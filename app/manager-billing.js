// manager-billing.js
//
// Shared across every manager-facing page (agency.html, pipeline.html,
// profile-manager.html): the Manager/Agency access gate and the checkout
// call. Kept in one file so the checkout fetch logic (session token,
// error shapes, success/cancel handling) isn't copy-pasted three times
// and drifts -- it was already duplicated once between profile-manager.html
// and pricing-creator.html before this.
//
// Access model: subscription_status ('trialing' | 'active' | anything
// else) gates whether the workspace is usable AT ALL. plan ('manager' |
// 'agency') gates which FEATURES are available once unlocked (see
// fn_manager_is_agency() server-side -- this client-side check is a UX
// convenience, not the security boundary; the real enforcement lives in
// the RPCs and RLS policies).

function managerHasAccess(manager) {
  return !!manager && ['trialing', 'active'].includes(manager.subscription_status);
}

function managerTrialDaysLeft(manager) {
  if (!manager?.trial_ends_at) return null;
  const ms = new Date(manager.trial_ends_at) - new Date();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// Mirrors profile-manager.html's original upgrade() -- same checkout
// route, same error-handling shape. `product` is 'manager' or 'agency',
// matching billing-checkout.js's PRODUCT_CONFIG keys. btnEl/msgEl are
// optional; pass them to get inline disabled/loading/error states.
async function startManagerCheckout(product, btnEl, msgEl) {
  if (msgEl) msgEl.innerHTML = '';
  const originalLabel = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Redirecting…'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      if (msgEl) msgEl.innerHTML = '<div class="msg error">You need to be signed in to continue. Try refreshing the page.</div>';
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalLabel; }
      return;
    }
    const res = await fetch('/api/billing?action=checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ product }),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      if (msgEl) msgEl.innerHTML = `<div class="msg error">Server did not return a valid response (status ${res.status}).</div>`;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalLabel; }
      return;
    }
    if (!res.ok || !json.url) {
      if (msgEl) msgEl.innerHTML = `<div class="msg error">Could not start checkout: ${escapeHtml(json.error || 'unknown error')}</div>`;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalLabel; }
      return;
    }
    window.location.href = json.url;
  } catch (err) {
    if (msgEl) msgEl.innerHTML = `<div class="msg error">Checkout request failed: ${escapeHtml(err.message)}</div>`;
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalLabel; }
  }
}

// Full-page paywall for the workspace pages (agency.html, pipeline.html).
// NOT used on profile-manager.html, which must stay reachable regardless
// of subscription_status -- it's where the trial/reactivate CTA lives, so
// it can't itself be locked behind the thing it unlocks.
function renderManagerPaywall(mountEl, manager) {
  const trialAvailable = !manager?.trial_used;
  const hadAnAccount = !!manager?.subscription_status && manager.subscription_status !== 'inactive';
  mountEl.innerHTML = `
    <div class="pf-card" style="max-width:460px;margin:60px auto;text-align:center;padding:40px 32px">
      <div style="font-family:'Fraunces',serif;font-size:20px;font-weight:600;margin-bottom:10px">
        ${trialAvailable ? 'Start your 14-day free trial' : hadAnAccount ? 'Your trial has ended' : 'Reactivate your Manager plan'}
      </div>
      <div style="font-size:13px;color:var(--pf-ink-soft,#5B6472);line-height:1.6;margin-bottom:22px;font-family:'Inter',sans-serif">
        ${trialAvailable
          ? 'Track deals through Pipeline, manage your roster, and see deadlines and payouts across everyone you represent. No card charged for 14 days.'
          : 'Your Manager plan subscription is no longer active. Reactivate to get back into your Roster, Pipeline, and everything else on your workspace.'}
      </div>
      <button class="pf-btn-save" id="paywallBtn" style="padding:12px 28px" onclick="startManagerCheckout('manager', document.getElementById('paywallBtn'), document.getElementById('paywallMsg'))">
        ${trialAvailable ? 'Start free trial' : 'Reactivate — $49/mo'}
      </button>
      <div id="paywallMsg"></div>
    </div>`;
}
