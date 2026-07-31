// POST /api/billing?action=checkout | ?action=portal
// Single Stripe billing entry point. Merges the old standalone
// /api/create-checkout-session and /api/create-portal-session routes into
// one function -- both were small, both were Stripe-only, and Vercel's
// Hobby plan caps us at 12 serverless functions. See docs/session-handoff
// for the July 2026 API-route consolidation that introduced this pattern
// (also used by /api/team.js, /api/campaign-actions.js, /api/documents.js).
//
// Body/behavior for each action is unchanged from the original routes --
// only the URL changed (from a dedicated path to ?action=on this one).
const handleCheckout = require('../lib/handlers/billing-checkout');
const handlePortal = require('../lib/handlers/billing-portal');
const handleAdminMetrics = require('../lib/handlers/admin-revenue-metrics');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'checkout') return handleCheckout(req, res);
  if (action === 'portal') return handlePortal(req, res);
  if (action === 'admin-metrics') return handleAdminMetrics(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=checkout, ?action=portal, or ?action=admin-metrics.' });
};
