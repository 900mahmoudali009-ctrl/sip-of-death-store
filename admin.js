'use strict';

/* ============================================================
   SIP OF DEATH — admin dashboard (API-backed CMS)
   Auth: POST /api/admin/login {username, password} → bearer
   token (12h server-side session, localStorage).
   Tabs: ORDERS · PRODUCTS (full CRUD + image upload) ·
   STOCK (quick price/stock edits) · ZONES · PAYMENTS · SETTINGS.
   First run: admin / ChangeMe123! — change it in SETTINGS.
   ============================================================ */

const Admin = {
  mode: 'server', // or 'local' (offline demo)
  tab: 'orders',
  orderFilter: 'all',
  zoneEdits: null,
  prodSearch: '',
  editor: null,   /* product editor state {id, saving, error} */
  pmDraft: null,  /* payment methods draft before save */

  isAuthed() {
    return AdminApi.authed() || (this.mode === 'local' && !!localStorage.getItem(LS_KEYS.admin));
  },

  async login(username, password) {
    try {
      await AdminApi.login(username, password);
      this.mode = 'server';
      return true;
    } catch (err) {
      /* offline fallback: local demo creds (API unreachable) */
      if (String(err.message).includes('fetch') || err.status === undefined) {
        if (username === 'admin' && password === 'ChangeMe123!') {
          this.mode = 'local';
          localStorage.setItem(LS_KEYS.admin, JSON.stringify({ user: 'admin', at: Date.now() }));
          return true;
        }
      }
      return false;
    }
  },

  logout() {
    AdminApi.logout();
    localStorage.removeItem(LS_KEYS.admin);
    Admin.editor = null;
    Admin.pmDraft = null;
  },

  STATUS_LABEL: {
    placed: 'PLACED', paid: 'PAID', pending_payment: 'PENDING PAYMENT',
    failed: 'FAILED', roasting: 'ROASTING',
    shipped: 'SHIPPED', delivered: 'DELIVERED', cancelled: 'CANCELLED',
  },

  /* Local fallback stats (demo mode only) */
  localStats() {
    const live = Store.state.orders.filter((o) => !['cancelled', 'pending_payment', 'failed'].includes(o.status));
    const revenue = live.reduce((s, o) => s + o.totals.total, 0);
    return {
      orders: live.length,
      revenue,
      aov: live.length ? Math.round(revenue / live.length) : 0,
      units: live.reduce((s, o) => s + o.items.reduce((n, l) => n + l.qty, 0), 0),
      byStatus: Store.state.orders.reduce((m, o) => (m[o.status] = (m[o.status] || 0) + 1, m), {}),
      lowStock: PRODUCTS.filter((p) => p.stock <= STORE.lowStockThreshold).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
      topProducts: [],
    };
  },
};

/* ---------- login screen ---------- */

function adminLoginHTML() {
  return `
  <section class="container section admin-login">
    <form class="panel admin-login__panel" data-admin-login novalidate>
      ${emblemSVG('admin-login__emblem')}
      <h1 class="page-title">REAPER <span class="text-accent">CONSOLE</span></h1>
      <p class="muted">Staff only — اكتب اسم المستخدم وكلمة السر.</p>
      <label class="field"><span class="field__label">USERNAME</span>
        <input name="username" type="text" value="admin" data-validate="required" data-label="username" autocomplete="username"></label>
      <label class="field"><span class="field__label">PASSWORD</span>
        <input name="password" type="password" data-validate="required" data-label="password" autocomplete="current-password"></label>
      <button class="btn btn--accent btn--block" type="submit">ENTER ${icon('lock', 'ic-s')}</button>
      <p class="muted admin-login__hint">أول مرة؟ جرب <code>admin</code> / <code>ChangeMe123!</code> — وغيّر الباسورد فورًا من تبويب SETTINGS.</p>
    </form>
  </section>`;
}

/* ---------- dashboard shell ---------- */

