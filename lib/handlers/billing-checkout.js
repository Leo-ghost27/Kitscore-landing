// POST /api/billing?action=checkout  { product: 'report'|'starter'|'team'|'creator_pro', evaluationId?, creatorId? }
// (moved from the old standalone /api/create-checkout-session route during
// the July 2026 API-route consolidation -- logic unchanged)
const Stripe = require('stripe');
const { adminClient, getAuthedProfile } = require('../supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  report: process.env.STRIPE_PRICE_REPORT,
  evaluation_unlock: process.env.STRIPE_PRICE_EVALUATION_UNLOCK || process.env.STRIPE_PRICE_REPORT,
  starter: process.env.STRIPE_PRICE_STARTER,
  starter_overage: process.env.STRIPE_PRICE_STARTER_OVERAGE,
  team: process.env.STRIPE_PRICE_TEAM,
  creator_pro: process.env.STRIPE_PRICE_CREATOR_PRO,
};

const PRODUCT_CONFIG = {
  report:            { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  evaluation_unlock: { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  starter:           { role: 'sponsor', mode: 'subscription', returnPath: () => 'directory.html' },
  starter_overage:   { role: 'sponsor', mode: 'payment',      returnPath: () => 'directory.html' },
  team:              { role: 'sponsor', mode: 'subscription', returnPath: () => 'team.html' },
  creator_pro:       { role: 'creator', mode: 'subscription', returnPath: () => 'pricing-creator.html' },
};

module.exports = async function handleBillingCheckout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { product, evaluationId, creatorId } = req.body || {};
    const config = PRODUCT_CONFIG[product];
    const priceId = PRICE_MAP[product];
    if (!config || !priceId) return res.status(400).json({ error: 'Unknown or unconfigured product' });

    const buyer = await getAuthedProfile(req, config.role);
    if (!buyer) return res.status(401).json({ error: `Not authenticated as a ${config.role}` });

    let effectivePriceId = priceId;

    // Confirm this sponsor actually owns the evaluation they're unlocking.
    // NOTE: the live frontend (evaluate.html) sends product:'evaluation_unlock',
    // not 'report' — this check used to only run for 'report', which meant it
    // silently never executed. Without it, a sponsor could pass any
    // evaluationId (including one belonging to another sponsor) and the
    // Stripe webhook would unlock it with no ownership cross-check on that
    // side either.
    if (product === 'report' || product === 'evaluation_unlock') {
      if (!evaluationId) return res.status(400).json({ error: 'evaluationId is required for report purchase' });
      const admin = adminClient();
      const { data: evalRow } = await admin.from('evaluations').select('id')
        .eq('id', evaluationId).eq('sponsor_id', buyer.id).maybeSingle();
      if (!evalRow) return res.status(404).json({ error: 'Evaluation not found for this sponsor' });

      // Team members (not the team owner) need owner sign-off before spending
      // team money on a paid unlock. Owners are unrestricted.
      const { data: membership } = await admin.from('team_members')
        .select('role').eq('sponsor_id', buyer.id).maybeSingle();
      if (membership && membership.role === 'member') {
        const { data: approved } = await admin.from('approval_requests')
          .select('id').eq('requested_by', buyer.id).eq('action_type', 'evaluation_unlock')
          .eq('target_type', 'evaluation').eq('target_id', evaluationId).eq('status', 'approved')
          .maybeSingle();
        if (!approved) {
          return res.status(403).json({
            error: 'This unlock needs your team owner\'s approval first.',
            requiresApproval: true,
          });
        }
      }
    }

    // ── Starter plan: first 25 unlocks per billing period are included free,
    // no Stripe charge. 26th+ charges the discounted $12 overage rate instead
    // of the standard $29 evaluation_unlock price. Team plan intentionally
    // left out for now — rate/approach still being decided (see audit doc).
    //
    // fn_claim_free_eval_unlock does the check-and-increment atomically in
    // one UPDATE ... WHERE evals_used_this_period < 25 ... RETURNING, so two
    // concurrent requests (double-click, two tabs) can't both win the last
    // free slot — a prior version read `used` then wrote it back as two
    // separate calls, which had exactly that race.
    if (product === 'evaluation_unlock') {
      const admin = adminClient();
      const { data: sponsorRow } = await admin.from('sponsors')
        .select('plan').eq('id', buyer.id).maybeSingle();

      if (sponsorRow?.plan === 'starter') {
        const { data: claim } = await admin.rpc('fn_claim_free_eval_unlock', { p_sponsor_id: buyer.id });
        const claimed = claim?.[0]?.claimed;

        if (claimed) {
          await admin.from('evaluations').update({ unlocked: true }).eq('id', evaluationId);

          const origin = req.headers.origin || `https://${req.headers.host}`;
          const returnPath = config.returnPath(req.body || {});
          const sep = returnPath.includes('?') ? '&' : '?';
          return res.status(200).json({ url: `${origin}/app/${returnPath}${sep}checkout=success&product=evaluation_unlock` });
        }
        effectivePriceId = PRICE_MAP.starter_overage;
      }
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const returnPath = config.returnPath(req.body || {});
    const sep = returnPath.includes('?') ? '&' : '?';

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price: effectivePriceId, quantity: 1 }],
      success_url: `${origin}/app/${returnPath}${sep}checkout=success&product=${product}`,
      cancel_url: `${origin}/app/${returnPath}${sep}checkout=cancelled`,
     metadata: { profileId: buyer.id, profileRole: config.role, product: product, evaluationId: evaluationId || '', type: (product === 'report' || product === 'evaluation_unlock') ? 'evaluation' : product, evaluation_id: evaluationId || '', creator_id: creatorId || '', sponsor_id: buyer.id }, 
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
