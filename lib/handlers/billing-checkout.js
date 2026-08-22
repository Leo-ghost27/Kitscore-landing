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
  manager: process.env.STRIPE_PRICE_MANAGER,
  agency: process.env.STRIPE_PRICE_AGENCY,
};

const PRODUCT_CONFIG = {
  report:            { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  evaluation_unlock: { role: 'sponsor', mode: 'payment',      returnPath: (b) => `evaluate.html?creator=${b.creatorId || ''}` },
  starter:           { role: 'sponsor', mode: 'subscription', returnPath: () => 'directory.html' },
  starter_overage:   { role: 'sponsor', mode: 'payment',      returnPath: () => 'directory.html' },
  // trialDays: 14 -- product decision (2026-08-21) to nudge sponsors
  // toward Team over On Demand/Starter, since it offers meaningfully
  // more. Open to any new Team signup, not gated to upgrades from an
  // existing paid plan. trialTable/trial_used guard below is the same
  // once-per-account mechanism Manager already uses.
  team:              { role: 'sponsor', mode: 'subscription', returnPath: () => 'team.html', trialDays: 14, trialTable: 'sponsors' },
  creator_pro:       { role: 'creator', mode: 'subscription', returnPath: () => 'pricing-creator.html' },
  // Manager ($49/mo, up to 5 creators) and Agency ($149/mo, unlimited) are
  // both wired end-to-end here (checkout, plan/subscription_status flip in
  // stripe-webhook.js, entry points on profile-manager.html and the
  // workspace paywall) but stay inert -- "Unknown or unconfigured product"
  // -- until real recurring Prices exist in Stripe and STRIPE_PRICE_MANAGER
  // / STRIPE_PRICE_AGENCY are set in the Vercel env. Those price points are
  // a business decision, not something to invent here.
  //
  // trialDays: 14 -- both get one free trial, but it's a single
  // once-per-account guard (trial_used lives on managers.id, not
  // per-product), which is what makes offering both safe: someone
  // upgrading from an already-trialed Manager to Agency does NOT get a
  // second free trial (trial_used is already true on their row), but
  // someone signing up cold directly at Agency (2026-08-22, marketing
  // page now offers a direct path, not just Manager-first upgrade) does
  // get theirs. No separate abuse-prevention logic needed -- the shared
  // trial_used column already enforces "one trial per account, whichever
  // product you hit it on first" by construction.
  manager:           { role: 'manager', mode: 'subscription', returnPath: () => 'agency.html', trialDays: 14, trialTable: 'managers' },
  agency:            { role: 'manager', mode: 'subscription', returnPath: () => 'profile-manager.html', trialDays: 14, trialTable: 'managers' },
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

    // ── Starter/Team plans: included evaluations per billing period,
    // no Stripe charge until the allowance is used up (25 for Starter,
    // 150 for Team, matching pricing.html). Was previously Starter-only
    // -- Team's marketed "150 included" was never actually enforced,
    // silently falling through to the full $29 evaluation_unlock price
    // for every Team sponsor. fn_claim_free_eval_unlock now looks up
    // the right threshold per plan instead of hardcoding Starter's 25.
    //
    // Overage price: reusing Starter's $12 rate for Team overage too,
    // as a functional default -- there's no established Team-specific
    // overage price yet, so this is a placeholder pending an actual
    // pricing decision, not a considered business call.
    //
    // fn_claim_free_eval_unlock does the check-and-increment atomically in
    // one UPDATE ... WHERE evals_used_this_period < threshold ... RETURNING,
    // so two concurrent requests (double-click, two tabs) can't both win the
    // last free slot — a prior version read `used` then wrote it back as two
    // separate calls, which had exactly that race.
    if (product === 'evaluation_unlock') {
      const admin = adminClient();
      const { data: sponsorRow } = await admin.from('sponsors')
        .select('plan').eq('id', buyer.id).maybeSingle();

      if (sponsorRow?.plan === 'starter' || sponsorRow?.plan === 'team') {
        const { data: claim } = await admin.rpc('fn_claim_free_eval_unlock', { p_sponsor_id: buyer.id });
        const claimed = claim?.[0]?.claimed;

        if (claimed) {
          await admin.from('evaluations').update({ unlocked: true }).eq('id', evaluationId);

          const origin = req.headers.origin || `https://${req.headers.host}`;
          const returnPath = config.returnPath(req.body || {});
          const sep = returnPath.includes('?') ? '&' : '?';
          return res.status(200).json({ url: `${origin}/app/${returnPath}${sep}checkout=success&product=evaluation_unlock` });
        }
        // Same overage price for both plans for now -- see note above.
        effectivePriceId = PRICE_MAP.starter_overage;
      }
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const returnPath = config.returnPath(req.body || {});
    const sep = returnPath.includes('?') ? '&' : '?';

    // Trial eligibility: Team and Manager both offer one (see trialDays
    // in PRODUCT_CONFIG), each once per account -- trial_used flips true
    // on first checkout completion (see stripe-webhook.js), so
    // cancel-and-resubscribe lands on a normal paid subscription, not a
    // fresh trial. trialTable picks which table to check since Team's
    // guard lives on sponsors and Manager's lives on managers.
    let subscriptionData;
    if (config.trialDays) {
      const admin = adminClient();
      const { data: row } = await admin.from(config.trialTable).select('trial_used').eq('id', buyer.id).maybeSingle();
      if (!row?.trial_used) {
        subscriptionData = { trial_period_days: config.trialDays };
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price: effectivePriceId, quantity: 1 }],
      success_url: `${origin}/app/${returnPath}${sep}checkout=success&product=${product}`,
      cancel_url: `${origin}/app/${returnPath}${sep}checkout=cancelled`,
      ...(subscriptionData ? { subscription_data: subscriptionData } : {}),
     metadata: { profileId: buyer.id, profileRole: config.role, product: product, evaluationId: evaluationId || '', type: (product === 'report' || product === 'evaluation_unlock') ? 'evaluation' : product, evaluation_id: evaluationId || '', creator_id: creatorId || '', sponsor_id: buyer.id }, 
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
