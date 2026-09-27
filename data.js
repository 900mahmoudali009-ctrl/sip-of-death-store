'use strict';

/* ============================================================
   SIP OF DEATH — frontend-only data: merch art, storage keys.
   Catalog itself lives in catalog.js (shared with the API).
   ============================================================ */

/* Product art used for merch items (icons instead of bags) */
const MERCH_ART = {
  'mug-skull': `<svg viewBox="0 0 160 120" aria-hidden="true"><path d="M30 26h72v46a26 26 0 0 1-26 26H56a26 26 0 0 1-26-26V26Z" stroke="#F5F5F5" stroke-width="4" fill="rgba(245,245,245,.05)"/><path d="M102 34h10a12 12 0 0 1 0 24h-10" stroke="#F5F5F5" stroke-width="4" fill="none"/><path d="M40 8c-2-3 2-5 0-8M52 10c-2-3 2-5 0-8" stroke="#B80000" stroke-width="2.6" stroke-linecap="round" transform="translate(0 16)"/><g transform="translate(44 34) scale(.55)">${emblemInner()}</g></svg>`,
  'cup-black': `<svg viewBox="0 0 160 120" aria-hidden="true"><path d="M56 18h48l6 84a8 8 0 0 1-8 9H58a8 8 0 0 1-8-9l6-84Z" stroke="#F5F5F5" stroke-width="4" fill="rgba(245,245,245,.05)"/><rect x="50" y="8" width="60" height="10" rx="5" stroke="#F5F5F5" stroke-width="3.5" fill="none"/><path d="M66 40c-3-5 3-8 0-13M80 38c-3-5 3-8 0-13" stroke="#B80000" stroke-width="2.6" stroke-linecap="round"/><path d="M60 92h40" stroke="#B80000" stroke-width="4"/></svg>`,
  'tee-no-mercy': `<svg viewBox="0 0 160 120" aria-hidden="true"><path d="M56 14 80 8l24 6 22 12-8 18-12-5v58H54V39l-12 5-8-18 22-12Z" stroke="#F5F5F5" stroke-width="3.5" fill="rgba(245,245,245,.04)" stroke-linejoin="round"/><g transform="translate(62 40) scale(.5)">${emblemInner()}</g></svg>`,
  'sticker-pack': `<svg viewBox="0 0 160 120" aria-hidden="true"><circle cx="52" cy="52" r="26" stroke="#F5F5F5" stroke-width="3.5" fill="rgba(245,245,245,.05)"/><g transform="translate(38 38) scale(.45)">${emblemInner()}</g><circle cx="112" cy="46" r="20" stroke="#B80000" stroke-width="3.5" fill="none"/><path d="M104 38c5 5 11 11 17 17M120 38c-5 5-11 11-17 17" stroke="#B80000" stroke-width="3"/><rect x="88" y="76" width="44" height="26" rx="6" stroke="#F5F5F5" stroke-width="3.5" fill="none" transform="rotate(-8 110 89)"/></svg>`,
};

/* Storage keys (server-backed pieces are cached here for offline reads) */
const LS_KEYS = {
  cart: 'sod.cart.v1',
  wishlist: 'sod.wishlist.v1',
  orders: 'sod.orders.v1',
  session: 'sod.session.v1',
  currency: 'sod.currency.v1',
  admin: 'sod.admin.v1',
};
