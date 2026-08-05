// POST /api/escrow?action=dispute  { contractId, reason }
//
// The sponsor's "report a problem" alternative to a unilateral refund,
// for exactly one situation: the creator has already submitted the
// deliverable. Before submission, plain refund (escrow-refund.js) is
// still the right tool -- nothing was delivered, nothing to dispute.
//
// This does NOT move any money. It freezes the contract in its current
// 'held' state (which it already is) and records a dispute on it, using
// the same disputed_at/disputed_by/dispute_reason/admin_resolved_at
// columns admin-contracts.html already uses for ad hoc admin flags --
// this just lets a sponsor be the one who sets them instead of only an
// admin. Resolution happens through the existing admin-release/
// admin-refund tools in admin-escrow.html, which now also clear the
// dispute fields when used (see those handlers).
//
// Superseding escrow-refund.js's unrestricted self-refund after
// submission is the actual point of this endpoint -- see that file's
// new guard.
const { adminClient, getAuthedSponsor } = require('../supabase-admin');
const { sendEmail, escrowDisputedCreatorEmail, escrowDisputedAdminEmail } = require('../email');
const { logNotificationFailure } = require('../notification-queue');

const ADMIN_EMAIL = 'gina.hamza@kitscore.co';

module.exports = async function handleDispute(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { contractId, reason } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Explain what the problem is' });

  const admin = adminClient();

  try {
    const { data: contract } = await admin.from('contracts')
      .select('*, sponsors!inner(company_name), creators!inner(id, profiles!inner(display_name))')
      .eq('id', contractId).eq('sponsor_id', sponsor.id).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found for this sponsor' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status}, not held -- nothing to dispute` });
    }
    if (!contract.deliverable_submitted_at) {
      return res.status(400).json({ error: 'Nothing has been submitted yet -- use refund if you want to back out before delivery' });
    }
    if (contract.disputed_at && !contract.admin_resolved_at) {
      return res.status(200).json({ ok: true, alreadyOpen: true, message: 'A dispute is already open on this contract -- Kitscore is reviewing it.' });
    }

    await admin.from('contracts').update({
      disputed_at: new Date().toISOString(),
      disputed_by: sponsor.id,
      dispute_reason: reason.trim(),
      admin_resolved_at: null,
      admin_resolution_note: null,
    }).eq('id', contractId);

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const contractsUrl = `${origin}/app/contracts.html`;
    const creatorName = contract.creators.profiles.display_name || 'The creator';

    const { data: creatorProfile } = await admin.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
    if (creatorProfile?.email) {
      const result = await sendEmail({
        to: creatorProfile.email,
        ...escrowDisputedCreatorEmail({
          contractTitle: contract.title,
          disputeReason: reason.trim(),
          contractsUrl,
        }),
      });
      if (result?.error) {
        await logNotificationFailure(admin, {
          kind: 'escrow_dispute_notification', contractId, recipientEmail: creatorProfile.email,
          error: JSON.stringify(result.error).slice(0, 2000),
        });
      }
    }

    await sendEmail({
      to: ADMIN_EMAIL,
      ...escrowDisputedAdminEmail({
        contractTitle: contract.title,
        sponsorCompanyName: contract.sponsors.company_name || 'A sponsor',
        creatorName,
        disputeReason: reason.trim(),
        amountCents: contract.escrow_amount_cents || 0,
        adminUrl: `${origin}/app/admin-escrow.html`,
      }),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('escrow dispute error:', err);
    res.status(500).json({ error: err.message || 'Could not open a dispute' });
  }
};
