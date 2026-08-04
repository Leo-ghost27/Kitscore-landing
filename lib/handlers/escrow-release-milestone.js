// POST /api/escrow?action=release-milestone  { contractId, milestoneId }
//
// Milestone-based escrow release. Contracts fund their FULL
// escrow_amount_cents in one Stripe Checkout session exactly as before
// (escrow-fund.js, unchanged) -- this handler only changes how the
// held pool gets paid OUT. Splitting one funded charge into several
// sequential stripe.transfers.create() calls against the same
// source_transaction is a standard Stripe pattern, so no funding-side
// changes were needed to support this.
//
// A contract with zero contract_milestones rows is untouched by this
// file entirely and keeps using escrow-release.js's single, whole-
// amount release. This handler is only ever called for contracts that
// were drafted with milestones.
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('../supabase-admin');
const { sendEmail, escrowReleasedEmail } = require('../email');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleReleaseMilestone(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { contractId, milestoneId } = req.body || {};
  if (!contractId || !milestoneId) return res.status(400).json({ error: 'contractId and milestoneId are required' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*, creators!inner(id, stripe_connect_account_id, profiles!inner(display_name))')
      .eq('id', contractId).eq('sponsor_id', sponsor.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this sponsor' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status}, not held -- nothing to release` });
    }
    if (!contract.creators.stripe_connect_account_id) {
      return res.status(400).json({ error: 'This creator has no connected payout account' });
    }

    const { data: milestone } = await admin.from('contract_milestones')
      .select('*').eq('id', milestoneId).eq('contract_id', contractId).maybeSingle();

    if (!milestone) return res.status(404).json({ error: 'Milestone not found on this contract' });
    if (milestone.status === 'released') return res.status(400).json({ error: 'This milestone was already released' });

    // Same fee percentage as the whole-contract flow, applied
    // proportionally to just this milestone's share of the total.
    const feeRatio = contract.escrow_amount_cents > 0 ? (contract.platform_fee_cents || 0) / contract.escrow_amount_cents : 0;
    const milestoneFeeCents = Math.round(milestone.amount_cents * feeRatio);
    const transferAmount = milestone.amount_cents - milestoneFeeCents;

    const transfer = await stripe.transfers.create({
      amount: transferAmount,
      currency: 'usd',
      destination: contract.creators.stripe_connect_account_id,
      source_transaction: contract.escrow_charge_id || undefined,
      metadata: { contractId: contract.id, milestoneId: milestone.id, type: 'contract_milestone_release' },
    });

    await admin.from('contract_milestones').update({
      status: 'released',
      released_at: new Date().toISOString(),
      stripe_transfer_id: transfer.id,
    }).eq('id', milestoneId);

    const newReleasedCents = (contract.escrow_released_cents || 0) + milestone.amount_cents;
    const isFullyReleased = newReleasedCents >= contract.escrow_amount_cents;

    await admin.from('contracts').update({
      escrow_released_cents: newReleasedCents,
      ...(isFullyReleased ? { escrow_status: 'released', released_at: new Date().toISOString() } : {}),
    }).eq('id', contractId);

    const { data: creatorProfile } = await admin.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
    if (creatorProfile?.email) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      await sendEmail({
        to: creatorProfile.email,
        ...escrowReleasedEmail({
          contractTitle: `${contract.title} — ${milestone.title}`,
          amountCents: transferAmount,
          contractsUrl: `${origin}/app/contracts.html`,
        }),
      });
    }

    res.status(200).json({ ok: true, transferId: transfer.id, fullyReleased: isFullyReleased });
  } catch (err) {
    console.error('escrow milestone release error:', err);
    // Left untouched at status='pending' on failure -- safe to retry
    // once the underlying Stripe-side issue (insufficient available
    // platform balance, destination account restricted, etc.) is
    // resolved, same recovery story as escrow-release.js.
    res.status(500).json({ error: err.message || 'Could not release milestone funds' });
  }
};