function adminDashHTML(statsData) {
  return `
  <section class="container admin" data-admin-root>
    <div class="admin__bar">
      <h1 class="page-title admin__title">REAPER <span class="text-accent">CONSOLE</span>
        ${Admin.mode === 'local' ? '<span class="tag tag--sm" title="API unreachable — showing local demo data">OFFLINE DEMO</span>' : `<span class="tag tag--sm">${esc(AdminApi.username())}</span>`}</h1>
      <div class="admin__bar-actions">
        <button class="btn btn--ghost btn--sm" data-action="admin-export">EXPORT ORDERS (JSON)</button>
        <button class="btn btn--accent btn--sm" data-action="admin-logout">LOG OUT</button>
      </div>
    </div>

    <div class="statgrid">
      <div class="stat"><span class="stat__v">${statsData.orders}</span><span class="stat__l">ORDERS</span></div>
      <div class="stat"><span class="stat__v">${fmt(statsData.revenue)}</span><span class="stat__l">REVENUE</span></div>
      <div class="stat"><span class="stat__v">${fmt(statsData.aov)}</span><span class="stat__l">AVG ORDER</span></div>
      <div class="stat"><span class="stat__v">${statsData.units}</span><span class="stat__l">UNITS SOLD</span></div>
      <div class="stat stat--warn"><span class="stat__v">${statsData.lowStock.length}</span><span class="stat__l">LOW STOCK</span></div>
    </div>

    ${statsData.topProducts && statsData.topProducts.length ? `
    <div class="panel admin__top">
      <h2 class="panel__h">TOP SELLERS</h2>
      <div class="admin__toplist">
        ${statsData.topProducts.map((t) => {
          const p = Store.product(t.productId);
          return `<span class="tag">${t.sold}× ${p ? esc(p.name) : esc(t.productId)}</span>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="tabs" role="tablist" aria-label="Admin sections">
      ${[['orders', 'ORDERS'], ['products', 'PRODUCTS'], ['stock', 'STOCK & PRICES'], ['zones', 'SHIPPING ZONES'], ['payments', 'PAYMENTS'], ['settings', 'SETTINGS']].map(([v, l]) =>
        `<button class="tab ${Admin.tab === v ? 'is-on' : ''}" role="tab" aria-selected="${Admin.tab === v}" data-tab="${v}">${l}</button>`).join('')}
    </div>
    <div class="admin__body" data-admin-body><p class="muted">Loading…</p></div>
  </section>`;
}

/* ---------- tab: orders ---------- */

function adminOrdersHTML(orders) {
  return `
  <div class="admin__filters">
    ${['all', 'pending_payment', 'placed', 'paid', 'roasting', 'shipped', 'delivered', 'failed', 'cancelled'].map((f) =>
      `<button class="chip ${Admin.orderFilter === f ? 'is-on' : ''}" data-ofilter="${f}">${f === 'pending_payment' ? 'PENDING' : f.toUpperCase()}</button>`).join('')}
  </div>
  ${orders.length ? orders.map((o) => `
    <article class="ordercard" data-order="${esc(o.number)}">
      <header class="ordercard__head">
        <div>
          <strong class="ordercard__num">${esc(o.number)}</strong>
          <span class="muted"> · ${new Date(o.createdAt).toLocaleString()}</span>
          <div class="muted">${esc(o.customer.name)} · ${esc(o.customer.email)} · ${esc(o.customer.phone)}</div>
          <div class="muted">${esc(o.shipping.address)}, ${esc(o.shipping.city)} — ${esc(o.shipping.zoneName || '')}</div>
        </div>
        <div class="ordercard__meta">
          <span class="statusbadge statusbadge--${esc(o.status)}">${Admin.STATUS_LABEL[o.status] || o.status.toUpperCase()}</span>
          <strong class="ordercard__total">${fmt(o.totals.total)}</strong>
          <span class="muted">${esc((o.paymentMethod || '').toUpperCase())}</span>
        </div>
      </header>
      <div class="ordercard__items">
        ${o.items.map((l) => `<span class="tag tag--sm">${l.qty}× ${esc(l.name)}${l.weightG ? ` ${l.weightG}g ${esc(l.grind || '')}` : ''}</span>`).join('')}
      </div>
      <footer class="ordercard__foot">
        ${o.status === 'pending_payment' ? `
          <div class="ordercard__pending">
            <span class="muted">Awaiting gateway webhook —</span>
            <button class="chip chip--xs" data-setstatus="paid" data-num="${esc(o.number)}">MARK PAID</button>
            <button class="chip chip--xs" data-setstatus="failed" data-num="${esc(o.number)}">MARK FAILED</button>
          </div>` : `
          <div class="ordercard__flow" role="group" aria-label="Update status">
            ${['placed', 'paid', 'roasting', 'shipped', 'delivered'].map((st) =>
              `<button class="chip chip--xs ${o.status === st ? 'is-on' : ''}" data-setstatus="${st}" data-num="${esc(o.number)}" ${o.status === 'failed' || o.status === 'cancelled' ? 'disabled' : ''}>${Admin.STATUS_LABEL[st]}</button>`).join('')}
          </div>`}
      </footer>
    </article>`).join('')
  : `<div class="empty">${skullIcon('empty__skull')}<p>No orders in this state.</p></div>`}`;
}

/* ---------- tab: products (CMS) ---------- */

function adminProductsHTML(products) {
  const q = Admin.prodSearch.trim().toLowerCase();
  const list = q ? products.filter((p) => `${p.name} ${p.shortName} ${p.categoryId}`.toLowerCase().includes(q)) : products;
  const ed = Admin.editor;

  return `
  ${ed ? adminProductEditorHTML(ed) : ''}
  <div class="admin__toolbar">
    <input class="zinput admin__search" type="search" placeholder="Search products…" value="${esc(Admin.prodSearch)}" data-prod-search aria-label="Search products">
    <button class="btn btn--accent btn--sm" data-action="p-new">+ NEW PRODUCT</button>
  </div>
  <div class="tablewrap">
    <table class="atable">
      <thead><tr><th></th><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>ACTIONS</th></tr></thead>
      <tbody>
        ${list.map((p) => `
          <tr>
            <td>${p.images && p.images.length ? `<img class="imgthumb" src="${esc(p.images[0])}" alt="">` : `<span class="imgthumb imgthumb--ph">${p.badge ? esc(p.badge[0]) : '☕'}</span>`}</td>
            <td><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.badge || '')}</span></td>
            <td>${esc((CATEGORIES.find((c) => c.id === p.categoryId) || {}).name || p.categoryId)}</td>
            <td>${fmt(p.basePrice)}</td>
            <td>${p.stock}</td>
            <td class="admin__rowactions">
              <button class="chip chip--xs" data-pedit="${esc(p.id)}">EDIT</button>
              <button class="chip chip--xs" data-pdel="${esc(p.id)}" data-pname="${esc(p.name)}">DELETE</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ${!list.length ? `<div class="empty">${skullIcon('empty__skull')}<p>No products match.</p></div>` : ''}`;
}

function adminProductEditorHTML(ed) {
  const isNew = !ed.id;
  const p = ed.values;
  const roasts = ['Dark', 'Medium', 'Espresso'];
  return `
  <form class="panel peditor" data-peditor novalidate>
    <h2 class="panel__h">${isNew ? 'NEW PRODUCT' : `EDIT — ${esc(p.name || '')}`}</h2>
    ${ed.error ? `<p class="peditor__err">${esc(ed.error)}</p>` : ''}
    <div class="peditor__grid">
      <label class="field"><span class="field__label">NAME *</span>
        <input name="name" value="${esc(p.name || '')}" data-validate="required" data-label="name"></label>
      <label class="field"><span class="field__label">CATEGORY *</span>
        <select name="categoryId">
          ${CATEGORIES.map((c) => `<option value="${c.id}" ${p.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span class="field__label">BASE PRICE (EGP) * <small class="muted">250g — 500g ×1.8 — 1kg ×3.2</small></span>
        <input name="basePrice" type="number" min="0" value="${p.basePrice ?? ''}" data-validate="required" data-label="base price"></label>
      <label class="field"><span class="field__label">STOCK</span>
        <input name="stock" type="number" min="0" value="${p.stock ?? 0}"></label>
      <label class="field"><span class="field__label">BADGE <small class="muted">(optional — e.g. NEW)</small></span>
        <input name="badge" value="${esc(p.badge || '')}"></label>
      <label class="field"><span class="field__label">SHORT NAME</span>
        <input name="shortName" value="${esc(p.shortName || '')}"></label>
      <label class="field"><span class="field__label">ROAST <small class="muted">(coffee only)</small></span>
        <select name="roast">
          ${roasts.map((r) => `<option value="${r}" ${p.roast === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select></label>
      <label class="field"><span class="field__label">TASTING NOTES <small class="muted">(comma separated)</small></span>
        <input name="notes" value="${esc(Array.isArray(p.notes) ? p.notes.join(', ') : (p.notes || ''))}"></label>
      <label class="field peditor__full"><span class="field__label">DESCRIPTION</span>
        <textarea name="description" rows="3">${esc(p.description || '')}</textarea></label>
    </div>

    ${isNew ? `
      <p class="muted">💡 Save the product first, then add images from the editor.</p>
      <div class="admin__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-action="p-cancel">CANCEL</button>
        <button class="btn btn--accent btn--sm" type="submit" ${ed.saving ? 'disabled' : ''}>${ed.saving ? 'SAVING…' : 'CREATE PRODUCT'}</button>
      </div>` : `
      <div class="peditor__imgs">
        <span class="field__label">IMAGES</span>
        <div class="peditor__imglist">
          ${(ed.images || []).map((img) => `
            <span class="imgchip">
              <img class="imgthumb" src="${esc(img.url)}" alt="">
              <button type="button" class="imgchip__x" data-img-del="${esc(img.id)}" title="Remove image">×</button>
            </span>`).join('') || '<span class="muted">No images yet — upload one (png/jpg/webp, max 5MB) or paste a URL.</span>'}
        </div>
        <div class="peditor__upload">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" data-img-file aria-label="Upload image">
          <span class="muted">or</span>
          <input class="zinput" type="url" placeholder="https://…/photo.jpg" data-img-url aria-label="Image URL">
          <button class="btn btn--ghost btn--sm" type="button" data-action="img-add-url">ADD URL</button>
        </div>
      </div>
      <div class="admin__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-action="p-cancel">CANCEL</button>
        <button class="btn btn--accent btn--sm" type="submit" ${ed.saving ? 'disabled' : ''}>${ed.saving ? 'SAVING…' : 'SAVE CHANGES'}</button>
      </div>`}
  </form>`;
}

/* ---------- tab: stock (quick price/stock edits) ---------- */

function adminStockHTML(products) {
  return `
  <p class="muted admin__hint">Quick edits: use − / + for stock, or type a new price and it saves instantly.</p>
  <div class="tablewrap">
    <table class="atable">
      <thead><tr><th>PRODUCT</th><th>PRICE (EGP)</th><th>STOCK</th><th>STATE</th></tr></thead>
      <tbody>
        ${products.map((p) => `
          <tr data-pid="${esc(p.id)}">
            <td><strong>${esc(p.name)}</strong></td>
            <td><input class="zinput zinput--price" type="number" min="0" value="${p.basePrice}" data-price-input data-pid="${esc(p.id)}" aria-label="Price for ${esc(p.name)}"></td>
            <td>
              <div class="stockctl">
                <button class="qty__btn" data-stock-step="-1" data-pid="${esc(p.id)}" aria-label="Decrease stock">−</button>
                <span class="stockctl__v" data-stock-val>${p.stock}</span>
                <button class="qty__btn" data-stock-step="1" data-pid="${esc(p.id)}" aria-label="Increase stock">+</button>
              </div>
            </td>
            <td>${p.stock <= 0 ? '<span class="text-accent">SOLD OUT</span>' : p.stock <= STORE.lowStockThreshold ? `<span class="text-accent">LOW (${p.stock})</span>` : 'OK'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ---------- tab: zones ---------- */

function adminZonesHTML(zones) {
  if (!Admin.zoneEdits) Admin.zoneEdits = zones.map((z) => ({ ...z }));
  return `
  <p class="muted admin__hint">Flat-rate zone shipping. Saved edits update the database and apply instantly at checkout.</p>
  <div class="tablewrap">
    <table class="atable">
      <thead><tr><th>ZONE</th><th>FEE (EGP)</th><th>ETA</th></tr></thead>
      <tbody>
        ${Admin.zoneEdits.map((z, i) => `
          <tr>
            <td>${esc(z.name)}</td>
            <td><input class="zinput" type="number" min="0" max="500" value="${z.fee}" data-zone-fee="${i}" data-zone-id="${esc(z.id)}" aria-label="Fee for ${esc(z.name)}"></td>
            <td><input class="zinput" value="${esc(z.etaDays)}" data-zone-eta="${i}" aria-label="ETA for ${esc(z.name)}"></td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="admin__actions">
    <button class="btn btn--ghost btn--sm" data-action="zones-reset">RESET</button>
    <button class="btn btn--accent btn--sm" data-action="zones-save">SAVE ZONES</button>
  </div>`;
}

/* ---------- tab: payments ---------- */

function adminPaymentsHTML(methods) {
  return `
  <p class="muted admin__hint">فعّل أو أوقف طرق الدفع اللي تظهر للعميل في صفحة الدفع. طرق التحويل (بنكي / فودافون كاش) بتظهر للعميل تعليمات تحويل بعد تأكيد الطلب.</p>
  <div class="pmgrid">
    ${methods.map((m, i) => `
      <div class="panel pmcard ${m.enabled ? 'pmcard--on' : ''}">
        <label class="pmcard__toggle">
          <input type="checkbox" data-pm-enabled="${i}" ${m.enabled ? 'checked' : ''}>
          <span class="pmcard__id">${esc(m.id.toUpperCase().replace('_', ' '))}</span>
        </label>
        <label class="field"><span class="field__label">LABEL</span>
          <input class="zinput" value="${esc(m.label)}" data-pm-label="${i}"></label>
        <label class="field"><span class="field__label">DETAIL SHOWN TO CUSTOMER</span>
          <input class="zinput" value="${esc(m.detail)}" data-pm-detail="${i}"></label>
      </div>`).join('')}
  </div>
  <div class="admin__actions">
    <button class="btn btn--ghost btn--sm" data-action="pm-reset">RESET</button>
    <button class="btn btn--accent btn--sm" data-action="pm-save">SAVE PAYMENT SETTINGS</button>
  </div>`;
}

/* ---------- tab: settings ---------- */

function adminSettingsHTML() {
  return `
  <div class="panel peditor">
    <h2 class="panel__h">CHANGE PASSWORD</h2>
    <p class="muted">الباسورد الافتراضي <code>ChangeMe123!</code> مخصص للتشغيل الأول فقط — غيّره من هنا فورًا بعد النشر. الحد الأدنى 8 حروف.</p>
    <form data-pw-form novalidate>
      <div class="peditor__grid">
        <label class="field"><span class="field__label">CURRENT PASSWORD</span>
          <input name="current" type="password" autocomplete="current-password" data-validate="required" data-label="current password"></label>
        <label class="field"><span class="field__label">NEW PASSWORD (8+)</span>
          <input name="next" type="password" autocomplete="new-password" data-validate="required" data-label="new password" minlength="8"></label>
        <label class="field"><span class="field__label">CONFIRM NEW PASSWORD</span>
          <input name="confirm" type="password" autocomplete="new-password" data-validate="required" data-label="password confirmation"></label>
      </div>
      <div class="admin__actions">
        <button class="btn btn--accent btn--sm" type="submit">UPDATE PASSWORD</button>
      </div>
    </form>
    <h2 class="panel__h">STORE RULES</h2>
    <p class="muted">Free-shipping threshold, COD fee & cap, low-stock alert.</p>
    <div class="peditor__grid">
      ${[['freeShippingThreshold', 'FREE SHIPPING OVER (EGP)'], ['codFee', 'COD FEE (EGP)'], ['codMax', 'COD MAX ORDER (EGP)'], ['lowStockThreshold', 'LOW STOCK ALERT AT']].map(([k, l]) => `
        <label class="field"><span class="field__label">${l}</span>
          <input class="zinput" type="number" min="0" value="${STORE[k] ?? ''}" data-store-default="${k}"></label>`).join('')}
    </div>
    <div class="admin__actions">
      <button class="btn btn--accent btn--sm" data-action="sd-save">SAVE STORE RULES</button>
    </div>
    <h2 class="panel__h">SESSION</h2>
    <p class="muted">Signed in as <strong>${esc(AdminApi.username())}</strong>. Sessions last 12 hours.</p>
  </div>`;
}

/* ---------- controller ---------- */

function offlineTabHTML() {
  return `<div class="empty">${skullIcon('empty__skull')}<p>OFFLINE DEMO — this tab needs the live server.</p></div>`;
}

async function renderAdminBody(body) {
  if (Admin.mode === 'local' || !AdminApi.authed()) {
    /* local demo mode */
    if (Admin.tab === 'orders') body.innerHTML = adminOrdersHTML(Store.state.orders.filter((o) => Admin.orderFilter === 'all' || o.status === Admin.orderFilter));
    else if (Admin.tab === 'stock') body.innerHTML = adminStockHTML(PRODUCTS);
    else if (Admin.tab === 'zones') body.innerHTML = adminZonesHTML(SHIPPING_ZONES);
    else if (Admin.tab === 'products') body.innerHTML = adminProductsHTML(PRODUCTS);
    else if (Admin.tab === 'payments') body.innerHTML = adminPaymentsHTML(typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []);
    else body.innerHTML = offlineTabHTML();
    return;
  }

  try {
    if (Admin.tab === 'orders') {
      const orders = await AdminApi.orders(Admin.orderFilter);
      body.innerHTML = adminOrdersHTML(orders);
    } else if (Admin.tab === 'products') {
      body.innerHTML = adminProductsHTML(await store_products());
    } else if (Admin.tab === 'stock') {
      body.innerHTML = adminStockHTML(await store_products());
    } else if (Admin.tab === 'zones') {
      body.innerHTML = adminZonesHTML(await store_zones());
    } else if (Admin.tab === 'payments') {
      const data = await Api.req('GET', '/api/catalog');
      Admin.pmDraft = (data.paymentMethods || []).map((m) => ({ ...m }));
      body.innerHTML = adminPaymentsHTML(Admin.pmDraft);
    } else {
      body.innerHTML = adminSettingsHTML();
    }
  } catch (err) {
    body.innerHTML = `<div class="empty">${skullIcon('empty__skull')}<p>API error: ${esc(String(err.message))}</p>
      <button class="btn btn--ghost btn--sm" data-action="admin-retry">RETRY</button></div>`;
  }
}

/* products/zones straight from the API so admin sees live DB values */
async function store_products() {
  const data = await Api.req('GET', '/api/catalog');
  return data.products;
}
async function store_zones() {
  const data = await Api.req('GET', '/api/catalog');
  return data.zones;
}

/* refresh the storefront catalog cache after an admin mutation */
async function refreshCatalog() {
  await Store.hydrate();
}

Views.admin = () => {
  if (!Admin.isAuthed()) {
    return {
      html: adminLoginHTML(),
      mount(root) {
        const form = $('[data-admin-login]', root);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!validateForm(form).ok) return;
          const fd = new FormData(form);
          const username = String(fd.get('username') || '').trim();
          const password = String(fd.get('password') || '');
          if (await Admin.login(username, password)) {
            toast('Welcome back, reaper');
            App.rerender();
          } else {
            toast('اسم المستخدم أو كلمة السر غلط', 'err');
          }
        });
      },
    };
  }

  return {
    html: '<section class="container section"><p class="muted">Loading console…</p></section>',
    async mount(root) {
      let statsData;
      if (AdminApi.authed()) {
        try {
          statsData = await AdminApi.stats();
          Admin.mode = 'server';
        } catch (err) {
          if (err.status === 401) {
            AdminApi.logout();
            toast('Session expired — sign in again');
            App.rerender();
            return;
          }
          statsData = Admin.localStats();
          Admin.mode = 'local';
        }
      } else {
        statsData = Admin.localStats();
        Admin.mode = 'local';
      }

      root.outerHTML = adminDashHTML(statsData);
      const shell = document.querySelector('[data-admin-root]');
      const body = $('[data-admin-body]');
      if (!shell || !body) return;
      await renderAdminBody(body);

      const view = () => document.querySelector('[data-admin-root]') || root;

      /* ---------- click actions ---------- */
      shell.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          Admin.tab = tab.dataset.tab;
          Admin.editor = null;
          Admin.zoneEdits = null;
          $$('.tab', view()).forEach((t) => {
            const on = t === tab;
            t.classList.toggle('is-on', on);
            t.setAttribute('aria-selected', on);
          });
          renderAdminBody(body);
          return;
        }

        const of = e.target.closest('[data-ofilter]');
        if (of) {
          Admin.orderFilter = of.dataset.ofilter;
          $$('.admin__filters .chip', view()).forEach((c) => c.classList.toggle('is-on', c === of));
          renderAdminBody(body);
          return;
        }

        const st = e.target.closest('[data-setstatus]');
        if (st) {
          const number = st.dataset.num;
          const target = st.dataset.setstatus;
          try {
            if (Admin.mode === 'server' && AdminApi.authed()) {
              await AdminApi.setStatus(number, target, 'admin console');
              const local = Store.state.orders.find((o) => o.number === number);
              if (local) { local.status = target; Store.save(); }
            } else {
              const local = Store.state.orders.find((o) => o.number === number);
              if (local) { local.status = target; Store.save(); }
            }
            toast(`${number} → ${Admin.STATUS_LABEL[target] || target}`);
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        const sk = e.target.closest('[data-stock-step]');
        if (sk) {
          const pid = sk.dataset.pid;
          const valEl = sk.parentElement.querySelector('[data-stock-val]');
          const next = Math.max(0, +valEl.textContent + (+sk.dataset.stockStep));
          try {
            if (Admin.mode === 'server' && AdminApi.authed()) {
              const p = await AdminApi.setStock(pid, next);
              valEl.textContent = p.stock;
              refreshCatalog();
            } else {
              const p = Store.product(pid);
              if (p) { p.stock = next; valEl.textContent = next; }
            }
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          return;
        }

        /* ---- products CMS ---- */
        const pedit = e.target.closest('[data-pedit]');
        if (pedit) {
          try {
            const p = await AdminApi.authed() ? (await Api.req('GET', `/api/products/${encodeURIComponent(pedit.dataset.pedit)}`)).product : Store.product(pedit.dataset.pedit);
            Admin.editor = { id: p.id, saving: false, error: null, values: { ...p }, images: p.images || [] };
            renderAdminBody(body);
            body.querySelector('[data-peditor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          return;
        }

        if (e.target.closest('[data-action="p-new"]')) {
          Admin.editor = {
            id: null, saving: false, error: null, images: [],
            values: { name: '', categoryId: (CATEGORIES[0] || {}).id, roast: 'Medium', basePrice: '', stock: 0, badge: '', shortName: '', notes: [], description: '' },
          };
          renderAdminBody(body);
          body.querySelector('[data-peditor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        const pdel = e.target.closest('[data-pdel]');
        if (pdel) {
          if (!confirm(`Delete "${pdel.dataset.pname}"? It disappears from the store (orders keep their history).`)) return;
          try {
            await AdminApi.deleteProduct(pdel.dataset.pdel);
            toast('Product deleted');
            if (Admin.editor && Admin.editor.id === pdel.dataset.pdel) Admin.editor = null;
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="p-cancel"]')) {
          Admin.editor = null;
          renderAdminBody(body);
          return;
        }

        const imgDel = e.target.closest('[data-img-del]');
        if (imgDel && Admin.editor) {
          try {
            await AdminApi.deleteImage(Admin.editor.id, imgDel.dataset.imgDel);
            Admin.editor.images = Admin.editor.images.filter((i) => i.id !== imgDel.dataset.imgDel);
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="img-add-url"]') && Admin.editor) {
          const urlInput = body.querySelector('[data-img-url]');
          const url = urlInput ? urlInput.value.trim() : '';
          if (!/^https?:\/\//.test(url)) { toast('Paste a valid image URL (https://…)', 'err'); return; }
          try {
            await AdminApi.setProductImages(Admin.editor.id, [...Admin.editor.images.map((i) => i.url), url]);
            const p = (await Api.req('GET', `/api/products/${encodeURIComponent(Admin.editor.id)}`)).product;
            Admin.editor.images = p.images || [];
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        /* ---- payment settings ---- */
        if (e.target.closest('[data-action="pm-save"]')) {
          try {
            const draft = Admin.pmDraft || [];
            draft.forEach((m, i) => {
              m.enabled = !!body.querySelector(`[data-pm-enabled="${i}"]`)?.checked;
              m.label = body.querySelector(`[data-pm-label="${i}"]`)?.value || m.label;
              m.detail = body.querySelector(`[data-pm-detail="${i}"]`)?.value || m.detail;
            });
            await AdminApi.savePaymentMethods(draft);
            toast('Payment methods saved');
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="pm-reset"]')) {
          Admin.pmDraft = null;
          renderAdminBody(body);
          return;
        }

        /* ---- store rules ---- */
        if (e.target.closest('[data-action="sd-save"]')) {
          try {
            const patch = {};
            $$('[data-store-default]', body).forEach((inp) => { patch[inp.dataset.storeDefault] = +inp.value || 0; });
            await AdminApi.saveStoreDefaults(patch);
            Object.assign(STORE, patch);
            toast('Store rules saved');
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          return;
        }

        if (e.target.closest('[data-action="zones-save"]')) {
          $$('[data-zone-fee]', body).forEach((inp) => {
            const i = +inp.dataset.zoneFee;
            Admin.zoneEdits[i].fee = Math.max(0, +inp.value || 0);
            Admin.zoneEdits[i].etaDays = $(`[data-zone-eta="${i}"]`, body).value;
          });
          try {
            if (Admin.mode === 'server' && AdminApi.authed()) {
              await Promise.all(Admin.zoneEdits.map((z) => AdminApi.setZone(z.id, { fee: z.fee, etaDays: z.etaDays })));
              toast('Shipping zones saved');
            } else {
              Admin.zoneEdits.forEach((z) => { const t = SHIPPING_ZONES.find((x) => x.id === z.id); if (t) Object.assign(t, z); });
              toast('Zones updated (local demo mode)');
            }
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="zones-reset"]')) {
          Admin.zoneEdits = null;
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="admin-logout"]')) {
          Admin.logout();
          toast('Logged out');
          App.rerender();
          return;
        }

        if (e.target.closest('[data-action="admin-retry"]')) {
          renderAdminBody(body);
          return;
        }

        if (e.target.closest('[data-action="admin-export"]')) {
          let orders = Store.state.orders;
          if (Admin.mode === 'server' && AdminApi.authed()) {
            try { orders = await AdminApi.orders('all'); } catch { /* fallback to cache */ }
          }
          const blob = new Blob([JSON.stringify(orders, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `sod-orders-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      });

      /* ---------- editor submit ---------- */
      body.addEventListener('submit', async (e) => {
        const edForm = e.target.closest('[data-peditor]');
        if (edForm && Admin.editor) {
          e.preventDefault();
          if (!validateForm(edForm).ok) return;
          const fd = new FormData(edForm);
          const payload = {
            name: String(fd.get('name') || '').trim(),
            categoryId: String(fd.get('categoryId') || ''),
            basePrice: Math.round(+fd.get('basePrice') || 0),
            stock: Math.max(0, Math.floor(+fd.get('stock') || 0)),
            badge: String(fd.get('badge') || '').trim(),
            shortName: String(fd.get('shortName') || '').trim(),
            roast: String(fd.get('roast') || 'Medium'),
            notes: String(fd.get('notes') || ''),
            description: String(fd.get('description') || '').trim(),
          };
          Admin.editor.saving = true;
          renderAdminBody(body);
          try {
            if (Admin.editor.id) {
              await AdminApi.updateProduct(Admin.editor.id, payload);
            } else {
              const p = await AdminApi.createProduct(payload);
              Admin.editor = { id: p.id, saving: false, error: null, values: { ...p }, images: p.images || [] };
              toast('Product created — now add images');
              await refreshCatalog();
              renderAdminBody(body);
              return;
            }
            toast('Product saved');
            Admin.editor = null;
            await refreshCatalog();
          } catch (err) {
            Admin.editor.saving = false;
            Admin.editor.error = String(err.message || err);
          }
          renderAdminBody(body);
          return;
        }

        const pwForm = e.target.closest('[data-pw-form]');
        if (pwForm) {
          e.preventDefault();
          if (!validateForm(pwForm).ok) return;
          const fd = new FormData(pwForm);
          const current = String(fd.get('current') || '');
          const next = String(fd.get('next') || '');
          const confirmPw = String(fd.get('confirm') || '');
          if (next.length < 8) { toast('New password must be at least 8 characters', 'err'); return; }
          if (next !== confirmPw) { toast('The two passwords do not match', 'err'); return; }
          try {
            const data = await AdminApi.changePassword(current, next);
            if (data && data.token) localStorage.setItem('sod.adminToken', data.token); /* keep the session alive */
            toast('تم تحديث الباسورد ✔');
            pwForm.reset();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
        }
      });

      /* ---------- change events: image upload, price inputs, product search ---------- */
      body.addEventListener('change', async (e) => {
        const fileInput = e.target.closest('[data-img-file]');
        if (fileInput && Admin.editor && fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          if (file.size > 5 * 1024 * 1024) { toast('Image too large — max 5MB', 'err'); fileInput.value = ''; return; }
          try {
            toast('Uploading image…');
            await AdminApi.uploadImage(Admin.editor.id, file);
            const p = (await Api.req('GET', `/api/products/${encodeURIComponent(Admin.editor.id)}`)).product;
            Admin.editor.images = p.images || [];
            await refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
          }
          renderAdminBody(body);
          return;
        }

        const priceInput = e.target.closest('[data-price-input]');
        if (priceInput) {
          const pid = priceInput.dataset.pid;
          const price = Math.max(0, Math.round(+priceInput.value || 0));
          try {
            await AdminApi.updateProduct(pid, { basePrice: price });
            toast('Price updated');
            refreshCatalog();
          } catch (err) {
            toast(String(err.message || err), 'err');
            renderAdminBody(body);
          }
        }
      });

      body.addEventListener('input', (e) => {
        const search = e.target.closest('[data-prod-search]');
        if (search) {
          Admin.prodSearch = search.value;
          const table = body.querySelector('.tablewrap');
          if (table) {
            const q = Admin.prodSearch.trim().toLowerCase();
            $$('tbody tr', table).forEach((tr) => {
              const name = tr.textContent.toLowerCase();
              tr.hidden = !!q && !name.includes(q);
            });
          }
        }
      });
    },
  };
};
