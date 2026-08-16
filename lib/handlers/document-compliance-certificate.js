// POST /api/documents?type=compliance-certificate
//
// Pro-gated -- but unlike Exclusivity Conflict Check, this gating is
// consistent with the rest of the codebase: the underlying protections
// (disclosure_scans, brand_safety_scans, contract clause scans) already
// run and are visible to every creator for free. This document is a
// presentation/export layer on top of data the creator already has for
// free, not the protection itself -- same category as EveKit being
// free while a polished export is the upsell, not the safety check.
//
// IMPORTANT FRAMING, do not change without re-reading this note: this
// is explicitly NOT a legal certification that the creator IS FTC
// compliant. Kitscore is not a law firm and this is not a compliance
// guarantee. It is a timestamped RECORD of the automated checks
// Kitscore has run and their outcomes -- same non-legal-advice
// boundary as contract-clause-scan.js and disclosure-scan.js. The
// document itself says this explicitly on every page; the marketing
// copy for this feature must say the same.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedCreator } = require('../supabase-admin');

const PAGE_W = 612, PAGE_H = 792, MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = '#1A1A18', MUTED = '#6B6B67', FAINT = '#9E9E99';
const ACCENT = '#2563EB', GOOD = '#1D9E75', WARN = '#B45309';
const RULE = '#E5E4DF';

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = async function handleComplianceCertificate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  if (creator.plan !== 'pro') {
    return res.status(403).json({ error: 'The Compliance Certificate export is a Pro feature. The underlying compliance scans themselves stay free for every creator.', upgradeRequired: true });
  }

  const db = adminClient();

  try {
    const [{ data: disclosureScans }, { data: brandSafetyScans }, { data: contracts }] = await Promise.all([
      db.from('disclosure_scans').select('platform, flagged, scanned_at').eq('creator_id', creator.id).order('scanned_at', { ascending: false }),
      db.from('brand_safety_scans').select('platform, flagged, categories, scanned_at').eq('creator_id', creator.id).order('scanned_at', { ascending: false }),
      db.from('contracts').select('title, clause_scan_flagged, clause_scanned_at, ftc_disclosure_required').eq('creator_id', creator.id).not('clause_scanned_at', 'is', null).order('clause_scanned_at', { ascending: false }),
    ]);

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, bufferPages: true });
    const bufferPromise = streamToBuffer(doc);

    let y = MARGIN;

    // ---------- HEADER ----------
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Kitscore Compliance Record', MARGIN, y);
    y += 24;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`${creator.display_name || 'Creator'} · generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, MARGIN, y);
    y += 26;

    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 18;

    // ---------- NOT LEGAL ADVICE NOTICE (prominent, not buried) ----------
    doc.rect(MARGIN, y, CONTENT_W, 46).fillColor('#F5F8FF').fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT).text('This is not a legal certification.', MARGIN + 12, y + 10, { width: CONTENT_W - 24 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('This document records the automated compliance checks Kitscore has run and their outcomes. It is not a guarantee of FTC or other regulatory compliance and is not a substitute for legal advice.', MARGIN + 12, y + 22, { width: CONTENT_W - 24 });
    y += 60;

    // ---------- DISCLOSURE SCANS ----------
    y = section(doc, y, 'Paid-partnership disclosure scans', disclosureScans, s =>
      `${(s.platform || 'platform')} — scanned ${fmtDate(s.scanned_at)}`
    );

    // ---------- BRAND SAFETY SCANS ----------
    y = section(doc, y, 'Brand safety scans', brandSafetyScans, s =>
      `${(s.platform || 'platform')} — scanned ${fmtDate(s.scanned_at)}${s.flagged && s.categories?.length ? ` — flagged: ${s.categories.join(', ')}` : ''}`
    );

    // ---------- CONTRACT CLAUSE SCANS ----------
    y = section(doc, y, 'Contract clause scans', contracts, c =>
      `${c.title || 'Untitled contract'} — scanned ${fmtDate(c.clause_scanned_at)}${c.ftc_disclosure_required ? ' — FTC disclosure required' : ''}`
    );

    // ---------- SUMMARY ----------
    if (y > PAGE_H - 140) { doc.addPage(); y = MARGIN; }
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 16;
    const totalScans = (disclosureScans?.length || 0) + (brandSafetyScans?.length || 0) + (contracts?.length || 0);
    const totalFlags = (disclosureScans?.filter(s => s.flagged).length || 0) + (brandSafetyScans?.filter(s => s.flagged).length || 0) + (contracts?.filter(c => c.clause_scan_flagged).length || 0);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${totalScans} total scans on record, ${totalFlags} flagged for review.`, MARGIN, y, { width: CONTENT_W });
    y += 30;

    doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(
      'Flagged items indicate language or content patterns that Kitscore\'s automated review surfaced for the creator or sponsor to look at directly -- a flag does not itself mean a violation occurred, and the absence of flags does not guarantee full compliance. Generated by Kitscore, kitscore.co.',
      MARGIN, y, { width: CONTENT_W }
    );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kitscore-compliance-record-${(creator.display_name || 'creator').replace(/\s+/g, '-').toLowerCase()}.pdf"`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('compliance-certificate error:', err);
    res.status(500).json({ error: err.message || 'Could not generate compliance record' });
  }
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown date';
}

// Shared section renderer -- title + list of rows, or an explicit "none
// on record" line rather than silently omitting the section (a missing
// section could look like Kitscore forgot to check, not that there's
// nothing to show).
function section(doc, y, title, rows, formatRow) {
  if (y > PAGE_H - 100) { doc.addPage(); y = MARGIN; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(title, MARGIN, y);
  y += 18;

  if (!rows || !rows.length) {
    doc.font('Helvetica').fontSize(9.5).fillColor(FAINT).text('None on record.', MARGIN, y);
    return y + 22;
  }

  rows.slice(0, 20).forEach(row => {
    if (y > PAGE_H - 70) { doc.addPage(); y = MARGIN; }
    const color = row.flagged || row.clause_scan_flagged ? WARN : GOOD;
    doc.font('Helvetica').fontSize(9.5).fillColor(color).text(row.flagged || row.clause_scan_flagged ? '⚑ ' : '✓ ', MARGIN, y, { continued: true });
    doc.fillColor(MUTED).text(formatRow(row), { width: CONTENT_W - 14 });
    y += doc.heightOfString(formatRow(row), { width: CONTENT_W - 14 }) + 6;
  });

  if (rows.length > 20) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(FAINT).text(`+ ${rows.length - 20} more not shown`, MARGIN, y);
    y += 16;
  }

  return y + 14;
}
