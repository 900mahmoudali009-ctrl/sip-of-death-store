'use strict';

/* ============================================================
   SIP OF DEATH — PostgreSQL persistence layer (Supabase)
   node-postgres pooled connection via DATABASE_URL. All order
   mutations that touch stock run inside transactions; the
   guarded "UPDATE … WHERE stock >= ?" keeps oversell
   impossible even under concurrent webhooks.
   Tables are created idempotently at boot; catalog seeds once.
   New: settings (payment methods & toggles), admin_users
   (username + scrypt hash), product_images, archived products.
   ============================================================ */

const crypto = require('crypto');
const { Pool } = require('pg');
const catalog = require('../catalog.js');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  categoryId TEXT NOT NULL REFERENCES categories(id),
  roast TEXT,
  roastLabel TEXT NOT NULL,
  shortName TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  basePrice INTEGER NOT NULL,
  rating REAL NOT NULL DEFAULT 0,
  reviewsCount INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  caffeine TEXT,
  art TEXT,
  origin TEXT,
  process TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(productId, sort);

CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fee INTEGER NOT NULL,
  etaDays TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  number TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  status TEXT NOT NULL,
  paymentMethod TEXT NOT NULL,
  customerName TEXT NOT NULL,
  customerEmail TEXT NOT NULL,
  customerPhone TEXT NOT NULL,
  zoneId TEXT REFERENCES zones(id),
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  notes TEXT,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL,
  codFee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  promo TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customerEmail);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  orderNumber TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  weightG INTEGER,
  grind TEXT,
  unitPrice INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(orderNumber);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  orderNumber TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(orderNumber);

CREATE TABLE IF NOT EXISTS payment_intents (
  orderNumber TEXT PRIMARY KEY REFERENCES orders(number) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  providerRef TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  redirectUrl TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters(name, value) VALUES ('order', 0) ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  paymentMethods: JSON.stringify([
    { id: 'card', label: 'Online Card Payment', detail: 'Visa · Mastercard · Secure hosted checkout', enabled: true },
    { id: 'cod', label: 'Cash on Delivery', detail: 'Pay cash to the courier', enabled: true },
    { id: 'bank_transfer', label: 'Bank Transfer', detail: 'Transfer & send the receipt on WhatsApp', enabled: false },
    { id: 'vodafone_cash', label: 'Vodafone Cash', detail: 'Send to the store wallet & confirm on WhatsApp', enabled: false },
  ]),
  storeDefaults: JSON.stringify(catalog.STORE_DEFAULTS),
};

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (/supabase\.(co|com)/.test(String(process.env.DATABASE_URL || '')) || process.env.PGSSL === 'require')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
});
db.on('error', (err) => console.error('[pg] pool error:', err.message));

const q = (text, params) => db.query(text, params);
const now = () => new Date().toISOString();
const pid = () => crypto.randomBytes(9).toString('hex');
const first = async (text, params) => (await q(text, params)).rows[0] || null;

/* Postgres folds unquoted camelCase columns to lowercase; map row keys
   back to the camelCase API shape (SQLite used to return them as-is). */
const KEYMAP = {
  categoryid: 'categoryId', roastlabel: 'roastLabel', shortname: 'shortName',
  baseprice: 'basePrice', reviewscount: 'reviewsCount',
  createdat: 'createdAt', updatedat: 'updatedAt',
  paymentmethod: 'paymentMethod', customername: 'customerName',
  customeremail: 'customerEmail', customerphone: 'customerPhone',
  zoneid: 'zoneId', codfee: 'codFee', ordernumber: 'orderNumber',
  productid: 'productId', weightg: 'weightG', unitprice: 'unitPrice',
  providerref: 'providerRef', redirecturl: 'redirectUrl',
  etadays: 'etaDays', passwordhash: 'passwordHash',
};
const mapKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[KEYMAP[k] || k] = row[k];
  return out;
};

/* ---------- migration (idempotent) ---------- */

