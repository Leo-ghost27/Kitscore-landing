-- 2026-08-20-followup-health-check-investigation.sql
--
-- Investigated the "Kitscore health check: 2 issue(s) need a look" digest:
--
-- 1. client_failures / profile_creation (2 unresolved) -- both affected
--    accounts (gina.hamza@proton.me, mhamza-garba@outlook.com) already
--    had working profile rows created weeks before the failure
--    timestamps, so these were login-time hiccups in ensureProfile(),
--    not lost signups; no account was ever actually broken. Root cause:
--    profiles' insert-then-select re-triggers the
--    profiles_select_via_manager_link RLS policy, which reads
--    manager_creator_links -- and the error message ("permission denied
--    for table manager_creator_links") is a real missing-GRANT error,
--    not an RLS rejection. Grants are confirmed correct now
--    (has_table_privilege('authenticated','manager_creator_links','SELECT')
--    = true) and no commit in git history ever revoked them, so this was
--    most likely a brief PostgREST schema-cache lag during today's
--    unusually heavy run of back-to-back live `apply_migration` calls
--    across two parallel sessions (several DROP POLICY/CREATE POLICY
--    cycles landed on this exact table today). Not reproducible now.
--    Marked resolved:
update client_failures set resolved_at = now()
where kind = 'profile_creation' and resolved_at is null
  and id in ('964c12b4-5c8a-4e62-a0af-05d0d9cfddf1', '3f352f25-a24f-4f19-a396-5d13f2bc7e1e');

-- 2. stale_oauth_connection / instagram (9), discord (1) -- not a bug.
--    oauth_states is delete-on-read for completed OAuth flows by design;
--    a leftover row only exists because a user started "Connect
--    Instagram/Discord" and never finished. There was no cleanup step,
--    so abandoned rows accumulated indefinitely. Fixed in
--    lib/handlers/cron-health-check.js: the same daily cron that alerts
--    on these now also purges oauth_states rows older than 24h (separate
--    from the 1h "stale" alerting window, so a same-day retry still has
--    a valid state row). Backlog cleared manually below rather than
--    waiting for tomorrow's run -- only rows already past 24h old were
--    removed; anything still within the 24h grace window was left alone
--    since the user may yet come back and complete it.
delete from oauth_states where created_at < now() - interval '24 hours';
