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
  admin: [
    { key: 'admin-evidence', href: 'admin-evidence.html', icon: 'ti-shield-check', label: 'Evidence Review' },
    { key: 'admin-signups', href: 'admin-signups.html', icon: 'ti-users', label: 'Signups' },
  ],
};

function renderSidebar(role, activeKey) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const items = NAV[role] || [];
  const roleLabel = role === 'sponsor' ? 'Sponsor' : role === 'admin' ? 'Admin' : 'Creator';
  const roleIcon  = role === 'sponsor' ? 'ti-building-store' : role === 'admin' ? 'ti-shield-lock' : 'ti-device-camera';
  const initials  = roleLabel.slice(0, 2).toUpperCase();
  mount.innerHTML = `
    <a href="/" class="nav-logo" style="display:flex;align-items:center;gap:8px;text-decoration:none;padding:2px 10px 18px;writing-mode:horizontal-tb;transform:none">
      <svg width="22" height="18" viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg">
        <rect fill="#2F5FE0" x="0" y="10" width="4" height="10"/>
        <rect fill="#2F5FE0" x="6" y="5" width="4" height="15"/>
        <rect fill="#2F5FE0" x="12" y="0" width="4" height="20"/>
        <circle fill="#2F5FE0" cx="20" cy="3" r="3"/>
      </svg>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#10151F">Kit<span style="color:#2F5FE0">score</span></span>
    </a>
    <div class="nav-role-badge">
      <i class="ti ${roleIcon}" aria-hidden="true"></i>
      <div class="nav-role-label">
        <span>${roleLabel} account</span>
        <span class="role-sub">${initials}</span>
      </div>
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
