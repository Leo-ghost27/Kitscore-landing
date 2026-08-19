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
  briefs: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  contracts: '<path d="M9 3h6l4 4v14H5V3z"/><path d="M9 3v4H5"/><path d="M8 13l2 2 4-4"/>',
  revenue: '<path d="M4 20V13"/><path d="M10 20V7"/><path d="M16 20v-9"/><path d="M22 20H2"/><path d="M18 4l3 3-3 3"/><path d="M21 7h-9"/>',
  inbox: '<path d="M3 12h4.5l1.5 3h6l1.5-3H21"/><rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 12L5 6h14l2 6"/>',
};

function navIcon(name) {
  const paths = NAV_ICONS[name] || NAV_ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const NAV = {
  creator: [
    { key: 'profile', href: 'profile.html', icon: 'profile', label: 'Profile' },
    { key: 'dashboard', href: 'dashboard.html', icon: 'dashboard', label: 'Dashboard' },
    { key: 'evidence', href: 'evidence.html', icon: 'evidence', label: 'Evidence' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'campaigns', label: 'Campaigns' },
    { key: 'briefs', href: 'briefs.html', icon: 'briefs', label: 'Briefs' },
    { key: 'contracts', href: 'contracts.html', icon: 'contracts', label: 'Contracts' },
    { key: 'roster', href: 'roster.html', icon: 'team', label: 'Roster' },
    { key: 'support', href: 'support.html', icon: 'inbox', label: 'Support' },
    { key: 'pricing-creator', href: 'pricing-creator.html', icon: 'upgrade', label: 'Upgrade' },
  ],
  sponsor: [
    { key: 'directory', href: 'directory.html', icon: 'directory', label: 'Directory' },
    { key: 'campaigns', href: 'campaigns.html', icon: 'campaigns', label: 'Campaigns' },
    { key: 'briefs', href: 'briefs.html', icon: 'briefs', label: 'Briefs' },
    { key: 'contracts', href: 'contracts.html', icon: 'contracts', label: 'Contracts' },
    { key: 'watchlist', href: 'watchlist.html', icon: 'watchlist', label: 'Watchlist' },
    { key: 'history', href: 'history.html', icon: 'history', label: 'History' },
    { key: 'compare', href: 'compare.html', icon: 'compare', label: 'Compare' },
    { key: 'team', href: 'team.html', icon: 'team', label: 'Team' },
    { key: 'profile-sponsor', href: 'profile-sponsor.html', icon: 'profile', label: 'Profile' },
    { key: 'support', href: 'support.html', icon: 'inbox', label: 'Support' },
    { key: 'pricing', href: 'pricing.html', icon: 'plans', label: 'Plans' },
  ],
  manager: [
    { key: 'agency', href: 'agency.html', icon: 'team', label: 'Roster' },
    { key: 'profile-manager', href: 'profile-manager.html', icon: 'profile', label: 'Profile' },
    { key: 'support', href: 'support.html', icon: 'inbox', label: 'Support' },
  ],
  admin: [
    { key: 'admin-evidence', href: 'admin-evidence.html', icon: 'shield-check', label: 'Evidence Review' },
    { key: 'admin-brand-safety', href: 'admin-brand-safety.html', icon: 'alert-triangle', label: 'Brand Safety Review' },
    { key: 'admin-disclosure-review', href: 'admin-disclosure-review.html', icon: 'alert-triangle', label: 'Disclosure Review' },
    { key: 'admin-signups', href: 'admin-signups.html', icon: 'users', label: 'Signups' },
    { key: 'admin-directory', href: 'admin-directory.html', icon: 'directory', label: 'Directory' },
    { key: 'admin-sponsors', href: 'admin-sponsors.html', icon: 'building', label: 'Sponsors' },
    { key: 'admin-contracts', href: 'admin-contracts.html', icon: 'contracts', label: 'Contracts Oversight' },
    { key: 'admin-escrow', href: 'admin-escrow.html', icon: 'contracts', label: 'Escrow Oversight' },
    { key: 'admin-refunds', href: 'admin-refunds.html', icon: 'contracts', label: 'Refund Issuance' },
    { key: 'admin-disputes', href: 'admin-disputes.html', icon: 'alert-triangle', label: 'Dispute Arbitration' },
    { key: 'admin-revenue', href: 'admin-revenue.html', icon: 'revenue', label: 'Revenue' },
    { key: 'admin-support', href: 'admin-support.html', icon: 'inbox', label: 'Support Inbox' },
    { key: 'admin-system', href: 'admin-system.html', icon: 'settings', label: 'System Health' },
  ],
};

function renderSidebar(role, activeKey, displayName) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  // Dark sidebar skin -- originally creator-only, extended to manager
  // pages too so agency.html/profile-manager.html match the rest of the
  // app's current visual language instead of the old plain/light sidebar.
  // Sponsor and admin keep the light sidebar for now.
  mount.classList.toggle('sidebar-dark', role === 'creator' || role === 'manager');
  const items = NAV[role] || [];
  const roleLabel = role === 'sponsor' ? 'Sponsor account' : role === 'admin' ? 'Admin account' : role === 'manager' ? 'Manager account' : 'Creator account';
  const name = displayName || (typeof profile !== 'undefined' && profile ? profile.display_name : '') || '';
  const initial = name ? name.trim().charAt(0).toUpperCase() : (role === 'sponsor' ? 'S' : role === 'admin' ? 'A' : role === 'manager' ? 'M' : 'C');
  const logoTextColor = (role === 'creator' || role === 'manager') ? '#EAF0FF' : '#10151F';

  mount.innerHTML = `
    <a href="/" class="nav-logo" style="display:flex;align-items:center;gap:8px;text-decoration:none;writing-mode:horizontal-tb;transform:none">
      <svg width="22" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="19" width="5" height="7" rx="1" fill="#2563EB" opacity="0.5"/>
        <rect x="9" y="14" width="5" height="12" rx="1" fill="#2563EB" opacity="0.75"/>
        <rect x="16" y="10" width="5" height="16" rx="1" fill="#2563EB"/>
        <circle cx="23.5" cy="4.5" r="3.5" fill="#2563EB" stroke="#fff" stroke-width="1"/>
        <path d="M21.8 4.5l1.2 1.2L25.1 3.3" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${logoTextColor}">Kit<span style="color:#2563EB">score</span></span>
    </a>
    <div class="nav-account">
      <div class="nav-account-avatar">${initial}</div>
      <div class="nav-account-info">
        <div class="nav-account-name">${name || roleLabel}</div>
        <div class="nav-account-role">${roleLabel}</div>
      </div>
    </div>
    <nav class="sb-nav">
      ${(role === 'creator' || role === 'manager') ? '<div class="sb-section">Workspace</div>' : ''}
      ${items.map(i => `<a class="sb-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}" data-nav-key="${i.key}">${navIcon(i.icon)}${i.label}<span class="sb-badge" data-badge-for="${i.key}" style="display:none"></span></a>`).join('')}
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

  if (role === 'admin') attachAdminBadges();
}

// Attention-needed counts on the sidebar, so an admin sees something needs
// looking at before they click into the page. "Needs attention" per tab
// means the same thing that tab's own page already treats as open/urgent
// -- this just surfaces it one level up so it's visible platform-wide,
// not only after you've already opened the page. Runs after the
// sidebar's initial render so it never blocks/delays the nav showing up
// -- badges just pop in a moment later, one query per tab, in parallel.
const NAV_STUCK_DAYS = 5;

async function attachAdminBadges() {
  await Promise.all([
    badgeEscrow(),
    badgeDisputes(),
    badgeContracts(),
    badgeSupport(),
  ]);
}

async function badgeEscrow() {
  try {
    const { data: contracts } = await sb.from('contracts')
      .select('escrow_status, disputed_at, admin_resolved_at, deliverable_submitted_at')
      .eq('escrow_status', 'held');
    if (!contracts) return;

    const needsAttention = contracts.filter(c => {
      const openDispute = c.disputed_at && !c.admin_resolved_at;
      const stuck = c.deliverable_submitted_at
        && (Date.now() - new Date(c.deliverable_submitted_at).getTime()) / 86400000 >= NAV_STUCK_DAYS;
      return openDispute || stuck;
    }).length;

    setBadge('admin-escrow', needsAttention);
  } catch (err) {
    // Badge is a nice-to-have on top of the page itself, which shows the
    // real numbers regardless -- fail silently rather than block the nav.
    console.error('admin badge fetch error (escrow):', err);
  }
}

// Same two queries admin-disputes.html itself runs (open campaigns.status
// = 'disputed', and pending_review sponsor_reports) -- summed into one
// badge since that page renders both queues in one view.
async function badgeDisputes() {
  try {
    const [{ count: campaignCount }, { count: reportCount }] = await Promise.all([
      sb.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
      sb.from('sponsor_reports').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review'),
    ]);
    setBadge('admin-disputes', (campaignCount || 0) + (reportCount || 0));
  } catch (err) {
    console.error('admin badge fetch error (disputes):', err);
  }
}

// Mirrors admin-contracts.html's own isFlagged (disputed_at set, not yet
// admin-resolved) OR isLegalRisk (clause scan flagged) -- a contract can
// match both, so this pulls the rows once and counts distinct ids rather
// than summing two separate counts.
async function badgeContracts() {
  try {
    const { data: contracts } = await sb.from('contracts')
      .select('id, disputed_at, admin_resolved_at, clause_scan_flagged');
    if (!contracts) return;

    const needsAttention = contracts.filter(c =>
      (c.disputed_at && !c.admin_resolved_at) || c.clause_scan_flagged === true
    ).length;

    setBadge('admin-contracts', needsAttention);
  } catch (err) {
    console.error('admin badge fetch error (contracts):', err);
  }
}

// Matches admin-support.html's own default "Open" tab filter.
async function badgeSupport() {
  try {
    const { count } = await sb.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open');
    setBadge('admin-support', count || 0);
  } catch (err) {
    console.error('admin badge fetch error (support):', err);
  }
}

function setBadge(navKey, count) {
  const el = document.querySelector(`.sb-badge[data-badge-for="${navKey}"]`);
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : String(count);
    el.style.display = 'inline-flex';
  } else {
    el.style.display = 'none';
  }
}
