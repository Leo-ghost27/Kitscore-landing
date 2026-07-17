// POST /api/documents?type=evekit  (also aliased from ?type=creator-proof
// for backward compatibility with any existing bookmarked calls)
// Generates EveKit — the free, pitch-ready media kit PDF every creator can
// download and cold-email to brands. Replaces the old Pro-gated "Proof
// Packet" PDF as of July 2026: this is free for every creator now, full
// stop, no plan check. See docs/session-handoff-2026-07-13-evekit.md.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedCreator } = require('../supabase-admin');

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function hex2rgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r/255, g/255, b/255];
}

// PDFKit only supports JPEG and PNG natively -- not WebP, which the
// creator-media upload bucket does allow. Fetches and validates the
// content-type; returns null (never throws) on any failure so a bad or
// unsupported avatar/gallery image degrades gracefully instead of
// breaking PDF generation for the whole kit.
async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!/image\/(jpeg|jpg|png)/i.test(contentType)) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    return null;
  }
}

// Mirrors EK_THEMES in app/evekit.html exactly -- the live page and this
// PDF must render the same theme identically, or picking a color on the
// page and then downloading the PDF would look like a bug.
const EK_THEME_COLORS = {
  indigo:   { accent: '#5B4FCF', glow: '#1A1230' },
  ocean:    { accent: '#2172B8', glow: '#0F1F30' },
  emerald:  { accent: '#1D9A6C', glow: '#0F2A20' },
  rose:     { accent: '#C33D74', glow: '#2A1420' },
  charcoal: { accent: '#4A4A46', glow: '#161615' },
  amber:    { accent: '#C17A1E', glow: '#2A1D0D' },
};

