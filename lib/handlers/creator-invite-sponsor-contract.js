// POST /api/campaign-actions?action=invite-sponsor-contract  { sponsorEmail, sponsorName, title, deliverables, compensation, escrowAmountUsd, usageRights, exclusivityTerms, additionalTerms }
// Creator-initiated invite -- the mirror of sponsor-invite-creator.js, for a
// creator who already has a deal lined up outside Kitscore and wants the
// contract/clause-scan/escrow protection layer without needing the sponsor
// to already be on the platform or the deal to have come through a brief.
// Creates a creator_contract_invites row and emails the sponsor a link to
// review and sign. Confirming (fn_confirm_contract_invite) creates a real
// contracts row and, via Supabase's native magic-link auth, a real sponsor
// account -- no separate signup step, same mechanism as confirm-campaign.html.
//
// Compensation here is creator-proposed, not sponsor-set -- a reversal of
// the normal direction (see app/contracts.html's sponsor-drafted flow).
// That's fine functionally: nothing is binding until the sponsor actually
// signs, so they can push back on terms or simply not sign.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, creatorInviteSponsorContractEmail } = require('../email');

module.exports = async function handleCreatorInviteSponsorContract(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const {
      sponsorEmail, sponsorName, title, deliverables, compensation,
      escrowAmountUsd, usageRights, exclusivityTerms, additionalTerms,
      deliverableItems,
    } = req.body || {};

    if (!sponsorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sponsorEmail)) {
      return res.status(400).json({ error: 'A valid sponsor email is required' });
    }
    if (!title || !title.trim()) return res.status(400).json({ error: 'Give the contract a title' });
    if (!deliverables || !deliverables.trim()) return res.status(400).json({ error: 'Describe the deliverables' });
    if (!compensation || !compensation.trim()) return res.status(400).json({ error: 'Add the compensation terms' });

    // Same requirement as the sponsor-drafted flow: at least one checklist
    // item, since this is what escrow release actually checks against.
    // Without it, "bring your own deal" would get a lesser version of the
    // protections a sponsor-drafted contract gets -- see the 2026-08-04b
    // migration for the fuller reasoning.
    const items = Array.isArray(deliverableItems)
      ? deliverableItems
          .map(it => ({ description: String(it?.description || '').trim(), quantity: Number(it?.quantity) || 1 }))
          .filter(it => it.description)
      : [];
    if (!items.length) return res.status(400).json({ error: 'Add at least one deliverable checklist item' });

    const admin = adminClient();

    const { data: invite, error: inviteErr } = await admin.from('creator_contract_invites')
      .insert({
        creator_id: creator.id,
        sponsor_email: sponsorEmail.toLowerCase(),
        sponsor_name: sponsorName || null,
        title: title.trim(),
        deliverables: deliverables.trim(),
        compensation: compensation.trim(),
        escrow_amount_cents: escrowAmountUsd ? Math.round(Number(escrowAmountUsd) * 100) : null,
        usage_rights: usageRights || null,
        exclusivity_terms: exclusivityTerms || null,
        additional_terms: additionalTerms || null,
        deliverable_items: items,
      })
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const confirmLink = `${origin}/app/confirm-contract-invite.html?token=${invite.token}`;

    await sendEmail({
      to: sponsorEmail,
      ...creatorInviteSponsorContractEmail({
        creatorDisplayName: creator.display_name || 'A Kitscore creator',
        title: title.trim(),
        deliverables: deliverables.trim(),
        compensation: compensation.trim(),
        confirmLink,
      }),
    });

    res.status(200).json({
      message: `Invite sent to ${sponsorEmail}.`,
      confirmLink, // fallback copy-paste if email delivery fails
    });
  } catch (err) {
    console.error('invite-sponsor-contract error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
