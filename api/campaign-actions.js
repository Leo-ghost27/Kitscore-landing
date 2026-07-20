// POST /api/campaign-actions?action=invite-sponsor | ?action=notify-dispute | ?action=invite-creator
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
// Frees a Vercel Hobby function slot (was 2 files, now 1) -- see
// api/billing.js for the full reasoning on why this pattern exists.
const handleInviteSponsor = require('../lib/handlers/creator-invite-sponsor');
const handleNotifyDispute = require('../lib/handlers/creator-notify-dispute');
const handleInviteCreator = require('../lib/handlers/sponsor-invite-creator');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'invite-sponsor') return handleInviteSponsor(req, res);
  if (action === 'notify-dispute') return handleNotifyDispute(req, res);
  if (action === 'invite-creator') return handleInviteCreator(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=invite-sponsor, ?action=notify-dispute, or ?action=invite-creator.' });
};
