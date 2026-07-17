// Shared Resend email utility for all transactional emails.
// Sender is read from RESEND_FROM_EMAIL env var — swap from
// onboarding@resend.dev to hello@kitscore.co with no code change.

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping email to', to);
    return { skipped: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('Resend error:', json);
    return { error: json };
  }
  return { id: json.id };
}

function teamInviteEmail({ teamName, inviteLink, invitedBy }) {
  return {
    subject: `You've been invited to join ${teamName} on Kitscore`,
    text: `${invitedBy} has invited you to join ${teamName} on Kitscore.\n\nAccept your invite:\n${inviteLink}\n\nExpires in 7 days.`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">You're invited to ${teamName}</h2>
        <p style="color:#6B7280;font-size:14px">${invitedBy} has invited you to join their team on Kitscore — the creator trust and verification platform.</p>
        <a href="${inviteLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Accept invite</a>
        <p style="color:#9CA3AF;font-size:12px">This link expires in 7 days. If you weren't expecting this, ignore it.</p>
      </div>`,
  };
}

function sponsorReceiptEmail({ amount, creatorName, reportUrl }) {
  const dollars = (amount / 100).toFixed(2);
  return {
    subject: 'Your Kitscore evaluation report is ready',
    text: `Your $${dollars} Kitscore evaluation for ${creatorName} is ready.\n\nView your report: ${reportUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Your evaluation report is ready</h2>
        <p style="color:#6B7280;font-size:14px">Your $${dollars} evaluation for <strong>${creatorName}</strong> has been unlocked.</p>
        <a href="${reportUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View full report</a>
        <p style="color:#9CA3AF;font-size:12px">A PDF download is available on the report page. Keep this email as your receipt — amount charged: $${dollars} USD.</p>
      </div>`,
  };
}

function reportReadyEmail({ creatorName, reportUrl }) {
  return {
    subject: `Kitscore: ${creatorName} evaluation PDF ready`,
    text: `Your Kitscore PDF for ${creatorName} is ready to download.\n\n${reportUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">PDF report ready</h2>
        <p style="color:#6B7280;font-size:14px">Your Kitscore decision memo for <strong>${creatorName}</strong> is available to download.</p>
        <a href="${reportUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#1C7C3F;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Download PDF</a>
      </div>`,
  };
}

function refundConfirmationEmail({ amount, description }) {
  const dollars = (amount / 100).toFixed(2);
  return {
    subject: `Kitscore refund confirmed — $${dollars}`,
    text: `Your refund of $${dollars} has been processed.\n\nDescription: ${description || 'Kitscore purchase'}\n\nRefunds typically appear on your statement within 5–10 business days depending on your bank.\n\nIf you have any questions, reply to this email or contact billing@kitscore.co.\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Your refund is on its way</h2>
        <p style="color:#6B7280;font-size:14px">We've processed a refund of <strong>$${dollars} USD</strong> for your recent Kitscore purchase.</p>
        <div style="background:#F3F4F6;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#9CA3AF;margin-bottom:4px">Amount refunded</div>
          <div style="font-size:20px;font-weight:600;color:#1A1A1E">$${dollars} USD</div>
          <div style="font-size:12px;color:#9CA3AF;margin-top:6px">${description || 'Kitscore purchase'}</div>
        </div>
        <p style="color:#6B7280;font-size:13px">Refunds typically appear on your statement within <strong>5–10 business days</strong> depending on your bank or card issuer.</p>
        <p style="color:#6B7280;font-size:13px">If you have any questions about this refund, reply to this email or contact <a href="mailto:billing@kitscore.co" style="color:#2563EB">billing@kitscore.co</a>.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co · Verified Sponsorship Reputation</p>
      </div>`,
  };
}

// Dispute reason and campaign/creator names are free-text values supplied
// by the creator, so they must be escaped before going into the HTML body —
// same reasoning as the client-side escapeHtml() fixes elsewhere in the app.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function disputeNotificationEmail({ campaignName, creatorName, disputeReason, campaignsUrl }) {
  return {
    subject: `Kitscore: ${creatorName} disputed "${campaignName}"`,
    text: `${creatorName} has disputed the campaign "${campaignName}" you logged on Kitscore.\n\nTheir reason: ${disputeReason}\n\nThe campaign is on hold until you review it. Fix the details and resubmit, or reach out to the creator directly.\n\nReview it here: ${campaignsUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">A creator disputed a campaign</h2>
        <p style="color:#6B7280;font-size:14px"><strong>${escapeHtml(creatorName)}</strong> has disputed the campaign <strong>${escapeHtml(campaignName)}</strong> you logged on Kitscore.</p>
        <div style="background:#FDECEC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#B42318;margin-bottom:4px">Creator's reason</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(disputeReason)}</div>
        </div>
        <p style="color:#6B7280;font-size:13px">The campaign is on hold until you review it. You can fix the details and resubmit, which clears the dispute and puts it back in front of the creator to confirm.</p>
        <a href="${campaignsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review campaign</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co · Verified Sponsorship Reputation</p>
      </div>`,
  };
}

function campaignConfirmInviteEmail({ creatorName, description, confirmLink }) {
  return {
    subject: `${creatorName} wants you to confirm a sponsorship on Kitscore`,
    text: `${creatorName} has asked you to confirm a past sponsorship on Kitscore, the creator trust and verification platform.${description ? `\n\nWhat they described: ${description}` : ''}\n\nConfirm it here (no password needed, one click):\n${confirmLink}\n\nConfirming takes a few seconds and creates your free Kitscore sponsor account so you can browse verified creators too. Expires in 14 days.\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">${escapeHtml(creatorName)} wants you to confirm a sponsorship</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(creatorName)} has asked you to confirm a past sponsorship on Kitscore — the creator trust and verification platform.</p>
        ${description ? `
        <div style="background:#F5F8FF;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#2563EB;margin-bottom:4px">What they described</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(description)}</div>
        </div>` : ''}
        <a href="${confirmLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Confirm this sponsorship</a>
        <p style="color:#6B7280;font-size:13px">No password needed — confirming creates your free Kitscore sponsor account so you can also browse verified creators.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">This link expires in 14 days. If you weren't expecting this, you can ignore it. · Kitscore · kitscore.co</p>
      </div>`,
  };
}

function sponsorInviteCreatorEmail({ sponsorCompanyName, description, confirmLink }) {
  return {
    subject: `${sponsorCompanyName} wants you to confirm a sponsorship on Kitscore`,
    text: `${sponsorCompanyName} has asked you to confirm a past sponsorship on Kitscore, the creator trust and verification platform.${description ? `\n\nWhat they described: ${description}` : ''}\n\nConfirm it here (no password needed, one click):\n${confirmLink}\n\nConfirming takes a few seconds, creates your free Kitscore creator account, and starts your verified trust score with this campaign already counted. Expires in 14 days.\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">${escapeHtml(sponsorCompanyName)} wants you to confirm a sponsorship</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(sponsorCompanyName)} has asked you to confirm a past sponsorship on Kitscore — the creator trust and verification platform.</p>
        ${description ? `
        <div style="background:#F5F8FF;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#2563EB;margin-bottom:4px">What they described</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(description)}</div>
        </div>` : ''}
        <a href="${confirmLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Confirm this sponsorship</a>
        <p style="color:#6B7280;font-size:13px">No password needed — confirming creates your free Kitscore creator account with this campaign already verified on your trust score.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">This link expires in 14 days. If you weren't expecting this, you can ignore it. · Kitscore · kitscore.co</p>
      </div>`,
  };
}

module.exports = { sendEmail, teamInviteEmail, sponsorReceiptEmail, reportReadyEmail, refundConfirmationEmail, disputeNotificationEmail, campaignConfirmInviteEmail, sponsorInviteCreatorEmail };
