// POST /api/generate-pdf  { evaluationId }
// Only generates a PDF for an evaluation the requesting sponsor actually
// owns AND has unlocked (paid for) - this is the $29 report's deliverable.
//
// Visual language mirrors sample-sponsor-decision-memo.html (the page shown
// on the marketing site) as closely as pdfkit's drawing API allows. Every
// figure rendered here comes from a real table/column — nothing is invented.
// Sections with no backing data (e.g. audience geo/demo breakdown, which has
// no schema column yet) are omitted rather than shown with placeholder or
// fabricated numbers.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');
const { sendEmail, reportReadyEmail } = require('../lib/email');

const PAGE_W = 612, PAGE_H = 792, MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '#1A1A18', MUTED = '#6B6B67', FAINT = '#9E9E99';
const CARD_BORDER = '#E5E4DF', SEC_RULE = '#F0EFE9';
const ACCENT = '#5B4FCF';

const COMPONENT_LABELS = {
  audience_authenticity: 'Audience authenticity',
  engagement_quality: 'Engagement quality',
  brand_safety: 'Brand safety',
  content_consistency: 'Content consistency',
  professionalism: 'Professionalism',
};
const COMPONENT_ORDER = ['audience_authenticity', 'engagement_quality', 'brand_safety', 'content_consistency', 'professionalism'];

const BRAND_SAFETY_QUESTIONS = {
  family_safe: 'Family-safe content',
  political: 'Political content frequency',
  gambling: 'Gambling promotion history',
  adult: 'Adult/mature content',
  profanity: 'Profanity frequency',
};

const VERDICT_COPY = {
  approve: { label: 'Recommend to sponsor', accent: '#4ADE80', bg: '#0F1A0C', border: '#2A4020', sub: '#6B9E78' },
  caution: { label: 'Proceed with caution', accent: '#FBBF24', bg: '#1A1509', border: '#40331F', sub: '#B79A63' },
  avoid: { label: 'Do not recommend', accent: '#F87171', bg: '#1A0C0C', border: '#402020', sub: '#B08080' },
};

function scoreColor(v) {
  if (v == null) return FAINT;
  return v >= 80 ? '#1D9E75' : v >= 60 ? '#2563EB' : '#E58C1A';
}

