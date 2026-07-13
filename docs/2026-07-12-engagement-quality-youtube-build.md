# Engagement Quality — YouTube built, TikTok pending

**Date:** 2026-07-12 · **Status:** YouTube live in production. TikTok not started — blocked on a scoring-design decision below.

## What shipped today

Renamed the existing `engagement_quality` score component to **`engagement_quality_youtube`**, in prep for TikTok getting its own key later instead of colliding on the same row. No formula change, no score change for any existing creator — verified row-for-row before/after in production.

- **Formula (unchanged):** reach-efficiency proxy — `(views ÷ videos) ÷ followers`, tiered into a 40–90 value. Not true engagement (likes+comments÷views); that needs deeper analytics access we don't have.
- **Trigger:** fires on `platform_connections` insert/update, only when `platform = 'youtube' AND verification_method = 'oauth'`. Handle-lookup (`public_lookup`) YouTube connections never touch this — matches the "linked ≠ verified" labeling used everywhere else.
- **Weight:** 0.20, same as the other 4 components (audience_authenticity, brand_safety, content_consistency, professionalism).
- **Files touched:** `supabase/2026-07-10-rename-engagement-quality-youtube.sql` (DB, applied), `app/dashboard.html`, `app/compare.html`, `lib/handlers/document-creator-proof.js`, `lib/handlers/document-sponsor-memo.js` (all 5 hardcoded references — checked, none left stale).

## TikTok — what's blocking it

**1. Data gap.** TikTok OAuth (`user.info.basic,user.info.stats` scope) returns `follower_count` and `video_count` only — no aggregate view count. The YouTube formula needs `view_count`; TikTok's current scope can't supply it. Real parity requires the `video.list` scope (per-video views, summed), which is a TikTok Developer Portal approval step, not just code.

**2. Weight budget — the actual blocker, needs your call before any code gets written.** All 5 components are weighted 0.20 and sum to exactly 1.00. `fn_recalc_trust_score()` just sums `value × weight` across whatever component rows exist — no renormalization. If `engagement_quality_tiktok` gets added as a plain 6th row at 0.20, any creator with both platforms connected scores up to **120**, not 100. This has to be resolved before a TikTok trigger exists, not after. Two ways to resolve it, your call once you know whether `video.list` comes through:
   - **Shared budget:** both `engagement_quality_youtube` and `engagement_quality_tiktok` split the same 0.20 (e.g. best-of, or averaged if both connected) — total stays 5 components / 1.00 either way.
   - **Rebalance:** all 6 components move to ~0.167 each. Bigger blast radius — changes every existing creator's score, not just multi-platform ones.

**3. If `video.list` doesn't come through:** build `engagement_quality_tiktok` on `follower_count`/`video_count` alone (industry norm still says calculate per-platform, but this would be a lighter-weight signal than YouTube's, not full parity — should get its own status label, not `live_verified`, so it isn't oversold to sponsors reading the score breakdown or Proof Packet).

**Next step:** tell me once you know if `video.list` scope is approved, and which weight-budget option you want — then TikTok gets built the same day.
