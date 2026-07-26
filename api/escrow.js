// POST /api/escrow?action=connect-onboarding | refresh-connect-status | fund | submit-deliverable | release | refund
//
// One function slot for the whole escrow feature, same consolidation
// pattern as api/billing.js, api/team.js, api/campaign-actions.js.
const handleConnectOnboarding = require('../lib/handlers/escrow-connect-onboarding');
const handleRefreshConnectStatus = require('../lib/handlers/escrow-refresh-connect-status');
const handleFund = require('../lib/handlers/escrow-fund');
const handleSubmitDeliverable = require('../lib/handlers/escrow-submit-deliverable');
const handleRelease = require('../lib/handlers/escrow-release');
const handleRefund = require('../lib/handlers/escrow-refund');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'connect-onboarding') return handleConnectOnboarding(req, res);
  if (action === 'refresh-connect-status') return handleRefreshConnectStatus(req, res);
  if (action === 'fund') return handleFund(req, res);
  if (action === 'submit-deliverable') return handleSubmitDeliverable(req, res);
  if (action === 'release') return handleRelease(req, res);
  if (action === 'refund') return handleRefund(req, res);

  return res.status(400).json({
    error: 'Unknown or missing action. Use ?action=connect-onboarding, refresh-connect-status, fund, submit-deliverable, release, or refund.',
  });
};
