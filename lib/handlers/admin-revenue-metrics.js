// GET /api/billing?action=admin-metrics&days=30
// Admin-only revenue/business metrics: MRR, plan mix, churn, and one-time
// revenue for a trailing window (default 30 days). This intentionally
// pulls live from Stripe rather than reconstructing dollar amounts from
// locally-mirrored `plan`/`subscription_status` columns on sponsors/
// creators -- those columns track *current state* (see stripe-webhook.js),
// not a history of amounts or cancellation timestamps, so they can't
// answer "what's MRR" or "how many churned in the last 30 days" on their
// own. Stripe is the one place that actually has that history, so this
// asks Stripe directly instead of adding a locally-mirrored ledger that
// could drift from what Stripe actually billed.
//
// Folded into the existing /api/billing dispatcher (not a new /api/*.js
// file) to stay under Vercel's Hobby-plan serverless function cap -- see
// the comment at the top of api/billing.js.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Same price-ID env vars billing-checkout.js and stripe-webhook.js use --
// never hardcode a plan's price, always resolve it from Stripe/env.
const PLAN_LABEL = {
  [process.env.STRIPE_PRICE_STARTER]: 'Starter',
  [process.env.STRIPE_PRICE_TEAM]: 'Team',
  [process.env.STRIPE_PRICE_CREATOR_PRO]: 'Creator Pro',
};

async function listAll(fn, params, maxPages = 5) {
  let results = [];
  let startingAfter;
  for (let page = 0; page < maxPages; page++) {
    const resp = await fn({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    results = results.concat(resp.data);
    if (!resp.has_more || !resp.data.length) break;
    startingAfter = resp.data[resp.data.length - 1].id;
  }
  return results;
}

// Normalizes one subscription item to a monthly dollar amount.
// Recognizes month/year intervals; anything else (week/day, or a
// usage-based price with no fixed unit_amount) is skipped from the sum
// and surfaced in `unrecognizedItems` so it's visible rather than
// silently wrong.
function monthlyAmountForItem(item, unrecognized) {
  const price = item.price;
  if (!price || price.unit_amount == null || !price.recurring) {
    unrecognized.push({ priceId: price?.id, reason: 'no fixed unit_amount (usage-based or missing)' });
    return 0;
  }
  const qty = item.quantity || 1;
  const total = price.unit_amount * qty;
  if (price.recurring.interval === 'month') return total / (price.recurring.interval_count || 1);
  if (price.recurring.interval === 'year') return total / (12 * (price.recurring.interval_count || 1));
  unrecognized.push({ priceId: price.id, reason: `unhandled interval: ${price.recurring.interval}` });
  return 0;
}

module.exports = async function handleAdminRevenueMetrics(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 30, 1), 365);
  const periodStartUnix = Math.floor(Date.now() / 1000) - days * 86400;

  try {
    const [activeSubs, pastDueSubs, trialingSubs] = await Promise.all([
      listAll(stripe.subscriptions.list.bind(stripe.subscriptions), { status: 'active', expand: ['data.items.data.price'] }),
      listAll(stripe.subscriptions.list.bind(stripe.subscriptions), { status: 'past_due', expand: ['data.items.data.price'] }),
      listAll(stripe.subscriptions.list.bind(stripe.subscriptions), { status: 'trialing', expand: ['data.items.data.price'] }),
    ]);

    const unrecognizedItems = [];
    const planMix = {}; // label -> count of subscriptions
    let mrrCents = 0;

    for (const sub of [...activeSubs, ...pastDueSubs]) {
      let subLabel = null;
      for (const item of sub.items.data) {
        mrrCents += monthlyAmountForItem(item, unrecognizedItems);
        if (!subLabel) subLabel = PLAN_LABEL[item.price?.id] || item.price?.nickname || 'Other';
      }
      planMix[subLabel] = (planMix[subLabel] || 0) + 1;
    }

    let trialingMrrCents = 0;
    for (const sub of trialingSubs) {
      for (const item of sub.items.data) trialingMrrCents += monthlyAmountForItem(item, []);
    }

    // Churn: count of subscription-cancellation events in the window.
    // Using the Events API (not subscriptions.list) because a cancelled
    // subscription's `canceled_at` isn't filterable via list() -- events
    // are the documented way to ask "what got cancelled in this window."
    const churnEvents = await listAll(
      stripe.events.list.bind(stripe.events),
      { type: 'customer.subscription.deleted', created: { gte: periodStartUnix } },
      10
    );
    const churnedSubIds = new Set(churnEvents.map(e => e.data.object.id));
    const activeNow = activeSubs.length + pastDueSubs.length;
    // Rough approximation of the denominator (active-at-start-of-period)
    // since we don't have a historical snapshot to compare against --
    // flagged as approximate in the response rather than presented as exact.
    const approxChurnRate = (activeNow + churnedSubIds.size) > 0
      ? churnedSubIds.size / (activeNow + churnedSubIds.size)
      : 0;

    // One-time revenue in the window: successful charges NOT attached to
    // a subscription invoice (report purchases, evaluation unlocks,
    // starter overage top-ups). Subscription revenue is already captured
    // in MRR above, so it's deliberately excluded here to avoid double-
    // counting the same dollars under two different metrics.
    const charges = await listAll(
      stripe.charges.list.bind(stripe.charges),
      { created: { gte: periodStartUnix } },
      10
    );
    let oneTimeRevenueCents = 0;
    let oneTimeRefundedCents = 0;
    let oneTimeCount = 0;
    for (const charge of charges) {
      if (!charge.paid || charge.invoice) continue;
      oneTimeRevenueCents += charge.amount;
      oneTimeRefundedCents += charge.amount_refunded || 0;
      oneTimeCount += 1;
    }

    // Local headcount for context (paid vs free split) -- not a source of
    // dollar figures, just "how many accounts", which the local DB does
    // know accurately regardless of Stripe.
    const db = adminClient();
    const [{ count: totalSponsors }, { count: totalCreators }] = await Promise.all([
      db.from('sponsors').select('id', { count: 'exact', head: true }).eq('is_test', false),
      db.from('creators').select('id', { count: 'exact', head: true }).eq('is_test', false),
    ]);

    return res.status(200).json({
      periodDays: days,
      mrr: { cents: Math.round(mrrCents), planMix },
      trialing: { count: trialingSubs.length, projectedMrrCents: Math.round(trialingMrrCents) },
      churn: {
        cancelledCount: churnedSubIds.size,
        activeNow,
        approxChurnRate,
        note: 'approxChurnRate is cancelled / (active-now + cancelled) -- a rough proxy, not a cohort-based churn rate, since Stripe does not retain a historical active-subscriber snapshot to divide against.',
      },
      oneTimeRevenue: {
        cents: oneTimeRevenueCents,
        refundedCents: oneTimeRefundedCents,
        netCents: oneTimeRevenueCents - oneTimeRefundedCents,
        count: oneTimeCount,
      },
      accounts: { totalSponsors: totalSponsors || 0, totalCreators: totalCreators || 0 },
      unrecognizedItems,
    });
  } catch (err) {
    console.error('admin-revenue-metrics error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load revenue metrics' });
  }
};
