// POST /api/escrow?action=fund  { contractId }
// Creates a Stripe Checkout Session that charges the sponsor and lands
// the funds in the PLATFORM's own Stripe balance (no transfer_data/
// destination set here) -- this is the "hold" half of escrow. The
// contract itself is NOT marked funded by this handler; that only
// happens once Stripe confirms the charge via webhook
// (checkout.session.completed, metadata.type === 'contract_escrow'),
// so an abandoned checkout just leaves the contract as not_funded
// rather than stuck in a false-positive state.
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const DEFAULT_FEE_PCT = 10;

module.exports = async function handleFund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { contractId } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*, creators!inner(id, stripe_connect_account_id, stripe_connect_payouts_enabled, profiles!inner(display_name))')
      .eq('id', contractId).eq('sponsor_id', sponsor.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this sponsor' });
    if (contract.status !== 'fully_signed') {
      return res.status(400).json({ error: 'Both parties must sign before a contract can be funded' });
    }
    if (contract.escrow_status !== 'not_funded') {
      return res.status(400).json({ error: `This contract's escrow is already ${contract.escrow_status}` });
    }
    if (!contract.escrow_amount_cents || contract.escrow_amount_cents <= 0) {
      return res.status(400).json({ error: 'No escrow amount was set when this contract was drafted' });
    }
    if (!contract.creators.stripe_connect_payouts_enabled) {
      return res.status(400).json({ error: 'This creator has not finished setting up their payout account yet -- ask them to connect payouts before funding.' });
    }

    const feePct = Number(process.env.PLATFORM_ESCROW_FEE_PCT) || DEFAULT_FEE_PCT;
    const platformFeeCents = Math.round(contract.escrow_amount_cents * feePct / 100);

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Escrow: ${contract.title}` },
          unit_amount: contract.escrow_amount_cents,
        },
        quantity: 1,
      }],
      success_url: `${origin}/app/contracts.html?escrow=funded`,
      cancel_url: `${origin}/app/contracts.html?escrow=cancelled`,
      metadata: {
        type: 'contract_escrow',
        contractId: contract.id,
        platformFeeCents: String(platformFeeCents),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('escrow fund error:', err);
    res.status(500).json({ error: err.message || 'Could not start escrow payment' });
  }
};
