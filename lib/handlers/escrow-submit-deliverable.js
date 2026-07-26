// POST /api/escrow?action=submit-deliverable  { contractId, notes? }
// Creator-side signal that the work is done and ready for the sponsor
// to review and release payment. Goes through the server (not a direct
// client-side table update) purely for consistency with every other
// escrow-adjacent mutation and so the sponsor notification email fires
// reliably from one place.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, escrowDeliverableSubmittedEmail } = require('../email');

module.exports = async function handleSubmitDeliverable(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  const { contractId, notes } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*, sponsors!inner(id, profiles!inner(display_name, email))')
      .eq('id', contractId).eq('creator_id', creator.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this creator' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: 'This contract has no funds held in escrow yet' });
    }
    if (contract.deliverable_submitted_at) {
      return res.status(400).json({ error: 'The deliverable has already been marked as submitted' });
    }

    await admin.from('contracts').update({
      deliverable_submitted_at: new Date().toISOString(),
      deliverable_notes: notes || null,
    }).eq('id', contractId);

    const sponsorEmail = contract.sponsors.profiles.email;
    if (sponsorEmail) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      await sendEmail({
        to: sponsorEmail,
        ...escrowDeliverableSubmittedEmail({
          contractTitle: contract.title,
          creatorName: creator.display_name || 'The creator',
          contractsUrl: `${origin}/app/contracts.html`,
        }),
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit-deliverable error:', err);
    res.status(500).json({ error: err.message || 'Could not submit deliverable' });
  }
};
