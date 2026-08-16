// POST /api/team?action=revoke-manager  { linkId }
// Creator revokes an active manager link instantly. No manager-side
// approval or delay -- matches the permission spec: "creator can revoke
// manager access instantly, no manager-side approval needed."
const { adminClient, getAuthedCreator } = require('../supabase-admin');

module.exports = async function handleManagerRevoke(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  const { linkId } = req.body || {};
  if (!linkId) return res.status(400).json({ error: 'linkId is required' });

  const admin = adminClient();

  try {
    const { data: link } = await admin.from('manager_creator_links').select('id, creator_id').eq('id', linkId).maybeSingle();
    if (!link) return res.status(404).json({ error: 'Manager link not found' });
    if (link.creator_id !== creator.id) return res.status(403).json({ error: 'Not your manager link' });

    await admin.from('manager_creator_links')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', linkId);

    res.status(200).json({ message: 'Manager access revoked.' });
  } catch (err) {
    console.error('manager-revoke error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
