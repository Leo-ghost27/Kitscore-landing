// Handler for GET /api/cron?job=audit-exception-report
//
// Weekly paper-trail digest across every surface this session's
// privilege-escalation sweep found and locked down, plus trial
// lifecycle tracking:
// 1. Escrow & contracts (money movement, disputes, admin resolution)
// 2. Trials ending soon / recently lapsed (managers + sponsors --
//    "team" is a sponsor plan tier, not the teams table, which has no
//    trial concept of its own)
// 3. Privilege changes (profiles.role, managers/sponsors/teams.plan)
// 4. Payout integrity (creators' Stripe Connect fields)
// 5. Trust & reputation (campaign verification/disputes, score_components)
// 6. Admin actions (admin_actions -- already populated by every real
//    admin handler with proper admin_id attribution; this is a
//    reporting addition, not a new logging path)
//
// Sections are ordered by "how urgently does this need a human," not
// discovery order -- disputes and lapsing trials are time-boxed and
// actionable today; admin actions are a look-back, not a to-do. A
// "Start here" summary up top distills all six into one skimmable list
// before the detail sections, so opening the email tells you where to
// start the day without reading the whole thing first.
//
// See 2026-08-21-followup-audit-log-and-contract-trigger.sql,
// 2026-08-21e-trust-privilege-payout-audit-triggers.sql for the
// audit_log table/triggers, and managers/sponsors.trial_ends_at for
// the trial fields (teams.plan has no trial columns at all --
// "Team" is billed on the sponsors row, teams is a separate roster/
// org concept).
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
// Queries audit_log/admin_actions/managers/sponsors directly via the
// service-role client, not through fn_admin_audit_log() -- same lesson
// cron-health-check.js already documents: that RPC's admin gate checks
// auth.uid(), which is null for this service-role call, so it would
// reject itself. The RPC is for the admin's own logged-in browser
// session instead (admin-audit-log.html).
const { adminClient } = require('../supabase-admin');
const { sendEmail } = require('../email');

const ADMIN_EMAIL = 'gina.hamza@kitscore.co';
const LOOKBACK_DAYS = 7;
const TRIAL_LOOKAHEAD_DAYS = 7;

