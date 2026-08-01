// GET /api/billing?action=admin-list-charges&accountTable=sponsors|creators&accountId=...
// Looks up the account's stripe_customer_id, then lists their recent
// Stripe charges so admin can see what's refundable without leaving
// Kitscore. Read-only -- no state changes, so no note/audit-log
// requirement (that's on the actual refund action).
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleAdminListCharges(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { accountTable, accountId } = req.query || {};
  if (!['sponsors', 'creators'].includes(accountTable) || !accountId) {
    return res.status(400).json({ error: 'accountTable (sponsors|creators) and accountId are required' });
  }

  const db = adminClient();

  try {
    const { data: account } = await db.from(accountTable).select('id, stripe_customer_id').eq('id', accountId).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!account.stripe_customer_id) return res.status(200).json({ charges: [] });

    const charges = await stripe.charges.list({ customer: account.stripe_customer_id, limit: 20 });

    res.status(200).json({
      charges: charges.data.map(c => ({
        id: c.id,
        amount: c.amount,
        amountRefunded: c.amount_refunded,
        currency: c.currency,
        description: c.description,
        created: c.created,
        refunded: c.refunded,
        status: c.status,
        paid: c.paid,
      })),
    });
  } catch (err) {
    console.error('billing admin list charges error:', err);
    res.status(500).json({ error: err.message || 'Could not list charges' });
  }
};
