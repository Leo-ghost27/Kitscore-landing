// POST /api/escrow?action=admin-release  { contractId, note, amountCents? }
// Admin's release-side intervention for a stuck or contested escrow --
// same kind of Stripe transfer as escrow-release.js, but callable by
// admin instead of requiring the sponsor to click it, and supports a
// PARTIAL amount for mediated outcomes (e.g. "creator delivered, not to
// spec -- agreed to release 20%, refund the rest"). Omitting amountCents
// releases everything still undisbursed (the old all-or-nothing
// behavior). amountCents is GROSS -- taken out of escrow_amount_cents
// before the platform's fee %, same ratio as a full release -- the
// actual Stripe transfer is amountCents net of that proportional fee.
//
// Still requires deliverable_submitted_at, same as the sponsor-facing
// flow -- admin is stepping in for an unresponsive/uncooperative sponsor,
// not waiving the "creator actually submitted something" gate. `note` is
// mandatory and written to admin_actions so every forced release has a
// stated reason on record.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');
const { sendEmail, escrowReleasedEmail } = require('../email');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleAdminRelease(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { contractId, note, amountCents } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note explaining the intervention is required' });
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    return res.status(400).json({ error: 'amountCents must be a positive integer if provided' });
  }

  const db = adminClient();

  try {
    const { data: contract } = await db.from('contracts')
      .select('*, creators!inner(id, stripe_connect_account_id, profiles!inner(display_name))')
      .eq('id', contractId).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status}, not held -- nothing to release` });
    }
    if (!contract.deliverable_submitted_at) {
      return res.status(400).json({ error: 'The creator has not submitted the deliverable yet' });
    }
    if (!contract.creators.stripe_connect_account_id) {
      return res.status(400).json({ error: 'This creator has no connected payout account' });
    }

    const releasedSoFar = contract.escrow_released_cents || 0;
    const refundedSoFar = contract.escrow_refunded_cents || 0;
    const remainingGross = contract.escrow_amount_cents - releasedSoFar - refundedSoFar;
    if (remainingGross <= 0) return res.status(400).json({ error: 'Nothing left in escrow to release' });

    const releaseGross = amountCents !== undefined ? amountCents : remainingGross;
    if (releaseGross > remainingGross) {
      return res.status(400).json({ error: `Only $${(remainingGross / 100).toFixed(2)} remains undisbursed on this contract` });
    }

    const feeRatio = contract.escrow_amount_cents > 0 ? (contract.platform_fee_cents || 0) / contract.escrow_amount_cents : 0;
    const netTransfer = Math.round(releaseGross * (1 - feeRatio));
    if (netTransfer <= 0) return res.status(400).json({ error: 'That amount is too small to transfer after the platform fee' });

    const transfer = await stripe.transfers.create({
      amount: netTransfer,
      currency: 'usd',
      destination: contract.creators.stripe_connect_account_id,
      source_transaction: contract.escrow_charge_id || undefined,
      metadata: { contractId: contract.id, type: 'contract_escrow_release', forcedByAdmin: admin.id, grossCents: releaseGross },
    });

    const newReleasedTotal = releasedSoFar + releaseGross;
    const remainingAfter = contract.escrow_amount_cents - newReleasedTotal - refundedSoFar;
    const fullySettled = remainingAfter <= 0;
    const newStatus = fullySettled ? (refundedSoFar > 0 ? 'settled' : 'released') : 'held';

    await db.from('contracts').update({
      escrow_status: newStatus,
      escrow_released_cents: newReleasedTotal,
      escrow_transfer_id: transfer.id,
      ...(fullySettled ? { released_at: new Date().toISOString() } : {}),
      ...(contract.disputed_at ? { admin_resolved_at: new Date().toISOString(), admin_resolution_note: note.trim() } : {}),
    }).eq('id', contractId);

    await db.from('admin_actions').insert({
      admin_id: admin.id,
      action_type: 'escrow_force_release',
      target_table: 'contracts',
      target_id: contractId,
      note: note.trim(),
      metadata: { transferId: transfer.id, grossCents: releaseGross, netTransferCents: netTransfer, partial: !fullySettled },
    });

    const { data: creatorProfile } = await db.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
    if (creatorProfile?.email) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      await sendEmail({
        to: creatorProfile.email,
        ...escrowReleasedEmail({
          contractTitle: contract.title,
          amountCents: netTransfer,
          contractsUrl: `${origin}/app/contracts.html`,
        }),
      });
    }

    res.status(200).json({ ok: true, transferId: transfer.id, releasedGrossCents: releaseGross, netTransferCents: netTransfer, fullySettled });
  } catch (err) {
    console.error('escrow admin release error:', err);
    res.status(500).json({ error: err.message || 'Could not release escrow funds' });
  }
};
