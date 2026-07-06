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

function renderSidebar(role, activeKey, displayName) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const items = NAV[role] || [];
  const roleLabel = role === 'sponsor' ? 'Sponsor account' : role === 'admin' ? 'Admin account' : 'Creator account';
  const name = displayName || (typeof profile !== 'undefined' && profile ? profile.display_name : '') || '';
  const initial = name ? name.trim().charAt(0).toUpperCase() : (role === 'sponsor' ? 'S' : role === 'admin' ? 'A' : 'C');

  mount.innerHTML = `
    <a href="/" class="nav-logo" style="display:flex;align-items:center;gap:8px;text-decoration:none;writing-mode:horizontal-tb;transform:none">
      <svg width="22" height="18" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="10" width="4" height="10" fill="#2563EB"/>
        <rect x="6" y="5" width="4" height="15" fill="#2563EB"/>
        <rect x="12" y="0" width="4" height="20" fill="#2563EB"/>
        <circle cx="20" cy="3" r="3" fill="#2563EB"/>
      </svg>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#10151F">Kit<span style="color:#2563EB">score</span></span>
    </a>
    <div class="nav-account">
      <div class="nav-account-avatar">${initial}</div>
      <div class="nav-account-info">
        <div class="nav-account-name">${name || roleLabel}</div>
        <div class="nav-account-role">${roleLabel}</div>
      </div>
    </div>
    <nav class="sb-nav">
      ${items.map(i => `<a class="sb-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}"><i class="ti ${i.icon}" aria-hidden="true"></i>${i.label}</a>`).join('')}
    </nav>
    <div class="sb-signout-row">
      <a class="sb-item" href="#" id="sb-signout"><i class="ti ti-logout" aria-hidden="true"></i>Sign out</a>
    </div>
  `;
  document.getElementById('sb-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'auth.html';
  });
}
