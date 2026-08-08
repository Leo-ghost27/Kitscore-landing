// Handler for GET /api/cron?job=escrow-stuck-nudge
//
// Closes the ghosting half of the escrow-protection gap (the dispute
// flow in escrow-dispute.js / escrow-refund.js's new guard closes the
// other half -- active bad-faith refund after submission). Before this,
// a sponsor who simply never clicked "release" or "report a problem"
// left the creator stuck with no automated recourse -- the only
// detection was Gina manually checking admin-escrow.html's "Stuck"
// filter (5+ days after submission, same STUCK_DAYS threshold reused
// here so both surfaces agree on what "stuck" means).
//
// Runs daily. For each stuck, non-disputed contract: nudges the sponsor
// directly (every day it's still stuck -- no backoff in this v1, easy
// to add if it turns out to be annoying rather than useful) and rolls
// everything currently stuck into one digest to Gina, mirroring
// cron-health-check.js's "one email, not one per row" pattern.
const { adminClient } = require('../supabase-admin');
const { sendEmail, escrowStuckNudgeEmail } = require('../email');

const ADMIN_EMAIL = 'gina.hamza@kitscore.co';
const STUCK_DAYS = 5;

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

module.exports = async function handleCronEscrowStuckNudge(req, res) {
  try {
    const admin = adminClient();
    const cutoff = new Date(Date.now() - STUCK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: contracts, error } = await admin.from('contracts')
      .select('id, title, escrow_amount_cents, deliverable_submitted_at, disputed_at, admin_resolved_at, sponsor_id, creator_id, sponsors!inner(company_name, profiles!sponsors_id_fkey(email)), creators!inner(profiles!inner(display_name))')
      .eq('escrow_status', 'held')
      .not('deliverable_submitted_at', 'is', null)
      .lte('deliverable_submitted_at', cutoff);

    if (error) throw error;

    // Disputes already have a human (Gina) actively looking at them via
    // the dispute email -- don't also nudge those, it's redundant and
    // muddies "stuck because ignored" vs "stuck because being resolved."
    const stuck = (contracts || []).filter(c => !c.disputed_at || c.admin_resolved_at);

    if (!stuck.length) return res.status(200).json({ ok: true, nudged: 0 });

    const origin = `https://${req.headers.host || 'kitscore.co'}`;
    const contractsUrl = `${origin}/app/contracts.html`;

    let nudged = 0;
    for (const c of stuck) {
      const sponsorEmail = c.sponsors?.profiles?.email;
      if (!sponsorEmail) continue;
      const result = await sendEmail({
        to: sponsorEmail,
        ...escrowStuckNudgeEmail({
          contractTitle: c.title,
          creatorName: c.creators?.profiles?.display_name || 'The creator',
          heldDays: daysSince(c.deliverable_submitted_at),
          contractsUrl,
        }),
      });
      if (!result?.error) nudged++;
    }

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `${stuck.length} escrow contract(s) stuck 5+ days`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="font-size:18px;color:#1A1A1E">${stuck.length} contract(s) still stuck</h2>
          <p style="color:#6B7280;font-size:14px">Deliverable submitted, escrow held, sponsor hasn't released or disputed. Each sponsor was nudged today.</p>
          ${stuck.map(c => `
            <div style="border-top:1px solid #E5E7EB;padding:10px 0;font-size:13px">
              <strong>${c.title}</strong> — ${c.sponsors?.company_name || 'Unknown sponsor'} → ${c.creators?.profiles?.display_name || 'Unknown creator'}
              · $${((c.escrow_amount_cents || 0) / 100).toFixed(2)} · ${daysSince(c.deliverable_submitted_at)}d
            </div>`).join('')}
          <a href="${origin}/app/admin-escrow.html" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Open Escrow Oversight</a>
        </div>`,
    });

    res.status(200).json({ ok: true, stuck: stuck.length, nudged });
  } catch (err) {
    console.error('cron escrow-stuck-nudge error:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
};
