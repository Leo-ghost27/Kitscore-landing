// POST /api/team?action=invite | ?action=request-approval | ?action=review-approval | ?action=invite-manager | ?action=revoke-manager | ?action=scan-roster-exclusivity | ?action=invite-staff | ?action=revoke-staff | ?action=invite-roster
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
//
// invite-staff and revoke-staff added same day, same slot reasoning.
// Group A item 4 -- agency sub-seats. Staff inherit their owner's
// entire roster access (see fn_is_active_manager_for), not a separate
// per-creator grant. See lib/handlers/agency-staff-invite.js and
// lib/handlers/agency-staff-revoke.js.
//
// invite-roster added 2026-08-22, same slot reasoning -- the reverse of
// invite-manager: a manager invites a creator onto their roster, needed
// to make self-serve manager signup (same date) actually useful.
// Cancelling a pending roster invite doesn't need a server route, same
// as manager_invites -- roster_invites_manager_all already grants the
// manager ALL on rows they own, so profile-side pages can just delete
// the row directly. See lib/handlers/roster-invite.js.
const handleInvite = require('../lib/handlers/team-invite');
const handleRequestApproval = require('../lib/handlers/team-request-approval');
const handleReviewApproval = require('../lib/handlers/team-review-approval');
const handleManagerInvite = require('../lib/handlers/manager-invite');
const handleManagerRevoke = require('../lib/handlers/manager-revoke');
const handleScanRosterExclusivity = require('../lib/handlers/scan-roster-exclusivity');
const handleAgencyStaffInvite = require('../lib/handlers/agency-staff-invite');
const handleAgencyStaffRevoke = require('../lib/handlers/agency-staff-revoke');
const handleRosterInvite = require('../lib/handlers/roster-invite');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite') return handleInvite(req, res);
  if (action === 'request-approval') return handleRequestApproval(req, res);
  if (action === 'review-approval') return handleReviewApproval(req, res);
  if (action === 'invite-manager') return handleManagerInvite(req, res);
  if (action === 'revoke-manager') return handleManagerRevoke(req, res);
  if (action === 'scan-roster-exclusivity') return handleScanRosterExclusivity(req, res);
  if (action === 'invite-staff') return handleAgencyStaffInvite(req, res);
  if (action === 'revoke-staff') return handleAgencyStaffRevoke(req, res);
  if (action === 'invite-roster') return handleRosterInvite(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite, ?action=request-approval, ?action=review-approval, ?action=invite-manager, ?action=revoke-manager, ?action=scan-roster-exclusivity, ?action=invite-staff, ?action=revoke-staff, or ?action=invite-roster.' });
};
