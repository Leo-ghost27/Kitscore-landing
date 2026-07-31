// POST /api/escrow?action=release  { contractId }
// The actual "un-hold" step: transfers the escrowed amount (minus the
// platform fee taken at fund time) from the platform's Stripe balance
// to the creator's connected account. Only callable once the creator
// has marked the deliverable submitted -- this is the sponsor's
// approval gate, there is no separate "approve" click before this.
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('../supabase-admin');
const { sendEmail, escrowReleasedEmail } = require('../email');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleRelease(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { contractId } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*, creators!inner(id, stripe_connect_account_id, profiles!inner(display_name))')
      .eq('id', contractId).eq('sponsor_id', sponsor.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this sponsor' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status}, not held -- nothing to release` });
    }
    if (!contract.deliverable_submitted_at) {
      return res.status(400).json({ error: 'The creator has not submitted the deliverable yet' });
    }
    if (!contract.creators.stripe_connect_account_id) {
      return res.status(400).json({ error: 'This creator has no connected payout account' });
    }
    if ((contract.escrow_released_cents || 0) > 0 || (contract.escrow_refunded_cents || 0) > 0) {
      return res.status(400).json({ error: 'A partial settlement is already in progress on this contract -- contact Kitscore support to finish it.' });
    }

    const transferAmount = contract.escrow_amount_cents - (contract.platform_fee_cents || 0);

    const transfer = await stripe.transfers.create({
      amount: transferAmount,
      currency: 'usd',
      destination: contract.creators.stripe_connect_account_id,
      source_transaction: contract.escrow_charge_id || undefined,
      metadata: { contractId: contract.id, type: 'contract_escrow_release' },
    });

    await admin.from('contracts').update({
      escrow_status: 'released',
      released_at: new Date().toISOString(),
      escrow_transfer_id: transfer.id,
    }).eq('id', contractId);

    const { data: creatorProfile } = await admin.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
    if (creatorProfile?.email) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      await sendEmail({
        to: creatorProfile.email,
        ...escrowReleasedEmail({
          contractTitle: contract.title,
          amountCents: transferAmount,
          contractsUrl: `${origin}/app/contracts.html`,
        }),
      });
    }

    res.status(200).json({ ok: true, transferId: transfer.id });
  } catch (err) {
    console.error('escrow release error:', err);
    // Stripe transfer failures (e.g. insufficient available platform
    // balance, destination account restricted) surface here with the
    // contract left untouched at escrow_status='held' -- safe to retry
    // once the underlying Stripe-side issue is resolved.
    res.status(500).json({ error: err.message || 'Could not release escrow funds' });
  }
};
