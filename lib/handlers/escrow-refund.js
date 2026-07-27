// POST /api/escrow?action=refund  { contractId }
// Sponsor-side release valve: refunds the held payment back to the
// sponsor instead of releasing it to the creator. No formal dispute
// workflow in this v1 -- release-or-refund is the sponsor's call,
// same pattern as contract voiding (sponsor-only) elsewhere in this
// feature. Only valid while escrow_status is still 'held' -- once
// released, funds have already left the platform's balance and this
// endpoint can't touch them.
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleRefund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { contractId } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*').eq('id', contractId).eq('sponsor_id', sponsor.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this sponsor' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status} -- can only refund funds that are currently held` });
    }
    if (!contract.escrow_payment_intent_id) {
      return res.status(400).json({ error: 'No payment found to refund on this contract' });
    }

    await stripe.refunds.create({ payment_intent: contract.escrow_payment_intent_id });

    await admin.from('contracts').update({
      escrow_status: 'refunded',
      refunded_at: new Date().toISOString(),
    }).eq('id', contractId);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('escrow refund error:', err);
    res.status(500).json({ error: err.message || 'Could not refund escrow funds' });
  }
};
