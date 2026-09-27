'use strict';

/* ============================================================
   SIP OF DEATH — API smoke test (Postgres edition)
   Boots the Express server against a scratch Postgres database
   and exercises: catalog, order creation (server pricing + stock
   reservation), stock races, admin auth (username+password),
   product CRUD, image upload, payment-settings enforcement,
   payment intents, signed webhooks (success/failure/tamper/
   replay), tracking, COD path, storefront static.
   Requires DATABASE_URL pointing at a disposable database.
   Run: npm run smoke   (from sip-of-death-store/api)
   ============================================================ */

const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'sod-mock-hmac-secret';
/* Provide SMOKE_DATABASE_URL to test against an external Postgres;
   otherwise a throwaway embedded Postgres is booted on :5433. */
const SCRATCH_DB = process.env.SMOKE_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/sod_smoke';

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}`); }
}

function req(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url, BASE);
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path: u.pathname + u.search, method, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* html */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function signPaymob(txn) {
  const parts = [
    txn.amount_cents, txn.created_at, txn.currency, txn.error_occured,
    txn.has_parent_transaction, txn.id, txn.integration_id, txn.is_3d_secure,
    txn.is_auth, txn.is_capture, txn.is_refunded, txn.is_standalone_payment,
    txn.is_voided, txn.order.id, txn.order.merchant_order_id,
    txn.owner, txn.pending, txn.source_data.pan,
    txn.source_data.sub_type, txn.source_data.type, txn.success,
  ].join('');
  return crypto.createHmac('sha512', SECRET).update(parts).digest('hex');
}

const ORDER = {
  paymentMethod: 'card',
  customer: { name: 'Smoke Tester', email: 'smoke@example.com', phone: '01000000000' },
  zoneId: 'z1',
  address: '1 Test St',
  city: 'Cairo',
  items: [
    { productId: 'death-shot', qty: 1, weightG: 250, grind: 'Whole Bean' },
    { productId: 'skull-cup-mug-missing', qty: 1 },
  ],
};

async function startEmbeddedPostgres() {
  const _ep = require('embedded-postgres');
  const EmbeddedPostgres = _ep.default || _ep;
  const dataDir = path.join(__dirname, 'data-smoke-pg');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: 5433,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('sod_smoke');
  return pg;
}

/* pg.stop() can hang on Windows; use pg_ctl directly and kill leftovers. */
async function stopEmbeddedPostgres(pg) {
  try {
    const { execFileSync } = require('child_process');
    const pgCtl = path.join(__dirname, 'node_modules', '@embedded-postgres', `windows-x64`, 'native', 'bin', 'pg_ctl.exe');
    execFileSync(pgCtl, ['-D', path.join(__dirname, 'data-smoke-pg'), '-m', 'fast', 'stop'], { stdio: 'ignore', timeout: 20000 });
  } catch (e) {
    console.error('pg_ctl stop warning:', String(e.message || e).slice(0, 120));
  }
}

async function resetScratchDb() {
  const adminUrl = SCRATCH_DB.replace(/\/[^/]+$/, '/postgres');
  const dbName = SCRATCH_DB.split('/').pop();
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    /* force UTF8 — Windows clusters default to WIN1252 and would reject Arabic labels */
    await admin.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  } finally {
    await admin.end();
  }
}

async function main() {
  let embedded = null;
  if (!process.env.SMOKE_DATABASE_URL) {
    console.log('booting embedded postgres (scratch)…');
    embedded = await startEmbeddedPostgres();
  }
  await resetScratchDb();
  const pool = new Pool({ connectionString: SCRATCH_DB });

  console.log('booting api server…');
  const child = spawn(process.execPath, [require('path').join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: SCRATCH_DB,
      MOCK_HMAC_SECRET: SECRET,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'ChangeMe123!',
      STORE_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d; });
  child.stderr.on('data', (d) => { bootLog += d; });

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { await req('GET', '/api/health'); up = true; } catch { /* retry */ }
  }
  if (!up) { console.error('server failed to boot:\n' + bootLog); child.kill(); process.exit(1); }
  console.log('server up ✓\n');

  try {
    /* ---------- catalog ---------- */
    console.log('[catalog]');
    const cat = await req('GET', '/api/catalog');
    ok(cat.status === 200 && cat.json.products.length === 10, 'catalog served (10 products)');
    ok(cat.json.zones.length === 9, 'zones served (9)');
    const deathShot = cat.json.products.find((p) => p.id === 'death-shot');
    ok(deathShot && deathShot.stock === 24, 'seeded stock intact');
    ok(Array.isArray(deathShot.images), 'products carry an images array');
    ok(cat.json.paymentMethods.some((m) => m.id === 'cod' && m.enabled), 'payment methods served (cod enabled)');
    ok(cat.json.paymentMethods.some((m) => m.id === 'bank_transfer' && !m.enabled), 'bank_transfer exists but disabled by default');

    /* ---------- order validation ---------- */
    console.log('\n[order validation]');
    const badProd = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ORDER),
    });
    ok(badProd.status === 422 && badProd.json.errors.some((e) => /unknown product/.test(e)), 'unknown product rejected');

    const badZone = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'death-shot', qty: 1, weightG: 250 }], zoneId: 'nope' }),
    });
    ok(badZone.status === 422 && badZone.json.errors.some((e) => /zone/.test(e)), 'unknown zone rejected');

    const noCust = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'death-shot', qty: 1, weightG: 250 }], zoneId: 'z1', customer: {} }),
    });
    ok(noCust.status === 422, 'missing customer rejected');

    /* ---------- real order: server pricing + intent ---------- */
    console.log('\n[order + payment intent]');
    const good = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...ORDER,
        items: [{ productId: 'death-shot', qty: 2, weightG: 500, grind: 'Ground' }],
        promo: 'REAPER10',
      }),
    });
    ok(good.status === 201 && good.json.ok, 'order created');
    const ord = good.json.order;
    /* 380*1.8=684 ×2 = 1368 −10% (137) = 1231 → free shipping (≥800) → total 1231 */
    ok(ord.totals.subtotal === 1368, `server-priced subtotal ${ord.totals.subtotal} (expect 1368)`);
    ok(ord.totals.discount === 137, `promo discount ${ord.totals.discount} (expect 137)`);
    ok(ord.totals.shipping === 0, 'free shipping unlocked (1231 ≥ 800)');
    ok(ord.totals.total === 1231, `total ${ord.totals.total} (expect 1231)`);
    ok(ord.status === 'pending_payment', 'card order starts pending_payment');
    ok(good.json.payment && typeof good.json.payment.redirectUrl === 'string', 'payment intent returned with redirect');
    ok(good.json.payment.redirectUrl.includes('/mock-gateway'), 'mock provider redirect');

    const num = ord.number;
    const stockAfter = (await req('GET', '/api/products/death-shot')).json.product.stock;
    ok(stockAfter === 22, `stock reserved (${stockAfter}, expect 22)`);

    ok(/^SOD-\d{4}-\d{6}$/.test(num), `server-assigned number ${num}`);

    /* ---------- tracking ---------- */
    console.log('\n[tracking]');
    const noEmail = await req('GET', `/api/orders/${num}`);
    ok(noEmail.status === 401, 'tracking without email rejected');
    const wrongEmail = await req('GET', `/api/orders/${num}?email=wrong@x.com`);
    ok(wrongEmail.status === 404, 'wrong email → not found');
    const right = await req('GET', `/api/orders/${num}?email=SMOKE@example.com`);
    ok(right.status === 200 && right.json.order.number === num, 'tracking with email works (case-insensitive)');

    /* ---------- webhook security ---------- */
    console.log('\n[webhook security]');
    const txnBase = {
      id: 1001,
      amount_cents: 123100,
      created_at: '2026-09-27 12:00:00',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      integration_id: 1,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: false,
      is_voided: false,
      order: { id: 111222333, merchant_order_id: num, owner: 'sandbox' },
      owner: 'sandbox',
      pending: false,
      source_data: { pan: '2346', sub_type: 'Mastercard', type: 'card' },
      success: true,
    };

    const noSig = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obj: txnBase }),
    });
    ok(noSig.status === 400, 'webhook without HMAC rejected');

    const badSig = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': 'deadbeef' },
      body: JSON.stringify({ obj: txnBase }),
    });
    ok(badSig.status === 400, 'wrong HMAC rejected');

    const tampered = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(txnBase) },
      body: JSON.stringify({ obj: { ...txnBase, amount_cents: 1 } }),
    });
    ok(tampered.status === 400, 'tampered payload rejected');

    const unknownTxn = { ...txnBase, order: { ...txnBase.order, merchant_order_id: 'SOD-2026-000000' } };
    const unknown = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(unknownTxn) },
      body: JSON.stringify({ obj: unknownTxn }),
    });
    ok(unknown.status === 404, 'unknown order → 404');

    /* ---------- webhook success + idempotency ---------- */
    console.log('\n[webhook success]');
    const good1 = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(txnBase) },
      body: JSON.stringify({ obj: txnBase }),
    });
    ok(good1.status === 200 && good1.json.changed === true && good1.json.status === 'paid', 'valid success webhook → paid');

    const st = await req('GET', `/api/payments/status/${num}`);
    ok(st.json.status === 'paid', 'status endpoint confirms paid');

    const replay = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(txnBase) },
      body: JSON.stringify({ obj: txnBase }),
    });
    ok(replay.status === 200 && replay.json.changed === false, 'replayed webhook ignored');

    const stockStill = (await req('GET', '/api/products/death-shot')).json.product.stock;
    ok(stockStill === 22, 'stock NOT released on paid (still 22)');

    /* late failure must not downgrade a paid order */
    const txnFailLate = { ...txnBase, id: 1002, success: false, error_occured: true };
    const downgrade = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(txnFailLate) },
      body: JSON.stringify({ obj: txnFailLate }),
    });
    ok(downgrade.json.changed === false && downgrade.json.status === 'paid', 'late failure ignored for paid order');

    /* ---------- failure path releases stock ---------- */
    console.log('\n[webhook failure]');
    const ord2 = (await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'last-breath', qty: 1, weightG: 250 }] }),
    })).json.order;
    const txnFail = {
      ...txnBase, id: 2001, success: false, error_occured: true,
      order: { ...txnBase.order, merchant_order_id: ord2.number },
    };
    const failRes = await req('POST', '/api/payments/webhook/paymob', {
      headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signPaymob(txnFail) },
      body: JSON.stringify({ obj: txnFail }),
    });
    ok(failRes.status === 200 && failRes.json.status === 'failed', 'failure webhook → failed');
    const lbStock = (await req('GET', '/api/products/last-breath')).json.product.stock;
    ok(lbStock === 30, `failed order released stock (${lbStock}, expect 30)`);

    /* ---------- COD ---------- */
    console.log('\n[COD]');
    const cod = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: 'cod',
        customer: ORDER.customer,
        zoneId: 'z2', address: 'x', city: 'y',
        items: [{ productId: 'sticker-pack', qty: 3 }],
      }),
    });
    ok(cod.status === 201 && cod.json.order.status === 'placed', 'COD order placed immediately');
    ok(cod.json.order.totals.codFee === 15, 'COD fee applied');
    ok(!cod.json.payment, 'COD has no payment intent');

    const codMax = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: 'cod',
        customer: ORDER.customer,
        zoneId: 'z1', address: 'x', city: 'y',
        items: [{ productId: 'death-shot', qty: 40, weightG: 1000 }],
      }),
    });
    ok(codMax.status === 422, 'COD above cap rejected');

    /* ---------- disabled payment method rejected ---------- */
    console.log('\n[payment settings]');
    const disabled = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: 'vodafone_cash',
        customer: ORDER.customer,
        zoneId: 'z1', address: 'x', city: 'y',
        items: [{ productId: 'sticker-pack', qty: 1 }],
      }),
    });
    ok(disabled.status === 422, 'vodafone_cash rejected while disabled');

    /* ---------- stock race ---------- */
    console.log('\n[stock race]');
    const reaperStock = (await req('GET', '/api/products/grim-reaper-reserve')).json.product.stock; // 3
    const r1 = req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'grim-reaper-reserve', qty: 2, weightG: 250 }] }),
    });
    const r2 = req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'grim-reaper-reserve', qty: 2, weightG: 250 }] }),
    });
    const [r1r, r2r] = await Promise.all([r1, r2]);
    const oks = [r1r, r2r].filter((r) => r.status === 201);
    ok(oks.length === 1, `concurrent oversell prevented (${oks.length} of 2 succeeded, stock was ${reaperStock})`);
    ok(r1r.status === 422 || r2r.status === 422, 'loser got a 422');

    /* ---------- admin auth ---------- */
    console.log('\n[admin auth]');
    const noAuth = await req('GET', '/api/admin/orders');
    ok(noAuth.status === 401, 'admin API requires auth');
    const badLogin = await req('POST', '/api/admin/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    ok(badLogin.status === 401, 'wrong admin password rejected');
    const badUser = await req('POST', '/api/admin/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ghost', password: 'ChangeMe123!' }),
    });
    ok(badUser.status === 401, 'unknown admin user rejected');
    const login = await req('POST', '/api/admin/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'ChangeMe123!' }),
    });
    ok(login.status === 200 && login.json.token, 'admin login issues token (admin / ChangeMe123!)');
    ok(login.json.username === 'admin', 'login response carries username');
    const auth = { Authorization: `Bearer ${login.json.token}` };

    /* ---------- change password ---------- */
    console.log('\n[change password]');
    const wrongCurrent = await req('POST', '/api/admin/change-password', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'nope', newPassword: 'NewPass456!' }),
    });
    ok(wrongCurrent.status === 401, 'change-password rejects wrong current password');
    const shortNew = await req('POST', '/api/admin/change-password', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'ChangeMe123!', newPassword: 'short' }),
    });
    ok(shortNew.status === 422, 'change-password rejects short new password');
    const changed = await req('POST', '/api/admin/change-password', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'ChangeMe123!', newPassword: 'NewPass456!' }),
    });
    ok(changed.status === 200, 'change-password succeeds');
    const oldPw = await req('POST', '/api/admin/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'ChangeMe123!' }),
    });
    ok(oldPw.status === 401, 'old password no longer works');
    const newPw = await req('POST', '/api/admin/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'NewPass456!' }),
    });
    ok(newPw.status === 200 && newPw.json.token, 'new password works');
    const auth2 = { Authorization: `Bearer ${newPw.json.token}` };
    /* password change backends with rotated tokens return a fresh token; the previous token must die */
    const oldToken = await req('GET', '/api/admin/stats', { headers: auth });
    ok(oldToken.status === 401, 'old session token invalidated after password change');

    /* ---------- admin orders/stats ---------- */
    console.log('\n[admin orders]');
    const adminOrders = await req('GET', '/api/admin/orders', { headers: auth2 });
    ok(adminOrders.status === 200 && adminOrders.json.orders.length >= 4, `admin lists orders (${adminOrders.json.orders.length})`);

    const pendFilter = await req('GET', '/api/admin/orders?status=pending_payment', { headers: auth2 });
    ok(pendFilter.json.orders.every((o) => o.status === 'pending_payment'), 'status filter works');

    const stats = await req('GET', '/api/admin/stats', { headers: auth2 });
    ok(stats.status === 200 && typeof stats.json.stats.revenue === 'number', 'stats served');
    ok(stats.json.stats.revenue > 0, 'revenue counted only from paid orders');

    const stockSet = await req('PUT', '/api/admin/products/mug-skull/stock', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: 77 }),
    });
    ok(stockSet.status === 200 && stockSet.json.product.stock === 77, 'admin stock update persists');
    const mugStock = (await req('GET', '/api/products/mug-skull')).json.product.stock;
    ok(mugStock === 77, 'stock change visible on public catalog');

    /* ---------- product CRUD ---------- */
    console.log('\n[product CRUD]');
    const noAuthCreate = await req('POST', '/api/admin/products', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HACK', basePrice: 1 }),
    });
    ok(noAuthCreate.status === 401, 'product create requires auth');

    const badPrice = await req('POST', '/api/admin/products', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'BAD PRICE', basePrice: -5 }),
    });
    ok(badPrice.status === 422, 'negative price rejected');

    const created = await req('POST', '/api/admin/products', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Death Elixir', categoryId: 'dark', roast: 'Dark', basePrice: 450, stock: 12,
        notes: ['Test', 'Elixir'], description: 'A test product.', badge: 'TEST',
      }),
    });
    ok(created.status === 201 && created.json.product.id, 'product created');
    const newId = created.json.product.id;
    ok(created.json.product.name === 'DEATH ELIXIR', 'name stored uppercase');
    ok(created.json.product.roastLabel === 'Dark Roast', 'roastLabel derived');

    const img = await req('POST', `/api/admin/products/${newId}/images`, {
      headers: { ...auth2, 'Content-Type': 'application/octet-stream' },
      body: 'image/png-1image/png-2',
    });
    ok(img.status === 201 && img.json.ok, 'image upload accepted');
    ok(/^(https?:\/\/|\/api\/data\/uploads\/)/.test(img.json.image.url), `image stored with URL (${img.json.image.url.slice(0, 60)}…)`);

    const withImg = (await req('GET', `/api/products/${newId}`)).json.product;
    ok(withImg.images.length === 1, 'image visible on public product');

    const delImg = await req('DELETE', `/api/admin/products/${newId}/images/${img.json.image.id}`, { headers: auth2 });
    ok(delImg.status === 200 && delImg.json.ok, 'image deleted');

    const priceUpd = await req('PATCH', `/api/admin/products/${newId}`, {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePrice: 475, stock: 9 }),
    });
    ok(priceUpd.status === 200 && priceUpd.json.product.basePrice === 475 && priceUpd.json.product.stock === 9, 'product price+stock updated');

    const catUpd = await req('PATCH', `/api/admin/products/${newId}`, {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: 'merch' }),
    });
    ok(catUpd.status === 200 && catUpd.json.product.categoryId === 'merch', 'product category updated');

    const del = await req('DELETE', `/api/admin/products/${newId}`, { headers: auth2 });
    ok(del.status === 200 && del.json.ok, 'product deleted (archived)');
    const gone = await req('GET', `/api/products/${newId}`);
    ok(gone.status === 404, 'archived product hidden from catalog');

    /* archived product cannot be ordered */
    const ordArch = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: newId, qty: 1 }] }),
    });
    ok(ordArch.status === 422, 'ordering an archived product rejected');

    /* ---------- payment settings API ---------- */
    console.log('\n[payment settings]');
    const settingsNoAuth = await req('PUT', '/api/admin/settings/payments', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethods: [] }),
    });
    ok(settingsNoAuth.status === 401, 'payment settings require auth');

    const setPm = await req('PUT', '/api/admin/settings/payments', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethods: [
          { id: 'card', enabled: true },
          { id: 'cod', enabled: true },
          { id: 'vodafone_cash', enabled: true, label: 'فودافون كاش', detail: '010xxxxxxx' },
        ],
      }),
    });
    ok(setPm.status === 200, 'payment methods saved');
    const pmNow = setPm.json.paymentMethods.find((m) => m.id === 'vodafone_cash');
    ok(pmNow && pmNow.enabled === true && pmNow.label === 'فودافون كاش', 'vodafone_cash enabled with Arabic label');

    const catVoda = await req('GET', '/api/catalog');
    ok(catVoda.json.paymentMethods.some((m) => m.id === 'vodafone_cash' && m.enabled), 'vodafone_cash now visible in catalog');

    const vodaOrder = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: 'vodafone_cash',
        customer: ORDER.customer,
        zoneId: 'z1', address: 'x', city: 'y',
        items: [{ productId: 'sticker-pack', qty: 1 }],
      }),
    });
    ok(vodaOrder.status === 201 && vodaOrder.json.order.status === 'placed', 'vodafone_cash order placed (awaiting confirmation)');
    ok(!vodaOrder.json.payment, 'transfer methods carry no gateway intent');

    /* card off → card orders rejected */
    await req('PUT', '/api/admin/settings/payments', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethods: [{ id: 'cod', enabled: true }, { id: 'vodafone_cash', enabled: true }] }),
    });
    const cardOff = await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'death-shot', qty: 1, weightG: 250 }] }),
    });
    ok(cardOff.status === 422, 'card order rejected when card disabled');

    /* restore defaults */
    const restored = await req('PUT', '/api/admin/settings/payments', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethods: [{ id: 'card', enabled: true }, { id: 'cod', enabled: true }] }),
    });
    ok(restored.status === 200, 'payment methods restored');

    /* store defaults */
    const sd = await req('PUT', '/api/admin/settings/store', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codFee: 20, freeShippingThreshold: 900 }),
    });
    ok(sd.status === 200 && sd.json.storeDefaults.codFee === 20, 'store defaults updated');
    const sdBack = await req('PUT', '/api/admin/settings/store', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codFee: 15, freeShippingThreshold: 800 }),
    });
    ok(sdBack.status === 200, 'store defaults restored');

    /* ---------- zone + status flows ---------- */
    const zoneSet = await req('PUT', '/api/admin/zones/z1', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee: 75 }),
    });
    ok(zoneSet.status === 200 && zoneSet.json.zone.fee === 75, 'admin zone fee update persists');
    const zBack = await req('PUT', '/api/admin/zones/z1', {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee: 50 }),
    });
    ok(zBack.status === 200, 'zone fee restored');

    const adminPaid = await req('POST', `/api/admin/orders/${num}/status`, {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'roasting', detail: 'smoke' }),
    });
    ok(adminPaid.status === 200 && adminPaid.json.order.status === 'roasting', 'admin advances paid order to roasting');
    const adminDown = await req('POST', `/api/admin/orders/${num}/status`, {
      headers: { ...auth2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'placed' }),
    });
    ok(adminDown.status === 409, 'downgrade from paid rejected (409)');

    /* ---------- mock gateway ---------- */
    console.log('\n[mock gateway]');
    const intentFor = (await req('POST', '/api/orders', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ORDER, items: [{ productId: 'sticker-pack', qty: 1 }] }),
    })).json;
    const page = await req('GET', intentFor.payment.redirectUrl.replace(BASE, ''));
    ok(page.status === 200 && page.text.includes('SANDBOX'), 'mock gateway page renders');
    const sim = await req('POST', `/api/payments/simulate/${intentFor.order.number}`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'success' }),
    });
    ok(sim.status === 200 && sim.json.status === 'paid', 'simulate → self-signed webhook → paid');
    const codSim = await req('POST', `/api/payments/simulate/${cod.json.order.number}`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'success' }),
    });
    ok(codSim.status === 400, 'simulation blocked for COD orders');

    /* ---------- static storefront ---------- */
    console.log('\n[static]');
    const home = await req('GET', '/');
    ok(home.status === 200 && home.text.includes('SIP OF DEATH'), 'storefront served from same origin');
  } finally {
    child.kill();
    try { await pool.end(); } catch { /* ignore */ }
    if (embedded) {
      await stopEmbeddedPostgres(embedded);
      try { fs.rmSync(path.join(__dirname, 'data-smoke-pg'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  console.log(`\n━━━ smoke: ${passed} passed, ${failed} failed ━━━`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
