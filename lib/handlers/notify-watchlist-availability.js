// POST /api/campaign-actions?action=notify-watchlist-availability
// { }  -- no body needed, acts on the authenticated creator
//
// Fires when a creator's availability_status transitions TO 'open' (the
// caller, app/profile.html's saveAvailability(), is responsible for only
// calling this on an actual transition -- re-saving an already-open
// status, or setting Limited/Booked, should not re-notify). Emails every
// sponsor who has this creator on their watchlist: "someone you saved is
// now open for work." Free to call (no plan gate) -- this isn't a paid
// action, it's a side effect of a Pro creator's own availability change,
// and gating the notification itself would be gating the sponsor's
// existing watchlist relationship, not the creator's feature.
//
// Added 2026-08-18, same Vercel-slot reasoning as every other action in
// this dispatcher (still 11/12 function slots -- see api/campaign-actions.js
// header comment). Directory visibility batch, item 3 of 4 (sort
// priority, sponsor filter, and the spotlight strip are pure frontend,
// this is the one that needed a backend piece).

const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { sendEmail, watchlistAvailabilityEmail } = require('../email');

module.exports = async function handleNotifyWatchlistAvailability(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  const db = adminClient();

  const [{ data: profile }, { data: watchlistRows, error: wlErr }] = await Promise.all([
    db.from('profiles').select('display_name').eq('id', creator.id).maybeSingle(),
    db.from('watchlists')
      .select('sponsor_id, sponsors!inner(company_name, id, profiles!sponsors_id_fkey(email, display_name))')
      .eq('creator_id', creator.id),
  ]);

  if (wlErr) return res.status(500).json({ error: 'Could not look up your watchlist.' });

  const rows = watchlistRows || [];
  if (!rows.length) return res.status(200).json({ notified: 0 });

  const creatorName = profile?.display_name || 'A creator you saved';
  const evaluateUrl = `https://kitscore.co/app/evaluate.html?creator=${creator.id}`;

  let notified = 0;
  for (const row of rows) {
    const sponsorProfile = row.sponsors?.profiles;
    if (!sponsorProfile?.email) continue;
    const { subject, html, text } = watchlistAvailabilityEmail({
      sponsorName: sponsorProfile.display_name,
      creatorName,
      evaluateUrl,
    });
    try {
      await sendEmail({ to: sponsorProfile.email, subject, html, text });
      notified++;
    } catch (err) {
      console.error(`Could not notify sponsor ${row.sponsor_id} of availability change:`, err.message);
    }
  }

  return res.status(200).json({ notified });
};
