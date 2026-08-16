// POST /api/campaign-actions?action=scan-exclusivity-conflicts  { contractId }
//
// Pro-gated per explicit product decision -- flagging for the record:
// this is different in kind from scan-contract-clauses (free for
// everyone, always) because it protects against the same kind of real
// legal/financial exposure -- an unknowing exclusivity breach. Gating
// it means a free-tier creator gets no protection here that a Pro
// creator gets. See lib/exclusivity-conflict-check.js and the product
// conversation this came out of for the full reasoning either way.
//
// Creator-only (not sponsor, unlike scan-contract-clauses) -- this
// reads across the creator's OTHER contracts with OTHER sponsors to
// check for conflicts, which is the creator's own private deal history.
// The sponsor on THIS contract has no legitimate reason to see that.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { checkExclusivityConflicts } = require('../exclusivity-conflict-check');

module.exports = async function handleScanExclusivityConflicts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  if (creator.plan !== 'pro') {
    return res.status(403).json({ error: 'Exclusivity Conflict Check is a Pro feature.', upgradeRequired: true });
  }

  const { contractId, force } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });

  const db = adminClient();

  try {
    const { data: contract } = await db.from('contracts')
      .select('*, sponsors(company_name)').eq('id', contractId).maybeSingle();
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.creator_id !== creator.id) return res.status(403).json({ error: 'Not your contract' });

    if (contract.exclusivity_conflict_scanned_at && !force) {
      return res.status(200).json({
        flagged: contract.exclusivity_conflict_flagged,
        concerns: contract.exclusivity_conflict_concerns || [],
        rationale: contract.exclusivity_conflict_rationale,
        cached: true,
      });
    }

    const { data: otherContracts } = await db.from('contracts')
      .select('id, exclusivity_terms, created_at, sponsors(company_name)')
      .eq('creator_id', creator.id)
      .eq('status', 'fully_signed')
      .neq('id', contractId);

    const flattened = (otherContracts || []).map(c => ({
      id: c.id,
      exclusivity_terms: c.exclusivity_terms,
      created_at: c.created_at,
      sponsor_company_name: c.sponsors?.company_name,
    }));

    const result = await checkExclusivityConflicts(
      { ...contract, sponsor_company_name: contract.sponsors?.company_name },
      flattened
    );

    if (!result) {
      return res.status(200).json({ flagged: false, concerns: [], rationale: '', notRun: true });
    }

    await db.from('contracts').update({
      exclusivity_conflict_flagged: result.flagged,
      exclusivity_conflict_concerns: result.concerns,
      exclusivity_conflict_rationale: result.rationale,
      exclusivity_conflict_model: result.model,
      exclusivity_conflict_scanned_at: new Date().toISOString(),
    }).eq('id', contractId);

    res.status(200).json({
      flagged: result.flagged,
      concerns: result.concerns,
      rationale: result.rationale,
      checkedAgainst: result.checkedAgainst,
      cached: false,
    });
  } catch (err) {
    console.error('exclusivity conflict check error:', err);
    res.status(500).json({ error: err.message || 'Could not check for exclusivity conflicts' });
  }
};
