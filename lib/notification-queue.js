// Shared helper for queuing failed transactional-email sends into
// notification_failures, so a Resend outage or bad address doesn't just
// vanish into console.error with no way to know it happened.
//
// Used by api/notify-dispute.js (writes) and
// scripts/retry-failed-notifications.js (reads + retries). Both run with
// the service-role client, which bypasses the RLS on this table by design —
// see the notification_failures_table migration for why RLS is enabled
// with zero policies.

async function logNotificationFailure(admin, { kind = 'dispute_notification', campaignId, recipientEmail, error }) {
  try {
    await admin.from('notification_failures').insert({
      kind, campaign_id: campaignId, recipient_email: recipientEmail, error,
    });
  } catch (err) {
    // Logging the failure failing too shouldn't take down the request that
    // triggered it — worst case is back to today's behavior (console only).
    console.error('logNotificationFailure error:', err);
  }
}

module.exports = { logNotificationFailure };
