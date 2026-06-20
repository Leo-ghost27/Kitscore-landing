// POST /api/stripe-webhook — configured in the Stripe dashboard, not called by the browser.
// Verifies the signature, then on a confirmed payment unlocks the report or
// upgrades the sponsor's plan. This is the only code path that sets unlocked=true.
const Stripe = require('stripe');
const { adminClient } = require('./_supabase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { sponsorId, product, evaluationId } = session.metadata || {};
    const admin = adminClient();

    if (product === 'report' && evaluationId) {
      await admin.from('evaluations').update({ unlocked: true }).eq('id', evaluationId);
    } else if ((product === 'starter' || product === 'team') && sponsorId) {
      await admin.from('sponsors').update({ plan: product }).eq('id', sponsorId);
    }
  }

  res.status(200).json({ received: true });
};

// Stripe needs the raw, unparsed body to verify the signature.
handler.config = { api: { bodyParser: false } };

module.exports = handler;
