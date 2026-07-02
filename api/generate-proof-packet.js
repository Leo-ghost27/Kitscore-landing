// POST /api/generate-proof-packet
// Generates a styled HTML proof packet for the authenticated creator
// and returns it as a downloadable PDF.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedCreator } = require('./_supabase-admin');

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

module.exports = async (req, res) => {
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
    ] = await Promise.all([
      admin.from('profiles').select('display_name, email').eq('id', creator.id).single(),
      admin.from('score_components').select('*').eq('creator_id', creator.id),
      admin.from('campaigns').select('*').eq('creator_id', creator.id).eq('status', 'verified'),
      admin.from('evidence_items').select('*').eq('creator_id', creator.id),
      admin.from('brand_safety_answers').select('*').eq('creator_id', creator.id),
    ]);

    const isPro = creator.plan === 'pro';
    const displayName = profile?.display_name || 'Creator';
    const score = creator.trust_score || 0;
    const confidence = creator.confidence_rating || 0;
    const niche = creator.niche || '—';
    const location = creator.location || '—';
    const badgeTier = creator.badge_tier || 'none';
    const verifiedCount = (campaigns || []).length;
    const reliabilityScore = creator.reliability_score || 0;
    const repeatRate = creator.repeat_sponsor_rate || 0;
    const generatedDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    // ── Build PDF ──────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const bufferPromise = streamToBuffer(doc);

    const W = 595.28;
    const MARGIN = 44;
    const CONTENT_W = W - MARGIN * 2;

    // ── COVER ──────────────────────────────────────────────────────────────────
    // Dark background
    doc.rect(0, 0, W, 280).fill('#0F0F0E');

    // Purple radial glow (simulate with gradient-ish circle)
    doc.circle(-30, 80, 200).fill('#1A1230').opacity(0.6);
    doc.opacity(1);

    // Eyebrow
    doc.fontSize(8).fillColor('#5B4FCF').font('Helvetica-Bold')
      .text('CREATOR PROOF PACKET · KITSCORE VERIFIED', MARGIN, 48, { characterSpacing: 1.5 });

    // Creator name
    doc.fontSize(28).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(displayName, MARGIN, 72);

    // Sub
    doc.fontSize(12).fillColor('#6B6B67').font('Helvetica')
      .text(`${niche} · ${location}`, MARGIN, 108);

    // Score circle (drawn manually)
    const cx = MARGIN + 46, cy = 168, r = 42;
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
         .stroke(filled ? '#5B4FCF' : '#2A2A28').lineWidth(2);
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
      .text('Confidence rating', metaX, 140);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(`${confidence}%`, metaX, 155);

    doc.fontSize(10).fillColor('#6B6B67').font('Helvetica')
      .text('Trust badge', metaX + 130, 140);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(badgeTier.charAt(0).toUpperCase() + badgeTier.slice(1), metaX + 130, 155);

    doc.fontSize(10).fillColor('#6B6B67').font('Helvetica')
      .text('Verified campaigns', metaX + 250, 140);
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(verifiedCount.toString(), metaX + 250, 155);

    // Cover footer
    doc.moveTo(MARGIN, 245).lineTo(W - MARGIN, 245).stroke('#2A2A28').lineWidth(0.5);
    doc.fontSize(9).fillColor('#3D3D3A').font('Helvetica')
      .text(`Generated ${generatedDate}`, MARGIN, 256);
    doc.fontSize(9).fillColor('#5B4FCF').font('Helvetica-Bold')
      .text('Kitscore.co', W - MARGIN - 60, 256);

    // ── CONTENT AREA ──────────────────────────────────────────────────────────
    let y = 296;

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
      { key: 'engagement_quality',    label: 'Engagement Quality' },
      { key: 'brand_safety',          label: 'Brand Safety' },
      { key: 'content_consistency',   label: 'Content Consistency' },
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
          .text(c.brand_name || 'Brand', MARGIN + 12, rY + 8);
        doc.fontSize(9).fillColor('#6B6B67').font('Helvetica')
          .text(c.campaign_name || '', MARGIN + 12, rY + 18);
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
        const statusColor = e.status === 'verified' ? '#1C7C3F' : '#92460A';
        doc.fontSize(8).fillColor(statusColor).font('Helvetica-Bold')
          .text(statusLabel, MARGIN + CONTENT_W - 70, eY + 8, { width: 58, align: 'right' });
      });
      y += Math.min(evCount, 6) * 24;
    }
    doc.rect(MARGIN, evStartY, CONTENT_W, y - evStartY).stroke('#E5E4DF').lineWidth(0.5);
    y += 14;

    // ── Footer ─────────────────────────────────────────────────────────────────
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).stroke('#E5E4DF').lineWidth(0.5);
    y += 8;
    doc.fontSize(7.5).fillColor('#9CA3AF').font('Helvetica')
      .text(
        'This proof packet reflects Kitscore data at time of generation. Verified campaigns require mutual confirmation from both creator and sponsor. ' +
        'Confidence rating reflects the proportion of score components backed by live-verified or evidence-submitted data.',
        MARGIN, y, { width: CONTENT_W, lineGap: 2 }
      );

    // ── Watermark for free plan ────────────────────────────────────────────────
    if (!isPro) {
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.save();
        doc.translate(W / 2, 420);
        doc.rotate(-40);
        doc.fontSize(52).fillColor('#E5E7EB').font('Helvetica-Bold')
          .opacity(0.55)
          .text('WATERMARKED', -180, -26, { lineBreak: false });
        doc.restore();

        // Upgrade prompt banner on each page
        doc.rect(0, 785, W, 57).fill('#F0F6FF');
        doc.fontSize(9).fillColor('#2563EB').font('Helvetica-Bold')
          .text('Upgrade to Kitscore Pro ($19.99/mo)', MARGIN, 798);
        doc.fontSize(8).fillColor('#4B5563').font('Helvetica')
          .text('Remove watermark · Full PDF export · Score history · Public profile listing', MARGIN, 812);
        doc.fontSize(8).fillColor('#2563EB').font('Helvetica-Bold')
          .text('kitscore.co/app/pricing-creator.html', W - MARGIN - 160, 805);
      }
    }

    doc.end();
    const pdfBuffer = await bufferPromise;

    const filename = `kitscore-proof-${displayName.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(pdfBuffer);

  } catch (err) {
    console.error('generate-proof-packet error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
