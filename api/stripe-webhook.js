// POST /api/stripe-webhook
// Verifies Stripe signature then routes events. This is the only code path
// that mutates billing state — never trust client-reported plan changes.
//
// Requires these event types enabled on the Stripe webhook endpoint
// (Dashboard → Developers → Webhooks): checkout.session.completed,
// customer.subscription.trial_will_end, customer.subscription.updated,
// customer.subscription.deleted, charge.refunded, invoice.paid,
// invoice.payment_failed, account.updated. trial_will_end specifically
// was added 2026-08-21 alongside the Team trial and is easy to miss
// enabling since it's not fired by anything else this app does --
// without it, the handler below is dead code and terms.html's "we'll
// email a reminder" claim silently becomes false again.
const Stripe = require('stripe');
const { adminClient } = require('../lib/supabase-admin');
const { sendEmail, sponsorReceiptEmail, reportReadyEmail, refundConfirmationEmail, escrowFundedEmail, trialEndingEmail } = require('../lib/email');
const { deriveVerdict, fallbackSummary, fetchCreatorBriefData } = require('../lib/ai-brief');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Map Stripe price IDs to internal plan names.
// Reads from env vars — never hardcoded.
function planFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_STARTER]: 'starter',
    [process.env.STRIPE_PRICE_TEAM]: 'team',
    [process.env.STRIPE_PRICE_CREATOR_PRO]: 'creator_pro',
    [process.env.STRIPE_PRICE_MANAGER]: 'manager',
    [process.env.STRIPE_PRICE_AGENCY]: 'agency',
  };
  return map[priceId] || null;
}

// Find a sponsor, creator, or manager account by their Stripe customer ID.
// Checks all three tables since any role can hold a subscription
// (sponsors: starter/team, creators: creator_pro, managers: agency).
async function accountByCustomerId(admin, customerId) {
  const { data: sponsor } = await admin.from('sponsors')
    .select('id, plan').eq('stripe_customer_id', customerId).maybeSingle();
  if (sponsor) return { ...sponsor, table: 'sponsors' };

  const { data: creator } = await admin.from('creators')
    .select('id, plan').eq('stripe_customer_id', customerId).maybeSingle();
  if (creator) return { ...creator, table: 'creators' };

  const { data: manager } = await admin.from('managers')
    .select('id, plan').eq('stripe_customer_id', customerId).maybeSingle();
  if (manager) return { ...manager, table: 'managers' };

  return null;
}

