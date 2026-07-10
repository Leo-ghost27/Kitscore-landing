// POST /api/creator-actions?action=invite-sponsor  { sponsorEmail, sponsorName, description, budgetRange }
// Creator-initiated invite: creates a campaign_confirmation_invites row and
// emails the sponsor a link to confirm the campaign happened. Confirming
// creates a real campaigns row (see fn_confirm_campaign_invite) and, via
// Supabase's native magic-link auth + the existing handle_new_auth_user
// trigger, a real sponsor account -- no separate signup step later.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, campaignConfirmInviteEmail } = require('../email');

module.exports = async function handleCreatorInviteSponsor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const { sponsorEmail, sponsorName, description, budgetRange } = req.body || {};
    if (!sponsorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sponsorEmail)) {
      return res.status(400).json({ error: 'A valid sponsor email is required' });
    }

    const admin = adminClient();

    const { data: invite, error: inviteErr } = await admin.from('campaign_confirmation_invites')
      .insert({
        creator_id: creator.id,
        sponsor_email: sponsorEmail.toLowerCase(),
        sponsor_name: sponsorName || null,
        description: description || null,
        budget_range: budgetRange || null,
      })
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const confirmLink = `${origin}/app/confirm-campaign.html?token=${invite.token}`;

    const { data: creatorProfile } = await admin.from('profiles')
      .select('display_name').eq('id', creator.id).single();

    await sendEmail({
      to: sponsorEmail,
      ...campaignConfirmInviteEmail({
        creatorName: creatorProfile?.display_name || 'A Kitscore creator',
        description,
        confirmLink,
      }),
    });

    res.status(200).json({
      message: `Invite sent to ${sponsorEmail}.`,
      confirmLink, // fallback copy-paste if email delivery fails
    });
  } catch (err) {
    console.error('invite-sponsor-confirm error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
