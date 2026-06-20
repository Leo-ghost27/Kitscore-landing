// Renders the left sidebar into #sidebar-mount. Only links to pages that
// actually exist and work — see status doc for what's still missing
// (Compare, Campaigns, Evidence upload UI, Profile editing, Action plan).
const NAV = {
  creator: [
    { key: 'dashboard', href: 'dashboard.html', icon: 'ti-layout-dashboard', label: 'Dashboard' },
    { key: 'pricing-creator', href: 'pricing-creator.html', icon: 'ti-credit-card', label: 'Upgrade' },
  ],
  sponsor: [
    { key: 'directory', href: 'directory.html', icon: 'ti-users', label: 'Directory' },
    { key: 'pricing', href: 'pricing.html', icon: 'ti-credit-card', label: 'Plans' },
  ],
};

function renderSidebar(role, activeKey) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const items = NAV[role] || [];
  mount.innerHTML = `
    <div class="nav-logo">Kit<span>score</span></div>
    ${items.map(i => `<a class="sb-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}"><i class="ti ${i.icon}" aria-hidden="true"></i>${i.label}</a>`).join('')}
    <a class="sb-item" href="#" id="sb-signout" style="margin-top:auto"><i class="ti ti-logout" aria-hidden="true"></i>Sign out</a>
  `;
  document.getElementById('sb-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'auth.html';
  });
}