// Retrieve the plan name from a Stripe subscription object
async function planFromSubscription(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return planFromPriceId(priceId);
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  const admin = adminClient();

  try {
    switch (event.type) {

      // ── checkout.session.completed ──────────────────────────────────────────
      // Existing handler: unlock reports, upgrade plans on first checkout.
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { profileId, profileRole, product, evaluationId } = session.metadata || {};

        // ── Escrow funding for a contract (separate flow from the
        // report/subscription checkout below -- no profileId/product in
        // its metadata, just type + contractId). Mark held, not
        // released -- funds sit in the platform's own Stripe balance
        // until api/escrow.js?action=release explicitly transfers them.
        if (session.metadata?.type === 'contract_escrow') {
          const contractId = session.metadata.contractId;
          const platformFeeCents = Number(session.metadata.platformFeeCents) || 0;
          if (contractId) {
            let chargeId = null;
            if (session.payment_intent) {
              const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
              chargeId = pi.latest_charge || null;
            }

            await admin.from('contracts').update({
              escrow_status: 'held',
              escrow_payment_intent_id: session.payment_intent,
              escrow_charge_id: chargeId,
              platform_fee_cents: platformFeeCents,
              funded_at: new Date().toISOString(),
            }).eq('id', contractId);

            const { data: contract } = await admin.from('contracts')
              .select('title, creator_id, sponsors!inner(company_name)').eq('id', contractId).maybeSingle();
            if (contract) {
              const { data: creatorProfile } = await admin.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
              if (creatorProfile?.email) {
                const origin = `https://${req.headers.host}`;
                await sendEmail({
                  to: creatorProfile.email,
                  ...escrowFundedEmail({
                    contractTitle: contract.title,
                    amountCents: session.amount_total,
                    sponsorCompanyName: contract.sponsors.company_name,
                    contractsUrl: `${origin}/app/contracts.html`,
                  }),
                });
              }
            }
          }
          break;
        }

        // Persist stripe_customer_id if not already stored — to the correct
        // table for this buyer's role (creator_pro buyers are creators,
        // agency buyers are managers, everyone else is a sponsor).
        if (session.customer && profileId) {
          const accountTable = profileRole === 'creator' ? 'creators' : profileRole === 'manager' ? 'managers' : 'sponsors';
          await admin.from(accountTable)
            .update({ stripe_customer_id: session.customer })
            .eq('id', profileId)
            .is('stripe_customer_id', null);
        }

        if (product === 'report' || product === 'evaluation_unlock') {
          if (evaluationId) {
            await admin.from('evaluations')
              .update({
                unlocked: true,
                stripe_payment_id: session.payment_intent || session.id,
                // Real amount actually charged this checkout -- $29
                // on-demand or $12 Starter overage, whichever applied.
                // Lets history.html report real spend instead of
                // assuming every paid unlock cost the same amount.
                price_cents: session.amount_total,
              }).eq('id', evaluationId);

            // Send receipt email to the sponsor
            const { data: evalRow } = await admin.from('evaluations')
              .select('creator_id, sponsor_id').eq('id', evaluationId).single();
            if (evalRow) {
              // Re-derive the verdict + template summary now that payment is
              // confirmed. This used to also call out to Claude for a
              // narrative AI brief (ai_summary) — removed July 2026 along
              // with the ANTHROPIC_API_KEY dependency; recommendation_summary
              // is now always the deterministic template sentence from
              // fallbackSummary(). See docs/session-handoff for context.
              try {
                const briefData = await fetchCreatorBriefData(admin, evalRow.creator_id);
                if (briefData) {
                  const verdict = deriveVerdict(briefData.trustScore, briefData.brandSafety, briefData.verifiedCount);
                  const { summary } = fallbackSummary(verdict);
                  await admin.from('evaluations').update({
                    recommendation_verdict: verdict,
                    recommendation_summary: summary,
                  }).eq('id', evaluationId);
                }
              } catch (summaryErr) {
                console.error('Verdict/summary refresh failed (non-fatal, payment already confirmed):', summaryErr);
              }

              const [{ data: creatorProfile }, { data: sponsorProfile }] = await Promise.all([
                admin.from('profiles').select('display_name').eq('id', evalRow.creator_id).single(),
                admin.from('profiles').select('email, display_name').eq('id', evalRow.sponsor_id).single(),
              ]);
              const origin = `https://${req.headers.host}`;
              const reportUrl = `${origin}/app/evaluate.html?creator=${evalRow.creator_id}`;
              const amount = session.amount_total || 2900; // cents
              if (sponsorProfile?.email) {
                await sendEmail({
                  to: sponsorProfile.email,
                  ...sponsorReceiptEmail({
                    amount,
                    creatorName: creatorProfile?.display_name || 'this creator',
                    reportUrl,
                  }),
                });
              }
            }
          }
        } else if (product === 'starter' || product === 'team') {
          // Team offers a 14-day trial to any new signup (2026-08-21
          // product decision -- nudge sponsors toward Team over On
          // Demand/Starter); Starter never has and still doesn't.
          // subscription_status reflects whether billing-checkout.js
          // granted a trial ('trialing') or not ('active') for Team,
          // same pattern as manager/agency below; trial_used is set
          // unconditionally on every Team checkout (not just trialing
          // ones) so a cancel-and-resubscribe doesn't get a second free
          // trial. Starter keeps its original unconditional 'active' --
          // it has no trial concept to get wrong.
          if (product === 'team') {
            const sub = session.subscription ? await stripe.subscriptions.retrieve(session.subscription) : null;
            await admin.from('sponsors').update({
              plan: product,
              subscription_status: sub ? sub.status : 'active',
              trial_used: true,
              trial_ends_at: sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            }).eq('id', profileId);
          } else {
            await admin.from('sponsors')
              .update({ plan: product, subscription_status: 'active' }).eq('id', profileId);
          }
        } else if (product === 'creator_pro') {
          await admin.from('creators').update({ plan: 'pro' }).eq('id', profileId);
        } else if (product === 'manager' || product === 'agency') {
          // Previously missing entirely -- 'agency' checkouts completed
          // without ever writing plan/subscription_status to managers,
          // so the upgrade button worked in Stripe but silently did
          // nothing in the app. subscription.status here reflects
          // whether billing-checkout.js granted a trial ('trialing') or
          // not ('active'); trial_used is set unconditionally so a
          // cancel-and-resubscribe doesn't get a second free trial.
          const sub = session.subscription ? await stripe.subscriptions.retrieve(session.subscription) : null;
          await admin.from('managers').update({
            plan: product,
            subscription_status: sub ? sub.status : 'active',
            trial_used: true,
            trial_ends_at: sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          }).eq('id', profileId);
        }
        break;
      }

      // ── customer.subscription.trial_will_end ────────────────────────────────
      // Fires 3 days before a trialing subscription converts to paid (Stripe's
      // default timing). Covers both Team ($299/mo) and Manager ($49/mo)
      // trials -- the only two products with trialDays set. Added alongside
      // the Team trial itself: promising "we'll email a reminder" in
      // terms.html without this existing would have been a false claim, and
      // Manager's trial had the same silent-auto-charge gap (only an in-app
      // countdown, nothing proactive) even before Team existed.
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        const account = await accountByCustomerId(admin, sub.customer);
        if (!account || (account.table !== 'sponsors' && account.table !== 'managers')) break;

        const { data: profile } = await admin.from('profiles').select('email').eq('id', account.id).maybeSingle();
        if (!profile?.email) break;

        const plan = await planFromSubscription(sub);
        const planLabel = { team: 'Team', manager: 'Manager', agency: 'Agency' }[plan] || 'subscription';
        const priceLabel = { team: '$299/mo', manager: '$49/mo', agency: '$149/mo' }[plan] || 'the plan price';
        const endDate = sub.trial_end
          ? new Date(sub.trial_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'soon';

        await sendEmail({ to: profile.email, ...trialEndingEmail({ planLabel, price: priceLabel, endDate }) });
        break;
      }

      // ── customer.subscription.updated ──────────────────────────────────────
      // Fires on plan changes, renewals, reactivations, and trial endings.
      // Source of truth for what plan the sponsor is actually on right now.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const account = await accountByCustomerId(admin, sub.customer);
        if (!account) break;

        const plan = await planFromSubscription(sub);
        const status = sub.status; // active | past_due | canceled | unpaid | trialing etc.

        const update = {};
        // Managers track subscription_status the same way sponsors do --
        // it's what the workspace paywall gate checks (trialing/active =
        // unlocked, anything else = locked), independent of which plan
        // (manager vs agency) they're nominally on.
        if (account.table === 'sponsors' || account.table === 'managers') update.subscription_status = status;
        if (plan) update.plan = plan;
        // If Stripe shows cancelled or unpaid, downgrade to free -- but
        // 'free' isn't a real manager plan (managers are always 'manager'
        // or 'agency'), so leave a manager's plan alone here and let
        // subscription_status='canceled'/'unpaid' do the actual locking.
        if ((status === 'canceled' || status === 'unpaid') && account.table !== 'managers') update.plan = 'free';

        await admin.from(account.table).update(update).eq('id', account.id);
        break;
      }

      // ── customer.subscription.deleted ──────────────────────────────────────
      // Fires when a subscription is fully cancelled (end of billing period).
      // Downgrade the sponsor to free — they've had their last paid period.
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const account = await accountByCustomerId(admin, sub.customer);
        if (!account) break;

        const update = {};
        if (account.table === 'sponsors') { update.plan = 'free'; update.subscription_status = 'cancelled'; }
        else if (account.table === 'managers') { update.subscription_status = 'cancelled'; } // plan stays manager/agency, gate locks on status
        else {
          // creators: founding-cohort creators get Pro for free (first
          // 100, see fn_set_founding_cohort) independent of any Stripe
          // subscription. If one of them ALSO independently paid for
          // Pro and cancels, they keep their founding-cohort Pro rather
          // than being downgraded to free -- only a non-founding
          // creator's cancellation actually drops them to free.
          const { data: row } = await admin.from('creators').select('founding_cohort').eq('id', account.id).maybeSingle();
          update.plan = row?.founding_cohort ? 'pro' : 'free';
        }
        await admin.from(account.table).update(update).eq('id', account.id);
        break;
      }

      // ── charge.refunded ─────────────────────────────────────────────────────
      // Fires when a refund is issued (from Stripe dashboard or API).
      // Send confirmation email to the customer so they know it's on its way.
      case 'charge.refunded': {
        const charge = event.data.object;
        const customerEmail = charge.billing_details?.email || charge.receipt_email;
        if (!customerEmail) break;

        // Get the most recent refund amount
        const latestRefund = charge.refunds?.data?.[0];
        const amount = latestRefund?.amount || charge.amount_refunded;
        const description = charge.description || 'Kitscore purchase';

        await sendEmail({
          to: customerEmail,
          ...refundConfirmationEmail({ amount, description }),
        });
        break;
      }
      // ── invoice.paid ──────────────────────────────────────────────────────
      // Fires when a subscription invoice (including renewals) is paid
      // successfully. This is the signal that a new billing period has
      // actually started — resets the Starter plan's included-evaluations
      // counter here rather than on subscription.updated, since that fires
      // for other reasons too (plan changes, trial endings) that shouldn't
      // reset usage mid-period.
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (!invoice.customer) break;
        const account = await accountByCustomerId(admin, invoice.customer);
        if (!account || account.table !== 'sponsors') break;
        if (account.plan !== 'starter') break;

        await admin.from('sponsors')
          .update({ evals_used_this_period: 0, period_start: new Date().toISOString() })
          .eq('id', account.id);
        break;
      }

      // Fires when a renewal charge fails. Mark as past_due — Stripe will
      // retry before ultimately cancelling, so don't downgrade immediately.
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.customer) break;
        const account = await accountByCustomerId(admin, invoice.customer);
        if (!account) break;

        // creators has no subscription_status column — nothing to persist
        // there yet. Sponsors get flagged past_due so the app can warn them.
        if (account.table === 'sponsors') {
          await admin.from('sponsors')
            .update({ subscription_status: 'past_due' })
            .eq('id', account.id);
        }
        break;
      }

      // ── account.updated ──────────────────────────────────────────────────
      // Fires whenever a connected account's status changes -- including
      // mid-onboarding as Stripe verifies details, not just at the end.
      // This is the authoritative sync path; api/escrow.js?action=refresh-
      // connect-status is a manual/on-return convenience that does the
      // same lookup, not the only path to correct data.
      case 'account.updated': {
        const account = event.data.object;
        await admin.from('creators').update({
          stripe_connect_charges_enabled: !!account.charges_enabled,
          stripe_connect_payouts_enabled: !!account.payouts_enabled,
          stripe_connect_details_submitted: !!account.details_submitted,
        }).eq('stripe_connect_account_id', account.id);
        break;
      }

      default:
        // Unhandled event types — acknowledge receipt so Stripe doesn't retry
        break;
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    // Still return 200 — returning 4xx/5xx causes Stripe to retry indefinitely
    return res.status(200).json({ received: true, error: err.message });
  }

  res.status(200).json({ received: true });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
