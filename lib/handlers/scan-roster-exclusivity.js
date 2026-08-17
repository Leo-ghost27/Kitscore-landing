// POST /api/team?action=scan-roster-exclusivity  { force }
//
// Roster-wide version of scan-exclusivity-conflicts.js -- same
// underlying check (lib/exclusivity-conflict-check.js), same
// non-legal-advice framing, just orchestrated across every creator on
// the manager's active roster instead of one contract passed in.
//
// IMPORTANT SCOPE NOTE: this only re-runs the EXISTING per-creator
// check (does contract A's exclusivity terms conflict with contract B,
// both belonging to the SAME creator) across every creator on the
// roster. It does NOT attempt to detect a conflict BETWEEN two
// different creators on the same roster (e.g. "Creator A and Creator B,
// both managed by you, are both exclusively locked into competing
// skincare brands"). The schema has no manager-level exclusivity
// concept -- contracts.exclusivity_terms is scoped to a single
// creator_id, not to a manager -- so there is no real contract language
// to check a cross-creator claim against. Inventing one would mean
// flagging something with no actual text behind it, which breaks the
// verbatim-quote / fail-closed discipline the whole exclusivity-check
// system depends on. If cross-creator conflict detection is wanted
// later, it needs its own real data source first (e.g. a
// manager-level exclusivity field that doesn't exist today).
const { adminClient, getAuthedManager } = require('../supabase-admin');
const { checkExclusivityConflicts } = require('../exclusivity-conflict-check');

const MAX_CREATORS_PER_SCAN = 25; // cost/latency guard, same reasoning as the 15-contract cap inside checkExclusivityConflicts itself

module.exports = async function handleScanRosterExclusivity(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const manager = await getAuthedManager(req);
  if (!manager) return res.status(401).json({ error: 'Not authenticated as a manager' });

  const { force } = req.body || {};
  const db = adminClient();

  try {
    const { data: links } = await db.from('manager_creator_links')
      .select('creator_id, creators(profiles(display_name))')
      .eq('manager_id', manager.id)
      .eq('status', 'active')
      .limit(MAX_CREATORS_PER_SCAN);

    if (!links || !links.length) {
      return res.status(200).json({ results: [], message: 'No creators on your roster yet.' });
    }

    const results = [];

    for (const link of links) {
      const { data: contracts } = await db.from('contracts')
        .select('id, sponsor_company_name:sponsors(company_name), exclusivity_terms, created_at, exclusivity_conflict_flagged, exclusivity_conflict_scanned_at, deliverables')
        .eq('creator_id', link.creator_id)
        .eq('status', 'fully_signed')
        .not('exclusivity_terms', 'is', null);

      const withTerms = (contracts || []).filter(c => (c.exclusivity_terms || '').trim());
      if (withTerms.length < 2) continue; // nothing to cross-check against

      const creatorName = link.creators?.profiles?.display_name || 'Creator';
      const creatorFlags = [];

      for (const contract of withTerms) {
        if (contract.exclusivity_conflict_scanned_at && !force) {
          if (contract.exclusivity_conflict_flagged) {
            creatorFlags.push({ contractId: contract.id, cached: true });
          }
          continue;
        }

        const others = withTerms
          .filter(c => c.id !== contract.id)
          .map(c => ({ id: c.id, exclusivity_terms: c.exclusivity_terms, created_at: c.created_at, sponsor_company_name: c.sponsor_company_name?.company_name }));

        const result = await checkExclusivityConflicts(
          { ...contract, sponsor_company_name: contract.sponsor_company_name?.company_name },
          others
        );
        if (!result) continue;

        await db.from('contracts').update({
          exclusivity_conflict_flagged: result.flagged,
          exclusivity_conflict_concerns: result.concerns,
          exclusivity_conflict_rationale: result.rationale,
          exclusivity_conflict_model: result.model,
          exclusivity_conflict_scanned_at: new Date().toISOString(),
        }).eq('id', contract.id);

        if (result.flagged) {
          creatorFlags.push({ contractId: contract.id, rationale: result.rationale, concerns: result.concerns, cached: false });
        }
      }

      if (creatorFlags.length) {
        results.push({ creatorId: link.creator_id, creatorName, flags: creatorFlags });
      }
    }

    res.status(200).json({
      scannedCreators: links.length,
      flaggedCreators: results.length,
      results,
    });
  } catch (err) {
    console.error('scan-roster-exclusivity error:', err);
    res.status(500).json({ error: err.message || 'Could not scan roster for exclusivity conflicts' });
  }
};
