// POST /api/campaign-actions?action=scan-contract-clauses  { contractId }
// Creator-side legal protection: scans a contract's actual terms for
// one-sided indemnification/liability language, fake-ambassador-program
// compensation patterns (deliverables read like a paid deal, compensation
// is discount-code/affiliate/gifting-only with no flat fee), AND
// undisclosed usage-rights scope (perpetual/worldwide/paid-ad-usage grants
// with nothing in the contract suggesting the creator knew or was paid for
// that scope) -- see lib/contract-clause-scan.js for the full design note and the
// explicit non-legal-advice framing that must be preserved in any UI
// built on this. Callable by either party on the contract (or admin) --
// unlike disclosure_scans this isn't gated to admin-only, because it's
// the creator's own legal/compensation exposure and the whole point is
// surfacing it immediately, not after an admin review queue.
//
// Idempotent by default: if the contract already has a scan
// (clause_scanned_at is set), returns the cached result instead of
// re-running -- terms are locked once a contract leaves 'draft' anyway
// (fn_validate_contract_changes), so a second scan of the same text would
// just burn an API call for the same answer. Pass { force: true } to
// re-scan regardless (e.g. after a real terms change while still draft).
const { adminClient, getAuthedProfile } = require('../supabase-admin');
const { scanContractClauses } = require('../contract-clause-scan');

async function getAuthedPartyOnContract(req, contract) {
  for (const role of ['creator', 'sponsor', 'admin']) {
    const profile = await getAuthedProfile(req, role);
    if (!profile) continue;
    if (role === 'admin' || profile.id === contract.creator_id || profile.id === contract.sponsor_id) {
      return profile;
    }
  }
  return null;
}

module.exports = async function handleScanContractClauses(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { contractId, force } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const db = adminClient();

  try {
    const { data: contract } = await db.from('contracts').select('*').eq('id', contractId).maybeSingle();
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const caller = await getAuthedPartyOnContract(req, contract);
    if (!caller) return res.status(401).json({ error: 'Not authorized to scan this contract' });

    if (contract.clause_scanned_at && !force) {
      return res.status(200).json({
        flagged: contract.clause_scan_flagged,
        concerns: contract.clause_scan_concerns || [],
        rationale: contract.clause_scan_rationale,
        cached: true,
      });
    }

    const result = await scanContractClauses(contract);
    if (!result) {
      return res.status(200).json({ flagged: false, concerns: [], rationale: '', notRun: true });
    }

    await db.from('contracts').update({
      clause_scan_flagged: result.flagged,
      clause_scan_concerns: result.concerns,
      clause_scan_rationale: result.rationale,
      clause_scan_model: result.model,
      clause_scanned_at: new Date().toISOString(),
    }).eq('id', contractId);

    res.status(200).json({ flagged: result.flagged, concerns: result.concerns, rationale: result.rationale, cached: false });
  } catch (err) {
    console.error('contract clause scan error:', err);
    res.status(500).json({ error: err.message || 'Could not scan contract' });
  }
};
