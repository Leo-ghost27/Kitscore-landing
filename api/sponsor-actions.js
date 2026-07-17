// POST /api/sponsor-actions?action=invite-creator
// Sponsor-initiated, email-triggering actions. Currently just the one, but
// following the same action-dispatch pattern as creator-actions.js/team.js/
// billing.js so future sponsor-side actions don't each cost a new function
// slot -- see api/billing.js for the full reasoning.
const handleInviteCreator = require('../lib/handlers/sponsor-invite-creator');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite-creator') return handleInviteCreator(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite-creator.' });
};
