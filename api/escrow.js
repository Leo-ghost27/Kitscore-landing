// POST /api/escrow?action=connect-onboarding | refresh-connect-status | fund | submit-deliverable | release | release-milestone | refund | dispute | admin-release | admin-refund
// GET  /api/escrow?action=fee-info | balance
//
// One function slot for the whole escrow feature, same consolidation
// pattern as api/billing.js, api/team.js, api/campaign-actions.js.
// admin-release/admin-refund are the same money-moving operations as
// release/refund but for admin intervention on a stuck or contested
// escrow -- see app/admin-escrow.html and docs/admin-roadmap.md.
// dispute moves no money -- it's the sponsor's post-submission
// alternative to refund, see escrow-dispute.js.
const handleConnectOnboarding = require('../lib/handlers/escrow-connect-onboarding');
const handleRefreshConnectStatus = require('../lib/handlers/escrow-refresh-connect-status');
const handleFund = require('../lib/handlers/escrow-fund');
const handleSubmitDeliverable = require('../lib/handlers/escrow-submit-deliverable');
const handleRelease = require('../lib/handlers/escrow-release');
const handleReleaseMilestone = require('../lib/handlers/escrow-release-milestone');
const handleRefund = require('../lib/handlers/escrow-refund');
const handleDispute = require('../lib/handlers/escrow-dispute');
const handleBalance = require('../lib/handlers/creator-balance');
const handleAdminRelease = require('../lib/handlers/escrow-admin-release');
const handleAdminRefund = require('../lib/handlers/escrow-admin-refund');

const DEFAULT_FEE_PCT = 10;

module.exports = async (req, res) => {
  const action = req.query?.action;

  // Non-sensitive and unauthenticated on purpose -- both sponsor and
  // creator need to see this BEFORE a contract is funded, not just
  // after, so the fee is disclosed rather than a backend-only detail.
  if (action === 'fee-info') {
    const feePct = Number(process.env.PLATFORM_ESCROW_FEE_PCT) || DEFAULT_FEE_PCT;
    return res.status(200).json({ feePct });
  }

  if (action === 'connect-onboarding') return handleConnectOnboarding(req, res);
  if (action === 'refresh-connect-status') return handleRefreshConnectStatus(req, res);
  if (action === 'fund') return handleFund(req, res);
  if (action === 'submit-deliverable') return handleSubmitDeliverable(req, res);
  if (action === 'release') return handleRelease(req, res);
  if (action === 'release-milestone') return handleReleaseMilestone(req, res);
  if (action === 'refund') return handleRefund(req, res);
  if (action === 'dispute') return handleDispute(req, res);
  if (action === 'balance') return handleBalance(req, res);
  if (action === 'admin-release') return handleAdminRelease(req, res);
  if (action === 'admin-refund') return handleAdminRefund(req, res);

  return res.status(400).json({
    error: 'Unknown or missing action. Use ?action=connect-onboarding, refresh-connect-status, fund, submit-deliverable, release, release-milestone, refund, dispute, admin-release, admin-refund, fee-info, or balance.',
  });
};
