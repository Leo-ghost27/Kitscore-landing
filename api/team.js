// POST /api/team?action=invite | ?action=request-approval | ?action=review-approval
// Merges the old standalone /api/invite-team-member, /api/request-approval,
// and /api/review-approval routes -- all three are small sponsor-team
// endpoints that were eating separate function slots for no benefit.
// See api/billing.js for more on why this pattern exists.
const handleInvite = require('../lib/handlers/team-invite');
const handleRequestApproval = require('../lib/handlers/team-request-approval');
const handleReviewApproval = require('../lib/handlers/team-review-approval');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite') return handleInvite(req, res);
  if (action === 'request-approval') return handleRequestApproval(req, res);
  if (action === 'review-approval') return handleReviewApproval(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite, ?action=request-approval, or ?action=review-approval.' });
};
