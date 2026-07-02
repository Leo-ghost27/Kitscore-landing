// Renders the left sidebar into #sidebar-mount. Only links to pages that
// actually exist and work.
const NAV = {
  creator: [
    { key: 'dashboard', href: 'dashboard.html', icon: 'ti-layout-dashboard', label: 'Dashboard' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'ti-flag', label: 'Campaigns' },
    { key: 'evidence', href: 'evidence.html', icon: 'ti-file-upload', label: 'Evidence' },
    { key: 'profile', href: 'profile.html', icon: 'ti-user', label: 'Profile' },
    { key: 'pricing-creator', href: 'pricing-creator.html', icon: 'ti-credit-card', label: 'Upgrade' },
  ],
  sponsor: [
    { key: 'directory', href: 'directory.html', icon: 'ti-users', label: 'Directory' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'ti-flag', label: 'Campaigns' },
    { key: 'watchlist', href: 'watchlist.html', icon: 'ti-heart', label: 'Watchlist' },
    { key: 'history', href: 'history.html', icon: 'ti-history', label: 'History' },
    { key: 'compare', href: 'compare.html', icon: 'ti-arrows-exchange', label: 'Compare' },
    { key: 'team', href: 'team.html', icon: 'ti-user-plus', label: 'Team' },
    { key: 'pricing', href: 'pricing.html', icon: 'ti-credit-card', label: 'Plans' },
  ],
};

function renderSidebar(role, activeKey) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const items = NAV[role] || [];
  const roleLabel = role === 'sponsor' ? 'Sponsor' : 'Creator';
  const roleIcon  = role === 'sponsor' ? 'ti-building-store' : 'ti-device-camera';
  mount.innerHTML = `
    <a href="/" class="nav-logo" style="display:flex;align-items:center;gap:8px;text-decoration:none;padding:10px 10px 16px;writing-mode:horizontal-tb;transform:none">
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="16" width="5" height="10" rx="1" fill="#2563EB" opacity="0.5"/>
        <rect x="9" y="10" width="5" height="16" rx="1" fill="#2563EB" opacity="0.75"/>
        <rect x="16" y="4" width="5" height="20" rx="1" fill="#2563EB"/>
        <circle cx="23.5" cy="5.5" r="4.5" fill="#2563EB" stroke="#fff" stroke-width="1"/>
        <path d="M21.3 5.5l1.5 1.5L25.5 4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span style="font-size:14px;font-weight:800;letter-spacing:-0.02em;color:#0F172A">Kit<span style="color:#2563EB">score</span></span>
    </a>
    <div class="nav-role-badge">
      <i class="ti ${roleIcon}" aria-hidden="true"></i>
      ${roleLabel} account
    </div>
    ${items.map(i => `<a class="sb-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}"><i class="ti ${i.icon}" aria-hidden="true"></i>${i.label}</a>`).join('')}
    <a class="sb-item" href="#" id="sb-signout" style="margin-top:auto"><i class="ti ti-logout" aria-hidden="true"></i>Sign out</a>
  `;
  document.getElementById('sb-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'auth.html';
  });
}
