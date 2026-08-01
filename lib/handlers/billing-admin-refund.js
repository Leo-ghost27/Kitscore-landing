// POST /api/billing?action=admin-refund  { chargeId, accountTable, accountId, amountCents?, reason?, note }
// Lets admin issue a refund on a sponsor/creator's subscription/billing
// charge from inside Kitscore, instead of the only path today being
// Stripe's own dashboard. api/stripe-webhook.js already handles
// charge.refunded and sends the customer confirmation email regardless of
// whether the refund came from the Dashboard or the API -- this handler
// doesn't duplicate that, it just triggers the refund and records why.
//
// This is billing/subscription money (starter/team/creator_pro plan
// charges), not contract escrow -- see lib/handlers/escrow-admin-refund.js
// for that. `note` is mandatory and logged to admin_actions, same
// governance pattern as every other admin money-moving action.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const VALID_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'];

module.exports = async function handleAdminBillingRefund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { chargeId, accountTable, accountId, amountCents, reason, note } = req.body || {};
  if (!chargeId) return res.status(400).json({ error: 'chargeId is required' });
  if (!['sponsors', 'creators'].includes(accountTable) || !accountId) {
    return res.status(400).json({ error: 'accountTable (sponsors|creators) and accountId are required' });
  }
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note explaining the refund is required' });
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    return res.status(400).json({ error: 'amountCents must be a positive integer if provided' });
  }
  if (reason !== undefined && !VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
  }

  const db = adminClient();

  try {
    const { data: account } = await db.from(accountTable).select('id, stripe_customer_id').eq('id', accountId).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const refund = await stripe.refunds.create({
      charge: chargeId,
      ...(amountCents !== undefined ? { amount: amountCents } : {}),
      ...(reason ? { reason } : {}),
      metadata: { accountTable, accountId, forcedByAdmin: admin.id },
    });

    await db.from('admin_actions').insert({
      admin_id: admin.id,
      action_type: 'billing_refund_issued',
      target_table: accountTable,
      target_id: accountId,
      note: note.trim(),
      metadata: { chargeId, refundId: refund.id, amountCents: refund.amount, reason: reason || null },
    });

    res.status(200).json({ ok: true, refundId: refund.id, amountCents: refund.amount });
  } catch (err) {
    console.error('billing admin refund error:', err);
    res.status(500).json({ error: err.message || 'Could not issue refund' });
  }
};
