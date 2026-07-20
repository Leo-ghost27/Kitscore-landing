// GET /api/badge?slug={creator-slug}
//
// Public, unauthenticated, no CORS restriction on purpose -- this is
// meant to be embedded as an <img> anywhere: a personal site, a GitHub
// README, a Beacons/Linktree custom-HTML block, or as the icon on a
// plain link-in-bio button pointing at the creator's kitscore.co/p/
// profile. Always returns a valid SVG, even for an unknown slug or a
// DB error -- an embedded image silently breaking on someone else's
// page is worse than a graceful fallback badge.
const { adminClient } = require('../lib/supabase-admin');

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function renderBadgeSvg({ score, fallback }) {
  const scoreText = fallback ? '—' : String(Math.round(score));
  // Width flexes a little for 1 vs 2 vs 3-digit scores so the number
  // never gets cramped or leaves awkward extra padding.
  const width = 168 + (scoreText.length - 2) * 8;
  const dividerX = width - 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="36" viewBox="0 0 ${width} 36" role="img" aria-label="Verified by Kitscore${fallback ? '' : `, trust score ${scoreText}`}">
<title>Verified by Kitscore${fallback ? '' : ` — ${scoreText}`}</title>
<rect x="0.5" y="0.5" width="${width - 1}" height="35" rx="18" fill="#FFFFFF" stroke="#E5E4DF"/>
<circle cx="19" cy="18" r="11" fill="#5B4FCF"/>
<path d="M19 12.5c-1.9 0-3.6.5-5 1.4 0 3.9 2.1 7.3 5 8.6 2.9-1.3 5-4.7 5-8.6-1.4-.9-3.1-1.4-5-1.4Z" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M16.3 18.1l1.9 1.9 3.5-3.9" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
<text x="36" y="22" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="#1A1A18">Verified by Kitscore</text>
<line x1="${dividerX}" y1="9" x2="${dividerX}" y2="27" stroke="#E5E4DF" stroke-width="1"/>
<text x="${dividerX + 12}" y="22" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600" fill="#5B4FCF">${escapeXml(scoreText)}</text>
</svg>`;
}

module.exports = async (req, res) => {
  const slug = req.query?.slug;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  // 1 hour fresh, serve stale up to a day while revalidating in the
  // background -- keeps this cheap under repeated embedding without
  // showing a badly stale score for long.
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  if (!slug) {
    return res.status(200).send(renderBadgeSvg({ fallback: true }));
  }

  try {
    const admin = adminClient();
    const { data, error } = await admin
      .rpc('fn_get_badge_data', { p_slug: slug })
      .maybeSingle();

    if (error || !data) {
      return res.status(200).send(renderBadgeSvg({ fallback: true }));
    }

    return res.status(200).send(renderBadgeSvg({ score: data.trust_score }));
  } catch (err) {
    return res.status(200).send(renderBadgeSvg({ fallback: true }));
  }
};
