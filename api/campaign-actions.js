// POST /api/campaign-actions?action=invite-sponsor | ?action=notify-dispute | ?action=invite-creator | ?action=scan-contract-clauses | ?action=draft-pitch
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
// Frees a Vercel Hobby function slot (was 2 files, now 1) -- see
// api/billing.js for the full reasoning on why this pattern exists.
const handleInviteSponsor = require('../lib/handlers/creator-invite-sponsor');
const handleNotifyDispute = require('../lib/handlers/creator-notify-dispute');
const handleInviteCreator = require('../lib/handlers/sponsor-invite-creator');
const handleScanContractClauses = require('../lib/handlers/scan-contract-clauses');
const handleDraftPitch = require('../lib/handlers/draft-pitch');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite-sponsor') return handleInviteSponsor(req, res);
  if (action === 'notify-dispute') return handleNotifyDispute(req, res);
  if (action === 'invite-creator') return handleInviteCreator(req, res);
  if (action === 'scan-contract-clauses') return handleScanContractClauses(req, res);
  if (action === 'draft-pitch') return handleDraftPitch(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite-sponsor, notify-dispute, invite-creator, scan-contract-clauses, or draft-pitch.' });
};
