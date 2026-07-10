// POST /api/team?action=review-approval  { requestId, decision }  decision: 'approved' | 'rejected'
// Only the team owner may call this — enforced both here and by the
// approval_requests_owner_review RLS policy as a second layer.
const { adminClient, getAuthedSponsor } = require('../supabase-admin');

module.exports = async function handleTeamReviewApproval(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { requestId, decision } = req.body || {};
    if (!requestId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'requestId and a valid decision are required' });
    }

    const admin = adminClient();

    const { data: request } = await admin.from('approval_requests').select('*').eq('id', requestId).maybeSingle();
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const { data: team } = await admin.from('teams').select('id').eq('id', request.team_id).eq('owner_id', sponsor.id).maybeSingle();
    if (!team) return res.status(403).json({ error: 'Only the team owner can review this request' });

    if (request.status !== 'pending') {
      return res.status(400).json({ error: `Request is already ${request.status}` });
    }

    const { data: updated, error } = await admin.from('approval_requests').update({
      status: decision,
      reviewed_by: sponsor.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ request: updated });
  } catch (err) {
    console.error('review-approval error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
