// Pulse – inline SVG icons.
// Every icon is a single stroked path in `currentColor`, so it inherits the
// theme automatically. No colour ever appears that isn't from the palette.
const ICONS = {
  play:    '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause:   '<path d="M9 5.5v13M15 5.5v13"/>',
  next:    '<path d="M6 5.5l9 6.5-9 6.5zM18 5.5v13" fill="currentColor" stroke="none"/>',
  prev:    '<path d="M18 5.5l-9 6.5 9 6.5zM6 5.5v13" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M3 7h3.5l3 5 3-5H16M16 7l-2.5-2.5M16 7l-2.5 2.5M3 17h3.5l3-5M16 17l-2.5-2.5M16 17l-2.5 2.5M14 12h2"/>',
  repeat:  '<path d="M4 9a4 4 0 014-4h9M17 5l-2.5-2.5M17 5l-2.5 2.5M20 15a4 4 0 01-4 4H7M7 19l2.5 2.5M7 19l2.5-2.5"/>',
  heart:   '<path d="M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z"/>',
  heartOn: '<path d="M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z" fill="currentColor"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  minus:   '<path d="M5 12h14"/>',
  trash:   '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  queue:   '<path d="M4 7h12M4 12h12M4 17h8M18 15v6M15 18h6"/>',
  search:  '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  disc:    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
  clock:   '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  gear:    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3"/>',
  upload:  '<path d="M12 16V4M8 8l4-4 4 4M4 16v3h16v-3"/>',
  close:   '<path d="M6 6l12 12M18 6L6 18"/>',
  expand:  '<path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"/>',
  folder:  '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  edit:    '<path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4"/>',
  check:   '<path d="M5 13l4 4L19 7"/>',
  lyrics:  '<path d="M8 17a3 3 0 103 3V6l8-2v11a3 3 0 103 3"/>'
};

function svg(name, size = 20) {
  const body = ICONS[name] || ICONS.disc;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
         `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
         `aria-hidden="true">${body}</svg>`;
}
