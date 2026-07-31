// POST /api/escrow?action=admin-refund  { contractId, note, amountCents? }
// Admin's refund-side intervention -- mirrors escrow-refund.js (sponsor's
// release valve) but callable by admin for a contested or stuck escrow,
// and supports a PARTIAL amount for mediated outcomes (e.g. release 20%
// to the creator, refund the other 80% to the sponsor). Omitting
// amountCents refunds everything still undisbursed (the old
// all-or-nothing behavior). Unlike release, amountCents here needs no fee
// adjustment -- refunding just returns actual charged dollars from the
// original Stripe charge, no proportional split involved.
//
// Same 'held'-only rule as the sponsor-facing endpoint -- once fully
// settled, funds have already left the platform's balance and this can't
// touch them. `note` is mandatory and logged to admin_actions.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleAdminRefund(req, res) {
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
    const { data: contract } = await db.from('contracts').select('*').eq('id', contractId).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status} -- can only refund funds that are currently held` });
    }
    if (!contract.escrow_payment_intent_id) {
      return res.status(400).json({ error: 'No payment found to refund on this contract' });
    }

    const releasedSoFar = contract.escrow_released_cents || 0;
    const refundedSoFar = contract.escrow_refunded_cents || 0;
    const remainingGross = contract.escrow_amount_cents - releasedSoFar - refundedSoFar;
    if (remainingGross <= 0) return res.status(400).json({ error: 'Nothing left in escrow to refund' });

    const refundAmount = amountCents !== undefined ? amountCents : remainingGross;
    if (refundAmount > remainingGross) {
      return res.status(400).json({ error: `Only $${(remainingGross / 100).toFixed(2)} remains undisbursed on this contract` });
    }

    const refund = await stripe.refunds.create({
      payment_intent: contract.escrow_payment_intent_id,
      amount: refundAmount,
      metadata: { contractId: contract.id, forcedByAdmin: admin.id },
    });

    const newRefundedTotal = refundedSoFar + refundAmount;
    const remainingAfter = contract.escrow_amount_cents - releasedSoFar - newRefundedTotal;
    const fullySettled = remainingAfter <= 0;
    const newStatus = fullySettled ? (releasedSoFar > 0 ? 'settled' : 'refunded') : 'held';

    await db.from('contracts').update({
      escrow_status: newStatus,
      escrow_refunded_cents: newRefundedTotal,
      ...(fullySettled ? { refunded_at: new Date().toISOString() } : {}),
    }).eq('id', contractId);

    await db.from('admin_actions').insert({
      admin_id: admin.id,
      action_type: 'escrow_force_refund',
      target_table: 'contracts',
      target_id: contractId,
      note: note.trim(),
      metadata: { refundId: refund.id, amountCents: refundAmount, partial: !fullySettled },
    });

    res.status(200).json({ ok: true, refundId: refund.id, refundedCents: refundAmount, fullySettled });
  } catch (err) {
    console.error('escrow admin refund error:', err);
    res.status(500).json({ error: err.message || 'Could not refund escrow funds' });
  }
};
