// POST /api/team?action=revoke-staff  { staffLinkId }
// Owner revokes a staff sub-seat instantly -- they immediately lose the
// inherited roster access, same as manager_creator_links revocation.
const { adminClient, getAuthedManager } = require('../supabase-admin');

module.exports = async function handleAgencyStaffRevoke(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const owner = await getAuthedManager(req);
  if (!owner) return res.status(401).json({ error: 'Not authenticated as a manager' });

  const { staffLinkId } = req.body || {};
  if (!staffLinkId) return res.status(400).json({ error: 'staffLinkId is required' });

  const admin = adminClient();

  try {
    const { data: link } = await admin.from('agency_staff').select('id, owner_id').eq('id', staffLinkId).maybeSingle();
    if (!link) return res.status(404).json({ error: 'Staff link not found' });
    if (link.owner_id !== owner.id) return res.status(403).json({ error: 'Not your staff member' });

    await admin.from('agency_staff')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', staffLinkId);

    res.status(200).json({ message: 'Staff access revoked.' });
  } catch (err) {
    console.error('agency-staff-revoke error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
