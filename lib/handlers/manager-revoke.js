// POST /api/team?action=revoke-manager  { linkId }
// Creator revokes an active manager link instantly. No manager-side
// approval or delay -- matches the permission spec: "creator can revoke
// manager access instantly, no manager-side approval needed."
//
// 2026-08-19: now calls fn_revoke_manager_and_archive (SECURITY DEFINER
// RPC, see migration 20260819_manager_submission_attribution_and_revoke_archive)
// instead of a plain status update. That RPC does the same revoke, plus
// clears any brief_applications/evidence_uploads this manager submitted
// that are still pending/unreviewed out of the creator's active view --
// archiving a full copy into manager_revoke_archive first. Anything
// already acted on (shortlisted, accepted, verified, or attached to a
// signed contract) is left untouched -- this never deletes a completed
// transaction, only in-flight leftovers, and never without a retrievable
// copy for a later dispute or audit.
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

    // fn_revoke_manager_and_archive re-checks ownership itself (via
    // auth.uid()) as a second, RLS-independent guard -- this admin-client
    // check above is not a substitute for that, just a fast-fail before
    // making the RPC call.
    const { data: rpcData, error: rpcError } = await admin.rpc('fn_revoke_manager_and_archive', { p_link_id: linkId });
    if (rpcError) throw rpcError;

    const result = (rpcData && rpcData[0]) || { archived_brief_applications: 0, archived_evidence_uploads: 0 };
    const archivedTotal = (result.archived_brief_applications || 0) + (result.archived_evidence_uploads || 0);
    const message = archivedTotal > 0
      ? `Manager access revoked. ${archivedTotal} pending item${archivedTotal === 1 ? '' : 's'} they submitted (not yet acted on) ${archivedTotal === 1 ? 'was' : 'were'} cleared from your account and archived for record-keeping.`
      : 'Manager access revoked.';

    res.status(200).json({ message, archived: result });
  } catch (err) {
    console.error('manager-revoke error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
