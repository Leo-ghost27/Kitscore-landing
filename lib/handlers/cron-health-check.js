// Handler for GET /api/cron?job=health-check
//
// Closes the "found by accident" blind spot: signup/profile-creation
// failures (client_failures) and abandoned/failed OAuth connections
// (stale oauth_states rows -- see 2026-07-31c-client-failure-log-and-
// health-summary.sql for why a leftover row means the flow never
// completed) had no aggregate view anywhere. This queries the same
// three sources fn_admin_health_summary() exposes to the admin UI, but
// directly via the service-role client rather than through that RPC --
// the RPC's own admin-gate checks auth.uid(), which is null for a
// cron-triggered service-role call, so it would reject itself. Two
// consumers of the same underlying data, not two sources of truth.
//
// Sends one digest email (via lib/email.js, not the Vault-secret path
// fn_notify_admin_on_signup uses) only when something crosses a
// threshold -- this runs daily and most days should be silent.
const { adminClient } = require('../supabase-admin');
const { sendEmail } = require('../email');

const ADMIN_EMAIL = 'gina.hamza@kitscore.co';
const STALE_OAUTH_HOURS = 1;
const LOOKBACK_DAYS = 7;

// Below this count for a given kind, it's noise -- don't page anyone.
const THRESHOLDS = { client_failure: 1, notification_failure: 1, stale_oauth_connection: 5 };

module.exports = async function handleCronHealthCheck(req, res) {
  try {
    const admin = adminClient();
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const staleCutoff = new Date(Date.now() - STALE_OAUTH_HOURS * 60 * 60 * 1000).toISOString();

    const [clientFailures, notificationFailures, staleOauth] = await Promise.all([
      admin.from('client_failures').select('kind, created_at')
        .is('resolved_at', null).gte('created_at', lookback),
      admin.from('notification_failures').select('kind, created_at')
        .is('resolved_at', null).gte('created_at', lookback),
      admin.from('oauth_states').select('platform, created_at')
        .lt('created_at', staleCutoff),
    ]);

    if (clientFailures.error) throw clientFailures.error;
    if (notificationFailures.error) throw notificationFailures.error;
    if (staleOauth.error) throw staleOauth.error;

    const summary = [
      ...groupByKind(clientFailures.data, 'client_failure'),
      ...groupByKind(notificationFailures.data, 'notification_failure'),
      ...groupByKind(staleOauth.data, 'stale_oauth_connection', 'platform'),
    ];

    const overThreshold = summary.filter(row => row.count >= THRESHOLDS[row.category]);

    if (overThreshold.length > 0) {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `Kitscore health check: ${overThreshold.length} issue(s) need a look`,
        html: renderDigest(overThreshold),
      });
    }

    return res.status(200).json({ ok: true, summary, alerted: overThreshold.length > 0 });
  } catch (err) {
    console.error('cron-health-check error:', err);
    return res.status(500).json({ error: 'health check failed' });
  }
};

function groupByKind(rows, category, kindField = 'kind') {
  const byKind = new Map();
  for (const row of rows) {
    const kind = row[kindField];
    const existing = byKind.get(kind);
    if (!existing || row.created_at < existing.oldest) {
      byKind.set(kind, { count: (existing?.count || 0) + 1, oldest: existing ? existing.oldest : row.created_at });
    } else {
      existing.count += 1;
    }
  }
  return [...byKind.entries()].map(([kind, v]) => ({ category, kind, count: v.count, oldest: v.oldest }));
}

function renderDigest(rows) {
  const items = rows.map(r =>
    `<li><b>${r.category}</b> / ${r.kind} — ${r.count} unresolved, oldest since ${new Date(r.oldest).toLocaleString()}</li>`
  ).join('');
  return `<p>The Kitscore health check found the following over the last ${LOOKBACK_DAYS} days:</p><ul>${items}</ul>` +
    `<p>Full detail: <code>select * from fn_admin_health_summary();</code> (admin-only RPC) or the Health panel in admin-system.</p>`;
}
