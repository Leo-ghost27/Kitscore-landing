// POST /api/documents?type=sponsor-memo | ?type=creator-proof
// Merges the old standalone /api/generate-pdf (sponsor $29 decision memo)
// and /api/generate-proof-packet (creator proof packet) routes -- both are
// pdfkit-based document generators, just for different roles/audiences.
// See api/billing.js for more on why this pattern exists.
const handleSponsorMemo = require('../lib/handlers/document-sponsor-memo');
const handleCreatorProof = require('../lib/handlers/document-creator-proof');

module.exports = async (req, res) => {
  const type = req.query?.type;

  if (type === 'sponsor-memo') return handleSponsorMemo(req, res);
  if (type === 'creator-proof') return handleCreatorProof(req, res);

  return res.status(400).json({ error: 'Unknown or missing type. Use ?type=sponsor-memo or ?type=creator-proof.' });
};
