'use strict';

/* ============================================================
   SIP OF DEATH — app shell: hash router, sticky header,
   search, currency selector, mini-cart drawer, footer.
   ============================================================ */

const App = {
  root: null,
  currentView: null,

  ROUTES: {
    '/': { view: () => Views.home(), title: 'Home' },
    '/shop': { view: (p) => Views.shop(p), title: 'Shop' },
    '/product': { view: (p) => Views.product(p), title: 'Product' },
    '/wishlist': { view: () => Views.wishlist(), title: 'Wishlist' },
    '/cart': { view: () => Views.cart(), title: 'Cart' },
    '/checkout': { view: () => Views.checkout(), title: 'Checkout' },
    '/success': { view: () => Views.success(), title: 'Order Confirmed' },
    '/transfer': { view: (p) => Views.transfer(p), title: 'Transfer Instructions' },
    '/payment-return': { view: (p) => Views.paymentReturn(p), title: 'Payment Status' },
    '/track': { view: (p) => Views.track(p), title: 'Track Order' },
    '/about': { view: () => Views.about(), title: 'Manifesto' },
    '/admin': { view: () => Views.admin(), title: 'Admin' },
  },

  boot() {
    this.root = $('[data-app]');
    document.body.insertAdjacentHTML('beforeend', this.drawerHTML());
    this.bindHeader();
    this.bindDrawer();
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('cart:change', () => this.syncBadges());
    document.addEventListener('wishlist:change', () => this.syncBadges());
    document.addEventListener('currency:change', () => this.rerender());
    document.addEventListener('store:hydrated', () => this.syncBadges());
    this.route();

    /* hydrate catalog from the API (non-blocking — snapshot renders first) */
    Store.hydrate().then((online) => {
      if (online) this.rerender();
      else console.warn('[sod] API unreachable — running on the cached catalog snapshot; orders will fail until the server is up.');
    });
  },

  /* ---------- routing ---------- */
  route() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query] = raw.split('?');
    const params = new URLSearchParams(query || '');
    const def = this.ROUTES[path] || { view: () => Views.notFound(), title: '404' };

    if (this.currentView && typeof this.currentView.unmount === 'function') {
      try { this.currentView.unmount(); } catch { /* view cleanup is best-effort */ }
    }

    const view = def.view(params);
    document.title = `${def.title} — ${BRAND.name}`;
    /* re-query the outlet every time: views may replace their own root
       node (admin console swaps itself for the dashboard shell) */
    const outlet = $('[data-outlet]');
    outlet.innerHTML = view.html;
    this.currentView = view;
    this.syncBadges();
    this.highlightNav(path);

    if (view.mount) view.mount(outlet);
    if (this.currentView !== view && typeof this.currentView === 'undefined') this.currentView = view;
    if (!raw.includes('#modal')) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  },

  rerender() { this.route(); },

  highlightNav(path) {
    $$('[data-nav]').forEach((a) => {
      const target = a.getAttribute('href').replace(/^#/, '');
      const on = path === target || (target !== '/' && path.startsWith(target));
      a.classList.toggle('is-on', on);
      a.setAttribute('aria-current', on ? 'page' : 'false');
    });
  },

  /* ---------- header ---------- */
  headerHTML() {
    return `
    <header class="hdr" data-hdr>
      <div class="hdr__announce">${flame('ic-xs')} FREE SHIPPING OVER ${fmt(STORE.freeShippingThreshold)} — CODE <strong>REAPER10</strong> FOR 10% OFF</div>
      <div class="hdr__main container">
        <button class="hdr__burger" data-action="open-menu" aria-label="Open menu" aria-expanded="false">${icon('menu')}</button>
        <a class="hdr__logo" href="#/" aria-label="${BRAND.name} — home">${logoSVG()}</a>
        <nav class="hdr__nav" aria-label="Primary">
          <a href="#/shop" data-nav>SHOP</a>
          <a href="#/shop?cat=dark" data-nav>DARK ROAST</a>
          <a href="#/shop?cat=medium" data-nav>MEDIUM</a>
          <a href="#/shop?cat=espresso" data-nav>ESPRESSO</a>
          <a href="#/shop?cat=merch" data-nav>MERCH</a>
          <a href="#/about" data-nav>MANIFESTO</a>
        </nav>
        <div class="hdr__tools">
          <div class="hdr__search" data-search-wrap>
            ${icon('search', 'hdr__search-ic')}
            <input type="search" placeholder="Search…" aria-label="Search products" data-hdr-search>
          </div>
          <label class="hdr__cur">
            <span class="visually-hidden">Currency</span>
            <select data-cur-select aria-label="Currency">
              ${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${curCode() === c.code ? 'selected' : ''}>${c.symbol} ${c.code}</option>`).join('')}
            </select>
          </label>
          <a class="hdr__iconbtn" href="#/wishlist" aria-label="Wishlist" data-wish-link>
            ${icon('heart')}<span class="badge" data-wish-badge hidden>0</span>
          </a>
          <button class="hdr__iconbtn" data-action="open-cart" aria-label="Open cart" aria-haspopup="dialog">
            ${icon('cart')}<span class="badge" data-cart-badge hidden>0</span>
          </button>
        </div>
      </div>
    </header>`;
  },

  bindHeader() {
    document.body.insertAdjacentHTML('afterbegin', this.headerHTML());
    const hdr = $('[data-hdr]');

    hdr.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action="open-menu"]');
      if (b) {
        const nav = $('.hdr__nav');
        const open = nav.classList.toggle('is-open');
        b.setAttribute('aria-expanded', open);
      }
    });

    const search = $('[data-hdr-search]');
    search.addEventListener('input', debounce((e) => {
      const q = e.target.value.trim();
      if (q.length >= 2) {
        location.hash = `#/shop?q=${encodeURIComponent(q)}`;
      } else if (location.hash.startsWith('#/shop')) {
        location.hash = '#/shop';
      }
    }, 350));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && search.value.trim()) {
        location.hash = `#/shop?q=${encodeURIComponent(search.value.trim())}`;
        search.blur();
      }
    });

    $('[data-cur-select]').addEventListener('change', (e) => setCurrency(e.target.value));
  },

  /* ---------- mini cart drawer ---------- */
  drawerHTML() {
    return `
    <div class="drawer" data-drawer aria-hidden="true">
      <div class="drawer__backdrop" data-drawer-close></div>
      <aside class="drawer__panel" role="dialog" aria-modal="true" aria-label="Shopping cart">
        <header class="drawer__head">
          <h2 class="drawer__title">THE <span class="text-accent">STASH</span></h2>
          <button class="drawer__x" data-drawer-close aria-label="Close cart">${icon('close')}</button>
        </header>
        <div class="drawer__body" data-drawer-body></div>
        <footer class="drawer__foot" data-drawer-foot></footer>
      </aside>
    </div>`;
  },

  bindDrawer() {
    this.drawerEl = $('[data-drawer]');
    this.lastFocusDrawer = null;

    document.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="open-cart"]')) this.openMiniCart();
      if (e.target.closest('[data-drawer-close]')) this.closeMiniCart();
    });

    document.body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawerEl.classList.contains('is-open')) this.closeMiniCart();
    });

    this.drawerEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const key = btn.dataset.key;
      const line = Store.state.cart.find((l) => l.key === key);
      if (btn.dataset.action === 'd-qty-dec' && line) Store.setQty(key, line.qty - 1);
      if (btn.dataset.action === 'd-qty-inc' && line) Store.setQty(key, line.qty + 1);
      if (btn.dataset.action === 'd-remove') Store.removeLine(key);
    });
  },

  openMiniCart() {
    this.renderDrawer();
    this.lastFocusDrawer = document.activeElement;
    this.drawerEl.classList.add('is-open');
    this.drawerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    $('.drawer__x', this.drawerEl).focus();
  },

  closeMiniCart() {
    this.drawerEl.classList.remove('is-open');
    this.drawerEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    if (this.lastFocusDrawer && document.contains(this.lastFocusDrawer)) {
      try { this.lastFocusDrawer.focus(); } catch { /* element may be gone */ }
    }
  },

  renderDrawer() {
    const body = $('[data-drawer-body]');
    const foot = $('[data-drawer-foot]');
    const lines = Store.state.cart;

    if (!lines.length) {
      body.innerHTML = `<div class="drawer__empty">${skullIcon('drawer__skull')}<p>Empty. A worthy grave.</p>
        <a class="btn btn--accent btn--sm" href="#/shop" data-drawer-close>SHOP NOW</a></div>`;
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = `${shippingProgress()}
      <div class="drawer__lines">${lines.map((l) => cartLineHTML(l, true)).join('')}</div>`;
    const q = Store.quote({});
    foot.innerHTML = `
      <div class="drawer__totals">
        <span>SUBTOTAL</span><strong>${fmt(q.sub)}</strong>
      </div>
      <p class="muted drawer__shipnote">Shipping &amp; fees calculated at checkout</p>
      <a class="btn btn--accent btn--block" href="#/checkout" data-drawer-close>CHECKOUT ${icon('arrow', 'ic-s')}</a>
      <a class="btn btn--ghost btn--block btn--sm" href="#/cart" data-drawer-close>VIEW FULL CART</a>`;
  },

  syncBadges() {
    const c = Store.cartCount();
    const w = Store.state.wishlist.length;
    const cb = $('[data-cart-badge]');
    const wb = $('[data-wish-badge]');
    if (cb) { cb.textContent = c; cb.hidden = c === 0; }
    if (wb) { wb.textContent = w; wb.hidden = w === 0; }
    if (this.drawerEl && this.drawerEl.classList.contains('is-open')) this.renderDrawer();
  },

  /* ---------- footer ---------- */
  footerHTML() {
    return `
    <footer class="ftr">
      <div class="container ftr__grid">
        <div class="ftr__brand">
          ${logoSVG('ftr__logo')}
          <p class="muted">${esc(BRAND.tagline)}<br>Est. ${BRAND.established}. Roasted past the point of politeness.</p>
          <p class="ftr__pay" aria-label="Accepted payments">
            <span class="paychip">VISA</span><span class="paychip">MASTERCARD</span><span class="paychip">COD</span>
          </p>
        </div>
        <nav class="ftr__col" aria-label="Shop links">
          <h3>SHOP</h3>
          <a href="#/shop?cat=dark">DARK ROAST</a>
          <a href="#/shop?cat=medium">MEDIUM ROAST</a>
          <a href="#/shop?cat=espresso">ESPRESSO</a>
          <a href="#/shop?cat=merch">MERCH &amp; GEAR</a>
        </nav>
        <nav class="ftr__col" aria-label="Support links">
          <h3>SUPPORT</h3>
          <a href="#/track">TRACK ORDER</a>
          <a href="#/cart">CART</a>
          <a href="#/wishlist">WISHLIST</a>
          <a href="#/about">MANIFESTO</a>
        </nav>
        <nav class="ftr__col" aria-label="Company links">
          <h3>COMPANY</h3>
          <a href="#/about">ABOUT</a>
          <a href="#/admin">REAPER CONSOLE</a>
        </nav>
      </div>
      <div class="ftr__legal container">
        <span>© ${new Date().getFullYear()} ${esc(BRAND.name)}. All rights reserved. No decaf.</span>
        <span class="ftr__x">${brushX('ftr__brush')}</span>
        <span>${esc(BRAND.tagline)}</span>
      </div>
    </footer>`;
  },
};

