// POST /api/invite-team-member  { teamId, email }
// Creates an invite record and returns the accept link.
// In production this would send an email via Resend/Postmark.
// For now it returns the link so the team owner can share it manually.
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');
const { sendEmail, teamInviteEmail } = require('../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { teamId, email } = req.body || {};
    if (!teamId || !email) return res.status(400).json({ error: 'teamId and email are required' });

    const admin = adminClient();

    // Confirm caller is the team owner
    const { data: team } = await admin.from('teams').select('id, name').eq('id', teamId).eq('owner_id', sponsor.id).maybeSingle();
    if (!team) return res.status(403).json({ error: 'Only the team owner can invite members' });

    // Upsert so re-inviting the same email refreshes the token and expiry
    const { data: invite, error: inviteErr } = await admin.from('team_invites')
      .upsert({ team_id: teamId, invited_by: sponsor.id, email: email.toLowerCase() },
               { onConflict: 'team_id,email', ignoreDuplicates: false })
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const acceptLink = `${origin}/app/accept-invite.html?token=${invite.token}`;

    // Auto-send the invite email — no longer requires manual copy-paste
    const { data: inviterProfile } = await admin.from('profiles')
      .select('display_name').eq('id', sponsor.id).single();
    await sendEmail({
      to: email,
      ...teamInviteEmail({
        teamName: team.name,
        inviteLink: acceptLink,
        invitedBy: inviterProfile?.display_name || 'Your team',
      }),
    });

    res.status(200).json({
      message: `Invite sent to ${email}.`,
      acceptLink, // still returned for fallback copy-paste if email fails
    });
  } catch (err) {
    console.error('invite-team-member error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
