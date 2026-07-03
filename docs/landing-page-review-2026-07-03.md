# Kitscore Landing Page Review — July 3, 2026

Requested: a 360 review of kitscore.co's visual/content maturity vs. CreatorScore.io, plus a few specific fixes.

**Method note:** I read both sites' actual page content and structure (fetched live), and cross-referenced against the repo's design system. I don't have a way to literally screenshot-render either site, so this is a content/IA/trust-signal read, not a pixel-level visual diff.

## Verdict

Copy and positioning are strong — "should we sponsor this creator?" vs. audience-size tools is a sharp wedge, and the Self-Reported → Submitted → Live-Verified framing is a real differentiator. The gap vs. CreatorScore.io isn't visual polish, it's **depth of proof on the page**: CreatorScore shows the product working (live dashboard screenshots, real roster grid, comparison tables against named competitors, FAQ, case studies, blog, trust badges). Kitscore describes the product well but backs it with thinner, more repetitive evidence.

## What was found

1. Same demo creator (Jordan Ellis) reused across hero card and AI Decision Brief — reads as "one seeded example," not a live system.
2. Homepage directory preview was 5 rows, all UK, suspiciously round scores (87/91/80/78/65) — reads like curated seed data.
3. No FAQ — a due-diligence tool asking sponsors to trust it should pre-answer the obvious objections (how is evidence verified, what stops gaming, refund policy).
4. No comparison page vs. competitors (CreatorScore, HypeAuditor, etc.) — the verified-mutual-campaign differentiator is stated once, never defended head-to-head.
5. No trust/compliance signal in the footer.
6. Homepage hero had a non-functional search bar (`heroSearch`) — the Search button discarded whatever was typed and just linked to `app/directory.html`; the niche/location tag chips only populated that same dead input.
7. `app/directory.html` (the real, logged-in sponsor directory, wired to live Supabase data) had no niche filtering at all — just a sort dropdown.

## What was done this session

- **Removed** the non-functional hero search bar and tag chips from `index.html`.
- **Added functional niche filter pills to `app/directory.html`** — built dynamically from whatever niches actually exist in the live `creators` table, so it's real filtering over real (eventually real-signup) data, not a dead input.
- **Rotated the AI Decision Brief example** off Jordan Ellis onto Sophie Lau × a skincare brand, so the homepage shows two different creators instead of one repeated identity.
- **Diversified the homepage directory preview**: added 2 more rows (7 total, still UK-focused per current market), de-rounded a couple of scores (80→81, 78→76, 65→64). This is a static fallback that Vercel already auto-swaps for live Supabase data once real creators exist (`loadHomeDirectory()` — that logic was already correctly built, just never had live data to show).
- **Added a 6-question FAQ section** above the final CTA band, styled to match the existing design system (square corners, `<details>`/`<summary>` accordion, no new dependencies).
- **Added a new "For Creators" band** directly under the hero (purely additive, nothing else on the page changed) — short, punchy, hits both the free-profile angle and the evidence/proof angle per your direction, with a CTA into signup.

## What's still open

- **No real signups yet**, which is the actual root cause of the "thin proof" feeling — no amount of copy/layout work substitutes for real creators and campaigns. Everything above is the honest ceiling of what's fixable without fabricating data (I did not invent fake testimonials, signup counts, or activity — that would undercut the trust positioning you're selling).
- **No case studies / blog** — needs real completed evaluations to reference, can't be done meaningfully yet.
- **AI Intelligence section is still a static mock**, not a live/animated reveal — cosmetic upgrade, not started.
- **No trust/compliance badge in footer** — holding off on this until we know what's actually defensible to claim (e.g. don't want to write "GDPR compliant" if that hasn't been formally assessed).

## Update — July 3, later same day

**Shipped: `compare.html` — Kitscore vs. CreatorScore.** Researched CreatorScore.io directly (their homepage, pricing page, API docs) rather than guessing, so every claim in the table is sourced from their own site: 7 AI scoring agents, 12 platforms, $19.99 (Quick/scraper-based) or $29.99 (Verified/OAuth-authorized) per-creator pricing. Deliberately did **not** name HypeAuditor or Modash — they're a different weight class (HypeAuditor: 100+ employees, $299–$2,999+/mo enterprise pricing, 227M+ creator database) and a different product category (broad discovery + campaign management vs. Kitscore's narrow trust/verification focus). Comparing a zero-signup landing page against an 8-year-old enterprise incumbent would read as reaching; CreatorScore is the honest, same-weight-class comparison. The table frames the real difference: CreatorScore scores AI-analyzed public content ("is this creator's content safe"), Kitscore scores mutually-confirmed campaign history and real sponsor testimony ("will this creator deliver"). Linked from the homepage footer and from the Why Kitscore section CTA row.

**Next up (not started, by your instruction to keep original order): founding-creator acquisition page.** You shared a mockup for a dedicated `for-creators.html` — founding-cohort framing ("first 100"), 3 value props (free media kit, founding badge, discovery), 3-step signup flow, example profile card, single CTA. Agreed this is the right move for the actual bottleneck (need creators before sponsors have anything to browse). Plan, confirmed with you:
1. Migration: add `founding_cohort boolean` to `creators`, auto-flagged `true` for the first 100 creator signups by order (live tracking, not static copy).
2. Build `for-creators.html` matching the mockup and the site's design system.
3. Point the homepage's "For Creators" band CTA at this new page instead of straight to `auth.html`.

If this session ends before it's built, that's the next thing to pick up.
