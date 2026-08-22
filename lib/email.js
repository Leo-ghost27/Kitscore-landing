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

function brandSafetyFlagEmail({ creatorName, categories, rationale, reviewUrl }) {
  return {
    subject: `Kitscore admin: brand safety flag needs review -- ${creatorName}`,
    text: `A brand safety scan flagged ${creatorName} for: ${categories.join(', ')}.\n\nRationale: ${rationale}\n\nThis is held pending your review -- it has NOT changed their live score yet.\n\nReview it here: ${reviewUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Brand safety flag needs review</h2>
        <p style="color:#6B7280;font-size:14px">A scan flagged <strong>${escapeHtml(creatorName)}</strong> for: <strong>${escapeHtml(categories.join(', '))}</strong>.</p>
        <div style="background:#FEF3C7;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#92400E;margin-bottom:4px">Scan rationale</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(rationale)}</div>
        </div>
        <p style="color:#6B7280;font-size:13px">This is held pending your review — it has <strong>not</strong> changed their live score yet.</p>
        <a href="${reviewUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review now</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co · Verified Sponsorship Reputation</p>
      </div>`,
  };
}

function disclosureFlagEmail({ creatorName, rationale, reviewUrl }) {
  return {
    subject: `Kitscore admin: possible undisclosed paid content -- ${creatorName}`,
    text: `A disclosure check flagged ${creatorName}: YouTube's own paid-promotion flag is set on video(s) with no visible #ad/#sponsored/paid-partnership marker in the title or description.\n\nRationale: ${rationale}\n\nThis is a deterministic check against YouTube's own record plus a keyword match, not a legal compliance determination -- it has NOT changed their live score. Watch the linked video(s) yourself before deciding anything.\n\nReview it here: ${reviewUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Possible undisclosed paid content</h2>
        <p style="color:#6B7280;font-size:14px">YouTube's own paid-promotion flag is set on video(s) from <strong>${escapeHtml(creatorName)}</strong> with no visible disclosure marker found.</p>
        <div style="background:#FEF3C7;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#92400E;margin-bottom:4px">Scan rationale</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(rationale)}</div>
        </div>
        <p style="color:#6B7280;font-size:13px">This is pattern detection over text only, not a legal compliance call — it has <strong>not</strong> changed anything on their account. Watch the linked video(s) yourself before deciding.</p>
        <a href="${reviewUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review now</a>
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

function creatorInviteSponsorContractEmail({ creatorDisplayName, title, deliverables, compensation, confirmLink }) {
  return {
    subject: `${creatorDisplayName} wants you to sign a contract on Kitscore`,
    text: `${creatorDisplayName} has set up a contract on Kitscore, the creator trust and verification platform, for a deal you already agreed to: "${title}".\n\nDeliverables: ${deliverables}\nCompensation: ${compensation}\n\nReview and sign it here (no password needed, one click):\n${confirmLink}\n\nSigning takes a few seconds and creates your free Kitscore sponsor account -- nothing is binding until you actually sign, and you can review every term first. Expires in 14 days.\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">${escapeHtml(creatorDisplayName)} wants you to sign a contract</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(creatorDisplayName)} set up a contract on Kitscore for a deal you already agreed to — nothing is binding until you review and sign it yourself.</p>
        <div style="background:#F5F8FF;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#2563EB;margin-bottom:4px">${escapeHtml(title)}</div>
          <div style="font-size:14px;color:#1A1A1E;margin-bottom:8px"><strong>Deliverables:</strong> ${escapeHtml(deliverables)}</div>
          <div style="font-size:14px;color:#1A1A1E"><strong>Compensation:</strong> ${escapeHtml(compensation)}</div>
        </div>
        <a href="${confirmLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review and sign</a>
        <p style="color:#6B7280;font-size:13px">No password needed — this creates your free Kitscore sponsor account so you can review the full terms, sign, and fund escrow if you choose to.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">This link expires in 14 days. If you weren't expecting this, you can ignore it. · Kitscore · kitscore.co</p>
      </div>`,
  };
}

function escrowFundedEmail({ contractTitle, amountCents, sponsorCompanyName, contractsUrl }) {
  const dollars = (amountCents / 100).toFixed(2);
  return {
    subject: `$${dollars} is now held in escrow for "${contractTitle}"`,
    text: `${sponsorCompanyName} has funded your contract "${contractTitle}" -- $${dollars} is held in escrow.\n\nSubmit your deliverable when it's ready: ${contractsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">$${dollars} is now held in escrow</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(sponsorCompanyName)} has funded your contract <strong>${escapeHtml(contractTitle)}</strong>. The funds are held securely and will be released once you submit the deliverable and the sponsor approves it.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View contract</a>
      </div>`,
  };
}

function escrowDeliverableSubmittedEmail({ contractTitle, creatorName, contractsUrl }) {
  return {
    subject: `${creatorName} submitted the deliverable for "${contractTitle}"`,
    text: `${creatorName} has marked the deliverable as submitted for "${contractTitle}". Review and release payment: ${contractsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Deliverable submitted</h2>
        <p style="color:#6B7280;font-size:14px"><strong>${escapeHtml(creatorName)}</strong> has marked the deliverable as submitted for <strong>${escapeHtml(contractTitle)}</strong>. Review it, then release the held payment when you're satisfied.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review and release payment</a>
      </div>`,
  };
}

function escrowReleasedEmail({ contractTitle, amountCents, contractsUrl }) {
  const dollars = (amountCents / 100).toFixed(2);
  return {
    subject: `$${dollars} released to you for "${contractTitle}"`,
    text: `$${dollars} has been released to your connected account for "${contractTitle}". It should arrive on your usual Stripe payout schedule.\n\n${contractsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">$${dollars} released to you</h2>
        <p style="color:#6B7280;font-size:14px">Payment for <strong>${escapeHtml(contractTitle)}</strong> has been released to your connected Stripe account. It'll arrive on your usual payout schedule.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View contract</a>
      </div>`,
  };
}

function escrowDisputedCreatorEmail({ contractTitle, disputeReason, contractsUrl }) {
  return {
    subject: `A sponsor flagged a problem with "${contractTitle}"`,
    text: `The sponsor on "${contractTitle}" has flagged a problem with the deliverable instead of releasing payment.\n\nTheir reason: ${disputeReason}\n\nThe payment stays held in escrow -- it hasn't been refunded to them. Kitscore is reviewing and will resolve this; you don't need to do anything right now, but you're welcome to add context on the contract page.\n\n${contractsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">A sponsor flagged a problem</h2>
        <p style="color:#6B7280;font-size:14px">The sponsor on <strong>${escapeHtml(contractTitle)}</strong> has flagged a problem with the deliverable instead of releasing payment.</p>
        <div style="background:#FDECEC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#B42318;margin-bottom:4px">Sponsor's reason</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(disputeReason)}</div>
        </div>
        <p style="color:#6B7280;font-size:13px"><strong>The payment stays held in escrow</strong> — it has not been refunded. Kitscore is reviewing this and will resolve it directly; you don't need to do anything right now, but you're welcome to add context on the contract page.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View contract</a>
      </div>`,
  };
}

function escrowDisputedAdminEmail({ contractTitle, sponsorCompanyName, creatorName, disputeReason, amountCents, adminUrl }) {
  const dollars = (amountCents / 100).toFixed(2);
  return {
    subject: `Escrow dispute: "${contractTitle}" ($${dollars} held)`,
    text: `${sponsorCompanyName} flagged a problem on "${contractTitle}" with ${creatorName} instead of releasing the $${dollars} held in escrow.\n\nReason: ${disputeReason}\n\nFunds stay held until you resolve it (release, refund, or partial).\n\n${adminUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Escrow dispute needs review</h2>
        <p style="color:#6B7280;font-size:14px"><strong>${escapeHtml(sponsorCompanyName)}</strong> flagged a problem on <strong>${escapeHtml(contractTitle)}</strong> with <strong>${escapeHtml(creatorName)}</strong> instead of releasing the <strong>$${dollars}</strong> held in escrow.</p>
        <div style="background:#FDECEC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#B42318;margin-bottom:4px">Sponsor's reason</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(disputeReason)}</div>
        </div>
        <p style="color:#6B7280;font-size:13px">Funds stay held until you resolve it — release, refund, or a partial split of both.</p>
        <a href="${adminUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review in Escrow Oversight</a>
      </div>`,
  };
}

function escrowStuckNudgeEmail({ contractTitle, creatorName, heldDays, contractsUrl }) {
  return {
    subject: `Reminder: "${contractTitle}" has been ready for ${heldDays} days`,
    text: `${creatorName} submitted the deliverable for "${contractTitle}" ${heldDays} days ago and payment is still held in escrow.\n\nIf everything looks good, release it. If there's a problem, use "Report a problem" instead of letting it sit -- that gets Kitscore involved rather than leaving ${creatorName} waiting indefinitely.\n\n${contractsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Still waiting on you</h2>
        <p style="color:#6B7280;font-size:14px"><strong>${escapeHtml(creatorName)}</strong> submitted the deliverable for <strong>${escapeHtml(contractTitle)}</strong> <strong>${heldDays} days ago</strong>, and payment is still held in escrow.</p>
        <p style="color:#6B7280;font-size:13px">If everything looks good, release it. If there's a problem, use "Report a problem" on the contract instead of leaving it — that brings Kitscore in to help resolve it rather than leaving ${escapeHtml(creatorName)} waiting indefinitely.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Review contract</a>
      </div>`,
  };
}

// Admin flagged a contract's terms (from admin-contracts.html's "Flag a
// problem", either freeform or on top of an automated clause-scan hit).
// Two audiences, two different jobs to do:
//
// - The SPONSOR is the one who can actually fix anything -- contract
//   terms are locked once sent (see fn_validate_contract_changes), so
//   the only path to a corrected contract is voiding this one and
//   sending a new one with the fixed terms. If the contract is already
//   fully signed, voiding isn't available at all (see canVoid in
//   app/contracts.html) -- that email branch points to support instead
//   of a dead-end "void" instruction.
// - The CREATOR gets a shorter, reassuring version: what was flagged,
//   that Kitscore is already on it with the sponsor, and that they don't
//   need to do anything. They can't act on contract terms either way.
//
// scanConcerns is the clause scan's own verbatim-quoted concerns, if the
// flag coincides with an automated hit (may be empty -- plenty of flags
// are admin's own read of a manually-reported problem, not scan-driven).
function contractFlaggedSponsorEmail({ contractTitle, creatorName, adminNote, scanConcerns, canVoid, contractsUrl }) {
  const concernsHtml = (scanConcerns || []).map(t => `<div style="font-style:italic;font-size:12.5px;color:#6B7280;margin-top:6px">"${escapeHtml(t)}"</div>`).join('');
  const nextStep = canVoid
    ? `<p style="color:#6B7280;font-size:13px">To fix this: <strong>void this contract</strong> and send a new one with corrected terms. ${escapeHtml(creatorName)} will see the same flag on their side, so a corrected resend won't come as a surprise.</p>`
    : `<p style="color:#6B7280;font-size:13px">This contract already has funded escrow, so it can't be voided until that's resolved. Reach Kitscore support, or use Escrow Oversight's release/refund tools first.</p>`;
  return {
    subject: `Kitscore flagged a problem with "${contractTitle}"`,
    text: `Kitscore reviewed "${contractTitle}" with ${creatorName} and flagged a problem with the terms.\n\n${adminNote}${scanConcerns?.length ? `\n\nFlagged language:\n${scanConcerns.map(c => `"${c}"`).join('\n')}` : ''}\n\n${canVoid ? `To fix this: void this contract and send a new one with corrected terms.` : `This contract already has funded escrow, so it can't be voided until that's resolved -- reach Kitscore support, or use Escrow Oversight's release/refund tools first.`}\n\n${contractsUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Kitscore flagged a problem with this contract</h2>
        <p style="color:#6B7280;font-size:14px">We reviewed <strong>${escapeHtml(contractTitle)}</strong> with <strong>${escapeHtml(creatorName)}</strong> and found something worth fixing before this goes further.</p>
        <div style="background:#FDECEC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#B42318;margin-bottom:4px">What we found</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(adminNote)}</div>
          ${concernsHtml}
        </div>
        ${nextStep}
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View contract</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">This isn't legal advice -- it's a pattern flag worth acting on. Kitscore · kitscore.co</p>
      </div>`,
  };
}

function contractFlaggedCreatorEmail({ contractTitle, sponsorCompanyName, adminNote, scanConcerns, contractsUrl }) {
  const concernsHtml = (scanConcerns || []).map(t => `<div style="font-style:italic;font-size:12.5px;color:#6B7280;margin-top:6px">"${escapeHtml(t)}"</div>`).join('');
  return {
    subject: `Kitscore is following up on your contract with ${sponsorCompanyName}`,
    text: `Kitscore reviewed your contract "${contractTitle}" with ${sponsorCompanyName} and flagged a problem with the terms.\n\n${adminNote}${scanConcerns?.length ? `\n\nFlagged language:\n${scanConcerns.map(c => `"${c}"`).join('\n')}` : ''}\n\nWe're following up with ${sponsorCompanyName} directly -- you don't need to do anything right now. If you have more context, you're welcome to add it on the contract page.\n\n${contractsUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Kitscore is following up on this contract</h2>
        <p style="color:#6B7280;font-size:14px">We reviewed <strong>${escapeHtml(contractTitle)}</strong> with <strong>${escapeHtml(sponsorCompanyName)}</strong> and flagged a problem with the terms.</p>
        <div style="background:#FDECEC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#B42318;margin-bottom:4px">What we found</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(adminNote)}</div>
          ${concernsHtml}
        </div>
        <p style="color:#6B7280;font-size:13px">We're following up with ${escapeHtml(sponsorCompanyName)} directly to get this fixed. You don't need to do anything right now -- if you have more context, you're welcome to add it on the contract page.</p>
        <a href="${contractsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View contract</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co</p>
      </div>`,
  };
}

// Weekly re-pitch nudge (cron-repitch-nudges.js). Surfaces a completed,
// mutually-confirmed campaign from 5-7 months back as a prompt to check
// back in with that sponsor -- turns the existing Performance Recap
// artifact from passive to active. No claim about the sponsor wanting
// to hear from them again -- just a factual reminder plus a link, same
// "creator decides" framing as draft-pitch/counter-offer-assist.
function repitchNudgeEmail({ creatorName, sponsorCompanyName, campaignName, monthsAgo, briefsUrl }) {
  return {
    subject: `Worth a check-in? Your ${sponsorCompanyName} campaign was ${monthsAgo} months ago`,
    text: `Hi ${creatorName},\n\nIt's been about ${monthsAgo} months since "${campaignName}" with ${sponsorCompanyName} wrapped up. That's a completed, verified campaign on your profile now -- often a good moment to check back in with a sponsor you already have a track record with.\n\nNo pressure either way -- just flagging the timing.\n\n${briefsUrl}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Worth a check-in?</h2>
        <p style="color:#6B7280;font-size:14px">It's been about <strong>${monthsAgo} months</strong> since <strong>${escapeHtml(campaignName)}</strong> with <strong>${escapeHtml(sponsorCompanyName)}</strong> wrapped up -- a completed, verified campaign now sitting on your profile.</p>
        <p style="color:#6B7280;font-size:13px">That's often a good moment to check back in with a sponsor you already have a track record with. No pressure either way -- just flagging the timing.</p>
        <a href="${briefsUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View your profile</a>
      </div>`,
  };
}

// Fires when a creator on a sponsor's watchlist flips to "open for work".
// Factual, not pushy -- no urgency language, no "act now", just what
// changed and a link. Same restrained tone as repitchNudgeEmail above.
function watchlistAvailabilityEmail({ sponsorName, creatorName, evaluateUrl }) {
  const greeting = sponsorName ? `Hi ${sponsorName},` : 'Hi,';
  return {
    subject: `${creatorName} is now open for work`,
    text: `${greeting}\n\n${creatorName}, who you saved on Kitscore, just marked themselves open for work.\n\n${evaluateUrl}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">${escapeHtml(creatorName)} is now open for work</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(creatorName)}, who you saved on Kitscore, just marked themselves open for work.</p>
        <a href="${evaluateUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">View their profile</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co</p>
      </div>`,
  };
}

// Sponsor asks a creator to get verified on Kitscore before they'll
// decide -- whether the creator already has a claimed profile or not.
// Honest about the express/Pro distinction: only says a Pro creator's
// response is prioritized WHEN a real prioritization mechanism exists
// to back that up (see the NOTE in request-verification.js -- right
// now that's not built, so isPro only changes copy tone here, never a
// speed claim).
function verificationRequestEmail({ creatorName, sponsorCompanyName, targetContext, isExistingCreator, isPro, actionLink }) {
  const greeting = creatorName ? `Hi ${creatorName},` : 'Hi,';
  const actionText = isExistingCreator ? 'Update your Kitscore profile' : 'Claim your free Kitscore profile';
  return {
    subject: `${sponsorCompanyName} wants to see your Kitscore before they decide`,
    text: `${greeting}\n\n${sponsorCompanyName} is evaluating you for a possible sponsorship and asked to see a verified Kitscore profile before deciding.${targetContext ? `\n\nContext from them: ${targetContext}` : ''}\n\n${actionText}: ${actionLink}\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">${escapeHtml(sponsorCompanyName)} wants to see your Kitscore</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(sponsorCompanyName)} is evaluating you for a possible sponsorship and asked to see a verified Kitscore profile before deciding.</p>
        ${targetContext ? `
        <div style="background:#F5F8FF;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:12px;color:#2563EB;margin-bottom:4px">Context from them</div>
          <div style="font-size:14px;color:#1A1A1E">${escapeHtml(targetContext)}</div>
        </div>` : ''}
        <a href="${actionLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">${actionText}</a>
        <p style="color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">Kitscore · kitscore.co</p>
      </div>`,
  };
}

// Manager Seat, Phase 1 -- see manager_seat_phase1_invites_and_links
// migration comment. Deliberately doesn't claim any specific access
// grant in the copy (no "you'll be able to submit evidence for X" list)
// since Phase 1 is the link only -- what a manager can actually DO is
// Phase 2, not built yet.
function managerInviteEmail({ creatorName, acceptLink }) {
  return {
    subject: `${creatorName} invited you as their manager on Kitscore`,
    text: `${creatorName} has invited you to be linked as their manager on Kitscore.\n\nAccept: ${acceptLink}\n\nExpires in 14 days.`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">You're invited as ${escapeHtml(creatorName)}'s manager</h2>
        <p style="color:#6B7280;font-size:14px">${escapeHtml(creatorName)} has invited you to be linked as their manager on Kitscore, the creator trust and verification platform.</p>
        <a href="${acceptLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Accept invite</a>
        <p style="color:#9CA3AF;font-size:12px">This link expires in 14 days. The creator can revoke your access at any time.</p>
      </div>`,
  };
}

// Agency sub-seat invite -- inherits the owner's entire roster access
// on accept. Copy is deliberately plain about that scope (no vague
// "join the team" framing) since it's a real access grant, not a
// social invite.
function agencyStaffInviteEmail({ ownerName, acceptLink }) {
  return {
    subject: `${ownerName} invited you to their Kitscore agency`,
    text: `${ownerName} has invited you as staff on their Kitscore agency account. Once accepted, you'll have the same access to their creator roster that they do.\n\nAccept: ${acceptLink}\n\nExpires in 14 days.`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">You're invited to ${escapeHtml(ownerName)}'s agency</h2>
        <p style="color:#6B7280;font-size:14px">Once accepted, you'll have the same access to their creator roster that they do — the same permissions, nothing more.</p>
        <a href="${acceptLink}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Accept invite</a>
        <p style="color:#9CA3AF;font-size:12px">This link expires in 14 days. ${escapeHtml(ownerName)} can revoke your access at any time.</p>
      </div>`,
  };
}

function trialEndingEmail({ planLabel, price, endDate }) {
  return {
    subject: `Your Kitscore ${planLabel} trial ends in 3 days`,
    text: `Your ${planLabel} free trial ends on ${endDate}. Your card will be charged ${price} automatically unless you cancel before then.\n\nManage your subscription: https://kitscore.co/app/team.html\n\nKitscore`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="font-size:18px;color:#1A1A1E">Your ${planLabel} trial ends in 3 days</h2>
        <p style="color:#6B7280;font-size:14px">Your free trial ends on <strong>${endDate}</strong>. After that, your card will be charged <strong>${price}</strong> automatically — no action needed if you want to continue.</p>
        <a href="https://kitscore.co/app/team.html" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Manage subscription</a>
        <p style="color:#9CA3AF;font-size:12px">Want to cancel instead? You can do that from the same page, at no charge, any time before your trial ends.</p>
      </div>`,
  };
}

module.exports = { sendEmail, teamInviteEmail, sponsorReceiptEmail, reportReadyEmail, refundConfirmationEmail, disputeNotificationEmail, campaignConfirmInviteEmail, sponsorInviteCreatorEmail, creatorInviteSponsorContractEmail, brandSafetyFlagEmail, disclosureFlagEmail, escrowFundedEmail, escrowDeliverableSubmittedEmail, escrowReleasedEmail, escrowDisputedCreatorEmail, escrowDisputedAdminEmail, escrowStuckNudgeEmail, contractFlaggedSponsorEmail, contractFlaggedCreatorEmail, repitchNudgeEmail, verificationRequestEmail, managerInviteEmail, agencyStaffInviteEmail, watchlistAvailabilityEmail, trialEndingEmail };
