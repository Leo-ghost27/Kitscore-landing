// POST /api/generate-pdf  { evaluationId }
// Only generates a PDF for an evaluation the requesting sponsor actually
// owns AND has unlocked (paid for) - this is the $29 report's deliverable.
const PDFDocument = require('pdfkit');
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

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

    const { data: creator } = await admin.from('creators').select('*').eq('id', evalRow.creator_id).single();
    const { data: profileRow } = await admin.from('profiles').select('display_name').eq('id', evalRow.creator_id).single();
    const { data: components } = await admin.from('score_components').select('*').eq('creator_id', evalRow.creator_id);
    const { data: verifiedCampaigns } = await admin.from('campaigns').select('id').eq('creator_id', evalRow.creator_id).eq('status', 'verified');

    const doc = new PDFDocument({ margin: 50 });
    const bufferPromise = streamToBuffer(doc);

    doc.fontSize(20).fillColor('#1A1A1E').text('Kitscore — Sponsor Decision Memo', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#6B7280').text(`Generated ${new Date().toLocaleDateString('en-US')}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#1A1A1E').text(profileRow?.display_name || 'Creator');
    doc.fontSize(10).fillColor('#6B7280').text(`${creator?.niche || ''} ${creator?.location ? '· ' + creator.location : ''}`);
    doc.moveDown(1);

    const verdictColor = { approve: '#1C7C3F', caution: '#92600A', avoid: '#B42318' }[evalRow.recommendation_verdict] || '#185FA5';
    doc.fontSize(13).fillColor(verdictColor).text(`Recommendation: ${(evalRow.recommendation_verdict || 'pending').toUpperCase()}`);
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#1A1A1E').text(`Trust score: ${creator?.trust_score ?? '—'}`);
    doc.text(`Verified campaigns: ${(verifiedCampaigns || []).length}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#1A1A1E').text('Summary');
    doc.fontSize(10).fillColor('#374151').text(evalRow.recommendation_summary || '', { width: 480 });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#1A1A1E').text('Score breakdown');
    doc.fontSize(10).fillColor('#374151');
    (components || []).forEach(c => {
      doc.text(`${c.label}: ${c.value}`);
    });
    doc.moveDown(1.5);

    doc.fontSize(8).fillColor('#9CA3AF').text(
      'This evaluation reflects Kitscore data at time of generation. Verified campaigns require mutual confirmation from both creator and sponsor.',
      { width: 480 }
    );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kitscore-${(profileRow?.display_name || 'report').replace(/\s+/g, '-').toLowerCase()}.pdf"`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('generate-pdf error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
