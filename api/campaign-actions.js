// POST /api/campaign-actions?action=invite-sponsor | ?action=notify-dispute | ?action=invite-creator | ?action=scan-contract-clauses | ?action=draft-pitch | ?action=counter-offer-assist
//
// Merges the former api/creator-actions.js (invite-sponsor,
// notify-dispute) and api/sponsor-actions.js (invite-creator) into one
// function -- same consolidation pattern as api/billing.js/team.js/
// documents.js, done here specifically because both source files had
// exactly one caller between them (app/campaigns.html) and their three
// action names don't collide, so this needed no new param scheme, just
// one dispatcher instead of two. All three actions are part of the same
// campaign-confirmation flow (creator invites a sponsor to confirm a
// campaign, sponsor invites a creator, either side can flag a dispute),
// hence the "campaign-actions" name rather than reusing either the
// creator- or sponsor- prefix.
//
// scan-contract-clauses added 2026-08-01 -- contract-side, not campaign-
// side, but landed here rather than consuming the last Vercel function
// slot (11/12 used). See lib/handlers/scan-contract-clauses.js.
//
// draft-pitch added 2026-08-01 -- brief-application-side, same reasoning
// as scan-contract-clauses: no free function slot to spend on it. See
// lib/handlers/draft-pitch.js (Pro-gated, unlike scan-contract-clauses).
//
// counter-offer-assist added 2026-08-15 -- same reasoning again, still
// no free function slot (still 11/12; this file doesn't cost one either
// way since it's a dispatcher, not a new function). Brief-application-
// side like draft-pitch, and Pro-gated for the same reason. See
// lib/handlers/counter-offer-assist.js.
//
// scan-exclusivity-conflicts and request-verification added 2026-08-15,
// same slot reasoning. scan-exclusivity-conflicts is Pro-gated by
// explicit product decision -- flagged in its own file as inconsistent
// with scan-contract-clauses' free-for-everyone precedent, since this
// protects the same kind of real legal exposure. request-verification
// is free to call (sponsor-initiated, gating it would hurt discovery).
// See lib/handlers/scan-exclusivity-conflicts.js and
// lib/handlers/request-verification.js.
//
// Frees a Vercel Hobby function slot (was 2 files, now 1) -- see
// api/billing.js for the full reasoning on why this pattern exists.
const handleInviteSponsor = require('../lib/handlers/creator-invite-sponsor');
const handleNotifyDispute = require('../lib/handlers/creator-notify-dispute');
const handleInviteCreator = require('../lib/handlers/sponsor-invite-creator');
const handleScanContractClauses = require('../lib/handlers/scan-contract-clauses');
const handleDraftPitch = require('../lib/handlers/draft-pitch');
const handleInviteSponsorContract = require('../lib/handlers/creator-invite-sponsor-contract');
const handleCounterOfferAssist = require('../lib/handlers/counter-offer-assist');
const handleScanExclusivityConflicts = require('../lib/handlers/scan-exclusivity-conflicts');
const handleRequestVerification = require('../lib/handlers/request-verification');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite-sponsor') return handleInviteSponsor(req, res);
  if (action === 'notify-dispute') return handleNotifyDispute(req, res);
  if (action === 'invite-creator') return handleInviteCreator(req, res);
  if (action === 'scan-contract-clauses') return handleScanContractClauses(req, res);
  if (action === 'draft-pitch') return handleDraftPitch(req, res);
  if (action === 'invite-sponsor-contract') return handleInviteSponsorContract(req, res);
  if (action === 'counter-offer-assist') return handleCounterOfferAssist(req, res);
  if (action === 'scan-exclusivity-conflicts') return handleScanExclusivityConflicts(req, res);
  if (action === 'request-verification') return handleRequestVerification(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite-sponsor, notify-dispute, invite-creator, scan-contract-clauses, draft-pitch, invite-sponsor-contract, counter-offer-assist, scan-exclusivity-conflicts, or request-verification.' });
};
