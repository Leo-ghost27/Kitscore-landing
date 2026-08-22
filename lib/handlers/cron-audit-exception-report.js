// Handler for GET /api/cron?job=audit-exception-report
//
// Weekly paper-trail digest for the highest-stakes surface on the
// platform: escrow money movement and dispute/admin-resolution on
// contracts. Built alongside 2026-08-21-followup-audit-log-and-
// contract-trigger.sql, which added the append-only audit_log table
// and the AFTER-trigger that populates it -- this is the human-facing
// side of that: a weekly rollup an admin can actually read and act on,
// rather than a table they'd have to remember to query.
//
// Deliberately NOT another "something crossed a threshold" alert like
// cron-health-check.js -- this always sends, even when the answer is
// "nothing happened." A governance digest that only shows up when
// there's bad news trains the reader to associate its arrival with a
// problem, and silence stops being distinguishable from "nothing
// happened" vs "the job silently broke." Weekly (not daily) since
// that's what was asked for and matches the existing Monday 9am slot
// pattern (evidence-nudges, repitch-nudges) rather than adding a new
// time slot to reason about.
//
// Queries audit_log and contracts directly via the service-role client,
// not through fn_admin_audit_log() -- same lesson cron-health-check.js
// already documents: that RPC's admin gate checks auth.uid(), which is
// null for this service-role call, so it would reject itself. The RPC
// is for the admin's own logged-in browser session instead.
const { adminClient } = require('../supabase-admin');
const { sendEmail } = require('../email');

const ADMIN_EMAIL = 'gina.hamza@kitscore.co';
const LOOKBACK_DAYS = 7;

module.exports = async function handleCronAuditExceptionReport(req, res) {
  try {
    const admin = adminClient();
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [auditRows, openDisputes, escrowActivity] = await Promise.all([
      // Everything the audit trigger recorded on contracts this week --
      // the raw feed. changed_columns already tells you what kind of
      // event it was (disputed_at / admin_resolved_at / escrow_status /
      // etc.) without needing a separate categorization pass.
      admin.from('audit_log')
        .select('record_id, action, actor_role, db_role, changed_columns, old_values, new_values, occurred_at, profiles:actor_profile_id(display_name)')
        .eq('table_name', 'contracts')
        .gte('occurred_at', lookback)
        .order('occurred_at', { ascending: false }),

      // Open exceptions regardless of when they started -- a dispute
      // opened 3 weeks ago and still unresolved belongs in every
      // digest until it's actually resolved, not just the week it began.
      admin.from('contracts')
        .select('id, title, escrow_amount_cents, disputed_at, dispute_reason, sponsors!inner(company_name), creators!inner(profiles!inner(display_name))')
        .not('disputed_at', 'is', null)
        .is('admin_resolved_at', null),

      // Contracts info for anything the audit feed references, so the
      // email can show a title instead of a bare contract id.
      admin.from('contracts').select('id, title, sponsors(company_name), creators(profiles(display_name))'),
    ]);

    if (auditRows.error) throw auditRows.error;
    if (openDisputes.error) throw openDisputes.error;
    if (escrowActivity.error) throw escrowActivity.error;

    const contractById = new Map((escrowActivity.data || []).map(c => [c.id, c]));

    const html = renderDigest({
      auditRows: auditRows.data || [],
      openDisputes: openDisputes.data || [],
      contractById,
    });

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Kitscore weekly exception report: ${(openDisputes.data || []).length} open dispute(s), ${(auditRows.data || []).length} contract event(s) this week`,
      html,
    });

    return res.status(200).json({
      ok: true,
      open_disputes: (openDisputes.data || []).length,
      events_this_week: (auditRows.data || []).length,
    });
  } catch (err) {
    console.error('cron-audit-exception-report error:', err);
    return res.status(500).json({ error: 'audit exception report failed' });
  }
};

function contractLabel(c) {
  if (!c) return '(contract not found)';
  const sponsor = c.sponsors?.company_name || 'unknown sponsor';
  const creator = c.creators?.profiles?.display_name || 'unknown creator';
  return `"${c.title || 'Untitled'}" — ${sponsor} × ${creator}`;
}

function renderDigest({ auditRows, openDisputes, contractById }) {
  const disputeSection = !openDisputes.length
    ? '<p>No open disputes right now.</p>'
    : `<ul>${openDisputes.map(c => `
        <li><b>${escapeHtml(c.sponsors?.company_name || 'Sponsor')} × ${escapeHtml(c.creators?.profiles?.display_name || 'Creator')}</b>
        — "${escapeHtml(c.title || 'Untitled')}" (${moneyLabel(c.escrow_amount_cents)})<br>
        Disputed ${new Date(c.disputed_at).toLocaleDateString()}: ${escapeHtml(c.dispute_reason || '(no reason given)')}</li>
      `).join('')}</ul>`;

  const eventSection = !auditRows.length
    ? '<p>No contract events recorded this week.</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;border-bottom:1px solid #ddd"><th>When</th><th>Contract</th><th>Changed</th><th>Actor</th></tr>
        ${auditRows.map(r => `
          <tr style="border-bottom:1px solid #eee">
            <td>${new Date(r.occurred_at).toLocaleString()}</td>
            <td>${escapeHtml(contractLabel(contractById.get(r.record_id)))}</td>
            <td>${escapeHtml((r.changed_columns || []).join(', '))}</td>
            <td>${escapeHtml(r.profiles?.display_name || (r.db_role === 'service_role' ? 'System / API' : r.actor_role || 'unknown'))}</td>
          </tr>`).join('')}
      </table>`;

  return `
    <h2>Weekly exception report — escrow & contracts</h2>
    <h3>Open disputes needing review</h3>
    ${disputeSection}
    <h3>Contract events this week</h3>
    ${eventSection}
    <p style="color:#888;font-size:12px">Full detail: <code>select * from fn_admin_audit_log(30, 'contracts');</code> (admin-only RPC), or the Audit Log panel in admin-system.</p>
  `;
}

function moneyLabel(cents) {
  if (cents == null) return 'amount not set';
  return `$${(cents / 100).toLocaleString()}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