async function migrate() {
  await q(SCHEMA_SQL);
  const defaults = Object.entries(DEFAULT_SETTINGS);
  for (const [key, value] of defaults) {
    await q('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

/* ---------- seed (catalog + first admin) ---------- */

async function seedIfEmpty() {
  const row = await first('SELECT COUNT(*)::int AS n FROM products');
  if (row.n > 0) return false;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const c of catalog.CATEGORIES) {
      await client.query('INSERT INTO categories(id, name, tag) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [c.id, c.name, c.tag]);
    }
    for (const z of catalog.SHIPPING_ZONES) {
      await client.query('INSERT INTO zones(id, name, fee, etaDays) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [z.id, z.name, z.fee, z.etaDays]);
    }
    for (const p of catalog.PRODUCTS) {
      await client.query(`INSERT INTO products
        (id,name,categoryId,roast,roastLabel,shortName,notes,description,basePrice,rating,reviewsCount,stock,badge,caffeine,art,origin,process,updatedAt)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.categoryId, p.roast, p.roastLabel, p.shortName, JSON.stringify(p.notes || []),
          p.description, p.basePrice, p.rating, p.reviewsCount, p.stock, p.badge, p.caffeine, p.art, p.origin, p.process, now()]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return true;
}

async function ensureAdminUser() {
  const row = await first('SELECT username FROM admin_users LIMIT 1');
  if (row) return false;
  await createUser(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'ChangeMe123!');
  return true;
}

/* ---------- admin users ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `s2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [tag, salt, hash] = String(stored || '').split('$');
  if (tag !== 's2' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

async function createUser(username, password) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(u)) throw new Error('invalid username (3–32 chars: a-z 0-9 _ . -)');
  if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
  await q(`INSERT INTO admin_users(username, passwordHash, createdAt, updatedAt) VALUES ($1,$2,$3,$3)
           ON CONFLICT (username) DO UPDATE SET passwordHash = EXCLUDED.passwordHash, updatedAt = EXCLUDED.updatedAt`,
    [u, hashPassword(password), now()]);
}

async function getUser(username) {
  const u = await first('SELECT * FROM admin_users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
  return u ? mapKeys(u) : null;
}

async function checkLogin(username, password) {
  const u = await getUser(username);
  return u ? verifyPassword(password, u.passwordHash) : false;
}

async function changePassword(username, currentPassword, newPassword) {
  const u = await getUser(username);
  if (!u || !verifyPassword(currentPassword, u.passwordHash)) return false;
  if (String(newPassword || '').length < 8) throw new Error('password must be at least 8 characters');
  await q('UPDATE admin_users SET passwordHash = $2, updatedAt = $3 WHERE username = $1', [u.username, hashPassword(newPassword), now()]);
  return true;
}

/* ---------- settings (payment methods, store defaults) ---------- */

async function getSettings() {
  const rows = (await q('SELECT key, value FROM settings')).rows;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let methods;
  try { methods = JSON.parse(map.paymentMethods); } catch { methods = JSON.parse(DEFAULT_SETTINGS.paymentMethods); }
  let defaults;
  try { defaults = JSON.parse(map.storeDefaults); } catch { defaults = { ...catalog.STORE_DEFAULTS }; }
  const known = new Set(catalog.PAYMENT_METHODS.map((m) => m.id));
  return {
    paymentMethods: (methods || []).filter((m) => known.has(m.id)),
    storeDefaults: {
      freeShippingThreshold: Number(defaults.freeShippingThreshold) || 800,
      lowStockThreshold: Number.isFinite(+defaults.lowStockThreshold) ? +defaults.lowStockThreshold : 4,
      codFee: Number(defaults.codFee) || 0,
      codMax: Number(defaults.codMax) || 6000,
    },
  };
}

async function savePaymentMethods(list) {
  if (!Array.isArray(list)) throw new Error('paymentMethods must be an array');
  const known = new Set(catalog.PAYMENT_METHODS.map((m) => m.id));
  const seen = new Set();
  const clean = [];
  for (const m of list) {
    if (!m || !known.has(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    clean.push({
      id: m.id,
      label: String(m.label || '').slice(0, 80) || (catalog.PAYMENT_METHODS.find((x) => x.id === m.id)).label,
      detail: String(m.detail || '').slice(0, 160) || (catalog.PAYMENT_METHODS.find((x) => x.id === m.id)).detail,
      enabled: !!m.enabled,
    });
  }
  await q('UPDATE settings SET value = $2 WHERE key = $1', ['paymentMethods', JSON.stringify(clean)]);
  return clean;
}

async function saveStoreDefaults(patch) {
  const cur = (await getSettings()).storeDefaults;
  const next = { ...cur };
  for (const k of ['freeShippingThreshold', 'lowStockThreshold', 'codFee', 'codMax']) {
    if (patch && patch[k] !== undefined) {
      const n = Math.max(0, Math.floor(Number(patch[k])));
      if (Number.isFinite(n)) next[k] = n;
    }
  }
  await q('UPDATE settings SET value = $2 WHERE key = $1', ['storeDefaults', JSON.stringify(next)]);
  return next;
}

/* ---------- catalog reads ---------- */

async function listProducts({ includeArchived = false } = {}) {
  const res = await q(`SELECT p.*,
      COALESCE((SELECT json_agg(pi.url ORDER BY pi.sort) FROM product_images pi WHERE pi.productId = p.id), '[]') AS images
    FROM products p ${includeArchived ? '' : 'WHERE p.archived = 0'} ORDER BY p.basePrice, p.id`);
  return res.rows.map(productOut);
}

async function getProduct(id) {
  return first(`SELECT p.*,
      COALESCE((SELECT json_agg(pi.url ORDER BY pi.sort) FROM product_images pi WHERE pi.productId = p.id), '[]') AS images
    FROM products p WHERE p.id = $1`, [String(id || '')]).then((p) => (p ? productOut(p) : null));
}

function productOut(row) {
  const p = mapKeys(row);
  let notes = [];
  try { notes = JSON.parse(p.notes); } catch { /* keep [] */ }
  return { ...p, notes, archived: !!p.archived, images: Array.isArray(p.images) ? p.images.filter(Boolean) : [] };
}

async function listZones() {
  return (await q('SELECT * FROM zones ORDER BY fee, id')).rows.map(mapKeys);
}

async function listCategories() {
  return (await q('SELECT * FROM categories ORDER BY id')).rows;
}

async function updateZone(id, { fee, etaDays }) {
  const z = await first('SELECT * FROM zones WHERE id = $1', [id]);
  if (!z) return null;
  await q('UPDATE zones SET fee = COALESCE($2, fee), etaDays = COALESCE($3, etaDays) WHERE id = $1', [id, fee ?? null, etaDays ?? null]);
  return first('SELECT * FROM zones WHERE id = $1', [id]).then(mapKeys);
}

async function setStock(productId, stock) {
  const n = Math.floor(Number(stock));
  if (!Number.isFinite(n) || n < 0) throw new Error('invalid stock');
  const r = await q('UPDATE products SET stock = $2, updatedAt = $3 WHERE id = $1 AND archived = 0', [productId, n, now()]);
  if (r.rowCount === 0) return null;
  return getProduct(productId);
}

/* ---------- product CRUD (admin) ---------- */

function slugifyId(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'product'}-${pid().slice(0, 5)}`;
}

async function createProduct(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name is required');
  const price = Math.floor(Number(input.basePrice));
  if (!Number.isFinite(price) || price < 0) throw new Error('basePrice must be a positive number (EGP)');

  let categoryId = String(input.categoryId || '').trim();
  const cat = categoryId ? await first('SELECT id FROM categories WHERE id = $1', [categoryId]) : null;
  if (!cat) categoryId = (await first("SELECT id FROM categories WHERE id <> 'merch' ORDER BY id LIMIT 1")).id;

  let notes = input.notes;
  if (typeof notes === 'string') notes = notes.split(',').map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(notes) || !notes.length) notes = ['New'];
  const stock = Math.max(0, Math.floor(Number(input.stock) || 0));
  const images = (Array.isArray(input.images) ? input.images : []).map((u) => String(u)).filter((u) => /^https?:\/\//.test(u)).slice(0, 8);
  const isMerch = categoryId === 'merch';

  const id = input.id || slugifyId(name);
  const p = await first(`INSERT INTO products
    (id,name,categoryId,roast,roastLabel,shortName,notes,description,basePrice,rating,reviewsCount,stock,badge,caffeine,art,origin,process,archived,updatedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,$18) RETURNING *`,
    [id, name.toUpperCase(), categoryId, isMerch ? null : String(input.roast || 'Medium'),
      isMerch ? 'Merch' : `${input.roast || 'Medium'} Roast`, String(input.shortName || name).slice(0, 60),
      JSON.stringify(notes.slice(0, 4)), String(input.description || '').slice(0, 2000) || 'No description yet.',
      price, Math.min(5, Math.max(0, Number(input.rating) || 4.5)), Math.max(0, Math.floor(Number(input.reviewsCount) || 0)),
      stock, input.badge ? String(input.badge).slice(0, 24) : null, isMerch ? null : String(input.caffeine || 'Medium caffeine'),
      input.art || null, input.origin || null, input.process || null, now()]);
  for (let i = 0; i < images.length; i++) {
    await q('INSERT INTO product_images(id, productId, url, sort) VALUES ($1,$2,$3,$4)', [pid(), p.id, images[i], i]);
  }
  return getProduct(p.id);
}

const PRODUCT_FIELDS = ['name', 'categoryId', 'roast', 'roastLabel', 'shortName', 'description', 'badge', 'caffeine', 'art', 'origin', 'process'];

async function updateProduct(id, patch) {
  const existing = await getProduct(id);
  if (!existing || existing.archived) return null;

  const sets = [];
  const params = [id];
  const assign = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  for (const f of PRODUCT_FIELDS) {
    if (patch[f] !== undefined) {
      if (f === 'name') {
        const name = String(patch.name).trim();
        if (!name) throw new Error('name cannot be empty');
        assign(f, name.toUpperCase());
      } else if (f === 'categoryId') {
        const cat = await first('SELECT id FROM categories WHERE id = $1', [String(patch.categoryId)]);
        if (!cat) throw new Error('unknown category');
        assign(f, cat.id);
      } else {
        assign(f, patch[f] === null ? null : String(patch[f]).slice(0, 2000));
      }
    }
  }
  if (patch.basePrice !== undefined) {
    const price = Math.floor(Number(patch.basePrice));
    if (!Number.isFinite(price) || price < 0) throw new Error('basePrice must be a positive number (EGP)');
    assign('basePrice', price);
  }
  if (patch.stock !== undefined) {
    const n = Math.floor(Number(patch.stock));
    if (!Number.isFinite(n) || n < 0) throw new Error('stock must be zero or more');
    assign('stock', n);
  }
  if (patch.notes !== undefined) {
    let notes = patch.notes;
    if (typeof notes === 'string') notes = notes.split(',').map((s) => s.trim()).filter(Boolean);
    if (!Array.isArray(notes)) notes = existing.notes;
    assign('notes', JSON.stringify(notes.slice(0, 4)));
  }
  params.push(now());
  sets.push(`updatedAt = $${params.length}`);
  await q(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, params);
  return getProduct(id);
}

async function deleteProduct(id) {
  /* soft delete: keeps historical order_items FKs intact */
  const r = await q('UPDATE products SET archived = 1, updatedAt = $2 WHERE id = $1 AND archived = 0', [id, now()]);
  if (r.rowCount === 0) return null;
  return getProduct(id);
}

async function restoreProduct(id) {
  const r = await q('UPDATE products SET archived = 0, updatedAt = $2 WHERE id = $1 AND archived = 1', [id, now()]);
  if (r.rowCount === 0) return null;
  return getProduct(id);
}

/* ---------- product images ---------- */

async function addProductImage(productId, url) {
  const p = await first('SELECT id FROM products WHERE id = $1', [productId]);
  if (!p) return null;
  const r = await first('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM product_images WHERE productId = $1', [productId]);
  const img = { id: pid(), productId, url: String(url), sort: r.next };
  await q('INSERT INTO product_images(id, productId, url, sort) VALUES ($1,$2,$3,$4)', [img.id, img.productId, img.url, img.sort]);
  return img;
}

async function deleteProductImage(imageId) {
  const r = await q('DELETE FROM product_images WHERE id = $1 RETURNING id', [imageId]);
  return r.rowCount > 0;
}

async function setProductImages(productId, urls) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM product_images WHERE productId = $1', [productId]);
    let i = 0;
    for (const url of (Array.isArray(urls) ? urls : []).filter((u) => /^https?:\/\//.test(String(u))).slice(0, 12)) {
      await client.query('INSERT INTO product_images(id, productId, url, sort) VALUES ($1,$2,$3,$4)', [pid(), productId, String(url), i++]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getProduct(productId);
}

/* ---------- pricing (server is the authority) ---------- */

function variantPrice(p, weightG) {
  const w = catalog.WEIGHTS.find((x) => x.g === Number(weightG)) || catalog.WEIGHTS[0];
  return Math.round(p.basePrice * w.mult);
}

/* ---------- order creation (transactional) ---------- */

const ORDER_RE = /^SOD-\d{4}-\d{6}$/;

async function nextOrderNumber() {
  const r = await q("UPDATE counters SET value = value + 1 WHERE name = 'order' RETURNING value");
  return `SOD-${new Date().getFullYear()}-${String(r.rows[0].value).padStart(6, '0')}`;
}

/* Validates the client's cart server-side, recomputes every price,
   reserves stock, stores the order — atomically. */
async function createOrder(input) {
  const errors = [];
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) errors.push('cart is empty');

  const cfg = (await getSettings()).storeDefaults;
  const methods = (await getSettings()).paymentMethods.filter((m) => m.enabled).map((m) => m.id);
  const method = String(input.paymentMethod || '');
  if (!methods.includes(method)) {
    errors.push(method ? `payment method "${method}" is not enabled` : 'payment method required');
  }

  /* resolve + price every line against the DB */
  const priced = [];
  for (const line of items) {
    const p = await getProduct(line.productId);
    if (!p || p.archived) { errors.push(`unknown product: ${line.productId}`); continue; }
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) { errors.push(`invalid qty for ${line.productId}`); continue; }
    if (p.stock < qty) { errors.push(`insufficient stock for ${p.name} (${p.stock} left)`); continue; }
    const unitPrice = p.categoryId !== 'merch' ? variantPrice(p, line.weightG) : p.basePrice;
    priced.push({ p, qty, weightG: p.categoryId !== 'merch' ? Number(line.weightG) || 250 : null, grind: line.grind || null, unitPrice });
  }
  if (errors.length) return { errors };

  /* promo (server-side table) */
  const PROMOS = {
    REAPER10: { type: 'percent', value: 10, min: 0 },
    DEATH15: { type: 'percent', value: 15, min: 1000 },
    BONES50: { type: 'flat', value: 50, min: 500 },
  };
  let discount = 0;
  let promoCode = null;
  if (input.promo) {
    const promo = PROMOS[String(input.promo).toUpperCase()];
    const subtotal0 = priced.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    if (!promo) errors.push('unknown promo code');
    else if (subtotal0 < promo.min) errors.push(`promo needs minimum subtotal of ${promo.min}`);
    else {
      discount = promo.type === 'percent' ? Math.round(subtotal0 * promo.value / 100) : Math.min(promo.value, subtotal0);
      promoCode = String(input.promo).toUpperCase();
    }
  }

  const zone = await first('SELECT * FROM zones WHERE id = $1', [input.zoneId]);
  if (!zone) errors.push('unknown shipping zone');

  const c = input.customer || {};
  if (!c.name || !c.email || !c.phone) errors.push('customer name, email and phone are required');
  if (!input.address || !input.city) errors.push('address and city are required');
  if (errors.length) return { errors };

  const subtotal = priced.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const afterDiscount = subtotal - discount;
  const freeShipping = afterDiscount >= cfg.freeShippingThreshold;
  const shipping = freeShipping ? 0 : zone.fee;
  const codFee = method === 'cod' ? cfg.codFee : 0;
  const total = Math.max(0, afterDiscount + shipping + codFee);

  if (method === 'cod' && total > cfg.codMax) {
    return { errors: [`COD limited to ${cfg.codMax} EGP`] };
  }

  const at = now();
  const number = await nextOrderNumber();
  const status = method === 'card' ? 'pending_payment' : 'placed'; /* card pays via gateway; bank/vodafone/coin transfer confirmed by admin */

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    /* reserve stock with a guarded update — fails if another order won */
    for (const l of priced) {
      const r = await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $3 AND archived = 0', [l.qty, l.p.id, l.qty]);
      if (r.rowCount === 0) throw new Error(`stock race for ${l.p.name} — try again`);
    }
    await client.query(`INSERT INTO orders
      (number, createdAt, updatedAt, status, paymentMethod, customerName, customerEmail, customerPhone,
       zoneId, address, city, notes, subtotal, discount, shipping, codFee, total, promo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [number, at, at, status, method, c.name, c.email, c.phone, zone.id, input.address, input.city,
        input.notes || null, subtotal, discount, shipping, codFee, total, promoCode]);
    for (const l of priced) {
      await client.query('INSERT INTO order_items(orderNumber, productId, name, weightG, grind, unitPrice, qty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [number, l.p.id, l.p.name, l.weightG, l.grind, l.unitPrice, l.qty]);
    }
    await client.query('INSERT INTO order_events(orderNumber, type, detail, at) VALUES ($1,$2,$3,$4)', [number, 'order.created', `method=${method}`, at]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return { errors: [String(err.message || err)] };
  } finally {
    client.release();
  }
  return { order: await getOrder(number) };
}

/* ---------- order reads & transitions ---------- */

async function orderRowToFull(row) {
  if (!row) return null;
  const r = mapKeys(row);
  const items = (await q('SELECT * FROM order_items WHERE orderNumber = $1 ORDER BY id', [r.number])).rows.map(mapKeys);
  const events = (await q('SELECT type, detail, at FROM order_events WHERE orderNumber = $1 ORDER BY id', [r.number])).rows;
  const zone = r.zoneId ? await first('SELECT name, etaDays FROM zones WHERE id = $1', [r.zoneId]).then((z) => (z ? mapKeys(z) : null)) : null;
  return {
    number: r.number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    paymentMethod: r.paymentMethod,
    customer: { name: r.customerName, email: r.customerEmail, phone: r.customerPhone },
    shipping: {
      zoneId: r.zoneId,
      zoneName: zone ? zone.name : '',
      etaDays: zone ? zone.etaDays : '—',
      address: r.address,
      city: r.city,
      notes: r.notes || '',
    },
    items: items.map((i) => ({ productId: i.productId, name: i.name, weightG: i.weightG, grind: i.grind, unitPrice: i.unitPrice, qty: i.qty })),
    totals: { subtotal: r.subtotal, discount: r.discount, shipping: r.shipping, codFee: r.codFee, total: r.total },
    promo: r.promo,
    events,
  };
}

async function getOrder(number) {
  return orderRowToFull(await first('SELECT * FROM orders WHERE number = $1', [String(number || '').toUpperCase()]));
}

async function findOrder(number, email) {
  const row = await first('SELECT * FROM orders WHERE number = $1 AND LOWER(customerEmail) = LOWER($2)',
    [String(number || '').toUpperCase(), String(email || '').trim()]);
  return orderRowToFull(row);
}

async function listOrders({ status, limit = 100 } = {}) {
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const rows = status
    ? (await q('SELECT * FROM orders WHERE status = $1 ORDER BY createdAt DESC LIMIT $2', [status, lim])).rows
    : (await q('SELECT * FROM orders ORDER BY createdAt DESC LIMIT $1', [lim])).rows;
  const out = [];
  for (const row of rows) out.push(await orderRowToFull(row));
  return out;
}

/* All status changes flow through here so stock rules stay consistent. */
const PAID_STATES = ['paid', 'roasting', 'shipped', 'delivered'];

async function setOrderStatus(number, status, detail) {
  const row = await first('SELECT * FROM orders WHERE number = $1', [String(number || '').toUpperCase()]);
  if (!row) return { error: 'unknown order' };

  const noDowngrade = (current, next) => PAID_STATES.includes(current) && !PAID_STATES.includes(next);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (status === 'failed' || status === 'cancelled') {
      /* release reserved stock — but only if no payment settled */
      if (!PAID_STATES.includes(row.status)) {
        const items = (await client.query('SELECT * FROM order_items WHERE orderNumber = $1', [row.number])).rows.map(mapKeys);
        for (const i of items) await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [i.qty, i.productId]);
      }
    }
    const r = await client.query('UPDATE orders SET status = $2, updatedAt = $3 WHERE number = $1', [row.number, status, now()]);
    if (r.rowCount === 0) throw new Error('update lost');
    if (noDowngrade(row.status, status)) throw new Error(`cannot downgrade ${row.status} → ${status}`);
    await client.query('INSERT INTO order_events(orderNumber, type, detail, at) VALUES ($1,$2,$3,$4)', [row.number, `order.${status}`, detail || null, now()]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return { error: String(err.message || err) };
  } finally {
    client.release();
  }
  return { order: await getOrder(number) };
}

/* Webhook-driven payment settlement (idempotent). */
async function settlePayment(number, outcome, { provider, ref } = {}) {
  const row = await first('SELECT * FROM orders WHERE number = $1', [String(number || '').toUpperCase()]);
  if (!row) return { error: 'unknown order' };

  if (row.status === outcome) {
    await q('INSERT INTO order_events(orderNumber, type, detail, at) VALUES ($1,$2,$3,$4)',
      [row.number, 'payment.duplicate_ignored', `${provider}:${ref}`, now()]);
    return { order: await getOrder(number), changed: false };
  }
  const terminalConflict = ['paid', 'roasting', 'shipped', 'delivered', 'cancelled', 'failed', 'placed'].includes(row.status);
  if (terminalConflict) {
    await q('INSERT INTO order_events(orderNumber, type, detail, at) VALUES ($1,$2,$3,$4)',
      [row.number, 'payment.conflict_ignored', `was ${row.status}, got ${outcome}`, now()]);
    return { order: await getOrder(number), changed: false };
  }
  const result = await setOrderStatus(number, outcome, `${provider}:${ref}`);
  if (result.error) return result;
  return { order: result.order, changed: true };
}

/* ---------- intents ---------- */

async function saveIntent(orderNumber, intent) {
  await q(`INSERT INTO payment_intents(orderNumber, provider, providerRef, amount, currency, redirectUrl, createdAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (orderNumber) DO NOTHING`,
    [orderNumber, intent.provider, intent.providerRef, intent.amount, intent.currency, intent.redirectUrl, now()]);
}

async function getIntent(orderNumber) {
  const row = await first('SELECT * FROM payment_intents WHERE orderNumber = $1', [String(orderNumber || '').toUpperCase()]);
  return row ? mapKeys(row) : null;
}

async function updateIntentRedirect(orderNumber, providerRef, redirectUrl) {
  await q('UPDATE payment_intents SET providerRef = $2, redirectUrl = $3 WHERE orderNumber = $1',
    [String(orderNumber || '').toUpperCase(), providerRef, redirectUrl]);
}

/* ---------- stats ---------- */

async function stats() {
  const PAID_SQL = "status IN ('paid','roasting','shipped','delivered')";
  const revenue = Number((await first(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE ${PAID_SQL}`)).s);
  const count = Number((await first(`SELECT COUNT(*)::int AS n FROM orders WHERE ${PAID_SQL}`)).n);
  const byStatus = (await q('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status')).rows
    .reduce((m, r) => (m[r.status] = r.n, m), {});
  const units = Number((await first(`SELECT COALESCE(SUM(oi.qty),0)::int AS n FROM order_items oi JOIN orders o ON o.number = oi.orderNumber WHERE o.${PAID_SQL}`)).n);
  const cfg = (await getSettings()).storeDefaults;
  const lowStock = (await q('SELECT id, name, stock FROM products WHERE archived = 0 AND stock <= $1 ORDER BY stock', [cfg.lowStockThreshold])).rows;
  const topProducts = (await q(`SELECT oi.productId, SUM(oi.qty)::int AS sold FROM order_items oi
    JOIN orders o ON o.number = oi.orderNumber WHERE o.${PAID_SQL} GROUP BY oi.productId ORDER BY sold DESC LIMIT 5`)).rows;
  return { revenue, orders: count, aov: count ? Math.round(revenue / count) : 0, units, byStatus, lowStock, topProducts };
}

module.exports = {
  pool: db,
  seedIfEmpty, migrate, ensureAdminUser,
  hashPassword, verifyPassword, createUser, getUser, checkLogin, changePassword,
  getSettings, savePaymentMethods, saveStoreDefaults,
  listProducts, getProduct, listZones, listCategories, updateZone, setStock,
  createProduct, updateProduct, deleteProduct, restoreProduct,
  addProductImage, deleteProductImage, setProductImages,
  variantPrice,
  createOrder, getOrder, findOrder, listOrders, setOrderStatus, settlePayment,
  saveIntent, getIntent, updateIntentRedirect,
  stats,
};
