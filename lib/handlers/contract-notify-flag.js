// POST /api/escrow?action=notify-contract-flag  { contractId }
//
// Fires right after admin's flagProblem() in admin-contracts.html already
// saved the flag directly (disputed_at/dispute_reason via the browser's
// own Supabase client, same as escrow-dispute.js's sponsor-side flag).
// Until this, that flag was genuinely silent -- the only place it showed
// up was a banner on app/contracts.html that a party would only see if
// they happened to reopen that page. This is the email half, following
// the exact same "client saves state, then best-effort notifies" split
// as submitDispute() in app/campaigns.html + notify-dispute.js.
//
// Two emails, two different jobs -- see contractFlaggedSponsorEmail and
// contractFlaggedCreatorEmail in lib/email.js for why the content
// differs. The sponsor is the only party who can actually act (void +
// resend, or contact support if already fully signed); the creator gets
// a shorter "we're on it" version since they can't act on contract terms
// either way.
const { adminClient, getAuthedAdmin } = require('../supabase-admin');
const { sendEmail, contractFlaggedSponsorEmail, contractFlaggedCreatorEmail } = require('../email');
const { logNotificationFailure } = require('../notification-queue');

module.exports = async function handleNotifyContractFlag(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { contractId } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const db = adminClient();

  try {
    const { data: contract } = await db.from('contracts')
      .select('*, sponsors!inner(company_name), creators!inner(id, profiles!inner(display_name))')
      .eq('id', contractId).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!contract.disputed_at) {
      return res.status(400).json({ error: 'This contract has not been flagged -- nothing to notify' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const contractsUrl = `${origin}/app/contracts.html`;
    const creatorName = contract.creators.profiles.display_name || 'The creator';
    const sponsorCompanyName = contract.sponsors.company_name || 'The sponsor';
    // Only include scan-sourced concerns if this flag lines up with an
    // active scan hit -- an admin's own freeform flag (a phone call, a
    // support ticket) has no scan backing it, and quoting scan output
    // that isn't what prompted this particular flag would misattribute it.
    const scanConcerns = contract.clause_scan_flagged ? (contract.clause_scan_concerns || []) : [];
    // Matches canVoid's structural half in app/contracts.html (the role
    // check there doesn't apply here -- we're deciding what the SPONSOR
    // could do, not gating who's clicking right now).
    const canVoid = contract.status !== 'fully_signed' && contract.status !== 'void';

    const [{ data: sponsorProfile }, { data: creatorProfile }] = await Promise.all([
      db.from('profiles').select('email').eq('id', contract.sponsor_id).maybeSingle(),
      db.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle(),
    ]);

    let sentToSponsor = false;
    let sentToCreator = false;

    if (sponsorProfile?.email) {
      const result = await sendEmail({
        to: sponsorProfile.email,
        ...contractFlaggedSponsorEmail({
          contractTitle: contract.title,
          creatorName,
          adminNote: contract.dispute_reason || '',
          scanConcerns,
          canVoid,
          contractsUrl,
        }),
      });
      if (result?.error) {
        await logNotificationFailure(db, {
          kind: 'contract_flag_notification', contractId, recipientEmail: sponsorProfile.email,
          error: JSON.stringify(result.error).slice(0, 2000),
        });
      } else {
        sentToSponsor = true;
      }
    }

    if (creatorProfile?.email) {
      const result = await sendEmail({
        to: creatorProfile.email,
        ...contractFlaggedCreatorEmail({
          contractTitle: contract.title,
          sponsorCompanyName,
          adminNote: contract.dispute_reason || '',
          scanConcerns,
          contractsUrl,
        }),
      });
      if (result?.error) {
        await logNotificationFailure(db, {
          kind: 'contract_flag_notification', contractId, recipientEmail: creatorProfile.email,
          error: JSON.stringify(result.error).slice(0, 2000),
        });
      } else {
        sentToCreator = true;
      }
    }

    res.status(200).json({ ok: true, sentToSponsor, sentToCreator });
  } catch (err) {
    console.error('contract notify-flag error:', err);
    res.status(500).json({ error: err.message || 'Could not send notifications' });
  }
};
