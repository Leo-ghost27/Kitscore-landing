// POST /api/stripe-webhook
// Verifies Stripe signature then routes events. This is the only code path
// that mutates billing state — never trust client-reported plan changes.
const Stripe = require('stripe');
const { adminClient } = require('../lib/supabase-admin');
const { sendEmail, sponsorReceiptEmail, reportReadyEmail, refundConfirmationEmail } = require('../lib/email');
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
  };
  return map[priceId] || null;
}

// Find a sponsor or creator account by their Stripe customer ID.
// Checks both tables since either role can hold a subscription
// (sponsors: starter/team, creators: creator_pro).
async function accountByCustomerId(admin, customerId) {
  const { data: sponsor } = await admin.from('sponsors')
    .select('id, plan').eq('stripe_customer_id', customerId).maybeSingle();
  if (sponsor) return { ...sponsor, table: 'sponsors' };

  const { data: creator } = await admin.from('creators')
    .select('id, plan').eq('stripe_customer_id', customerId).maybeSingle();
  if (creator) return { ...creator, table: 'creators' };

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

        // Persist stripe_customer_id if not already stored — to the correct
        // table for this buyer's role, since creator_pro buyers are creators.
        if (session.customer && profileId) {
          const accountTable = profileRole === 'creator' ? 'creators' : 'sponsors';
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
          await admin.from('sponsors')
            .update({ plan: product, subscription_status: 'active' }).eq('id', profileId);
        } else if (product === 'creator_pro') {
          await admin.from('creators').update({ plan: 'pro' }).eq('id', profileId);
        }
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
        const status = sub.status; // active | past_due | canceled | unpaid etc.

        const update = {};
        if (account.table === 'sponsors') update.subscription_status = status;
        if (plan) update.plan = plan;
        // If Stripe shows cancelled or unpaid, downgrade to free
        if (status === 'canceled' || status === 'unpaid') update.plan = 'free';

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

        const update = { plan: 'free' };
        if (account.table === 'sponsors') update.subscription_status = 'cancelled';
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
