// POST /api/documents?type=pitch-evidence  { applicationId }
// One-page "Pitch Evidence Certificate" for a brief_applications row --
// see supabase/2026-08-10-pitch-evidence-logging.sql for the underlying
// hash/lock design. Every figure on this PDF (pitch text, hash, locked
// timestamp, brief/party names) comes straight off that row -- nothing
// generated or summarized, since the entire point is an unaltered record
// of what was actually submitted.
//
// Callable by either party on the application (creator or the sponsor
// who owns the brief), or admin -- deliberately symmetric, same
// reasoning as the RLS on brief_applications itself: this protects
// whichever side is telling the truth about what was actually sent, not
// just the creator. Not gated behind unlock/payment, unlike the sponsor
// memo -- pitch_hash/pitch_locked_at already exist on data both parties
// can already see; this just formats it as something a creator or
// sponsor could actually hand to a lawyer.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedProfile } = require('../supabase-admin');

const PAGE_W = 612, PAGE_H = 792, MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = '#1A1A18', MUTED = '#6B6B67', FAINT = '#9E9E99';
const CARD_BORDER = '#E5E4DF', SEC_RULE = '#F0EFE9';
const ACCENT = '#5B4FCF';

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

async function getAuthedPartyOnApplication(req, application, brief) {
  for (const role of ['creator', 'sponsor', 'admin']) {
    const profile = await getAuthedProfile(req, role);
    if (!profile) continue;
    if (role === 'admin' || profile.id === application.creator_id || profile.id === brief.sponsor_id) {
      return profile;
    }
  }
  return null;
}

module.exports = async function handlePitchEvidence(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { applicationId } = req.body || {};
    if (!applicationId) return res.status(400).json({ error: 'applicationId is required' });

    const admin = adminClient();
    const { data: application } = await admin.from('brief_applications').select('*').eq('id', applicationId).maybeSingle();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: brief } = await admin.from('campaign_briefs').select('*').eq('id', application.brief_id).maybeSingle();
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const requester = await getAuthedPartyOnApplication(req, application, brief);
    if (!requester) return res.status(401).json({ error: 'Not authorized to view this application' });

    if (!application.pitch_hash || !application.pitch_locked_at) {
      return res.status(409).json({ error: 'This application has no locked pitch to certify' });
    }

    const [{ data: creatorProfile }, { data: sponsorRow }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', application.creator_id).single(),
      admin.from('sponsors').select('company_name').eq('id', brief.sponsor_id).maybeSingle(),
    ]);

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, bufferPages: true });
    const bufferPromise = streamToBuffer(doc);
    let y = MARGIN;

    // ---------- HEADER ----------
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT).text('KITSCORE', MARGIN, y);
    doc.font('Helvetica').fontSize(9).fillColor(FAINT).text('Pitch Evidence Certificate', MARGIN, y, { align: 'right', width: CONTENT_W });
    y += 22;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(SEC_RULE).lineWidth(1).stroke();
    y += 22;

    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Pitch Evidence Certificate', MARGIN, y);
    y += 26;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(
      'This certificate records the exact pitch text submitted through Kitscore for the brief below, and the server-generated timestamp and cryptographic hash locked at the moment of submission. The pitch text and hash cannot be altered after submission.',
      MARGIN, y, { width: CONTENT_W, lineGap: 3 }
    );
    y = doc.y + 20;

    // ---------- PARTIES / BRIEF ----------
    function field(label, value) {
      doc.font('Helvetica').fontSize(9).fillColor(FAINT).text(label, MARGIN, y);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(value || '—', MARGIN, y, { width: CONTENT_W });
      y = doc.y + 14;
    }

    field('BRIEF', brief.title);
    field('CREATOR', creatorProfile?.display_name || 'Unknown creator');
    field('SPONSOR', sponsorRow?.company_name || 'Unknown sponsor');
    field('SUBMITTED (LOCKED TIMESTAMP)', new Date(application.pitch_locked_at).toUTCString());

    y += 6;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(SEC_RULE).lineWidth(1).stroke();
    y += 20;

    // ---------- PITCH TEXT ----------
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('PITCH TEXT AS SUBMITTED', MARGIN, y);
    y += 16;
    const pitchText = application.pitch_message || '(no pitch text was included with this application)';
    const boxTop = y;
    doc.font('Helvetica').fontSize(10.5).fillColor(INK);
    const textHeight = doc.heightOfString(pitchText, { width: CONTENT_W - 28, lineGap: 3 });
    doc.rect(MARGIN, boxTop, CONTENT_W, textHeight + 28).strokeColor(CARD_BORDER).lineWidth(1).stroke();
    doc.text(pitchText, MARGIN + 14, boxTop + 14, { width: CONTENT_W - 28, lineGap: 3 });
    y = boxTop + textHeight + 28 + 24;

    if (application.proposed_rate) {
      doc.font('Helvetica').fontSize(9).fillColor(FAINT).text('Proposed rate: ', MARGIN, y, { continued: true });
      doc.font('Helvetica-Bold').fillColor(INK).text(application.proposed_rate);
      y = doc.y + 20;
    }

    // ---------- HASH ----------
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('SHA-256 EVIDENCE HASH', MARGIN, y);
    y += 16;
    doc.rect(MARGIN, y, CONTENT_W, 34).fillAndStroke('#F7F6F2', CARD_BORDER);
    doc.font('Courier').fontSize(9.5).fillColor(INK).text(application.pitch_hash, MARGIN + 12, y + 12, { width: CONTENT_W - 24 });
    y += 34 + 16;
    doc.font('Helvetica').fontSize(8.5).fillColor(FAINT).text(
      'This hash is computed by Kitscore\u2019s database from the brief, creator, pitch text, and locked timestamp above. Re-hashing identical inputs will reproduce it exactly; any change to the pitch text would produce a different hash.',
      MARGIN, y, { width: CONTENT_W, lineGap: 3 }
    );
    y = doc.y + 24;

    // ---------- FOOTER / DISCLAIMER ----------
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(SEC_RULE).lineWidth(1).stroke();
    y += 16;
    doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(
      'This certificate is a factual record of data held by Kitscore at the time of generation. It is not legal advice and does not by itself establish legal ownership, originality, or infringement of any concept described in the pitch text -- it establishes only that this specific text was submitted through Kitscore by this creator, to this brief, at this timestamp. Consult a lawyer for advice on your specific situation.',
      MARGIN, y, { width: CONTENT_W, lineGap: 2 }
    );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kitscore-pitch-evidence-${applicationId.slice(0, 8)}.pdf"`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('pitch-evidence pdf error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
