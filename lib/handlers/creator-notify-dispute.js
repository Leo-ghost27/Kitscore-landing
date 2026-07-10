// POST /api/creator-actions?action=notify-dispute  { campaignId }
// Called by the creator's browser right after a dispute is submitted (see
// submitDispute() in app/campaigns.html). Verifies the campaign belongs to
// the calling creator and is actually in 'disputed' status, then emails the
// sponsor so they don't have to revisit the Campaigns page to find out.
// Mirrors the auth + email pattern used in invite-team-member.js.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, disputeNotificationEmail } = require('../email');
const { logNotificationFailure } = require('../notification-queue');

module.exports = async function handleCreatorNotifyDispute(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const { campaignId } = req.body || {};
    if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

    const admin = adminClient();

    // Confirm caller owns this campaign and it's actually disputed —
    // stops a creator from triggering emails for campaigns that aren't
    // theirs or aren't in dispute.
    const { data: campaign } = await admin.from('campaigns')
      .select('id, name, sponsor_id, dispute_reason, status')
      .eq('id', campaignId).eq('creator_id', creator.id).maybeSingle();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'disputed') return res.status(400).json({ error: 'Campaign is not disputed' });

    const [{ data: sponsorProfile }, { data: creatorProfile }] = await Promise.all([
      admin.from('profiles').select('email').eq('id', campaign.sponsor_id).single(),
      admin.from('profiles').select('display_name').eq('id', creator.id).single(),
    ]);

    if (!sponsorProfile?.email) {
      // Nothing to send to, but the dispute itself already went through —
      // don't fail the whole request over a missing email address. Still
      // queued below so it's visible somewhere instead of just vanishing.
      await logNotificationFailure(admin, {
        campaignId: campaign.id, recipientEmail: null, error: 'Sponsor has no email on file',
      });
      return res.status(200).json({ sent: false, reason: 'Sponsor has no email on file' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const campaignsUrl = `${origin}/app/campaigns.html`;

    const result = await sendEmail({
      to: sponsorProfile.email,
      ...disputeNotificationEmail({
        campaignName: campaign.name,
        creatorName: creatorProfile?.display_name || 'A creator',
        disputeReason: campaign.dispute_reason || 'No reason given.',
        campaignsUrl,
      }),
    });

    if (result?.error) {
      // Fail soft to the browser (dispute is already saved), but queue it
      // so scripts/retry-failed-notifications.js can pick it up later —
      // previously this just vanished into console.error with no way to
      // know it happened short of grepping Vercel logs.
      await logNotificationFailure(admin, {
        campaignId: campaign.id, recipientEmail: sponsorProfile.email,
        error: JSON.stringify(result.error).slice(0, 2000),
      });
      return res.status(200).json({ sent: false, reason: 'Email provider error' });
    }
    res.status(200).json({ sent: true });
  } catch (err) {
    console.error('notify-dispute error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
