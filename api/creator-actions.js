// POST /api/creator-actions?action=invite-sponsor | ?action=notify-dispute
// Merges the old standalone /api/invite-sponsor-confirm and
// /api/notify-dispute routes -- both are creator-initiated,
// email-triggering actions with the same auth shape (getAuthedCreator).
// See api/billing.js for more on why this pattern exists.
const handleInviteSponsor = require('../lib/handlers/creator-invite-sponsor');
const handleNotifyDispute = require('../lib/handlers/creator-notify-dispute');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite-sponsor') return handleInviteSponsor(req, res);
  if (action === 'notify-dispute') return handleNotifyDispute(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite-sponsor or ?action=notify-dispute.' });
};
