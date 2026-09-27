'use strict';

/* ============================================================
   SIP OF DEATH — SVG art system
   Skull-cup emblem, brush strokes, steam, icon set and
   product packet renders. Pure vector — no binary assets.
   ============================================================ */

/* --- Skull-cup emblem (the mark) --------------------------- */
function emblemInner() {
  return `
  <!-- steam -->
  <path d="M24 14c-2-3 2-5 0-8" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M32 12c-2.4-3.4 2.4-5.4 0-9" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M40 14c-2-3 2-5 0-8" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>
  <!-- cup -->
  <path d="M12 24h40l-4.5 22a6 6 0 0 1-5.9 4.8H22.4A6 6 0 0 1 16.5 46L12 24Z"
        stroke="var(--bone)" stroke-width="3" fill="rgba(245,245,245,.04)"/>
  <path d="M52 27c5.5-.8 8.5 1.6 8.5 5.2 0 3.8-3.4 6.4-9.3 6.6" stroke="var(--bone)" stroke-width="3" stroke-linecap="round"/>
  <!-- skull -->
  <path d="M32 30c6.2 0 10 4.1 10 9.2 0 3.4-1.6 5.4-3.2 6.6l.5 3.9c.1.9-.6 1.7-1.5 1.7h-11.6c-.9 0-1.6-.8-1.5-1.7l.5-3.9c-1.6-1.2-3.2-3.2-3.2-6.6C22 34.1 25.8 30 32 30Z"
        fill="var(--bone)"/>
  <ellipse cx="27.6" cy="39.6" rx="2.7" ry="3.1" fill="var(--bg)"/>
  <ellipse cx="36.4" cy="39.6" rx="2.7" ry="3.1" fill="var(--bg)"/>
  <path d="M30 47h4M32 44v3.4" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="32" cy="34.4" r="1.5" fill="var(--bg)" opacity=".85"/>`;
}

function emblemSVG(cls = '') {
  return `<svg class="emblem ${cls}" viewBox="0 0 64 64" fill="none" aria-hidden="true">${emblemInner()}</svg>`;
}

/* --- Text logo lockup -------------------------------------- */
function logoSVG(cls = '') {
  return `
<svg class="logo ${cls}" viewBox="0 0 190 44" fill="none" aria-hidden="true">
  <g transform="translate(2 4) scale(.6)">${emblemInner()}</g>
  <text x="46" y="20" class="logo-line1">SIP OF</text>
  <text x="46" y="38" class="logo-line2">DEATH</text>
</svg>`;
}

/* --- Misc brand marks -------------------------------------- */
function brushX(cls = '') {
  return `
<svg class="${cls}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <path d="M6 6c8 6 18 16 27 27M33 5C24 13 14 23 6 33" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"/>
</svg>`;
}

function flame(cls = '') {
  return `
<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 2c1 4-4 6-4 11a6 6 0 0 0 12 0c0-2.5-1-4.5-2.5-6-.3 1.6-1.2 2.6-2.5 3 .8-2.8-.3-6-3-8Z" fill="var(--accent)"/>
</svg>`;
}

function bolt(cls = '') {
  return `
<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z" fill="var(--accent)"/>
</svg>`;
}

function skullIcon(cls = '') {
  return `
<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5.2 3.2 6.4V20c0 1.1.9 2 2 2h5.6c1.1 0 2-.9 2-2v-3.6C18.5 15.2 20 13 20 10a8 8 0 0 0-8-8Z" fill="var(--bone)"/>
  <ellipse cx="9" cy="11" rx="2" ry="2.4" fill="var(--bg)"/>
  <ellipse cx="15" cy="11" rx="2" ry="2.4" fill="var(--bg)"/>
  <path d="M12 14.2v2.6M10.4 18.4h3.2" stroke="var(--bg)" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;
}

/* --- Standard UI icons ------------------------------------- */
const ICONS = {
  cart: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18h8.9a2 2 0 0 0 2-1.6L22 8H6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="21" r="1.4" fill="currentColor"/><circle cx="18" cy="21" r="1.4" fill="currentColor"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.5C6.5 16.5 3 13.3 3 9.6 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.6C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.6c0 3.7-3.5 6.9-9 10.9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  heartFill: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5C6.5 16.5 3 13.3 3 9.6 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.6C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.6c0 3.7-3.5 6.9-9 10.9Z" fill="currentColor"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9 2.9-6Z" fill="currentColor"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/><circle cx="17" cy="18" r="1.6" fill="currentColor"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7.5 12 12l8-4.5M12 12v9" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c1.5-3.8 4.5-6 8-6s6.5 2.2 8 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z" stroke="currentColor" stroke-width="1.8"/></svg>`,
};

function icon(name, cls = '') {
  const raw = ICONS[name] || ICONS.box;
  return raw.replace('<svg ', `<svg class="icon ${cls}" `);
}

/* ============================================================
   Product art — stylized coffee bags (dark roast red / medium
   bone / espresso amber), matching the brand reference.
   ============================================================ */
