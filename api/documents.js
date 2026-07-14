// POST /api/documents?type=sponsor-memo | ?type=evekit
// Merges the old standalone /api/generate-pdf (sponsor $29 decision memo)
// and /api/generate-proof-packet (creator PDF) routes -- both are
// pdfkit-based document generators, just for different roles/audiences.
// See api/billing.js for more on why this pattern exists.
//
// `?type=creator-proof` is kept as an alias to the same EveKit handler for
// backward compatibility with any bookmarked/cached calls from before the
// July 2026 Proof Packet → EveKit rename (see docs/session-handoff-2026-07-13-evekit.md).
const handleSponsorMemo = require('../lib/handlers/document-sponsor-memo');
const handleEveKit = require('../lib/handlers/document-evekit');

module.exports = async (req, res) => {
  const type = req.query?.type;

  if (type === 'sponsor-memo') return handleSponsorMemo(req, res);
  if (type === 'evekit' || type === 'creator-proof') return handleEveKit(req, res);

  return res.status(400).json({ error: 'Unknown or missing type. Use ?type=sponsor-memo or ?type=evekit.' });
};
