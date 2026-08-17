// POST /api/team?action=invite-staff  { email }
// Agency owner invites a staff member as a sub-seat. Staff inherit the
// owner's entire roster access on accept -- see the
// manager_seat_agency_sub_seats migration comment.
const { adminClient, getAuthedManager } = require('../supabase-admin');
const { sendEmail, agencyStaffInviteEmail } = require('../email');

module.exports = async function handleAgencyStaffInvite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const owner = await getAuthedManager(req);
  if (!owner) return res.status(401).json({ error: 'Not authenticated as a manager' });

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid staff email is required' });
  }

  const admin = adminClient();

  try {
    const { data: invite, error: inviteErr } = await admin.from('agency_staff_invites')
      .upsert(
        { owner_id: owner.id, email: email.toLowerCase() },
        { onConflict: 'owner_id,email', ignoreDuplicates: false }
      )
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const acceptLink = `${origin}/app/accept-agency-staff-invite.html?token=${invite.token}`;

    await sendEmail({
      to: email,
      ...agencyStaffInviteEmail({
        ownerName: owner.display_name || 'An agency',
        acceptLink,
      }),
    });

    res.status(200).json({ message: `Staff invite sent to ${email}.`, acceptLink });
  } catch (err) {
    console.error('agency-staff-invite error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
