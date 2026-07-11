// Renders the left sidebar into #sidebar-mount. Only links to pages that
// actually exist and work.
//
// Icons are inline SVG (not the tabler icon webfont) so they can never go
// missing/blank if that font CDN is slow, blocked, or fails to load.
const NAV_ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  campaigns: '<rect x="3" y="4" width="18" height="13"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  evidence: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  upgrade: '<path d="M12 2l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 9l6-1z"/>',
  directory: '<circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="8.5" r="2.6"/><path d="M2.3 20c0-3.4 2.8-6 6.2-6s6.2 2.6 6.2 6"/><path d="M14.8 14.2c3 .3 5.2 2.7 5.2 5.8"/>',
  watchlist: '<path d="M12 21s-7-4.3-9.4-8.4C1 9 2.4 5 6 5c2 0 3.4 1.2 4 2.3.6-1.1 2-2.3 4-2.3 3.6 0 5 4 3.4 7.6C19 16.7 12 21 12 21z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  compare: '<path d="M6 7h13M16 4l3 3-3 3"/><path d="M18 17H5M8 14l-3 3 3 3"/>',
  team: '<circle cx="9" cy="8" r="3.6"/><path d="M2.4 20.5c0-3.6 3-6.1 6.6-6.1s6.6 2.5 6.6 6.1"/><path d="M18.5 8.2h4M20.5 6.2v4"/>',
  plans: '<rect x="2" y="5" width="20" height="14"/><path d="M2 10h20"/>',
  'shield-check': '<path d="M12 2.5l7.5 3.5v5.4c0 4.6-3.2 7.5-7.5 9.1-4.3-1.6-7.5-4.5-7.5-9.1V6z"/><path d="M8.7 12l2.4 2.4 4.2-4.6"/>',
  users: '<circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="8.5" r="2.6"/><path d="M2.3 20c0-3.4 2.8-6 6.2-6s6.2 2.6 6.2 6"/><path d="M14.8 14.2c3 .3 5.2 2.7 5.2 5.8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

function navIcon(name) {
  const paths = NAV_ICONS[name] || NAV_ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const NAV = {
  creator: [
    { key: 'dashboard', href: 'dashboard.html', icon: 'dashboard', label: 'Dashboard' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'campaigns', label: 'Campaigns' },
    { key: 'evidence', href: 'evidence.html', icon: 'evidence', label: 'Evidence' },
    { key: 'profile', href: 'profile.html', icon: 'profile', label: 'Profile' },
    { key: 'pricing-creator', href: 'pricing-creator.html', icon: 'upgrade', label: 'Upgrade' },
  ],
  sponsor: [
    { key: 'directory', href: 'directory.html', icon: 'directory', label: 'Directory' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'campaigns', label: 'Campaigns' },
    { key: 'watchlist', href: 'watchlist.html', icon: 'watchlist', label: 'Watchlist' },
    { key: 'history', href: 'history.html', icon: 'history', label: 'History' },
    { key: 'compare', href: 'compare.html', icon: 'compare', label: 'Compare' },
    { key: 'team', href: 'team.html', icon: 'team', label: 'Team' },
    { key: 'pricing', href: 'pricing.html', icon: 'plans', label: 'Plans' },
  ],
  admin: [
    { key: 'admin-evidence', href: 'admin-evidence.html', icon: 'shield-check', label: 'Evidence Review' },
    { key: 'admin-signups', href: 'admin-signups.html', icon: 'users', label: 'Signups' },
    { key: 'admin-directory', href: 'admin-directory.html', icon: 'directory', label: 'Directory' },
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
      <svg width="22" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="19" width="5" height="7" rx="1" fill="#2563EB" opacity="0.5"/>
        <rect x="9" y="14" width="5" height="12" rx="1" fill="#2563EB" opacity="0.75"/>
        <rect x="16" y="10" width="5" height="16" rx="1" fill="#2563EB"/>
        <circle cx="23.5" cy="4.5" r="3.5" fill="#2563EB" stroke="#fff" stroke-width="1"/>
        <path d="M21.8 4.5l1.2 1.2L25.1 3.3" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
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
      ${items.map(i => `<a class="sb-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}">${navIcon(i.icon)}${i.label}</a>`).join('')}
    </nav>
    <div class="sb-signout-row">
      <a class="sb-item" href="#" id="sb-signout">${navIcon('logout')}Sign out</a>
    </div>
  `;
  document.getElementById('sb-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'auth.html';
  });
}
