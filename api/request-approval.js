// POST /api/request-approval  { actionType, targetType, targetId, note }
// A team 'member' (not the owner) uses this to ask their team owner to
// sign off on a paid action — e.g. unlocking an evaluation report.
// The owner does NOT need this endpoint; they act directly.
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { actionType, targetType, targetId, note } = req.body || {};
    if (!actionType || !targetType) return res.status(400).json({ error: 'actionType and targetType are required' });

    const admin = adminClient();

    const { data: membership } = await admin.from('team_members')
      .select('team_id, role').eq('sponsor_id', sponsor.id).maybeSingle();
    if (!membership) return res.status(400).json({ error: 'You are not on a team' });
    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'Team owners act directly and do not need to request approval' });
    }

    // Re-use a still-pending request for the same action/target rather than
    // stacking duplicates every time someone re-clicks "Unlock".
    const { data: existing } = await admin.from('approval_requests')
      .select('*').eq('team_id', membership.team_id).eq('requested_by', sponsor.id)
      .eq('action_type', actionType).eq('target_type', targetType)
      .eq('target_id', targetId || null).eq('status', 'pending').maybeSingle();
    if (existing) return res.status(200).json({ request: existing, message: 'Already pending review.' });

    const { data: request, error } = await admin.from('approval_requests').insert({
      team_id: membership.team_id,
      requested_by: sponsor.id,
      action_type: actionType,
      target_type: targetType,
      target_id: targetId || null,
      note: note || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ request, message: 'Sent to your team owner for approval.' });
  } catch (err) {
    console.error('request-approval error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
