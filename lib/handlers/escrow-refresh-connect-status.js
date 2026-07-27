// POST /api/escrow?action=refresh-connect-status
// Called when the creator lands back on Kitscore after Stripe's hosted
// onboarding (both the refresh_url and return_url from the Account Link
// point at pages that call this). Re-fetches the account from Stripe
// directly rather than trusting the redirect alone -- the redirect just
// means onboarding finished or was abandoned, not that it succeeded.
const Stripe = require('stripe');
const { adminClient, getAuthedCreator } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleRefreshConnectStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });
  if (!creator.stripe_connect_account_id) {
    return res.status(200).json({ connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  }

  try {
    const account = await stripe.accounts.retrieve(creator.stripe_connect_account_id);
    const admin = adminClient();
    await admin.from('creators').update({
      stripe_connect_charges_enabled: !!account.charges_enabled,
      stripe_connect_payouts_enabled: !!account.payouts_enabled,
      stripe_connect_details_submitted: !!account.details_submitted,
    }).eq('id', creator.id);

    res.status(200).json({
      connected: true,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
    });
  } catch (err) {
    console.error('refresh-connect-status error:', err);
    res.status(500).json({ error: err.message || 'Could not refresh payout account status' });
  }
};