/* ---------- global delegated card actions ---------- */
/* Handles product-card weight/grind quick-picks and wishlist/add
   from any rendered card grid (home, shop, related, wishlist). */
document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-change]');
  if (!sel) return;
  const card = sel.closest('.card');
  if (!card) return;
  const p = Store.product(card.dataset.pid);
  if (!p) return;

  const weightSel = card.querySelector('[data-change="card-weight"]');
  const grindSel = card.querySelector('[data-change="card-grind"]');
  if (weightSel || grindSel) {
    const w = WEIGHTS.find((x) => x.g === +(weightSel?.value || 250));
    card.querySelector('[data-card-price]').textContent =
      fmt(Store.variantPrice(p, w ? w.g : 250));
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  const p = Store.product(card.dataset.pid);
  if (!p) return;

  if (btn.dataset.action === 'wish') {
    const added = Store.toggleWish(p.id);
    btn.classList.toggle('is-on', added);
    btn.setAttribute('aria-pressed', added);
    btn.innerHTML = icon(added ? 'heartFill' : 'heart', 'ic-s');
    toast(added ? 'Marked for the hit list' : 'Removed from hit list');
  }

  if (btn.dataset.action === 'card-add') {
    const weightSel = card.querySelector('[data-change="card-weight"]');
    const grindSel = card.querySelector('[data-change="card-grind"]');
    const res = Store.addToCart(p.id, {
      weightG: weightSel ? +weightSel.value : 250,
      grind: grindSel ? grindSel.value : 'Whole Bean',
      qty: 1,
    });
    if (res.ok) {
      App.openMiniCart();
      toast(`${p.name} added to cart`);
    } else {
      toast(res.error, 'err');
    }
  }
});

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  /* year-sensitive bits first, then shell */
  document.body.insertAdjacentHTML('beforeend', App.footerHTML());
  App.boot();
});
