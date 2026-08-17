// POST /api/team?action=invite | ?action=request-approval | ?action=review-approval | ?action=invite-manager | ?action=revoke-manager | ?action=scan-roster-exclusivity
// Merges the old standalone /api/invite-team-member, /api/request-approval,
// and /api/review-approval routes -- all three are small sponsor-team
// endpoints that were eating separate function slots for no benefit.
// See api/billing.js for more on why this pattern exists.
//
// invite-manager and revoke-manager added 2026-08-15, same slot
// reasoning -- Manager Seat Phase 1 (the creator<->manager link itself,
// no resource-table permissions yet). Named to avoid colliding with the
// existing sponsor-team ?action=invite. See
// lib/handlers/manager-invite.js and lib/handlers/manager-revoke.js.
//
// scan-roster-exclusivity added same day, same slot reasoning. Manager-
// facing, Group A item 2 -- roster-wide version of the creator-facing
// scan-exclusivity-conflicts action in campaign-actions.js. See
// lib/handlers/scan-roster-exclusivity.js for the scope note on what
// this does and does not detect.
const handleInvite = require('../lib/handlers/team-invite');
const handleRequestApproval = require('../lib/handlers/team-request-approval');
const handleReviewApproval = require('../lib/handlers/team-review-approval');
const handleManagerInvite = require('../lib/handlers/manager-invite');
const handleManagerRevoke = require('../lib/handlers/manager-revoke');
const handleScanRosterExclusivity = require('../lib/handlers/scan-roster-exclusivity');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite') return handleInvite(req, res);
  if (action === 'request-approval') return handleRequestApproval(req, res);
  if (action === 'review-approval') return handleReviewApproval(req, res);
  if (action === 'invite-manager') return handleManagerInvite(req, res);
  if (action === 'revoke-manager') return handleManagerRevoke(req, res);
  if (action === 'scan-roster-exclusivity') return handleScanRosterExclusivity(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite, ?action=request-approval, ?action=review-approval, ?action=invite-manager, ?action=revoke-manager, or ?action=scan-roster-exclusivity.' });
};
