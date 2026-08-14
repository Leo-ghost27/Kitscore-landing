# Dashboard / Profile rework — blueprint v1
Session date: 2026-08-14. Planning-only session (no PAT issued for this doc — build
changes below are NOT yet pushed unless a later commit in this same session says so).

## Why
Two independent onboarding checklists existed (dashboard's "Complete your trust
profile" and profile.html's "Get fully verified"), overlapping on "profile details"
with different completion thresholds, plus a stub "Sharing" tab on Dashboard that
just cross-linked to Profile. This rework: (1) unifies onboarding into one Journey
card that matches the landing-page "Kitscore Journey" narrative, (2) moves
post-login landing to Profile, (3) redistributes Profile's non-account tabs into
Dashboard so each page has one clear job — Profile = who you are + how you get
paid, Dashboard = your score and everything that builds/shows it.

## New IA

### Sidebar order (nav.js CREATOR_ITEMS)
Profile, Dashboard, Evidence, Campaigns, Briefs, Contracts, Support, Upgrade
(was: Dashboard, Campaigns, Briefs, Contracts, Evidence, Support, Profile, Upgrade)

### auth.html
Post-login redirect target changes from dashboard.html to profile.html.

### profile.html — reduced to 2 tabs
- **Account setup**: Profile details form (display name, niche, location, business
  email) only. Drop the "Get fully verified" checklist (superseded by Dashboard's
  Journey card) and drop the "Connected platforms" summary card (duplicate of
  Dashboard's live Signals tab — remove, don't relocate).
- **Payout**: unchanged (Stripe Connect card, balance stats, earnings chart,
  payout history).
- Media kit tab and Link & share tab: REMOVE from profile.html, content moves to
  Dashboard (see below).
- Hero band (navy gradient, avatar, Founding Creator pill, score ring card,
  "+Connect a platform" button) becomes the shared hero used dashboard-wide too.
  Add a new line under the handle: "Verified since [Month Year]" — reuse the
  verifiedSince calc that currently only lives in evekit.html's data load; needs
  to move into the shared creator-fetch path so both Profile and Dashboard can
  use it.

### dashboard.html — reworked to 6 tabs
Tab order: Overview, Signals, Score, Verified media kit, Link and share, Tools

- **Overview**: hero (score ring, lives in the hero band itself, not a separate
  card) + Journey card only. Everything else currently on Overview moves out:
  - Stat strip (evidence items / campaigns / profile complete %) — TBD, likely
    drop or fold into Score tab, not yet decided
  - Media Kit teaser card — drop, real thing now lives on its own tab
  - Sponsor/creator interest card (creatorInterestHtml) — moves to Link and share
  - Verified Rate Benchmark card — drop the Overview duplicate; canonical version
    already lives in Tools, nothing to build
  - Cold-start nudge ("verify a past sponsor") — TBD placement, likely stays on
    Overview near Journey stage 3 since it's the same call to action, or folds
    into the Journey card's stage-3 continue button. Not yet decided.
  - Onboarding steps card — replaced entirely by the new Journey card (see
    Journey spec below)
  - Milestone / Trust Badge card — moves to Score tab
  - "Why verify campaigns?" card — moves to Score tab, next to Milestone

- **Signals** (renamed from "Inputs"/evidence tab): three-card block, same visual
  pattern as profile.html's old Account Setup + Connected Platforms pairing.
  1. Platforms — OAuth connect/disconnect UI (unchanged content, from old
     renderEvidenceTab's platform section)
  2. Brand safety — the 8-question questionnaire (unchanged content, from old
     renderEvidenceTab's #brand-safety block, QUESTIONS array)
  3. Audience demographics — MOVES here from Tools tab (currently
     renderAuthenticityTab(), called inside renderToolsTab() at present)
  Evidence upload/file management: REMOVED from this tab. Assume the standalone
  evidence.html sidebar page (already promoted higher in nav) is the one true
  place for it — same treatment as the profile.html "Connected platforms"
  duplicate. Confirm this assumption before deleting any evidence-upload code.

- **Score**: existing score breakdown content, PLUS:
  - Milestone / Trust Badge card (moved from Overview)
  - "Why verify campaigns?" card (moved from Overview)

- **Verified media kit**: moved from profile.html's old Media Kit tab. Rebuild in
  the rich navy/Fraunces visual system (same treatment as the hero), not
  Dashboard's current flat style.

- **Link and share**: moved from profile.html's old Link & Share tab. Add sponsor
  interest card (moved from Overview). Same rich visual treatment. Content:
  trust link, verified badge (embeddable SVG), verified media kit link, profile
  view analytics, sponsor watchlist interest — same breakdown look profile.html
  used.

- **Tools**: unchanged, keeps everything currently there MINUS audience
  demographics (moves to Signals, see above).

## Journey card spec (Overview tab)
Replaces the old flat 4-step "Complete your trust profile" card. Maps the
marketing "Kitscore Journey" (Claim → Verify → Score → Get hired) onto real data:

1. **Claim your profile** — done when profile details + at least one platform
   connected + media kit started (bio/avatar set). This absorbs 3 of
   profile.html's old 4 checklist items.
2. **Upload your evidence** — done when evidence.length >= 1
3. **Get your Kitscore** — nested sub-steps: brand safety questionnaire complete
   AND first campaign verified. Shows "Continue" button deep-linking to
   whichever sub-step is incomplete (Signals tab for brand safety, or
   campaigns.html?invite=1 for campaign verification).
4. **Get your next sponsor** — locked until hasScore is true. Placeholder for
   now; exact unlock behavior (deep-link to briefs.html or directory) not yet
   decided.
One progress bar, one percentage, shown only here — profile.html's Account Setup
tab does NOT get its own duplicate progress bar going forward.

## Visual system
Apply profile.html's existing rich treatment (navy/Fraunces gradient hero,
Space Grotesk body, 16px card radius, soft shadow `0 1px 2px rgba(11,18,32,.04),
0 8px 24px rgba(11,18,32,.06)`, blue-to-teal gradient progress bars) across ALL
Dashboard tabs, not just the hero. This replaces Dashboard's current flat
design system (shared.css defaults) for the creator workspace. Marketing pages
and sponsor-side pages are NOT in scope for this visual change.

## Open questions for next session
1. Stat strip (evidence/campaigns/profile-complete%) — keep on Overview, move to
   Score, or drop entirely?
2. Cold-start "verify a past sponsor" nudge — separate card or folded into
   Journey stage 3?
3. Stage 4 "Get your next sponsor" unlock — what does it deep-link to?
4. Confirm evidence.html is the sole home for evidence upload (Signals tab won't
   rebuild that UI)
5. verifiedSince — confirm where in the creator-fetch path to compute it so both
   Profile and Dashboard hero can share it without duplicating the calc

## Build order (recommended)
1. auth.html redirect change (small, isolated)
2. profile.html: strip to 2 tabs, drop redundant checklist + platform summary
3. dashboard.html: Journey card (already scoped in detail from earlier session)
4. dashboard.html: Signals tab restructure (3-box layout)
5. dashboard.html: Score tab additions (Milestone, Why verify)
6. dashboard.html: new Verified media kit + Link and share tabs (content move +
   restyle)
7. Visual system pass: apply navy/Fraunces treatment across all Dashboard cards
8. nav.js sidebar reorder
