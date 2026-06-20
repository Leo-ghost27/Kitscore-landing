// POST /api/create-checkout-session  { product: 'report'|'starter'|'team', evaluationId?, creatorId? }
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  report: process.env.STRIPE_PRICE_REPORT,
  starter: process.env.STRIPE_PRICE_STARTER,
  team: process.env.STRIPE_PRICE_TEAM,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { product, evaluationId, creatorId } = req.body || {};
  const priceId = PRICE_MAP[product];
  if (!priceId) return res.status(400).json({ error: 'Unknown or unconfigured product' });

  // For report purchases, confirm this sponsor actually owns the evaluation
  // they're trying to unlock before sending them to Stripe.
  if (product === 'report') {
    if (!evaluationId) return res.status(400).json({ error: 'evaluationId is required for report purchase' });
    const admin = adminClient();
    const { data: evalRow } = await admin.from('evaluations').select('id')
      .eq('id', evaluationId).eq('sponsor_id', sponsor.id).maybeSingle();
    if (!evalRow) return res.status(404).json({ error: 'Evaluation not found for this sponsor' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const returnPath = product === 'report' ? `evaluate.html?creator=${creatorId || ''}` : 'pricing.html';
  const sep = returnPath.includes('?') ? '&' : '?';

  const session = await stripe.checkout.sessions.create({
    mode: (product === 'starter' || product === 'team') ? 'subscription' : 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/app/${returnPath}${sep}checkout=success`,
    cancel_url: `${origin}/app/${returnPath}${sep}checkout=cancelled`,
    metadata: { sponsorId: sponsor.id, product, evaluationId: evaluationId || '' },
  });

  res.status(200).json({ url: session.url });
};
