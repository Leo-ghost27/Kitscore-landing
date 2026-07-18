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
  bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3 3-5 7-5s7 2 7 5"/><circle cx="18" cy="8" r="2.5"/><path d="M16 13c2.5 0 5 1.5 6 4"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  code: '<path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/>',
  layout: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  'user-contact': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  heart: '<path d="M19.5 12.6l-7.5 7.5-7.5-7.5a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6z"/>',
  'heart-filled': '<path d="M19.5 12.6l-7.5 7.5-7.5-7.5a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6z" fill="currentColor" stroke="none"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/>',
  'lock-open': '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  link: '<path d="M9 15l6-6"/><path d="M11 6l.4-.4a4 4 0 0 1 5.7 5.7l-2 2"/><path d="M13 18l-.4.4a4 4 0 0 1-5.7-5.7l2-2"/>',
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
