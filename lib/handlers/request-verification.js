// POST /api/campaign-actions?action=request-verification  { targetEmail, targetContext, expressRequested }
//
// Sponsor-initiated: "I want to see this creator verified on Kitscore
// before I decide." Free to send -- gating the sponsor's ability to ask
// would hurt discovery/growth for no reason, the paywall here sits on
// the CREATOR's response speed, not the sponsor's ability to ask.
//
// If target_email matches an existing creator's business_email, links
// target_creator_id so the in-app creator side can show "a sponsor
// asked about you." Otherwise this is an invite-to-claim, same email-
// first pattern as sponsor-invite-creator.js.
//
// NOTE ON WHAT "EXPRESS" ACTUALLY MEANS RIGHT NOW: expressRequested is
// stored as context only. There is no priority review queue built yet
// (that's the separate, still-unbuilt Priority Evidence Review
// feature) -- so right now this does NOT make evidence review actually
// faster for anyone, Pro or not. Do not advertise or imply a real speed
// guarantee until Priority Evidence Review exists and this is wired
// into it; today it only tells the creator a sponsor asked, and (if
// Pro) shows them a "respond faster" prompt in-app -- nothing on the
// review-queue backend actually changes yet.
const { adminClient, getAuthedSponsor } = require('../supabase-admin');
const { sendEmail, verificationRequestEmail } = require('../email');

module.exports = async function handleRequestVerification(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sponsor = await getAuthedSponsor(req);
  if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

  const { targetEmail, targetContext, expressRequested } = req.body || {};
  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return res.status(400).json({ error: 'A valid creator email is required' });
  }

  const db = adminClient();

  try {
    const normalizedEmail = targetEmail.toLowerCase();

    const { data: existingCreator } = await db.from('creators')
      .select('id, plan, profiles(display_name)')
      .eq('business_email', normalizedEmail)
      .maybeSingle();

    const { data: request, error: insertErr } = await db.from('verification_requests')
      .insert({
        sponsor_id: sponsor.id,
        target_creator_id: existingCreator?.id || null,
        target_email: normalizedEmail,
        target_context: targetContext || null,
      })
      .select().single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const claimOrProfileLink = existingCreator
      ? `${origin}/app/dashboard.html`
      : `${origin}/for-creators.html?ref=verify-request`;

    await sendEmail({
      to: normalizedEmail,
      ...verificationRequestEmail({
        creatorName: existingCreator?.profiles?.display_name || null,
        sponsorCompanyName: sponsor.company_name || 'A sponsor',
        targetContext,
        isExistingCreator: !!existingCreator,
        isPro: existingCreator?.plan === 'pro',
        actionLink: claimOrProfileLink,
      }),
    });

    res.status(200).json({
      message: `Verification request sent to ${normalizedEmail}.`,
      matchedExistingCreator: !!existingCreator,
      requestId: request.id,
    });
  } catch (err) {
    console.error('request-verification error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
