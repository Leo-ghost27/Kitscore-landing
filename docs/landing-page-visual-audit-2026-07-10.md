# Landing Page Visual Audit — index.html
Started 2026-07-10 · Living doc, updated as items are found/fixed.

Scope: `index.html` internal consistency — fonts, backgrounds, section rhythm,
visual claims. (Creator-side pricing/screenshot audit against `app/pricing-creator.html`
and `for-creators.html` was completed separately earlier the same day — see prior
commits `3519b51`, `d7467c4`, `f94ae8b`, `cc03a88`, `6e09296`, `9925424`.)

## System (for reference)
- Display font: `Fraunces` (serif) — used via `.section-h` on every major heading
- Body font: `Inter` (sans) — via `var(--font)`
- Band rhythm: alternates white (`var(--bg)` / `#FFFFFF`) and cream (`.band-alt`, `var(--bg-alt)` / `#FAF8F3`)
- Default section spacing: `padding: 80px 2rem; max-width: 1100px` (base `section` rule)
- Narrower content sections (`reputation`, `decision-memo`, `faq`) intentionally
  use `max-width: 960px` / `800px` — this is a deliberate editorial-width choice,
  not a bug.

## Findings

### 🔴 FIXED — CTA band headline breaks the serif-heading pattern
`<h2>` in the closing CTA band ("The smarter way to sponsor.", line ~1507) is
fully inline-styled and never sets `font-family`. Every other `<h2>` on the
page uses `.section-h` → `font-family: var(--font-display)` (Fraunces). This
one silently falls back to body Inter — meaning the single highest-visibility
headline on the page (last thing before conversion) is the only one not in
the premium serif. Font-weight also drifted (700 vs. 600 everywhere else).
**Fix:** added `font-family: var(--font-display)` and aligned weight to 600.
Pushed in commit `ced446e`.

### 🟢 FIXED — band-alt rhythm break
Resolved by merging "Sample Reports" + "See It In Action" into one continuous
white section (divider removed between them). Merging drops one section from
the alternating count, so keeping the merged block **white** (not cream)
restores perfect alternation for every section after it with zero other
changes needed — the fix was simpler than it first looked.
Pushed in commit `aae03f8`.

### 🟢 FIXED — comparison block structural asymmetry
"Other tools ask" (left column) had only an eyebrow + question, while
"Kitscore answers" (right column) had eyebrow + bold headline + explanatory
subline — leaving the left side visually sparse/unfinished next to the right.
Added a matching subline to the left column ("A single metric, disconnected
from any hiring decision.") so both sides share the same structure while
preserving the intentional muted-vs-bold tone contrast.
Pushed in commit `aae03f8`.

### 🟢 Reviewed, no issue — worth noting so it isn't re-flagged later
- App-side pages (`app/*.html`) intentionally use a second typeface,
  `IBM Plex Mono`, for uppercase eyebrow/tag labels via `shared.css`'s
  `--font-mono`. This is a deliberate marketing-vs-product typography split,
  not drift — confirmed by checking `shared.css` is shared across all app
  pages consistently.
- Section vertical padding varies 64px vs. 80px depending on section (some
  override the 80px default inline, some don't) — checked whether this reads
  as a real inconsistency or normal editorial variation. Given the max-width
  tiers already vary intentionally (960px/800px sections are content-dense,
  1100px sections are visual/grid-heavy), the padding variance tracks the
  same logic and reads as intentional, not sloppy. Not flagging as a fix
  unless you want strict spacing-scale enforcement.
- Directory avatar colors (`#2563EB`, `#DB2777`, `#7C3AED`, etc.) — varied
  brand colors for mock creator initials. Intentional visual variety for a
  sample directory list, not a design-system leak.

## Next up (pending your steer)
Sponsor-side review — bigger scope, tomorrow per your note.
