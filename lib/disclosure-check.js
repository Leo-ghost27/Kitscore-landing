// Deterministic replacement for the original LLM-based disclosure-scan.js.
// No external API call, no ANTHROPIC_API_KEY dependency.
//
// Checks YouTube's own record of what the creator declared -- the
// paidProductPlacementDetails.hasPaidProductPlacement flag the creator set
// at upload time via YouTube's "paid promotion" checkbox (see
// lib/google-oauth.js fetchYoutubeUploads and
// 2026-08-01b-creator-videos-paid-promotion-flag.sql) -- against a plain
// keyword match for a visible disclosure marker in the title/description.
// This is a materially stronger signal than an LLM guessing "this reads as
// sponsored" from text, because it's not a guess: it's YouTube's own
// record of the creator's own declaration.
//
// Still not a legal "clear and conspicuous" FTC determination -- a video
// can have the flag set and still bury the disclosure somewhere
// technically-present-but-not-conspicuous, which this can't evaluate any
// more than the old text-based version could. Flag-only, admin reviews the
// actual video before deciding anything -- same as before.

// Deliberately permissive/plain-language list -- false negatives (missing
// a real disclosure phrased unusually) are far less costly here than false
// positives, since every flag consumes admin review time. YouTube's own
// disclosure prompt suggests "#ad" or "Includes paid promotion", so those
// are covered along with the common platform-agnostic phrasing.
const DISCLOSURE_PATTERN = /#ad\b|#sponsored|#spon\b|paid partnership|paid promotion|sponsored by|in partnership with|thanks to .* for (sponsoring|partnering)/i;

function hasVisibleDisclosure(video) {
  const text = `${video.title || ''} ${video.description || ''}`;
  return DISCLOSURE_PATTERN.test(text);
}

// videos: creator_videos rows (or the shape fetchYoutubeUploads returns),
// each needs title, description, has_paid_promotion (or hasPaidPromotion).
function checkPaidDisclosure(videos) {
  if (!videos || videos.length === 0) return null;

  const flaggedTitles = [];
  let consideredCount = 0;

  for (const v of videos) {
    const hasPaidPromotion = v.has_paid_promotion ?? v.hasPaidPromotion;
    // null/undefined means YouTube didn't return the field for this video
    // (e.g. the batched videos.list call failed) -- treat as "unknown,"
    // not "no," and don't flag on it. Only explicit true counts.
    if (hasPaidPromotion !== true) continue;
    consideredCount++;
    if (!hasVisibleDisclosure(v)) {
      if (v.title) flaggedTitles.push(v.title);
    }
  }

  if (consideredCount === 0) return null; // nothing to check either way

  return {
    flagged: flaggedTitles.length > 0,
    suspectedTitles: flaggedTitles,
    rationale: flaggedTitles.length > 0
      ? `YouTube's own paid-promotion flag is set on ${flaggedTitles.length} video(s) with no #ad/#sponsored/paid-partnership marker found in the title or description: ${flaggedTitles.join('; ')}`
      : `All ${consideredCount} video(s) with YouTube's paid-promotion flag set also had a visible disclosure marker.`,
    model: 'youtube-native-flag+keyword-match', // no LLM -- kept the column name for schema compatibility
    videoCountScanned: videos.length,
  };
}

module.exports = { checkPaidDisclosure, hasVisibleDisclosure };
