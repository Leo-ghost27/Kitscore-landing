// Shared inline-SVG icon set. Used instead of an icon webfont so icons can
// never render blank/missing if a font CDN is slow, blocked, or fails.
const ICON_PATHS = {
  'rosette-discount-check': '<path d="M12 2l2.2 1.3 2.5-.5 1 2.3 2.3 1-.5 2.5L21 11l-1.3 2.2.5 2.5-2.3 1-1 2.3-2.5-.5L12 20l-2.2-1.3-2.5.5-1-2.3-2.3-1 .5-2.5L3 11l1.3-2.2-.5-2.5 2.3-1 1-2.3 2.5.5z"/><path d="M9 12l2 2 4-4"/>',
  'file-check': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9.5 14.7l1.4 1.4 3-3.2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'user-circle': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.3 19a6 6 0 0 1 11.4 0"/>',
  'info-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>',
  'alert-triangle': '<path d="M12 3.2l9.5 17H2.5z"/><path d="M12 9.5v4"/><path d="M12 16.7h.01"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  'shield-half': '<path d="M12 2.3l7.3 3.4v5.2c0 4.5-3.1 7.3-7.3 8.8-4.2-1.5-7.3-4.3-7.3-8.8V5.7z"/><path d="M12 2.3v17.4"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  photo: '<rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22 19.5 10.5H13z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6.2 6.2 0 0 1 12 0"/><path d="M15.5 5.5a3.2 3.2 0 0 1 0 6.2"/><path d="M17.5 14a6.2 6.2 0 0 1 4 5.7"/>',
  'layout-grid': '<rect x="3" y="3" width="7.5" height="7.5"/><rect x="13.5" y="3" width="7.5" height="7.5"/><rect x="3" y="13.5" width="7.5" height="7.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5"/>',
  'arrows-exchange': '<path d="M4 12.5a8 8 0 0 1 14.8-4.2"/><path d="M18.8 3.5v5h-5"/><path d="M20 11.5a8 8 0 0 1-14.8 4.2"/><path d="M5.2 20.5v-5h5"/>',
  'message-dots': '<path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z"/><path d="M8 10.2h.01"/><path d="M12 10.2h.01"/><path d="M16 10.2h.01"/>',
};

function svgIcon(name, opts) {
  opts = opts || {};
  const paths = ICON_PATHS[name] || '';
  const size = opts.size || 16;
  const stroke = opts.stroke || 'currentColor';
  const sw = opts.strokeWidth || 2;
  const style = opts.style ? ` style="${opts.style}"` : '';
  const cls = opts.class ? ` class="${opts.class}"` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${style}${cls}>${paths}</svg>`;
}
