// GET /api/escrow?action=balance
//
// Surfaces what a creator's connected Stripe Express account actually
// holds -- the app had no view into this at all before. A creator could
// see "Payouts ready" on their profile and get an email when Kitscore
// released funds, but the only way to see the real balance or when it'd
// actually reach their bank was logging into Stripe directly, which
// most creators won't know to do (found this gap live-testing the
// escrow flow -- money had genuinely landed but was invisible in-app).
//
// Reads directly from Stripe's Balance and Payouts APIs scoped to the
// creator's own connected account via { stripeAccount: ... } -- this
// does NOT touch Kitscore's platform balance, only what's sitting in
// that one creator's Express account.
const Stripe = require('stripe');
const { getAuthedCreator } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  if (!creator.stripe_connect_account_id) {
    return res.status(200).json({ connected: false });
  }

  try {
    const stripeAccount = creator.stripe_connect_account_id;

    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve({ stripeAccount }),
      stripe.payouts.list({ limit: 5 }, { stripeAccount }),
    ]);

    // Both arrays are per-currency -- this app only ever funds in USD
    // (see escrow-fund.js), so collapsing to a single USD figure is
    // correct today. Revisit if multi-currency escrow ever ships.
    const usdAvailable = balance.available.find(b => b.currency === 'usd')?.amount || 0;
    const usdPending = balance.pending.find(b => b.currency === 'usd')?.amount || 0;

    res.status(200).json({
      connected: true,
      availableCents: usdAvailable,
      pendingCents: usdPending,
      payouts: payouts.data.map(p => ({
        amountCents: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error('creator balance error:', err);
    res.status(500).json({ error: err.message || 'Could not load balance' });
  }
};
