// POST /api/create-portal-session
// Creates a Stripe Billing Portal session for the authenticated sponsor
// so they can manage their subscription, update card, cancel, etc.
// Stripe requires a customer ID — we store it on first portal visit.
const Stripe = require('stripe');
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const admin = adminClient();
    const { data: sponsorRow } = await admin.from('sponsors').select('stripe_customer_id, plan').eq('id', sponsor.id).single();

    let customerId = sponsorRow?.stripe_customer_id;

    if (!customerId) {
      // First portal visit — find or create the Stripe customer by email
      const { data: profileRow } = await admin.from('profiles').select('email, display_name').eq('id', sponsor.id).single();
      const existing = await stripe.customers.list({ email: profileRow?.email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: profileRow?.email,
          name: profileRow?.display_name,
          metadata: { kitscore_sponsor_id: sponsor.id },
        });
        customerId = customer.id;
      }
      // Persist so we don't look it up every time
      await admin.from('sponsors').update({ stripe_customer_id: customerId }).eq('id', sponsor.id);
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/pricing.html`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
