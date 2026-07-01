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

module.exports = { sendEmail, teamInviteEmail, sponsorReceiptEmail, reportReadyEmail };
