// POST /api/team?action=invite-manager  { email }
// Creator invites a manager/agent to be linked to their account.
// Phase 1 only -- see the manager_seat_phase1_invites_and_links migration
// comment. This creates the invite and the eventual link; it does NOT
// grant the manager any access to evidence/contracts/briefs yet.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, managerInviteEmail } = require('../email');

module.exports = async function handleManagerInvite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid manager email is required' });
  }

  const admin = adminClient();

  try {
    const { data: invite, error: inviteErr } = await admin.from('manager_invites')
      .upsert(
        { creator_id: creator.id, invited_by: creator.id, email: email.toLowerCase() },
        { onConflict: 'creator_id,email', ignoreDuplicates: false }
      )
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const acceptLink = `${origin}/app/accept-manager-invite.html?token=${invite.token}`;

    await sendEmail({
      to: email,
      ...managerInviteEmail({
        creatorName: creator.display_name || 'A creator',
        acceptLink,
      }),
    });

    res.status(200).json({ message: `Manager invite sent to ${email}.`, acceptLink });
  } catch (err) {
    console.error('manager-invite error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