module.exports = async function handleEveKit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const admin = adminClient();

    // Fetch all creator data
    const [
      { data: profile },
      { data: components },
      { data: campaigns },
      { data: evidence },
      { data: bsAnswers },
      { data: audience },
      { data: platforms },
      { data: collaborations },
      { data: pressMentions },
      avatarBuffer,
      galleryBuffersRaw,
    ] = await Promise.all([
      admin.from('profiles').select('display_name, email').eq('id', creator.id).single(),
      admin.from('score_components').select('*').eq('creator_id', creator.id),
      admin.from('campaigns').select('*').eq('creator_id', creator.id).eq('status', 'verified'),
      admin.from('evidence_uploads').select('*').eq('creator_id', creator.id),
      admin.from('brand_safety_answers').select('*').eq('creator_id', creator.id),
      admin.from('audience_demographics').select('dimension, label, pct').eq('creator_id', creator.id),
      admin.from('platform_connections').select('platform, platform_handle, verification_method, follower_count, video_count, view_count')
        .eq('creator_id', creator.id).not('follower_count', 'is', null).order('follower_count', { ascending: false }),
      // Same tables/columns app/evekit.html reads for the on-screen kit — the
      // PDF generator predates these (added 2026-07-14/15) and never picked
      // them up, so they saved and rendered on-screen but never made it into
      // the download.
      admin.from('creator_collaborations').select('brand_name, logo_url, link')
        .eq('creator_id', creator.id).order('display_order').order('created_at'),
      admin.from('creator_press_mentions').select('title, outlet_name, url, mention_date')
        .eq('creator_id', creator.id).order('display_order').order('created_at'),
      // avatar_url/gallery_images (added 2026-07-17) never made it into the
      // PDF either -- same gap as collaborations/press above.
      fetchImageBuffer(creator.avatar_url),
      Promise.all((creator.gallery_images || []).slice(0, 4).map(fetchImageBuffer)),
    ]);
    const galleryBuffers = (galleryBuffersRaw || []).filter(Boolean);

    // creator is `{ ...profile, ...creators-row }` (see getAuthedCreator), so
    // available_for/causes are already present via the creators `select('*')`.
    const availableFor = creator.available_for || [];
    const causes = creator.causes || [];

    const displayName = profile?.display_name || 'Creator';
    const bio = creator.bio || '';
    const businessEmail = creator.business_email || '';
    const score = creator.trust_score || 0;
    const confidence = creator.confidence || 0;
    const niche = creator.niche || '—';
    const location = creator.location || '—';
    const badgeTier = creator.badge_tier || 'none';
    const verifiedCount = (campaigns || []).length;
    const reliabilityScore = creator.reliability_score || 0;
    const repeatRate = creator.repeat_sponsor_rate || 0;
    const generatedDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const theme = EK_THEME_COLORS[creator.theme] || EK_THEME_COLORS.indigo;

    // ── Rate card (same bands as dashboard.html / evekit.html — keep in sync) ──
    const RATE_TIERS_USD = [
      [0,        10000,    100,   500],
      [10000,    100000,   500,   5000],
      [100000,   1000000,  5000,  25000],
      [1000000,  Infinity, 25000, 60000],
    ];
    const PLATFORM_RATE_MULT = { instagram: 1, tiktok: 0.75, youtube: 2.5 };
    const NICHE_RATE_MULT = {
      finance: 1.4, health: 1.35, sustainability: 1.3, tech: 1.25,
      beauty: 0.9, fashion: 0.95, lifestyle: 0.9, fitness: 1.0,
    };
    const topPlatform = (platforms || [])[0];
    let rateRangeText = null;
    if (topPlatform) {
      const tier = RATE_TIERS_USD.find(([min, max]) => topPlatform.follower_count >= min && topPlatform.follower_count < max) || RATE_TIERS_USD[RATE_TIERS_USD.length - 1];
      const platMult = PLATFORM_RATE_MULT[topPlatform.platform] || 1;
      const nicheMult = NICHE_RATE_MULT[(creator.niche || '').toLowerCase()] || 1;
      const min = Math.round(tier[2] * platMult * nicheMult / 5) * 5;
      const max = Math.round(tier[3] * platMult * nicheMult / 5) * 5;
      rateRangeText = `$${min.toLocaleString()}–$${max.toLocaleString()} per post`;
    }

    // ── Build PDF ──────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const bufferPromise = streamToBuffer(doc);

    const W = 595.28;
    const MARGIN = 44;
    const CONTENT_W = W - MARGIN * 2;

    // ── COVER ──────────────────────────────────────────────────────────────────
    // Dark background
    doc.rect(0, 0, W, 300).fill('#0F0F0E');

    // Radial glow (simulate with gradient-ish circle), themed
    doc.circle(-30, 80, 200).fill(theme.glow).opacity(0.6);
    doc.opacity(1);

    // Eyebrow
    doc.fontSize(8).fillColor(theme.accent).font('Helvetica-Bold')
      .text('VERIFIED MEDIA KIT · KITSCORE', MARGIN, 48, { characterSpacing: 1.5 });

    // Creator name
    doc.fontSize(28).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(displayName, MARGIN, 72);

    // Sub
    doc.fontSize(12).fillColor('#6B6B67').font('Helvetica')
      .text(`${niche} · ${location}`, MARGIN, 108);

    // Avatar (top-right of cover, clipped to a circle) -- falls back to
    // nothing if no avatar set or the format isn't PDFKit-supported
    // (WebP), same graceful-degradation as the web EveKit's initial-letter
    // placeholder, just omitted here rather than drawing a substitute.
    if (avatarBuffer) {
      const acx = W - MARGIN - 32, acy = 76, ar = 32;
      doc.save();
      doc.circle(acx, acy, ar).clip();
      doc.image(avatarBuffer, acx - ar, acy - ar, { width: ar * 2, height: ar * 2 });
      doc.restore();
    }

    // Bio (optional, wraps into the space above the score row)
    if (bio) {
      doc.fontSize(9.5).fillColor('#9E9E99').font('Helvetica')
        .text(bio, MARGIN, 124, { width: CONTENT_W - 20, height: 14, ellipsis: true });
    }

    // Score circle (drawn manually)
    const cx = MARGIN + 46, cy = 190, r = 42;
    // Background circle
    doc.circle(cx, cy, r).stroke('#2A2A28').lineWidth(6);
    // Score arc — approximate with filled text
    const scoreAngle = (score / 100) * 2 * Math.PI;
    doc.save().translate(cx, cy);
    // Draw arc segments
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * 2 * Math.PI - Math.PI / 2;
      const filled = (i / 36) <= (score / 100);
      doc.moveTo(Math.cos(angle) * (r-3), Math.sin(angle) * (r-3))
         .lineTo(Math.cos(angle) * (r+3), Math.sin(angle) * (r+3))
         .stroke(filled ? theme.accent : '#2A2A28').lineWidth(2);
    }
    doc.restore();

    // Score number
    doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(score.toString(), cx - 20, cy - 16, { width: 40, align: 'center' });
    doc.fontSize(8).fillColor('#6B6B67').font('Helvetica')
      .text('/100', cx - 16, cy + 8, { width: 32, align: 'center' });

    // Meta stats
    const metaX = MARGIN + 110;
    doc.fontSize(10).fillColor('#6B6B67').font('Helvetica')
      .text('Confidence rating', metaX, 162);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(`${confidence}%`, metaX, 177);

    doc.fontSize(10).fillColor('#6B6B67').font('Helvetica')
      .text('Trust badge', metaX + 130, 162);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(badgeTier.charAt(0).toUpperCase() + badgeTier.slice(1), metaX + 130, 177);

    doc.fontSize(10).fillColor('#6B6B67').font('Helvetica')
      .text('Verified campaigns', metaX + 250, 162);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(verifiedCount.toString(), metaX + 250, 177);

    // Cover footer
    doc.moveTo(MARGIN, 265).lineTo(W - MARGIN, 265).stroke('#2A2A28').lineWidth(0.5);
    doc.fontSize(9).fillColor('#3D3D3A').font('Helvetica')
      .text(`Generated ${generatedDate}`, MARGIN, 276);
    doc.fontSize(9).fillColor(theme.accent).font('Helvetica-Bold')
      .text('Kitscore.co', W - MARGIN - 60, 276);

    // ── CONTENT AREA ──────────────────────────────────────────────────────────
    let y = 316;

    function sectionCard(title, rightLabel, drawFn) {
      const startY = y;
      // Card background
      doc.rect(MARGIN, y, CONTENT_W, 20).fill('#F8F7F4');

      // Section title
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text(title.toUpperCase(), MARGIN + 14, y + 6, { characterSpacing: 0.8 });
      if (rightLabel) {
        doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
          .text(rightLabel, MARGIN, y + 6, { width: CONTENT_W - 14, align: 'right' });
      }
      y += 20;

      // White card body
      const bodyStartY = y;
      doc.rect(MARGIN, y, CONTENT_W, 8).fill('#FFFFFF'); // will extend
      y += 10;

      drawFn();

      y += 10;
      // Draw white card border
      doc.rect(MARGIN, bodyStartY, CONTENT_W, y - bodyStartY)
        .stroke('#E5E4DF').lineWidth(0.5).fillAndStroke('#FFFFFF', '#E5E4DF');

      // Redraw content on top (PDFKit layering workaround — just add spacing)
      y += 12;
    }

    // ── Score Breakdown ────────────────────────────────────────────────────────
    const COMPONENTS = [
      { key: 'audience_authenticity', label: 'Audience Authenticity' },
      { key: 'engagement_quality_youtube', label: 'Engagement Quality (YouTube)' },
      { key: 'brand_safety',          label: 'Brand Safety' },
      { key: 'content_consistency_youtube', label: 'Content Consistency (YouTube)' },
      { key: 'professionalism',       label: 'Professionalism' },
    ];

    const compMap = {};
    (components || []).forEach(c => { compMap[c.component_key] = c; });

    // Score breakdown section
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('SCORE BREAKDOWN', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
      .text('Weighted composite · 5 components', MARGIN, y + 5, { width: CONTENT_W - 14, align: 'right' });
    y += 18;

    const scoreCardStartY = y;
    const ROW_H = 28;
    const totalRows = COMPONENTS.length;

    COMPONENTS.forEach((ac, idx) => {
      const comp = compMap[ac.key];
      const val = comp?.value || 0;
      const status = comp?.status || 'pending';
      const rowY = y + idx * ROW_H;

      // Row background
      doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(idx % 2 === 0 ? '#FFFFFF' : '#FAFAF8');

      // Label
      doc.fontSize(10).fillColor('#1A1A18').font('Helvetica')
        .text(ac.label, MARGIN + 12, rowY + 9);

      // Bar background
      const barX = MARGIN + 175;
      const barW = 200;
      const barH = 5;
      const barY = rowY + 12;
      doc.rect(barX, barY, barW, barH).fill('#F0EFE9');

      // Bar fill
      const fillColor = val >= 80 ? '#1D9E75' : val >= 60 ? '#2563EB' : '#E58C1A';
      if (val > 0) {
        doc.rect(barX, barY, (val / 100) * barW, barH).fill(fillColor);
      }

      // Value
      doc.fontSize(11).fillColor(val > 0 ? fillColor : '#9E9E99').font('Helvetica-Bold')
        .text(val > 0 ? val.toString() : '—', barX + barW + 8, rowY + 7, { width: 28, align: 'right' });

      // Status badge
      const badgeColors = {
        live_verified: { bg: '#EBF5DE', text: '#2D6A0F', label: 'Live' },
        evidence_submitted: { bg: '#E4F0FB', text: '#0C3D6E', label: 'Evidence' },
        pending: { bg: '#F0EFE9', text: '#6B6B67', label: 'Pending' },
      };
      const badge = badgeColors[status] || badgeColors.pending;
      const badgeX = MARGIN + CONTENT_W - 70;
      doc.rect(badgeX, rowY + 7, 58, 13).fill(badge.bg);
      doc.fontSize(7).fillColor(badge.text).font('Helvetica-Bold')
        .text(badge.label, badgeX, rowY + 10, { width: 58, align: 'center' });
    });

    y += totalRows * ROW_H;
    // Border for score section
    doc.rect(MARGIN, scoreCardStartY, CONTENT_W, y - scoreCardStartY)
      .stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Platforms & Rate Card ────────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('PLATFORMS & ESTIMATED RATE CARD', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    y += 18;

    const platStartY = y;
    const platList = platforms || [];
    if (platList.length === 0) {
      doc.rect(MARGIN, y, CONTENT_W, 32).fill('#FFFFFF');
      doc.fontSize(10).fillColor('#9E9E99').font('Helvetica')
        .text('No platforms connected yet.', MARGIN + 14, y + 10);
      y += 32;
    } else {
      const colW = CONTENT_W / Math.min(platList.length, 3);
      const rowH = 58;
      platList.slice(0, 3).forEach((p, i) => {
        const px = MARGIN + i * colW;
        const followerLabel = p.platform === 'youtube' ? 'subscribers' : 'followers';
        const stats = [
          p.video_count != null ? `${Number(p.video_count).toLocaleString()} videos` : null,
          p.view_count != null ? `${Number(p.view_count).toLocaleString()} views` : null,
        ].filter(Boolean).join(' · ');
        doc.rect(px, y, colW, rowH).fill('#FFFFFF');
        doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
          .text((p.platform || '').toUpperCase(), px + 12, y + 8, { characterSpacing: 0.5 });
        doc.fontSize(15).fillColor('#1A1A18').font('Helvetica-Bold')
          .text(Number(p.follower_count).toLocaleString(), px + 12, y + 20);
        doc.fontSize(7.5).fillColor('#9E9E99').font('Helvetica')
          .text(followerLabel, px + 12, y + 37);
        if (stats) {
          doc.fontSize(7).fillColor('#9E9E99').font('Helvetica')
            .text(stats, px + 12, y + 47, { width: colW - 24 });
        }
        doc.fontSize(7.5).fillColor(p.verification_method === 'oauth' ? '#2D6A0F' : '#6B6B67').font('Helvetica-Bold')
          .text(p.verification_method === 'oauth' ? 'Verified' : 'Linked', px + colW - 60, y + 8, { width: 48, align: 'right' });
        if (i > 0) doc.moveTo(px, y + 6).lineTo(px, y + rowH - 6).stroke('#F0EFE9').lineWidth(0.5);
      });
      y += rowH;
      if (rateRangeText) {
        doc.rect(MARGIN, y, CONTENT_W, 34).fill('#F9F8F5');
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text('Estimated rate, top platform', MARGIN + 14, y + 9);
        doc.fontSize(13).fillColor(theme.accent).font('Helvetica-Bold')
          .text(rateRangeText, MARGIN, y + 9, { width: CONTENT_W - 14, align: 'right' });
        doc.fontSize(7).fillColor('#9E9E99').font('Helvetica-Oblique')
          .text('Estimated from public sponsorship-rate benchmarks by follower tier, platform, and niche — not a quote.', MARGIN + 14, y + 22, { width: CONTENT_W - 28 });
        y += 34;
      }
    }
    doc.rect(MARGIN, platStartY, CONTENT_W, y - platStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Verified Campaigns ─────────────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('VERIFIED CAMPAIGNS', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
      .text(`${verifiedCount} mutually confirmed`, MARGIN, y + 5, { width: CONTENT_W - 14, align: 'right' });
    y += 18;

    const campStartY = y;
    if (verifiedCount === 0) {
      doc.rect(MARGIN, y, CONTENT_W, 36).fill('#FFFFFF');
      doc.fontSize(10).fillColor('#9E9E99').font('Helvetica')
        .text('No verified campaigns yet. Campaigns are confirmed by both creator and sponsor.', MARGIN + 14, y + 12, { width: CONTENT_W - 28 });
      y += 36;
    } else {
      (campaigns || []).slice(0, 5).forEach((c, idx) => {
        const rY = y + idx * 28;
        doc.rect(MARGIN, rY, CONTENT_W, 28).fill(idx % 2 === 0 ? '#FFFFFF' : '#FAFAF8');
        doc.fontSize(10).fillColor('#1A1A18').font('Helvetica-Bold')
          .text(c.name || 'Campaign', MARGIN + 12, rY + 8);
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text(c.objective || '', MARGIN + 12, rY + 18);
        doc.fontSize(9).fillColor('#1C7C3F').font('Helvetica-Bold')
          .text('✓ Verified', MARGIN + CONTENT_W - 70, rY + 11);
      });
      y += Math.min(verifiedCount, 5) * 28;
      if (verifiedCount > 5) {
        doc.rect(MARGIN, y, CONTENT_W, 18).fill('#FAFAF8');
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text(`+ ${verifiedCount - 5} more verified campaigns`, MARGIN + 14, y + 4);
        y += 18;
      }
    }
    doc.rect(MARGIN, campStartY, CONTENT_W, y - campStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Past Collaborations (self-reported brand list) ──────────────────────
    if ((collaborations || []).length > 0) {
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text('BRANDS I\'VE WORKED WITH', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
        .text('self-reported, not verified', MARGIN, y + 5, { width: CONTENT_W - 14, align: 'right' });
      y += 18;

      const collabStartY = y;
      const collabRowH = 20;
      doc.rect(MARGIN, y, CONTENT_W, collabRowH * collaborations.length).fill('#FFFFFF');
      collaborations.forEach((c, idx) => {
        doc.fontSize(10).fillColor('#1A1A18').font('Helvetica-Bold')
          .text(c.brand_name || 'Brand', MARGIN + 14, y + idx * collabRowH + 5, { width: CONTENT_W - 28 });
      });
      y += collabRowH * collaborations.length;
      doc.rect(MARGIN, collabStartY, CONTENT_W, y - collabStartY).stroke('#E5E4DF').lineWidth(0.5);
      y += 14;
    }

    // ── Gallery (optional, up to 4 photos) ───────────────────────────────────
    if (galleryBuffers.length > 0) {
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text('GALLERY', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
      y += 18;

      const galStartY = y;
      const gap = 8;
      const cellW = (CONTENT_W - gap * (galleryBuffers.length - 1)) / galleryBuffers.length;
      const cellH = Math.min(cellW, 130);
      doc.rect(MARGIN, y, CONTENT_W, cellH).fill('#FFFFFF');
      galleryBuffers.forEach((buf, idx) => {
        const gx = MARGIN + idx * (cellW + gap);
        doc.image(buf, gx, y, { width: cellW, height: cellH, cover: [cellW, cellH] });
      });
      y += cellH;
      doc.rect(MARGIN, galStartY, CONTENT_W, y - galStartY).stroke('#E5E4DF').lineWidth(0.5);
      y += 14;
    }

    // ── Sponsorship Reputation ─────────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('VERIFIED SPONSORSHIP REPUTATION', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    y += 18;

    const repStartY = y;
    doc.rect(MARGIN, y, CONTENT_W, 52).fill('#FFFFFF');
    const statW = CONTENT_W / 3;

    [
      { label: 'Reliability Score', val: reliabilityScore, color: reliabilityScore >= 80 ? '#D4AF37' : '#1A1A18' },
      { label: 'Would Hire Again', val: `${creator.would_hire_again_pct || 0}%`, color: '#1A1A18' },
      { label: 'Repeat Sponsors', val: `${repeatRate}%`, color: '#1A1A18' },
    ].forEach((stat, i) => {
      const sx = MARGIN + i * statW;
      doc.fontSize(18).fillColor(stat.color).font('Helvetica-Bold')
        .text(stat.val.toString(), sx, y + 10, { width: statW, align: 'center' });
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
        .text(stat.label, sx, y + 32, { width: statW, align: 'center' });
      if (i < 2) {
        doc.moveTo(sx + statW, y + 8).lineTo(sx + statW, y + 44).stroke('#F0EFE9').lineWidth(0.5);
      }
    });

    y += 52;
    doc.rect(MARGIN, repStartY, CONTENT_W, y - repStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Evidence Items ─────────────────────────────────────────────────────────
    const evCount = (evidence || []).length;
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('EVIDENCE SUBMITTED', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
      .text(`${evCount} item${evCount !== 1 ? 's' : ''}`, MARGIN, y + 5, { width: CONTENT_W - 14, align: 'right' });
    y += 18;

    const evStartY = y;
    if (evCount === 0) {
      doc.rect(MARGIN, y, CONTENT_W, 32).fill('#FFFFFF');
      doc.fontSize(10).fillColor('#9E9E99').font('Helvetica')
        .text('No evidence uploaded yet.', MARGIN + 14, y + 10);
      y += 32;
    } else {
      (evidence || []).slice(0, 6).forEach((e, idx) => {
        const eY = y + idx * 24;
        doc.rect(MARGIN, eY, CONTENT_W, 24).fill(idx % 2 === 0 ? '#FFFFFF' : '#FAFAF8');
        doc.fontSize(10).fillColor('#1A1A18').font('Helvetica')
          .text(e.file_name || 'File', MARGIN + 12, eY + 7, { width: CONTENT_W - 140 });
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text(e.platform || '', MARGIN + 12 + (CONTENT_W - 140), eY + 7, { width: 80 });
        const statusLabel = (e.status || '').replace(/_/g, ' ');
        const statusColor = e.status === 'live_verified' ? '#1C7C3F' : e.status === 'submitted' ? '#0C3D6E' : '#92460A';
        doc.fontSize(8).fillColor(statusColor).font('Helvetica-Bold')
          .text(statusLabel, MARGIN + CONTENT_W - 70, eY + 8, { width: 58, align: 'right' });
      });
      y += Math.min(evCount, 6) * 24;
    }
    doc.rect(MARGIN, evStartY, CONTENT_W, y - evStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Press Mentions ────────────────────────────────────────────────────────
    if ((pressMentions || []).length > 0) {
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text('PRESS MENTIONS', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica')
        .text('self-reported', MARGIN, y + 5, { width: CONTENT_W - 14, align: 'right' });
      y += 18;

      const pressStartY = y;
      const pressRowH = 28;
      doc.rect(MARGIN, y, CONTENT_W, pressRowH * pressMentions.length).fill('#FFFFFF');
      pressMentions.forEach((p, idx) => {
        const rY = y + idx * pressRowH;
        doc.fontSize(10).fillColor('#1A1A18').font('Helvetica-Bold')
          .text(p.title || '', MARGIN + 14, rY + 5, { width: CONTENT_W - 28 });
        const meta = [p.outlet_name, p.mention_date].filter(Boolean).join(' · ');
        doc.fontSize(8.5).fillColor('#9E9E99').font('Helvetica')
          .text(meta, MARGIN + 14, rY + 17, { width: CONTENT_W - 28 });
      });
      y += pressRowH * pressMentions.length;
      doc.rect(MARGIN, pressStartY, CONTENT_W, y - pressStartY).stroke('#E5E4DF').lineWidth(0.5);
      y += 14;
    }

    // ── Audience Demographics (self-reported) ────────────────────────────────
    // audience is now one row per (dimension, label) -- e.g. multiple
    // countries, plus fixed gender/age-bracket rows -- rather than a single
    // top-country/age-range/gender-split row. Collapse each dimension into
    // one summary line, ordered by % descending.
    const AUD_GENDER_LABEL = { female: 'Female', male: 'Male', other: 'Other' };
    const audByDim = (dim) => (audience || []).filter(r => r.dimension === dim).sort((a, b) => b.pct - a.pct);
    const audCountries = audByDim('country');
    const audAges = audByDim('age');
    const audGenders = audByDim('gender');
    const hasAudienceData = audCountries.length > 0 || audAges.length > 0 || audGenders.length > 0;
    if (hasAudienceData) {
      const audRows = [
        audCountries.length ? ['Top countries', audCountries.map(c => `${c.label} (${c.pct}%)`).join(', ')] : null,
        audAges.length ? ['Age breakdown', audAges.map(a => `${a.label} (${a.pct}%)`).join(', ')] : null,
        audGenders.length ? ['Gender split', audGenders.map(g => `${AUD_GENDER_LABEL[g.label] || g.label} (${g.pct}%)`).join(', ')] : null,
      ].filter(Boolean);

      const audStartY = y;
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text('AUDIENCE DEMOGRAPHICS', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
      y += 18;

      doc.rect(MARGIN, y, CONTENT_W, 20).fill('#FFFFFF');
      doc.fontSize(7.5).fillColor('#9E9E99').font('Helvetica-Oblique')
        .text('Self-reported by the creator, not verified against platform analytics.', MARGIN + 14, y + 6, { width: CONTENT_W - 28 });
      y += 20;

      audRows.forEach((row, idx) => {
        const rY = y + idx * 22;
        doc.rect(MARGIN, rY, CONTENT_W, 22).fill(idx % 2 === 0 ? '#FFFFFF' : '#FAFAF8');
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text(row[0], MARGIN + 14, rY + 6, { width: CONTENT_W * 0.4 });
        doc.fontSize(9.5).fillColor('#1A1A18').font('Helvetica-Bold')
          .text(row[1], MARGIN + 14 + CONTENT_W * 0.4, rY + 6, { width: CONTENT_W * 0.55 });
      });
      y += audRows.length * 22;
      doc.rect(MARGIN, audStartY, CONTENT_W, y - audStartY).stroke('#E5E4DF').lineWidth(0.5);
      y += 14;
    }

    // ── Available For / Causes I Support ─────────────────────────────────────
    if (availableFor.length > 0 || causes.length > 0) {
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
      doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
        .text('AVAILABLE FOR / CAUSES I SUPPORT', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
      y += 18;

      const tagsStartY = y;
      const rowCount = (availableFor.length > 0 ? 1 : 0) + (causes.length > 0 ? 1 : 0);
      const tagsBoxH = rowCount * 34;
      doc.rect(MARGIN, y, CONTENT_W, tagsBoxH).fill('#FFFFFF');

      let rowY = y + 8;
      const drawTagRow = (label, items) => {
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica-Bold')
          .text(label, MARGIN + 14, rowY);
        doc.fontSize(9.5).fillColor('#1A1A18').font('Helvetica')
          .text(items.join('  ·  '), MARGIN + 14, rowY + 13, { width: CONTENT_W - 28 });
        rowY += 34;
      };
      if (availableFor.length > 0) drawTagRow('AVAILABLE FOR', availableFor);
      if (causes.length > 0) drawTagRow('CAUSES I SUPPORT', causes);

      y += tagsBoxH;
      doc.rect(MARGIN, tagsStartY, CONTENT_W, y - tagsStartY).stroke('#E5E4DF').lineWidth(0.5);
      y += 14;
    }

    // ── Contact ─────────────────────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#F8F7F4');
    doc.fontSize(8).fillColor('#9E9E99').font('Helvetica-Bold')
      .text('CONTACT', MARGIN + 14, y + 5, { characterSpacing: 0.8 });
    y += 18;
    const contactStartY = y;
    doc.rect(MARGIN, y, CONTENT_W, 30).fill('#FFFFFF');
    if (businessEmail) {
      doc.fontSize(11).fillColor('#1A1A18').font('Helvetica-Bold')
        .text(businessEmail, MARGIN + 14, y + 10);
    } else {
      doc.fontSize(9.5).fillColor('#9E9E99').font('Helvetica')
        .text('No contact email listed.', MARGIN + 14, y + 10);
    }
    y += 30;
    doc.rect(MARGIN, contactStartY, CONTENT_W, y - contactStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Footer ─────────────────────────────────────────────────────────────────
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).stroke('#E5E4DF').lineWidth(0.5);
    y += 8;
    doc.fontSize(7.5).fillColor('#9CA3AF').font('Helvetica')
      .text(
        'Your Verified Media Kit reflects Kitscore data at time of generation. Verified campaigns require mutual confirmation from both creator and sponsor. ' +
        'Confidence rating reflects the proportion of score components backed by live-verified or evidence-submitted data. Rate card figures are estimates, not quotes.',
        MARGIN, y, { width: CONTENT_W, lineGap: 2 }
      );

    doc.end();
    const pdfBuffer = await bufferPromise;

    const filename = `kitscore-verified-media-kit-${displayName.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(pdfBuffer);

  } catch (err) {
    console.error('generate-evekit error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
