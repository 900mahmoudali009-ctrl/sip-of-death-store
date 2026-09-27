'use strict';

/* ============================================================
   SIP OF DEATH — store state (server-backed)
   Catalog: hydrated from GET /api/catalog (cached snapshot in
   localStorage keeps the shop usable offline / before first load).
   Cart + wishlist: local (localStorage).
   Orders: created on the SERVER — it re-prices the cart and
   reserves stock; the client copy is a cache for display.
   ============================================================ */

const Api = {
  base() {
    return (localStorage.getItem('sod.api') || (typeof API_BASE !== 'undefined' ? API_BASE : '')).replace(/\/$/, '');
  },

  async req(method, path, body) {
    const token = localStorage.getItem('sod.adminToken') || '';
    const resp = await fetch(`${this.base()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await resp.json(); } catch { /* non-JSON */ }
    if (!resp.ok) {
      const err = new Error(data && (data.error || (data.errors && data.errors.join('; '))) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  },
};

const Store = {
  state: {
    cart: [],     // { key, productId, name, weightG, grind, unitPrice, qty }
    wishlist: [],
    orders: [],   // cached copies of this browser's orders (offline display)
    promo: null,
    online: false,
  },

  /* ---------- persistence (local cache) ---------- */
  load() {
    try {
      const cart = JSON.parse(localStorage.getItem(LS_KEYS.cart) || '[]');
      if (Array.isArray(cart)) this.state.cart = cart.filter((l) => l && l.productId && l.qty > 0);
    } catch { /* corrupted cart — start fresh */ }
    try {
      const w = JSON.parse(localStorage.getItem(LS_KEYS.wishlist) || '[]');
      if (Array.isArray(w)) this.state.wishlist = w;
    } catch { /* ignore */ }
    try {
      const o = JSON.parse(localStorage.getItem(LS_KEYS.orders) || '[]');
      if (Array.isArray(o)) this.state.orders = o;
    } catch { /* ignore */ }
    /* offline catalog snapshot */
    try {
      const snap = JSON.parse(localStorage.getItem('sod.catalog.v1') || 'null');
      if (snap && Array.isArray(snap.products) && snap.products.length) {
        Object.assign(window, {
          PRODUCTS: snap.products,
          CATEGORIES: snap.categories,
          SHIPPING_ZONES: snap.zones,
          PAYMENT_METHODS: (snap.paymentMethods && snap.paymentMethods.length)
            ? snap.paymentMethods
            : (typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []),
        });
      }
    } catch { /* ignore */ }
  },

  save() {
    localStorage.setItem(LS_KEYS.cart, JSON.stringify(this.state.cart));
    localStorage.setItem(LS_KEYS.wishlist, JSON.stringify(this.state.wishlist));
    localStorage.setItem(LS_KEYS.orders, JSON.stringify(this.state.orders.slice(0, 30)));
  },

  /* ---------- server hydration ---------- */
  async hydrate() {
    try {
      const data = await Api.req('GET', '/api/catalog');
      Object.assign(window, {
        PRODUCTS: data.products,
        CATEGORIES: data.categories,
        SHIPPING_ZONES: data.zones,
        PAYMENT_METHODS: data.paymentMethods || (typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []),
      });
      if (data.config) Object.assign(STORE, data.config);
      localStorage.setItem('sod.catalog.v1', JSON.stringify({
        products: data.products, categories: data.categories, zones: data.zones,
        paymentMethods: data.paymentMethods || [],
      }));
      this.state.online = true;
    } catch {
      this.state.online = false; // keep snapshot from load()
    }
    document.dispatchEvent(new CustomEvent('store:hydrated'));
    return this.state.online;
  },

  refreshStock: null, // assigned a debounced re-hydrator below

  /* ---------- catalog helpers ---------- */
  product(pid) {
    return PRODUCTS.find((p) => p.id === pid) || null;
  },

  isCoffee(p) {
    return p && p.categoryId !== 'merch';
  },

  variantPrice(p, weightG) {
    const w = WEIGHTS.find((x) => x.g === weightG) || WEIGHTS[0];
    return Math.round(p.basePrice * w.mult);
  },

  /* ---------- cart (local) ---------- */
  addToCart(productId, { weightG = 250, grind = 'Whole Bean', qty = 1 } = {}) {
    const p = this.product(productId);
    if (!p) return { ok: false, error: 'Product not found' };
    if (p.stock <= 0) return { ok: false, error: 'Out of stock' };

    const lineKey = `${productId}|${weightG}|${grind}`;
    const existing = this.state.cart.find((l) => l.key === lineKey);
    const unitPrice = this.isCoffee(p) ? this.variantPrice(p, weightG) : p.basePrice;
    const maxQty = Math.max(p.stock, 1);

    if (existing) {
      existing.qty = Math.min(existing.qty + qty, maxQty);
    } else {
      this.state.cart.push({
        key: lineKey,
        productId,
        name: p.name,
        weightG: this.isCoffee(p) ? weightG : null,
        grind: this.isCoffee(p) ? grind : null,
        unitPrice,
        qty: Math.min(qty, maxQty),
      });
    }
    this.save();
    document.dispatchEvent(new CustomEvent('cart:change'));
    return { ok: true };
  },

  setQty(key, qty) {
    const line = this.state.cart.find((l) => l.key === key);
    if (!line) return;
    const p = this.product(line.productId);
    const max = p ? Math.max(p.stock, 1) : 99;
    line.qty = Math.max(1, Math.min(qty, max));
    this.save();
    document.dispatchEvent(new CustomEvent('cart:change'));
  },

  removeLine(key) {
    this.state.cart = this.state.cart.filter((l) => l.key !== key);
    this.save();
    document.dispatchEvent(new CustomEvent('cart:change'));
  },

  clearCart() {
    this.state.cart = [];
    this.state.promo = null;
    this.save();
    document.dispatchEvent(new CustomEvent('cart:change'));
  },

  cartCount() {
    return this.state.cart.reduce((n, l) => n + l.qty, 0);
  },

  /* ---------- wishlist (local) ---------- */
  toggleWish(productId) {
    const i = this.state.wishlist.indexOf(productId);
    if (i >= 0) this.state.wishlist.splice(i, 1);
    else this.state.wishlist.push(productId);
    this.save();
    document.dispatchEvent(new CustomEvent('wishlist:change'));
    return i < 0;
  },

  inWish(productId) {
    return this.state.wishlist.includes(productId);
  },

  /* ---------- promo (validated again server-side at submit) ---------- */
  PROMOS: {
    REAPER10: { type: 'percent', value: 10, min: 0 },
    DEATH15: { type: 'percent', value: 15, min: 1000 },
    BONES50: { type: 'flat', value: 50, min: 500 },
  },

  applyPromo(code) {
    const key = String(code || '').trim().toUpperCase();
    const promo = this.PROMOS[key];
    if (!promo) return { ok: false, error: 'Unknown curse. Code not valid.' };
    const sub = this.subtotal();
    if (sub < promo.min) return { ok: false, error: `Needs a minimum subtotal of ${fmt(promo.min)}` };
    this.state.promo = { code: key, ...promo };
    this.save();
    return { ok: true };
  },

  clearPromo() {
    this.state.promo = null;
    this.save();
  },

  /* ---------- totals & shipping (display only — server re-prices) ---------- */
  subtotal() {
    return this.state.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  },

  discount() {
    const promo = this.state.promo;
    if (!promo) return 0;
    const sub = this.subtotal();
    if (sub < promo.min) return 0;
    return promo.type === 'percent' ? Math.round(sub * promo.value / 100) : Math.min(promo.value, sub);
  },

  shippingFor(zoneId, opts = {}) {
    if (opts.freeShipping) return 0;
    const zone = SHIPPING_ZONES.find((z) => z.id === zoneId);
    if (!zone) return null;
    return zone.fee;
  },

  zoneById(zoneId) {
    return SHIPPING_ZONES.find((z) => z.id === zoneId) || null;
  },

  quote(opts = {}) {
    const sub = this.subtotal();
    const discount = this.discount();
    const afterDiscount = sub - discount;
    const freeShipping = afterDiscount >= STORE.freeShippingThreshold;
    let shipping = 0;
    let zone = null;
    if (opts.zoneId) {
      zone = this.zoneById(opts.zoneId);
      shipping = this.shippingFor(opts.zoneId, { freeShipping });
    }
    const codFee = opts.paymentMethod === 'cod' ? STORE.codFee : 0;
    const total = Math.max(0, afterDiscount + shipping + codFee);
    return { sub, discount, afterDiscount, shipping, codFee, total, freeShipping, zone, zoneId: opts.zoneId || null };
  },

  freeShippingRemaining() {
    const after = this.subtotal() - this.discount();
    return Math.max(0, STORE.freeShippingThreshold - after);
  },

  /* ---------- orders (SERVER) ---------- */

  /* Submit the checkout to the server. Returns:
     { order, payment } — payment.redirectUrl set for card orders. */
  async submitOrder(details) {
    const payload = {
      paymentMethod: details.paymentMethod,
      customer: { name: details.name, email: details.email, phone: details.phone },
      zoneId: details.zoneId,
      address: details.address,
      city: details.city,
      notes: details.notes || '',
      promo: this.state.promo ? this.state.promo.code : undefined,
      items: this.state.cart.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        weightG: l.weightG,
        grind: l.grind,
      })),
    };

    const data = await Api.req('POST', '/api/orders', payload);
    const order = data.order;

    /* cache for offline display + dedupe tracking */
    this.state.orders = this.state.orders.filter((o) => o.number !== order.number);
    this.state.orders.unshift(this._cacheOrder(order));
    this.clearCart();
    return { order, payment: data.payment || null };
  },

  _cacheOrder(order) {
    return JSON.parse(JSON.stringify(order)); // detach from live catalog objects
  },

  /* Tracking: server is the source of truth; falls back to cache. */
  async lookupOrder(number, email) {
    try {
      const data = await Api.req('GET', `/api/orders/${encodeURIComponent(number)}?email=${encodeURIComponent(email)}`);
      const idx = this.state.orders.findIndex((o) => o.number === data.order.number);
      if (idx >= 0) this.state.orders[idx] = this._cacheOrder(data.order);
      else this.state.orders.unshift(this._cacheOrder(data.order));
      this.save();
      return data.order;
    } catch (err) {
      return this.findOrder(number, email); // offline fallback
    }
  },

  /* Sync a card order after the gateway redirect. */
  async syncPaymentStatus(number) {
    try {
      const st = await Api.req('GET', `/api/payments/status/${encodeURIComponent(number)}`);
      if (st.status === 'paid') this.markPaid(number);
      else if (st.status === 'failed') this.markFailed(number);
      return st;
    } catch {
      return null;
    }
  },

  findOrder(number, email) {
    const num = String(number || '').trim().toUpperCase();
    const em = String(email || '').trim().toLowerCase();
    return this.state.orders.find((o) =>
      o.number.toUpperCase() === num &&
      o.customer.email.toLowerCase() === em) || null;
  },

  /* Local lifecycle mirrors (server state arrives via lookup/sync). */
  markPaid(number) {
    const order = this.state.orders.find((o) => o.number === number);
    if (!order || order.status !== 'pending_payment') return order || null;
    order.status = 'paid';
    order.timeline = order.timeline || [];
    order.timeline.push({ status: 'paid', at: new Date().toISOString() });
    this.save();
    return order;
  },

  markFailed(number) {
    const order = this.state.orders.find((o) => o.number === number);
    if (!order || order.status !== 'pending_payment') return order || null;
    order.status = 'failed';
    order.timeline = order.timeline || [];
    order.timeline.push({ status: 'failed', at: new Date().toISOString() });
    this.save();
    return order;
  },

  cancelOrder(order) {
    if (!['placed', 'paid', 'pending_payment', 'failed'].includes(order.status)) return false;
    order.status = 'cancelled';
    order.timeline = order.timeline || [];
    order.timeline.push({ status: 'cancelled', at: new Date().toISOString() });
    this.save();
    /* best-effort server cancel for logged-in order (needs email match on track) */
    Api.req('GET', `/api/orders/${order.number}?email=${encodeURIComponent(order.customer.email)}`)
      .then((d) => d.order.status === 'placed' || d.order.status === 'paid'
        ? Api.req('POST', `/api/admin/orders/${order.number}/status`, { status: 'cancelled', detail: 'customer cancel (unauthenticated best-effort)' }).catch(() => {})
        : null)
      .catch(() => {});
    return true;
  },
};

/* ---------- admin API (server-backed with graceful fallback) ---------- */

const AdminApi = {
  async login(username, password) {
    const data = await Api.req('POST', '/api/admin/login', { username, password });
    localStorage.setItem('sod.adminToken', data.token);
    localStorage.setItem('sod.adminUser', data.username || 'admin');
    return true;
  },

  logout() {
    localStorage.removeItem('sod.adminToken');
    localStorage.removeItem('sod.adminUser');
  },

  authed() {
    return !!localStorage.getItem('sod.adminToken');
  },

  async orders(status) {
    const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    const data = await Api.req('GET', `/api/admin/orders${q}`);
    return data.orders;
  },

  async setStatus(number, status, detail) {
    const data = await Api.req('POST', `/api/admin/orders/${encodeURIComponent(number)}/status`, { status, detail });
    return data.order;
  },

  async setStock(productId, stock) {
    const data = await Api.req('PUT', `/api/admin/products/${encodeURIComponent(productId)}/stock`, { stock });
    /* update local catalog copy so the storefront reflects it */
    const p = PRODUCTS.find((x) => x.id === productId);
    if (p) p.stock = data.product.stock;
    document.dispatchEvent(new CustomEvent('store:hydrated'));
    return data.product;
  },

  async setZone(id, { fee, etaDays }) {
    const data = await Api.req('PUT', `/api/admin/zones/${encodeURIComponent(id)}`, { fee, etaDays });
    const z = SHIPPING_ZONES.find((x) => x.id === id);
    if (z) Object.assign(z, data.zone);
    return data.zone;
  },

  async stats() {
    const data = await Api.req('GET', '/api/admin/stats');
    return data.stats;
  },

  username() {
    return localStorage.getItem('sod.adminUser') || 'admin';
  },

  async changePassword(currentPassword, newPassword) {
    const data = await Api.req('POST', '/api/admin/change-password', { currentPassword, newPassword });
    return data;
  },

  /* ---- products CRUD ---- */
  async createProduct(payload) {
    const data = await Api.req('POST', '/api/admin/products', payload);
    return data.product;
  },

  async updateProduct(id, patch) {
    const data = await Api.req('PATCH', `/api/admin/products/${encodeURIComponent(id)}`, patch);
    return data.product;
  },

  async deleteProduct(id) {
    const data = await Api.req('DELETE', `/api/admin/products/${encodeURIComponent(id)}`);
    return data.product;
  },

  async restoreProduct(id) {
    const data = await Api.req('POST', `/api/admin/products/${encodeURIComponent(id)}/restore`);
    return data.product;
  },

  async uploadImage(productId, file) {
    const token = localStorage.getItem('sod.adminToken') || '';
    const resp = await fetch(`${Api.base()}/api/admin/products/${encodeURIComponent(productId)}/images`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const err = new Error((data && data.error) || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return data.image;
  },

  async deleteImage(productId, imageId) {
    const data = await Api.req('DELETE', `/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`);
    return data;
  },

  async setProductImages(productId, images) {
    const data = await Api.req('PUT', `/api/admin/products/${encodeURIComponent(productId)}/images`, { images });
    return data.product;
  },

  /* ---- settings ---- */
  async savePaymentMethods(paymentMethods) {
    const data = await Api.req('PUT', '/api/admin/settings/payments', { paymentMethods });
    return data.paymentMethods;
  },

  async saveStoreDefaults(patch) {
    const data = await Api.req('PUT', '/api/admin/settings/store', patch);
    return data.storeDefaults;
  },
};

document.addEventListener('DOMContentLoaded', () => Store.load());
