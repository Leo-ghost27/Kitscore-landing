# Before you work on this repo

This project is sometimes worked on by more than one Claude session at once
(different chat tabs, Claude Code, etc.), not just one at a time. On
2026-07-28 this caused two real, avoidable problems in a single day:

1. **Two sessions independently built the same follower-tracking feature**
   within about an hour of each other — one as `platform_follower_history`,
   the other as `platform_follower_snapshots` — neither aware the other
   existed, discovered only when the user happened to compare notes between
   sessions. Reconciled in `supabase/2026-07-25-consolidate-follower-*.sql`.
2. **Two sessions independently built engagement benchmarking** — one as a
   fixed industry-range comparison, the other as a peer-percentile ranking
   against real cohort data. The fixed-range version was later removed by
   user decision once this was noticed (see `app/dashboard.html` history).

Neither of these was caused by bad code — they were caused by two sessions
having zero visibility into what the other had already shipped, because
direct database changes don't show up in git the way file changes do.

## Before adding a new database table, column, or scoring function

- Run a check for what already exists first — `list_tables`,
  `list_migrations`, or a search of `supabase/*.sql` — rather than assuming
  a feature doesn't exist yet because you don't see it in the files you
  happen to be looking at.
- If you find something that looks like an early or partial version of
  what you're about to build, **stop and surface it to the user rather than
  quietly building a second version.** They may be able to tell you in one
  sentence whether it's live, abandoned, or mid-flight elsewhere.

## Always use `apply_migration`, never raw `execute_sql`, for schema changes

Raw `execute_sql` DDL changes don't get recorded in Supabase's own
`supabase_migrations.schema_migrations` ledger — `list_migrations` won't
show them to the next session that checks, even though they're live and
real. This happened at least once this same day (see the note in
`supabase/2026-07-25-consolidate-follower-snapshots-into-history.sql`).
`apply_migration` records properly; `execute_sql` should be reserved for
reads and one-off queries, not schema changes.

## After any live database change

Write the matching `.sql` file into `supabase/` in the same session, not
later. The live database has drifted from this repo's migration history
before (see the `2026-07-19*` Twitch backfills and `2026-07-23*` files) —
every time that happened, it was because a change was made live and the
file was never written down, not because anyone intended to hide it.

## Duplicated marketing content

`index.html` and `agencies.html` hand-duplicate the sponsor pricing grid
(see the comments at each `#pricing` / `#pricing-sponsors` section). If you
change one, change the other, or the two pages will describe two different
products to two different audiences.
