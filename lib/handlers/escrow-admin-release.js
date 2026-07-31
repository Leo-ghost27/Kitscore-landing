// POST /api/escrow?action=admin-release  { contractId, note }
// Admin's release-side intervention for a stuck or contested escrow --
// same Stripe transfer as escrow-release.js, but callable by admin instead
// of requiring the sponsor to click it. Exists because there was
// previously no way to move a 'held' escrow at all if the sponsor simply
// wouldn't act (no release, no refund) once a deliverable was submitted.
//
// Still requires deliverable_submitted_at, same as the sponsor-facing
// flow -- admin is stepping in for an unresponsive/uncooperative sponsor,
// not waiving the "creator actually submitted something" gate. `note` is
// mandatory and written to admin_actions so every forced release has a
// stated reason on record.
const Stripe = require('stripe');
const { adminClient, getAuthedAdmin } = require('../supabase-admin');
const { sendEmail, escrowReleasedEmail } = require('../email');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handleAdminRelease(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAuthedAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not authenticated as an admin' });

  const { contractId, note } = req.body || {};
  if (!contractId) return res.status(400).json({ error: 'contractId is required' });
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note explaining the intervention is required' });

  const db = adminClient();

  try {
    const { data: contract } = await db.from('contracts')
      .select('*, creators!inner(id, stripe_connect_account_id, profiles!inner(display_name))')
      .eq('id', contractId).maybeSingle();

    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.escrow_status !== 'held') {
      return res.status(400).json({ error: `Escrow is ${contract.escrow_status}, not held -- nothing to release` });
    }
    if (!contract.deliverable_submitted_at) {
      return res.status(400).json({ error: 'The creator has not submitted the deliverable yet' });
    }
    if (!contract.creators.stripe_connect_account_id) {
      return res.status(400).json({ error: 'This creator has no connected payout account' });
    }

    const transferAmount = contract.escrow_amount_cents - (contract.platform_fee_cents || 0);

    const transfer = await stripe.transfers.create({
      amount: transferAmount,
      currency: 'usd',
      destination: contract.creators.stripe_connect_account_id,
      source_transaction: contract.escrow_charge_id || undefined,
      metadata: { contractId: contract.id, type: 'contract_escrow_release', forcedByAdmin: admin.id },
    });

    await db.from('contracts').update({
      escrow_status: 'released',
      released_at: new Date().toISOString(),
      escrow_transfer_id: transfer.id,
    }).eq('id', contractId);

    await db.from('admin_actions').insert({
      admin_id: admin.id,
      action_type: 'escrow_force_release',
      target_table: 'contracts',
      target_id: contractId,
      note: note.trim(),
      metadata: { transferId: transfer.id, amountCents: transferAmount },
    });

    const { data: creatorProfile } = await db.from('profiles').select('email').eq('id', contract.creator_id).maybeSingle();
    if (creatorProfile?.email) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      await sendEmail({
        to: creatorProfile.email,
        ...escrowReleasedEmail({
          contractTitle: contract.title,
          amountCents: transferAmount,
          contractsUrl: `${origin}/app/contracts.html`,
        }),
      });
    }

    res.status(200).json({ ok: true, transferId: transfer.id });
  } catch (err) {
    console.error('escrow admin release error:', err);
    res.status(500).json({ error: err.message || 'Could not release escrow funds' });
  }
};