function riskLevel(components, penaltyTotal) {
  const brandSafety = (components || []).find(c => c.component_key === 'brand_safety');
  if (penaltyTotal >= 15 || (brandSafety && brandSafety.value < 60)) return { label: 'High', color: '#8B1A1A' };
  if (penaltyTotal >= 5 || (brandSafety && brandSafety.value < 80)) return { label: 'Medium', color: '#92460A' };
  return { label: 'Low', color: '#2D6A0F' };
}

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { evaluationId } = req.body || {};
    if (!evaluationId) return res.status(400).json({ error: 'evaluationId is required' });

    const admin = adminClient();
    const { data: evalRow } = await admin.from('evaluations').select('*')
      .eq('id', evaluationId).eq('sponsor_id', sponsor.id).maybeSingle();
    if (!evalRow) return res.status(404).json({ error: 'Evaluation not found for this sponsor' });
    if (!evalRow.unlocked) return res.status(403).json({ error: 'This evaluation has not been unlocked yet' });

    const [
      { data: creator },
      { data: profileRow },
      { data: components },
      { data: verifiedCampaigns },
      { data: endorsedCampaigns },
      { data: safetyAnswers },
      { data: safetyPenaltyTable },
      { data: sponsorRow },
      { data: audience },
    ] = await Promise.all([
      admin.from('creators').select('*').eq('id', evalRow.creator_id).single(),
      admin.from('profiles').select('display_name').eq('id', evalRow.creator_id).single(),
      admin.from('score_components').select('*').eq('creator_id', evalRow.creator_id),
      admin.from('campaigns').select('id').eq('creator_id', evalRow.creator_id).eq('status', 'verified'),
      admin.from('campaigns').select('endorsement_notes,sponsor_rating,would_hire_again,communication_rating,professionalism_rating,deliverable_quality_rating')
        .eq('creator_id', evalRow.creator_id).eq('status', 'verified').not('endorsement_notes', 'is', null).limit(3),
      admin.from('brand_safety_answers').select('*').eq('creator_id', evalRow.creator_id),
      admin.from('brand_safety_penalties').select('*'),
      admin.from('sponsors').select('company_name').eq('id', sponsor.id).maybeSingle(),
      admin.from('audience_demographics').select('*').eq('creator_id', evalRow.creator_id).maybeSingle(),
    ]);

    const compMap = {};
    (components || []).forEach(c => { compMap[c.component_key] = c; });

    const penaltyLookup = {};
    (safetyPenaltyTable || []).forEach(p => { penaltyLookup[`${p.question_key}::${p.answer}`] = Number(p.penalty) || 0; });
    const penaltyTotal = (safetyAnswers || []).reduce((sum, a) => sum + (penaltyLookup[`${a.question_key}::${a.answer}`] || 0), 0);

    const verdictKey = VERDICT_COPY[evalRow.recommendation_verdict] ? evalRow.recommendation_verdict : 'caution';
    const verdict = VERDICT_COPY[verdictKey];
    const risk = riskLevel(components, penaltyTotal);

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, bufferPages: true });
    const bufferPromise = streamToBuffer(doc);
    let y = MARGIN;

    function ensureRoom(needed) {
      if (y + needed > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
    }

    // Wraps a render function in a bordered card. renderFn draws starting at
    // (x, cy) and must return the y position where its content ends.
    // minHeight is a caller-supplied estimate of the card's total inner
    // height, used to reserve room on the current page up front so a card
    // never gets split across a page break mid-draw.
    function drawCard(minHeight, renderFn, padding = 22) {
      ensureRoom(minHeight + padding * 2);
      const cardTopY = y;
      const innerX = MARGIN + padding;
      const innerW = CONTENT_W - padding * 2;
      let cy = y + padding;
      cy = renderFn(innerX, innerW, cy);
      const cardBottom = cy + padding;
      doc.roundedRect(MARGIN, cardTopY, CONTENT_W, cardBottom - cardTopY, 10)
        .lineWidth(1).strokeColor(CARD_BORDER).stroke();
      y = cardBottom + 14;
    }

    function sectionLabel(x, w, text, cy) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(FAINT)
        .text(text.toUpperCase(), x, cy, { characterSpacing: 0.8 });
      const labelBottom = cy + 14;
      doc.moveTo(x, labelBottom).lineTo(x + w, labelBottom).lineWidth(1).strokeColor(SEC_RULE).stroke();
      return labelBottom + 12;
    }

    // ---------- HEADER CARD ----------
    drawCard(150, (x, w, cy) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
        .text('SPONSOR DECISION MEMO · KITSCORE EVALUATION', x, cy, { characterSpacing: 0.8 });
      cy += 20;
      const creatorName = profileRow?.display_name || 'Creator';
      const niche = creator?.niche ? ` — ${creator.niche}` : '';
      doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(`${creatorName}${niche}`, x, cy, { width: w });
      cy += doc.heightOfString(`${creatorName}${niche}`, { width: w }) + 4;
      const companyName = sponsorRow?.company_name || 'your team';
      const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      doc.font('Helvetica').fontSize(11).fillColor(MUTED)
        .text(`Evaluation requested by ${companyName} · ${dateStr}`, x, cy, { width: w });
      cy += 28;

      const cols = 4, gap = 16;
      const colW = (w - gap * (cols - 1)) / cols;
      const metaItems = [
        ['TRUST SCORE', creator?.trust_score != null ? `${creator.trust_score} / 100` : '—', null],
        ['CONFIDENCE', creator?.confidence != null ? `${creator.confidence}%` : '—', null],
        ['BADGE TIER', creator?.badge_tier ? creator.badge_tier[0].toUpperCase() + creator.badge_tier.slice(1) : '—', null],
        ['RISK LEVEL', risk.label, risk.color],
      ];
      const ruleY = cy;
      doc.moveTo(x, ruleY).lineTo(x + w, ruleY).lineWidth(1).strokeColor(SEC_RULE).stroke();
      cy += 16;
      metaItems.forEach((item, i) => {
        const ix = x + i * (colW + gap);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(FAINT).text(item[0], ix, cy, { width: colW, characterSpacing: 0.6 });
        doc.font('Helvetica-Bold').fontSize(13).fillColor(item[2] || INK).text(item[1], ix, cy + 12, { width: colW });
      });
      cy += 34;
      return cy;
    });

    // ---------- VERDICT BANNER ----------
    ensureRoom(90);
    const bannerTop = y;
    const bannerH = 78;
    doc.roundedRect(MARGIN, bannerTop, CONTENT_W, bannerH, 10).fill(verdict.bg);
    doc.roundedRect(MARGIN, bannerTop, CONTENT_W, bannerH, 10).lineWidth(1).strokeColor(verdict.border).stroke();
    const bx = MARGIN + 22;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(verdict.accent)
      .text('VERDICT', bx, bannerTop + 16, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#FFFFFF')
      .text(verdict.label, bx, bannerTop + 30, { width: CONTENT_W - 44 });
    const summaryLine = evalRow.recommendation_summary
      ? evalRow.recommendation_summary
      : `${risk.label} risk · Trust score ${creator?.trust_score ?? '—'} / 100`;
    doc.font('Helvetica').fontSize(10).fillColor(verdict.sub)
      .text(summaryLine, bx, bannerTop + 52, { width: CONTENT_W - 44 });
    y = bannerTop + bannerH + 14;

    // ---------- AI DECISION BRIEF ----------
    // evaluate.html already renders these four sections on-screen
    // (audience_fit / risk_assessment / confidence_note / recommendation);
    // the PDF previously only carried recommendation_summary, a single
    // sentence, leaving the rest of the brief sponsor-only-visible-on-web.
    let aiBrief = null;
    if (evalRow.ai_summary) {
      try { aiBrief = JSON.parse(evalRow.ai_summary); } catch (e) { aiBrief = null; }
    }
    const BRIEF_SECTIONS = [
      ['audience_fit', 'Audience fit'],
      ['risk_assessment', 'Risk assessment'],
      ['confidence_note', 'Confidence'],
      ['recommendation', 'Recommendation'],
    ];
    const briefItems = aiBrief
      ? BRIEF_SECTIONS.filter(([key]) => aiBrief[key]).map(([key, label]) => [label, String(aiBrief[key])])
      : [];
    if (briefItems.length > 0) {
      const briefInnerW = CONTENT_W - 22 * 2;
      doc.font('Helvetica').fontSize(10.5);
      let briefHeight = 26; // section label
      briefItems.forEach(([, body], idx) => {
        briefHeight += 14 + doc.heightOfString(body, { width: briefInnerW }) + (idx < briefItems.length - 1 ? 14 : 0);
      });
      drawCard(briefHeight, (x, w, cy) => {
        cy = sectionLabel(x, w, 'Kitscore AI decision brief', cy);
        briefItems.forEach(([label, body], idx) => {
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT).text(label, x, cy, { width: w });
          cy += 14;
          doc.font('Helvetica').fontSize(10.5).fillColor('#3D3D3A').text(body, x, cy, { width: w });
          cy += doc.heightOfString(body, { width: w });
          if (idx < briefItems.length - 1) cy += 14;
        });
        return cy;
      });
    }

    // ---------- AUDIENCE DEMOGRAPHICS (self-reported) ----------
    // Not verified against platform analytics -- explicitly labeled as
    // such in the card itself, same trust distinction as evidence_status
    // self_reported vs live_verified elsewhere in this product.
    const hasAudienceData = audience && (audience.top_country || audience.age_range || audience.gender_split);
    if (hasAudienceData) {
      const audienceRows = [
        audience.top_country ? ['Top country', audience.top_country_pct != null ? `${audience.top_country} (${audience.top_country_pct}% of audience)` : audience.top_country] : null,
        audience.age_range ? ['Dominant age range', audience.age_range] : null,
        audience.gender_split ? ['Gender split', audience.gender_split] : null,
      ].filter(Boolean);
      drawCard(50 + audienceRows.length * 18, (x, w, cy) => {
        cy = sectionLabel(x, w, 'Audience demographics', cy);
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(FAINT)
          .text('Self-reported by the creator, not verified against platform analytics.', x, cy, { width: w });
        cy += 18;
        audienceRows.forEach(([label, value]) => {
          doc.font('Helvetica').fontSize(9.5).fillColor(FAINT).text(label, x, cy, { width: w * 0.4 });
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, x + w * 0.4, cy, { width: w * 0.6 });
          cy += 18;
        });
        return cy;
      });
    }

    // ---------- KITSCORE OVERVIEW ----------
    drawCard(130, (x, w, cy) => {
      cy = sectionLabel(x, w, 'Kitscore overview', cy);
      const scoreColW = 110;
      const barsX = x + scoreColW + 24;
      const barsW = w - scoreColW - 24;
      const bigScore = creator?.trust_score != null ? String(creator.trust_score) : '—';
      doc.font('Helvetica-Bold').fontSize(40).fillColor(INK).text(bigScore, x, cy, { width: scoreColW });
      doc.font('Helvetica').fontSize(11).fillColor(FAINT).text('/ 100', x, cy + 42);
      if (creator?.badge_tier) {
        doc.roundedRect(x, cy + 62, Math.min(scoreColW, 90), 18, 9).fill('#F0EFE9');
        doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT)
          .text(`${creator.badge_tier.toUpperCase()} TIER`, x + 8, cy + 67);
      }

      let by = cy;
      const rowH = 20;
      COMPONENT_ORDER.forEach(key => {
        const comp = compMap[key];
        if (!comp) return;
        const label = COMPONENT_LABELS[key];
        doc.font('Helvetica').fontSize(10).fillColor('#3D3D3A').text(label, barsX, by, { width: 150 });
        const barY = by + 13;
        const barTrackW = barsW - 40;
        doc.roundedRect(barsX, barY, barTrackW, 5, 2.5).fill('#F0EFE9');
        const val = Math.max(0, Math.min(100, Number(comp.value) || 0));
        doc.roundedRect(barsX, barY, barTrackW * (val / 100), 5, 2.5).fill(scoreColor(val));
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
          .text(String(comp.value), barsX + barTrackW + 8, by, { width: 32, align: 'right' });
        by += rowH;
      });
      return Math.max(cy + 90, by);
    });

    // ---------- VERIFIED REPUTATION ----------
    const hasReputation = (verifiedCampaigns || []).length > 0
      || creator?.reliability_score != null || creator?.repeat_sponsor_rate != null || creator?.would_hire_again_pct != null;
    if (hasReputation) {
      drawCard(90, (x, w, cy) => {
        cy = sectionLabel(x, w, 'Verified sponsorship reputation', cy);
        const stats = [
          ['Verified campaigns', String((verifiedCampaigns || []).length)],
          ['Reliability score', creator?.reliability_score != null ? `${creator.reliability_score}` : '—'],
          ['Repeat sponsor rate', creator?.repeat_sponsor_rate != null ? `${creator.repeat_sponsor_rate}%` : '—'],
          ['Would hire again', creator?.would_hire_again_pct != null ? `${creator.would_hire_again_pct}%` : '—'],
        ];
        const cols = 4, gap = 14;
        const colW = (w - gap * (cols - 1)) / cols;
        stats.forEach((s, i) => {
          const ix = x + i * (colW + gap);
          doc.roundedRect(ix, cy, colW, 56, 8).fillAndStroke('#F9F8F5', CARD_BORDER);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(FAINT).text(s[0].toUpperCase(), ix + 10, cy + 10, { width: colW - 20, characterSpacing: 0.4 });
          doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(s[1], ix + 10, cy + 28, { width: colW - 20 });
        });
        return cy + 56;
      });
    }

    // ---------- SPONSOR ENDORSEMENTS ----------
    if ((endorsedCampaigns || []).length > 0) {
      const endorsementsInnerW = CONTENT_W - 22 * 2;
      doc.font('Helvetica').fontSize(10.5);
      let endorsementsHeight = 26; // section label
      endorsedCampaigns.forEach((e, idx) => {
        const quoteText = `"${e.endorsement_notes}"`;
        const noteHeight = doc.heightOfString(quoteText, { width: endorsementsInnerW - 28 });
        endorsementsHeight += noteHeight + 24 + 6;
        const hasRatings = e.communication_rating || e.professionalism_rating || e.deliverable_quality_rating;
        if (hasRatings) endorsementsHeight += 16;
        if (idx < endorsedCampaigns.length - 1) endorsementsHeight += 8;
      });
      drawCard(endorsementsHeight, (x, w, cy) => {
        cy = sectionLabel(x, w, 'Sponsor endorsements', cy);
        endorsedCampaigns.forEach((e, idx) => {
          const quoteText = `"${e.endorsement_notes}"`;
          const noteHeight = doc.font('Helvetica').fontSize(10.5).heightOfString(quoteText, { width: w - 28 });
          doc.roundedRect(x, cy, w, noteHeight + 24, 6).lineWidth(1).strokeColor(SEC_RULE).stroke();
          doc.font('Helvetica').fontSize(10.5).fillColor('#3D3D3A')
            .text(quoteText, x + 14, cy + 12, { width: w - 28 });
          cy += noteHeight + 24 + 6;
          const ratingBits = [];
          if (e.communication_rating) ratingBits.push(`Communication ${e.communication_rating}/5`);
          if (e.professionalism_rating) ratingBits.push(`Professionalism ${e.professionalism_rating}/5`);
          if (e.deliverable_quality_rating) ratingBits.push(`Deliverables ${e.deliverable_quality_rating}/5`);
          if (ratingBits.length) {
            doc.font('Helvetica').fontSize(9).fillColor(FAINT).text(ratingBits.join('   ·   '), x + 14, cy);
            cy += 16;
          }
          if (idx < endorsedCampaigns.length - 1) cy += 8;
        });
        return cy;
      });
    }

    // ---------- RISK ASSESSMENT ----------
    if ((safetyAnswers || []).length > 0) {
      const riskHeight = 26 + (safetyAnswers || []).length * 24 + 20;
      drawCard(riskHeight, (x, w, cy) => {
        cy = sectionLabel(x, w, 'Brand safety self-report', cy);
        (safetyAnswers || []).forEach(a => {
          const label = BRAND_SAFETY_QUESTIONS[a.question_key] || a.question_key;
          const penalty = penaltyLookup[`${a.question_key}::${a.answer}`] || 0;
          const rowRisk = penalty >= 8 ? { label: 'High', color: '#8B1A1A' } : penalty >= 3 ? { label: 'Medium', color: '#92460A' } : { label: 'Low', color: '#2D6A0F' };
          doc.font('Helvetica').fontSize(10).fillColor('#3D3D3A').text(label, x, cy, { width: w * 0.5 });
          doc.font('Helvetica').fontSize(10).fillColor(INK).text(a.answer, x + w * 0.5, cy, { width: w * 0.25 });
          doc.font('Helvetica-Bold').fontSize(9).fillColor(rowRisk.color).text(rowRisk.label, x + w * 0.75, cy, { width: w * 0.25, align: 'right' });
          cy += 16;
          doc.moveTo(x, cy).lineTo(x + w, cy).lineWidth(0.5).strokeColor(SEC_RULE).stroke();
          cy += 8;
        });
        doc.font('Helvetica').fontSize(9).fillColor(FAINT)
          .text('Self-reported by the creator; not independently verified by Kitscore.', x, cy, { width: w });
        cy += 14;
        return cy;
      });
    }

    // ---------- FOOTER ----------
    ensureRoom(50);
    doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(
      'This evaluation reflects Kitscore data at time of generation. Verified campaigns require mutual confirmation from both creator and sponsor. Brand safety answers are self-reported by the creator.',
      MARGIN, y, { width: CONTENT_W }
    );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kitscore-${(profileRow?.display_name || 'report').replace(/\s+/g, '-').toLowerCase()}.pdf"`);
    res.status(200).send(pdfBuffer);

    // Send report-ready notification (fire-and-forget after response sent)
    const { data: sponsorProfile } = await admin.from('profiles')
      .select('email').eq('id', sponsor.id).single();
    if (sponsorProfile?.email) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const reportUrl = `${origin}/app/evaluate.html?creator=${evalRow.creator_id}`;
      sendEmail({
        to: sponsorProfile.email,
        ...reportReadyEmail({
          creatorName: profileRow?.display_name || 'this creator',
          reportUrl,
        }),
      }).catch(err => console.error('report-ready email error:', err));
    }
  } catch (err) {
    console.error('generate-pdf error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
