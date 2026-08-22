// POST /api/team?action=invite-roster  { email }
// Manager invites a creator onto their roster -- the reverse of
// manager-invite.js (creator invites a manager). Added 2026-08-22
// alongside self-serve manager signup: without this, a manager who
// signs up cold has no way to populate their roster except waiting for
// a creator to independently invite them.
const { adminClient, getAuthedManager } = require('../supabase-admin');
const { sendEmail, rosterInviteEmail } = require('../email');

module.exports = async function handleRosterInvite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const manager = await getAuthedManager(req);
  if (!manager) return res.status(401).json({ error: 'Not authenticated as a manager' });

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid creator email is required' });
  }

  const admin = adminClient();

  try {
    const { data: invite, error: inviteErr } = await admin.from('roster_invites')
      .upsert(
        { manager_id: manager.id, invited_by: manager.id, email: email.toLowerCase() },
        { onConflict: 'manager_id,email', ignoreDuplicates: false }
      )
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const { data: managerProfile } = await admin.from('profiles').select('display_name').eq('id', manager.id).maybeSingle();
    const { data: managerRow } = await admin.from('managers').select('agency_name').eq('id', manager.id).maybeSingle();
    const managerLabel = managerRow?.agency_name || managerProfile?.display_name || 'A manager';

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const acceptLink = `${origin}/app/accept-roster-invite.html?token=${invite.token}`;

    await sendEmail({
      to: email,
      ...rosterInviteEmail({ managerLabel, acceptLink }),
    });

    res.status(200).json({ message: `Roster invite sent to ${email}.`, acceptLink });
  } catch (err) {
    console.error('roster-invite error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
