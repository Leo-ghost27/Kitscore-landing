// POST /api/escrow?action=admin-refund  { contractId, note }
// Admin's refund-side intervention -- mirrors escrow-refund.js (sponsor's
// release valve) but callable by admin for a contested or stuck escrow,
// e.g. the creator disputes a sponsor's refusal to release and admin sides
// with the sponsor, or the sponsor is unresponsive and the deal needs
// closing out either way. Same 'held'-only rule as the sponsor-facing
// endpoint -- once released, funds have already left the platform's
// balance and this can't touch them. `note` is mandatory and logged to
// admin_actions.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleAdminRefund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { contractId, note } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note explaining the intervention is required' });

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

    const refund = await stripe.refunds.create({
      payment_intent: contract.escrow_payment_intent_id,
      metadata: { contractId: contract.id, forcedByAdmin: admin.id },
    });

    await db.from('contracts').update({
      escrow_status: 'refunded',
      refunded_at: new Date().toISOString(),
    }).eq('id', contractId);

    await db.from('admin_actions').insert({
      admin_id: admin.id,
      action_type: 'escrow_force_refund',
      target_table: 'contracts',
      target_id: contractId,
      note: note.trim(),
      metadata: { refundId: refund.id, amountCents: contract.escrow_amount_cents },
    });

    res.status(200).json({ ok: true, refundId: refund.id });
  } catch (err) {
    console.error('escrow admin refund error:', err);
    res.status(500).json({ error: err.message || 'Could not refund escrow funds' });
  }
};