module.exports = async function handleCronAuditExceptionReport(req, res) {
  try {
    const admin = adminClient();
    const now = new Date();
    const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const trialWindowEnd = new Date(now.getTime() + TRIAL_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const [
      auditRows, openDisputes, contractLookup, trustRows, privilegeRows, payoutRows, adminActionRows,
      trialingManagers, lapsedManagers, trialingSponsors, lapsedSponsors,
    ] = await Promise.all([
      admin.from('audit_log')
        .select('record_id, action, actor_role, db_role, changed_columns, old_values, new_values, occurred_at, profiles:actor_profile_id(display_name)')
        .eq('table_name', 'contracts')
        .gte('occurred_at', lookback)
        .order('occurred_at', { ascending: false }),

      admin.from('contracts')
        .select('id, title, escrow_amount_cents, disputed_at, dispute_reason, sponsors!inner(company_name), creators!inner(profiles!inner(display_name))')
        .not('disputed_at', 'is', null)
        .is('admin_resolved_at', null),

      admin.from('contracts').select('id, title, sponsors(company_name), creators(profiles(display_name))'),

      admin.from('audit_log')
        .select('table_name, record_id, action, actor_role, db_role, changed_columns, old_values, new_values, occurred_at, profiles:actor_profile_id(display_name)')
        .in('table_name', ['campaigns', 'score_components'])
        .gte('occurred_at', lookback)
        .order('occurred_at', { ascending: false }),

      admin.from('audit_log')
        .select('table_name, record_id, action, actor_role, db_role, changed_columns, old_values, new_values, occurred_at, profiles:actor_profile_id(display_name)')
        .in('table_name', ['profiles', 'managers', 'sponsors', 'teams'])
        .gte('occurred_at', lookback)
        .order('occurred_at', { ascending: false }),

      admin.from('audit_log')
        .select('record_id, changed_columns, old_values, new_values, occurred_at, profiles:actor_profile_id(display_name)')
        .eq('table_name', 'creators_payout')
        .gte('occurred_at', lookback)
        .order('occurred_at', { ascending: false }),

      admin.from('admin_actions')
        .select('action_type, target_table, target_id, note, created_at, profiles:admin_id(display_name)')
        .gte('created_at', lookback)
        .order('created_at', { ascending: false }),

      // Trials ending soon (still trialing, ends within the lookahead window)
      admin.from('managers')
        .select('id, agency_name, plan, trial_ends_at, profiles!inner(display_name)')
        .eq('subscription_status', 'trialing')
        .not('trial_ends_at', 'is', null)
        .lte('trial_ends_at', trialWindowEnd)
        .order('trial_ends_at', { ascending: true }),

      // Trials that lapsed without converting (used a trial, ended in the
      // past week, and status isn't active/trialing -- i.e. never
      // converted to paid or was force-downgraded)
      admin.from('managers')
        .select('id, agency_name, plan, trial_ends_at, subscription_status, profiles!inner(display_name)')
        .eq('trial_used', true)
        .not('subscription_status', 'in', '(active,trialing)')
        .not('trial_ends_at', 'is', null)
        .lt('trial_ends_at', nowIso)
        .gte('trial_ends_at', lookback)
        .order('trial_ends_at', { ascending: false }),

      admin.from('sponsors')
        .select('id, company_name, plan, trial_ends_at, profiles!inner(display_name)')
        .eq('subscription_status', 'trialing')
        .not('trial_ends_at', 'is', null)
        .lte('trial_ends_at', trialWindowEnd)
        .order('trial_ends_at', { ascending: true }),

      admin.from('sponsors')
        .select('id, company_name, plan, trial_ends_at, subscription_status, profiles!inner(display_name)')
        .eq('trial_used', true)
        .not('subscription_status', 'in', '(active,trialing)')
        .not('trial_ends_at', 'is', null)
        .lt('trial_ends_at', nowIso)
        .gte('trial_ends_at', lookback)
        .order('trial_ends_at', { ascending: false }),
    ]);

    for (const r of [
      auditRows, openDisputes, contractLookup, trustRows, privilegeRows, payoutRows, adminActionRows,
      trialingManagers, lapsedManagers, trialingSponsors, lapsedSponsors,
    ]) {
      if (r.error) throw r.error;
    }

    const contractById = new Map((contractLookup.data || []).map(c => [c.id, c]));

    const endingSoon = [
      ...(trialingManagers.data || []).map(m => ({ kind: 'Manager', name: m.agency_name || m.profiles?.display_name, plan: m.plan, trial_ends_at: m.trial_ends_at })),
      ...(trialingSponsors.data || []).map(s => ({ kind: 'Sponsor', name: s.company_name || s.profiles?.display_name, plan: s.plan, trial_ends_at: s.trial_ends_at })),
    ].sort((a, b) => new Date(a.trial_ends_at) - new Date(b.trial_ends_at));

    const lapsed = [
      ...(lapsedManagers.data || []).map(m => ({ kind: 'Manager', name: m.agency_name || m.profiles?.display_name, plan: m.plan, trial_ends_at: m.trial_ends_at, subscription_status: m.subscription_status })),
      ...(lapsedSponsors.data || []).map(s => ({ kind: 'Sponsor', name: s.company_name || s.profiles?.display_name, plan: s.plan, trial_ends_at: s.trial_ends_at, subscription_status: s.subscription_status })),
    ].sort((a, b) => new Date(b.trial_ends_at) - new Date(a.trial_ends_at));

    const html = renderDigest({
      auditRows: auditRows.data || [],
      openDisputes: openDisputes.data || [],
      contractById,
      trustRows: trustRows.data || [],
      privilegeRows: privilegeRows.data || [],
      payoutRows: payoutRows.data || [],
      adminActionRows: adminActionRows.data || [],
      endingSoon,
      lapsed,
    });

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Kitscore weekly exception report: ${(openDisputes.data || []).length} open dispute(s), ${endingSoon.length} trial(s) ending soon`,
      html,
    });

    return res.status(200).json({
      ok: true,
      open_disputes: (openDisputes.data || []).length,
      trials_ending_soon: endingSoon.length,
      trials_lapsed: lapsed.length,
      contract_events_this_week: (auditRows.data || []).length,
      trust_events_this_week: (trustRows.data || []).length,
      privilege_changes_this_week: (privilegeRows.data || []).length,
      payout_changes_this_week: (payoutRows.data || []).length,
      admin_actions_this_week: (adminActionRows.data || []).length,
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

function actorLabel(row) {
  return row.profiles?.display_name || (row.db_role === 'service_role' ? 'System / API' : row.actor_role || 'unknown');
}

function daysUntil(iso) {
  return Math.ceil((new Date(iso) - new Date()) / (24 * 60 * 60 * 1000));
}

function auditRowsTable(rows, labelFn) {
  if (!rows.length) return '<p>None this week.</p>';
  return `<table style="border-collapse:collapse;width:100%;font-size:13px">
    <tr style="text-align:left;border-bottom:1px solid #ddd"><th>When</th><th>What</th><th>Changed</th><th>Actor</th></tr>
    ${rows.map(r => `
      <tr style="border-bottom:1px solid #eee">
        <td>${new Date(r.occurred_at).toLocaleString()}</td>
        <td>${escapeHtml(labelFn(r))}</td>
        <td>${escapeHtml((r.changed_columns || []).join(', '))}</td>
        <td>${escapeHtml(actorLabel(r))}</td>
      </tr>`).join('')}
  </table>`;
}

function renderDigest({ auditRows, openDisputes, contractById, trustRows, privilegeRows, payoutRows, adminActionRows, endingSoon, lapsed }) {
  const disputeSection = !openDisputes.length
    ? '<p>No open disputes right now.</p>'
    : `<ul>${openDisputes.map(c => `
        <li><b>${escapeHtml(c.sponsors?.company_name || 'Sponsor')} × ${escapeHtml(c.creators?.profiles?.display_name || 'Creator')}</b>
        — "${escapeHtml(c.title || 'Untitled')}" (${moneyLabel(c.escrow_amount_cents)})<br>
        Disputed ${new Date(c.disputed_at).toLocaleDateString()}: ${escapeHtml(c.dispute_reason || '(no reason given)')}</li>
      `).join('')}</ul>`;

  const contractEventSection = auditRowsTable(auditRows, r => contractLabel(contractById.get(r.record_id)));
  const trustSection = auditRowsTable(trustRows, r => `${r.table_name} #${String(r.record_id).slice(0, 8)}`);
  const privilegeSection = auditRowsTable(privilegeRows, r => `${r.table_name} #${String(r.record_id).slice(0, 8)}`);
  const payoutSection = auditRowsTable(payoutRows, r => `creator #${String(r.record_id).slice(0, 8)}`);

  const endingSoonSection = !endingSoon.length
    ? '<p>No trials ending in the next 7 days.</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;border-bottom:1px solid #ddd"><th>Ends</th><th>Name</th><th>Type</th><th>Plan</th></tr>
        ${endingSoon.map(t => `
          <tr style="border-bottom:1px solid #eee">
            <td>${new Date(t.trial_ends_at).toLocaleDateString()} (${daysUntil(t.trial_ends_at)}d)</td>
            <td>${escapeHtml(t.name || 'unnamed')}</td>
            <td>${escapeHtml(t.kind)}</td>
            <td>${escapeHtml(t.plan || '')}</td>
          </tr>`).join('')}
      </table>`;

  const lapsedSection = !lapsed.length
    ? '<p>No trials lapsed without converting this week.</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;border-bottom:1px solid #ddd"><th>Ended</th><th>Name</th><th>Type</th><th>Now</th></tr>
        ${lapsed.map(t => `
          <tr style="border-bottom:1px solid #eee">
            <td>${new Date(t.trial_ends_at).toLocaleDateString()}</td>
            <td>${escapeHtml(t.name || 'unnamed')}</td>
            <td>${escapeHtml(t.kind)}</td>
            <td>${escapeHtml(t.subscription_status)}</td>
          </tr>`).join('')}
      </table>`;

  const adminActionSection = !adminActionRows.length
    ? '<p>No admin actions logged this week.</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;border-bottom:1px solid #ddd"><th>When</th><th>Action</th><th>Target</th><th>Admin</th><th>Note</th></tr>
        ${adminActionRows.map(r => `
          <tr style="border-bottom:1px solid #eee">
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${escapeHtml(r.action_type)}</td>
            <td>${escapeHtml(r.target_table)} #${String(r.target_id).slice(0, 8)}</td>
            <td>${escapeHtml(r.profiles?.display_name || 'unknown')}</td>
            <td>${escapeHtml(r.note || '')}</td>
          </tr>`).join('')}
      </table>`;

  // "Start here" -- one skimmable list in the same priority order as
  // the detail sections below, so the email answers "what do I do
  // today" before it answers "what happened this week."
  const startHere = [
    openDisputes.length ? `<li><b>${openDisputes.length}</b> open dispute(s) need review — see §1</li>` : null,
    endingSoon.length ? `<li><b>${endingSoon.length}</b> trial(s) ending in the next 7 days — see §2</li>` : null,
    lapsed.length ? `<li><b>${lapsed.length}</b> trial(s) lapsed without converting — see §2</li>` : null,
    privilegeRows.length ? `<li><b>${privilegeRows.length}</b> role/plan change(s) this week — worth a sanity check, see §3</li>` : null,
    payoutRows.length ? `<li><b>${payoutRows.length}</b> creator payout-account change(s) — see §4</li>` : null,
  ].filter(Boolean);

  const startHereSection = startHere.length
    ? `<ul>${startHere.join('')}</ul>`
    : '<p>Nothing urgent — disputes, trials, privilege, and payout are all quiet this week.</p>';

  return `
    <h2>Weekly exception report</h2>

    <h3>Start here</h3>
    ${startHereSection}

    <h3>1. Escrow & contracts — open disputes needing review</h3>
    ${disputeSection}
    <h4>Contract events this week</h4>
    ${contractEventSection}

    <h3>2. Trials — ending soon / recently lapsed</h3>
    <h4>Ending in the next 7 days</h4>
    ${endingSoonSection}
    <h4>Lapsed without converting (past 7 days)</h4>
    ${lapsedSection}

    <h3>3. Privilege changes (role / plan)</h3>
    ${privilegeSection}

    <h3>4. Payout integrity (creator Stripe Connect changes)</h3>
    ${payoutSection}

    <h3>5. Trust & reputation (campaigns + score_components)</h3>
    ${trustSection}

    <h3>6. Admin actions this week</h3>
    ${adminActionSection}

    <p style="color:#888;font-size:12px">Full detail and filters: the Audit Log panel in admin, or <code>select * from fn_admin_audit_log(30);</code>. Trial and access overrides: the Managers/Sponsors admin pages.</p>
  `;
}

function moneyLabel(cents) {
  if (cents == null) return 'amount not set';
  return `$${(cents / 100).toLocaleString()}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
