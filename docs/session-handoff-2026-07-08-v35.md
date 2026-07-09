# Kitscore — Session Handoff (July 8, 2026 — v35)

**Context:** direct continuation of v34. Gina asked for a full audit of every creator-facing feature, split cleanly into what's actually Free vs actually Pro in the code (not just marketing copy), then to close every gap found and reorganize the creator dashboard to match the icon-nav pattern already live on the sponsor Team page.

Latest commit on `main`: `5a45c8a`. Note: a parallel session pushed `bdbfb8c` (card-pattern/shadow fixes) and `03eb8e8` (sponsor public feedback on `p.html` + evidence freshness nudges) mid-session — rebased cleanly, no conflicts, re-verified syntax on every touched file post-merge. That session's work isn't detailed here since it wasn't this session's; see its own commit messages for full detail.

## 1. Full feature audit — what's real vs what's just copy

Went through every creator-facing page and API route grep'ing for actual plan-gating logic (`creator.plan`, `isPro`, etc.) rather than trusting pricing-page copy. Found **only two real gates in the entire codebase**: the Proof Packet watermark and score history (built last session). Everything else claimed as a differentiator was unenforced:

- **"Public profile listing in the sponsor directory" as Pro-exclusive** — already found and fixed last session (v34).
- **"1 platform (Free) vs unlimited (Pro)"** — new finding this session. Zero enforcement anywhere; a free creator could already tag evidence to every platform. Also found the same stale "public profile listing" claim baked into the PDF watermark footer text (`api/generate-proof-packet.js`) and the dashboard's Proof Packet card copy — fixed both.

## 2. Decisions made this session

- **Shareable trust profile (`kitscore.co/p/:slug`) stays free for everyone.** Considered gating it behind Pro since it was on the initial "gate these" list, but `for-creators.html` already promises it "free forever" publicly — reversing that would break a live commitment. Dropped from the Pro feature list, confirmed.
- **1-platform cap: build it for real**, not just fix the copy. Real monetization lever, worth actually enforcing.
- **Founding-cohort exception**: founding creators (first 100) get unlimited platforms free too, not gated behind Pro — deliberate, to build a strong creator base for the directory during the founding period.

## 3. Real 1-platform cap — built and tested

New `BEFORE INSERT` trigger on `evidence_uploads` (`fn_enforce_platform_limit`): free, non-founding creators get blocked from adding a second distinct platform, with a clear error message naming the blocked platform. Pro and founding creators pass through untouched. Enforced at the DB level (not just client-side), so it can't be bypassed by calling the insert directly.

**Tested safely**: no free/non-founding creators exist yet in production to test against naturally (everyone so far is either Pro or founding — makes sense, the founding cohort is still filling). Verified the trigger logic directly instead, using a `BEGIN...ROLLBACK` transaction that temporarily flipped Fiona R to free/non-founding, confirmed the first platform insert succeeds and a second distinct platform is correctly blocked, then rolled back — confirmed zero residue afterward (Fiona R's real `founding_cohort: true` intact, no leftover test rows).

Evidence tab now shows a proactive notice for free/non-founding creators before they hit the wall, not just a reactive DB error.

## 4. Creator dashboard reorganized into icon-nav tabs

Replicated the sponsor Team page's pattern (`app/team.html`'s `TEAM_TABS`/`switchTab`/`renderTeamShell` structure) for the creator dashboard: **Overview / Score / Profile / Evidence / Tools**, with the score-hero ring staying always-visible above the tabs (same relationship as Team's title header staying above its tabs).

This was the messiest part of the session — the reassembly broke partway through (a leftover fragment from the old inline animation code leaked into the wrong function's closing brace, causing a real syntax error). Caught it via syntax-check before committing, not after. Also caught and fixed two more real bugs while reviewing the reassembled structure, neither of which the syntax checker would have caught on its own:
- `switchTab()` updated the panel content but never updated which tab *looked* active in the nav — fixed by adding `data-tab-key` attributes and toggling `.active` directly.
- A **pre-existing bug**, not something I introduced: a stray `}` had leaked inside a CSS color string (`'var(--color-text-primary)}'`), breaking the reliability-score number's color styling. Fixed while in there.

Tab breakdown:
- **Overview**: stat strip, onboarding checklist, milestone progress, why-verify card
- **Score**: verified reputation stats, score breakdown, improvement suggestions, score history chart
- **Profile**: shareable trust profile link, audience demographics
- **Evidence**: evidence list (with the new platform-cap notice), brand safety questionnaire
- **Tools**: rate calculator, Proof Packet download, tips to raise score

## 5. Pricing cards synced everywhere

Updated both `app/pricing-creator.html` and `index.html` Free-tier lists to include: the platform cap with the founding exception noted inline, shareable profile link, and the rate calculator/score breakdown. Pro list stays at the 3 real gates (unlimited platforms, unwatermarked PDF, score history) — no padding with unenforced claims. Also strengthened the `for-creators.html` founding-cohort CTA band to mention the now-real unlimited-platforms perk as a concrete incentive.

## Verification

Syntax-checked every touched file (dashboard.html, pricing-creator.html, index.html, for-creators.html, and — post-rebase — p.html, evidence.html, campaigns.html from the parallel session's changes) by extracting and parsing inline `<script>` blocks with Node. Platform-cap trigger verified via rollback-safe transaction test against real (temporarily-modified, then restored) production data.

**Not done**: no visual browser check of the reorganized dashboard yet — same caveat as v34, now compounding. This is the biggest UI change of the project so far and it genuinely needs eyes on it before anyone else sees it.

## For next session

1. **Visual check of the reorganized dashboard in an actual browser** — top priority, biggest UI change yet, only syntax- and logic-verified so far.
2. Real click-through as owner + member test accounts — still carried forward, now eight sessions overdue.
3. Weight-split decision (5 score components still all 0.20 placeholder).
4. Disclosure compliance — on hold until OAuth exists (per Gina's explicit call last session).
5. Decide on 150/mo quota enforcement.
6. `notification_failures` table check.
7. Check in on what the parallel session's Team-page/sponsor-feedback work needs from this side, if anything.
