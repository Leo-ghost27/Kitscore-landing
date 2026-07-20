// POST /api/campaign-actions?action=invite-creator  { creatorEmail, creatorName, description, budgetRange }
// Sponsor-initiated invite -- the mirror of creator-invite-sponsor.js, for a
// creator who isn't on Kitscore yet. Creates a campaign_confirmation_invites
// row (sponsor_id + creator_email, not creator_id + sponsor_email -- see the
// direction check constraint on that table) and emails the creator a link to
// confirm. Confirming creates a real campaigns row (see
// fn_confirm_creator_campaign_invite) and, via Supabase's native magic-link
// auth + the existing handle_new_auth_user trigger, a real creator account --
// no separate signup step later.
const { adminClient, getAuthedSponsor } = require('../supabase-admin');
const { sendEmail, sponsorInviteCreatorEmail } = require('../email');

module.exports = async function handleSponsorInviteCreator(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { creatorEmail, creatorName, description, budgetRange } = req.body || {};
    if (!creatorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creatorEmail)) {
      return res.status(400).json({ error: 'A valid creator email is required' });
    }

    const admin = adminClient();

    const { data: invite, error: inviteErr } = await admin.from('campaign_confirmation_invites')
      .insert({
        sponsor_id: sponsor.id,
        creator_email: creatorEmail.toLowerCase(),
        creator_name: creatorName || null,
        description: description || null,
        budget_range: budgetRange || null,
      })
      .select().single();
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const confirmLink = `${origin}/app/confirm-campaign.html?token=${invite.token}`;

    await sendEmail({
      to: creatorEmail,
      ...sponsorInviteCreatorEmail({
        sponsorCompanyName: sponsor.company_name || 'A Kitscore sponsor',
        description,
        confirmLink,
      }),
    });

    res.status(200).json({
      message: `Invite sent to ${creatorEmail}.`,
      confirmLink, // fallback copy-paste if email delivery fails
    });
  } catch (err) {
    console.error('invite-creator error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
