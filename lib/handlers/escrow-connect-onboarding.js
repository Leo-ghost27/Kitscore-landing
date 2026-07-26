// POST /api/escrow?action=connect-onboarding
// Creates the creator's Stripe Connect Express account on first call (or
// reuses the existing one), then returns a fresh Account Link URL for
// Stripe-hosted onboarding. A creator needs this completed
// (charges_enabled + payouts_enabled) before a sponsor can release an
// escrowed payment to them -- Stripe itself enforces the actual KYC/bank
// details collection, Kitscore just tracks the resulting status flags.
const Stripe = require('stripe');
const { adminClient, getAuthedCreator } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleConnectOnboarding(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  const admin = adminClient();
  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    let accountId = creator.stripe_connect_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: creator.email || undefined,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_type: 'individual',
        metadata: { creator_id: creator.id },
      });
      accountId = account.id;
      await admin.from('creators').update({ stripe_connect_account_id: accountId }).eq('id', creator.id);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/app/profile.html?connect=refresh`,
      return_url: `${origin}/app/profile.html?connect=return`,
      type: 'account_onboarding',
    });

    res.status(200).json({ url: accountLink.url });
  } catch (err) {
    console.error('connect-onboarding error:', err);
    res.status(500).json({ error: err.message || 'Could not start payout account setup' });
  }
};