function packetArt(product, cls = '') {
  const tint = product.art || '#B80000';
  /* split long names onto two lines so they fit the bag */
  const words = (product.shortName || product.name || '').toUpperCase().split(/\s+/);
  let nameLines;
  if (words.length >= 2) nameLines = [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
  else if (words[0] && words[0].length > 9) nameLines = [words[0].slice(0, Math.ceil(words[0].length / 2)), words[0].slice(Math.ceil(words[0].length / 2))];
  else nameLines = [words[0] || ''];
  const nameStartY = nameLines.length > 1 ? 140 : 146;
  const nameSVG = nameLines.map((l, i) =>
    `<text x="80" y="${nameStartY + i * 11}" text-anchor="middle" class="pk-name">${l}</text>`).join('');
  const nameShift = 0;
  const roast = (product.roastLabel || product.roast || '').toUpperCase();
  const notes = (product.notes || []).slice(0, 3).join(' · ').toUpperCase();
  const skullLight = product.art === '#C9A36A' ? '#E8C9A0' : '#F5F5F5';
  return `
<svg class="packet ${cls}" viewBox="0 0 160 210" role="img" aria-label="${nameLines.join(' ')} — ${roast} coffee bag" preserveAspectRatio="xMidYMax meet">
  <defs>
    <linearGradient id="pg-${product.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c1c1c"/>
      <stop offset=".5" stop-color="#111111"/>
      <stop offset="1" stop-color="#050505"/>
    </linearGradient>
    <radialGradient id="ps-${product.id}" cx=".5" cy=".18" r="1">
      <stop offset="0" stop-color="rgba(255,255,255,.14)"/>
      <stop offset=".55" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <!-- bag body -->
  <path d="M28 30h104v168a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V30Z" fill="url(#pg-${product.id})" stroke="#2a2a2a" stroke-width="1.5"/>
  <!-- top seal -->
  <path d="M24 18h112v14H24z" fill="#161616" stroke="#2a2a2a" stroke-width="1.5"/>
  <path d="M30 24h100" stroke="#3a3a3a" stroke-width="2" stroke-dasharray="4 4"/>
  <!-- side brush slash -->
  <path d="M28 96c14 8 20 26 16 62l-12 6-4-4V96Z" fill="${tint}" opacity=".82"/>
  <path d="M132 40c4 30 4 66-2 96l4 2V40h-2Z" fill="${tint}" opacity=".35"/>
  <!-- sheen -->
  <path d="M28 30h104v168a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V30Z" fill="url(#ps-${product.id})"/>
  <!-- mini emblem -->
  <g transform="translate(58 40) scale(.7)">
    <path d="M20 12c-1.6-2.4 1.6-4 0-6" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M28 10c-1.9-2.7 1.9-4.3 0-7" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M10 20h36l-4 18a5 5 0 0 1-4.9 4H18.9A5 5 0 0 1 14 38l-4-18Z" stroke="${skullLight}" stroke-width="2.4" fill="none"/>
    <path d="M28 25c4.8 0 7.6 3.1 7.6 7 0 2.6-1.2 4.1-2.4 5l.4 2.9c.1.7-.5 1.3-1.2 1.3H22.6c-.7 0-1.3-.6-1.2-1.3l.4-2.9c-1.2-.9-2.4-2.4-2.4-5 0-3.9 2.8-7 7.6-7Z" fill="${skullLight}"/>
    <ellipse cx="25.3" cy="32.4" rx="1.9" ry="2.2" fill="#111"/>
    <ellipse cx="32.7" cy="32.4" rx="1.9" ry="2.2" fill="#111"/>
  </g>
  <!-- brand -->
  <text x="80" y="86" text-anchor="middle" class="pk-brand">SIP OF</text>
  <text x="80" y="104" text-anchor="middle" class="pk-brand pk-brand2">DEATH</text>
  <path d="M46 110h68" stroke="${tint}" stroke-width="2"/>
  <text x="80" y="121" text-anchor="middle" class="pk-co">COFFEE CO.</text>
  <!-- name -->
  ${nameSVG}
  <text x="80" y="${158 + nameShift}" text-anchor="middle" class="pk-roast">${roast}</text>
  <text x="80" y="${170 + nameShift}" text-anchor="middle" class="pk-notes">${notes}</text>
  <!-- footer chips -->
  <rect x="30" y="178" width="42" height="14" rx="7" fill="none" stroke="#4a4a4a"/>
  <text x="51" y="187.5" text-anchor="middle" class="pk-chip">WHOLE BEAN</text>
  <text x="124" y="187.5" text-anchor="middle" class="pk-chip pk-chip2">250G</text>
</svg>`;
}

/* --- Hero smoke / beans backdrop --------------------------- */
function heroBackdrop(cls = '') {
  let beans = '';
  const pts = [[30,86],[44,90],[58,85],[72,91],[90,86],[108,90],[124,86],[140,91],[52,94],[86,95],[120,94],[16,89],[150,88],[66,88],[100,89]];
  for (const [x, y] of pts) {
    beans += `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.8" fill="#1e120b" transform="rotate(${(x * 37) % 60 - 30} ${x} ${y})"/>
              <path d="M${x - 2.2} ${y}q2.2 1 4.4 0" stroke="#2e1a10" stroke-width=".7" fill="none"/>`;
  }
  let smoke = '';
  for (let i = 0; i < 5; i++) {
    const x = 22 + i * 29;
    smoke += `<path d="M${x} 82c-3-9 4-14 1-23s3-13 0-21" stroke="rgba(245,245,245,${0.05 + i * 0.012})" stroke-width="6" stroke-linecap="round" fill="none" filter="url(#hb-blur)"/>`;
  }
  return `
<svg class="${cls}" viewBox="0 0 160 100" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><filter id="hb-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
  ${smoke}${beans}
</svg>`;
}
