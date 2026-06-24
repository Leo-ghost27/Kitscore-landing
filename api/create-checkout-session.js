// POST /api/create-checkout-session  { product: 'report'|'starter'|'team'|'creator_pro', evaluationId?, creatorId? }
const Stripe = require('stripe');
const { adminClient, getAuthedProfile } = require('./_supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  report: process.env.STRIPE_PRICE_REPORT,
  evaluation_unlock: process.env.STRIPE_PRICE_EVALUATION_UNLOCK || process.env.STRIPE_PRICE_REPORT,
  starter: process.env.STRIPE_PRICE_STARTER,
  team: process.env.STRIPE_PRICE_TEAM,
  creator_pro: process.env.STRIPE_PRICE_CREATOR_PRO,
};

const PRODUCT_CONFIG = {
  report:            { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  evaluation_unlock: { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  starter:           { role: 'sponsor', mode: 'subscription', returnPath: () => 'pricing.html' },
  team:              { role: 'sponsor', mode: 'subscription', returnPath: () => 'pricing.html' },
  creator_pro:       { role: 'creator', mode: 'subscription', returnPath: () => 'pricing-creator.html' },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { product, evaluationId, creatorId } = req.body || {};
    const config = PRODUCT_CONFIG[product];
    const priceId = PRICE_MAP[product];
    if (!config || !priceId) return res.status(400).json({ error: 'Unknown or unconfigured product' });

    const buyer = await getAuthedProfile(req, config.role);
    if (!buyer) return res.status(401).json({ error: `Not authenticated as a ${config.role}` });

    // For report purchases, confirm this sponsor actually owns the evaluation they're unlocking.
    if (product === 'report') {
      if (!evaluationId) return res.status(400).json({ error: 'evaluationId is required for report purchase' });
      const admin = adminClient();
      const { data: evalRow } = await admin.from('evaluations').select('id')
        .eq('id', evaluationId).eq('sponsor_id', buyer.id).maybeSingle();
      if (!evalRow) return res.status(404).json({ error: 'Evaluation not found for this sponsor' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const returnPath = config.returnPath(req.body || {});
    const sep = returnPath.includes('?') ? '&' : '?';

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app/${returnPath}${sep}checkout=success`,
      cancel_url: `${origin}/app/${returnPath}${sep}checkout=cancelled`,
      metadata: { profileId: buyer.id, profileRole: config.role, product, evaluationId: evaluationId || '', type: product === 'report' || product === 'evaluation_unlock' ? 'evaluation' : product, evaluation_id: evaluationId || '', creator_id: creatorId || '', sponsor_id: buyer.id },

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
