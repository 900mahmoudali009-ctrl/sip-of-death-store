'use strict';

/* ============================================================
   SIP OF DEATH — API + storefront server
   Express + PostgreSQL. Serves the static SPA and the REST API
   on one origin (local dev + Render/Koyeb style hosts).
   For Vercel serverless, api/index.js wraps this same app.
   ============================================================ */

const path = require('path');
const express = require('express');
const crypto = require('crypto');
const store = require('./db');
const gateways = require('./gateways');

const PORT = Number.isInteger(+process.env.PORT) && +process.env.PORT > 0 ? +process.env.PORT : 5050;
const STORE_URL = (process.env.STORE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; /* 12h admin sessions */
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

/* one-time schema/seed — safe to call repeatedly (idempotent), shared
   by the standalone boot and the serverless cold-start */
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await store.migrate();
      await store.seedIfEmpty();
      await store.ensureAdminUser();
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

/* ---------- admin session tokens (stateless HMAC, 12h TTL) ---------- */

function issueAdminToken(username, iatMs) {
  const payload = Buffer.from(JSON.stringify({ u: username, iat: iatMs, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `v1.${payload}.${sig}`;
}

function verifyAdminToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return Promise.resolve(null);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(parts[1]).digest('base64url');
  const okSig = sig.length === parts[2].length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]));
  if (!okSig) return Promise.resolve(null);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return Promise.resolve(null); }
  if (!payload.u || typeof payload.exp !== 'number' || Date.now() > payload.exp) return Promise.resolve(null);
  /* tokens issued before the last password change are invalid (async DB check) */
  return store.getUser(payload.u).then((u) => {
    if (u && Number(new Date(u.updatedAt).getTime()) > (payload.iat || 0)) return null;
    return payload.u;
  }).catch(() => null);
}

/* naive in-memory login rate limit (per IP) */
const loginAttempts = new Map();
function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  return rec && rec.until > Date.now();
}
function recordLoginFail(ip) {
  const rec = loginAttempts.get(ip) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= 5) { rec.until = Date.now() + 10 * 60 * 1000; rec.n = 0; }
  loginAttempts.set(ip, rec);
}

const app = express();
app.disable('x-powered-by');

/* Webhook routes FIRST with express.raw — HMAC must run over the exact
   bytes the gateway signed, so the JSON parser must not consume these. */
app.post('/api/payments/webhook/paymob', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const provided = req.headers['x-paymob-hmac'] || new URL(req.url, 'http://x').searchParams.get('hmac');
  const verdict = gateways.verifyPaymobHmac(req.body, provided);
  if (!verdict.ok) return res.status(400).json({ ok: false, error: `webhook rejected: ${verdict.reason}` });

  const txn = verdict.txn;
  const number = String(txn.order && txn.order.merchant_order_id || '').toUpperCase();
  try {
    const result = await store.settlePayment(number, txn.success === true ? 'paid' : 'failed', { provider: 'paymob', ref: txn.id });
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, number, changed: result.changed, status: result.order.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

app.post('/api/payments/webhook/stripe', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const verdict = gateways.verifyStripeSignature(req.body, req.headers['stripe-signature']);
  if (!verdict.ok) return res.status(400).json({ ok: false, error: `webhook rejected: ${verdict.reason}` });

  const event = verdict.event || {};
  const type = event.type || '';
  let number = null;
  let outcome = null;
  const ref = event.data && event.data.object && event.data.object.id;

  if (type === 'checkout.session.completed') {
    const obj = event.data.object;
    number = (obj.metadata && obj.metadata.order_number) || obj.client_reference_id;
    outcome = obj.payment_status === 'paid' ? 'paid' : null;
  } else if (type === 'payment_intent.payment_failed') {
    number = event.data.object.metadata && event.data.object.metadata.order_number;
    outcome = 'failed';
  } else {
    return res.json({ ok: true, ignored: type || 'unknown event' });
  }
  if (!number) return res.status(404).json({ ok: false, error: 'no order reference in event' });
  if (!outcome) return res.json({ ok: true, number, changed: false, status: 'pending' });

  try {
    const result = await store.settlePayment(number, outcome, { provider: 'stripe', ref });
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, number, changed: result.changed, status: result.order.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

/* JSON parser for everything else */
app.use(express.json({ limit: '256kb' }));

/* ---------- auth helpers ---------- */

async function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await verifyAdminToken(token);
  if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.adminUser = user;
  next();
}

function requireUploadedFile(req, res, next) {
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!/^(image\/(png|jpeg|webp|gif|avif)|application\/octet-stream)$/.test(ct)) {
    return res.status(415).json({ ok: false, error: 'image must be png/jpeg/webp/gif/avif, max 5MB' });
  }
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > 5 * 1024 * 1024) {
      aborted = true;
      return res.status(415).json({ ok: false, error: 'image too large — max 5MB' });
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted || res.headersSent) return;
    if (!size) return res.status(415).json({ ok: false, error: 'empty upload' });
    req.rawImage = { buffer: Buffer.concat(chunks), contentType: ct === 'application/octet-stream' ? 'image/png' : ct };
    next();
  });
  req.on('error', () => { if (!res.headersSent) res.status(400).json({ ok: false, error: 'upload failed' }); });
}

/* ---------- catalog ---------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sod-api',
    provider: gateways.pickProvider() || 'none-configured',
    mockAllowed: gateways.MOCK_ALLOWED,
    db: 'postgres',
  });
});

app.get('/api/catalog', async (req, res) => {
  try {
    const [products, categories, zones, settings] = await Promise.all([
      store.listProducts(), store.listCategories(), store.listZones(), store.getSettings(),
    ]);
    res.json({
      ok: true,
      products,
      categories,
      zones,
      paymentMethods: settings.paymentMethods,
      config: settings.storeDefaults,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: `catalog error: ${err.message}` });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.archived) return res.status(404).json({ ok: false, error: 'unknown product' });
    res.json({ ok: true, product: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

/* ---------- orders ---------- */

app.post('/api/orders', async (req, res) => {
  const input = req.body || {};
  const result = await store.createOrder(input);
  if (result.errors) return res.status(422).json({ ok: false, errors: result.errors });

  const order = result.order;

  /* card orders get a payment intent immediately */
  if (order.paymentMethod === 'card') {
    try {
      const intent = await gateways.createIntent(order, STORE_URL);
      await store.saveIntent(order.number, intent);
      return res.status(201).json({ ok: true, order, payment: { provider: intent.provider, redirectUrl: intent.redirectUrl, status: order.status } });
    } catch (err) {
      /* intent failed → roll the order back to failed + release stock */
      await store.setOrderStatus(order.number, 'failed', `intent error: ${err.message}`);
      const failedOrder = await store.getOrder(order.number);
      return res.status(502).json({ ok: false, error: `gateway error: ${err.message}`, order: failedOrder });
    }
  }

  res.status(201).json({ ok: true, order });
});

app.get('/api/orders/:number', async (req, res) => {
  /* email acts as the capability — no email, no read */
  const email = req.query.email;
  if (!email) return res.status(401).json({ ok: false, error: 'email required for lookup' });
  try {
    const order = await store.findOrder(req.params.number, email);
    if (!order) return res.status(404).json({ ok: false, error: 'no order found for those details' });
    res.json({ ok: true, order });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

/* ---------- payments ---------- */

app.post('/api/payments/intent', async (req, res) => {
  const { number } = req.body || {};
  if (!number) return res.status(422).json({ ok: false, error: 'order number required' });

  try {
    const existingIntent = await store.getIntent(number);
    const existingOrder = await store.getOrder(number);
    if (existingOrder && existingIntent && existingOrder.status === 'pending_payment') {
      return res.json({ ok: true, number, provider: existingIntent.provider, status: existingOrder.status, redirectUrl: existingIntent.redirectUrl });
    }
    if (!existingOrder) return res.status(404).json({ ok: false, error: 'unknown order' });

    const intent = await gateways.createIntent(existingOrder, STORE_URL);
    await store.updateIntentRedirect(number, intent.providerRef, intent.redirectUrl);
    return res.json({ ok: true, number, provider: intent.provider, status: existingOrder.status, redirectUrl: intent.redirectUrl });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `gateway error: ${err.message}` });
  }
});

app.get('/api/payments/status/:number', async (req, res) => {
  try {
    const order = await store.getOrder(req.params.number);
    if (!order) return res.status(404).json({ ok: false, error: 'unknown order' });
    const intent = await store.getIntent(order.number);

    res.json({
      ok: true,
      number: order.number,
      provider: intent ? intent.provider : order.paymentMethod,
      status: order.status,
      amount: Math.round(order.totals.total * 100),
      currency: 'EGP',
      updatedAt: order.updatedAt,
      events: order.events.slice(-5),
      redirectUrl: order.status === 'pending_payment' && intent ? intent.redirectUrl : undefined,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

/* ---------- admin: auth ---------- */

app.post('/api/admin/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginBlocked(ip)) return res.status(429).json({ ok: false, error: 'too many attempts — wait 10 minutes' });

  const { username, password } = req.body || {};
  let valid = false;
  let effectiveUser = String(username || '').trim().toLowerCase();
  try {
    if (effectiveUser) {
      valid = await store.checkLogin(effectiveUser, password);
    } else if (String(password || '') === ADMIN_PASSWORD) {
      /* legacy/CLI compatibility: password-only login maps to ADMIN_USERNAME */
      valid = true;
      effectiveUser = ADMIN_USERNAME;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `auth error: ${err.message}` });
  }
  if (!valid) {
    recordLoginFail(ip);
    return res.status(401).json({ ok: false, error: 'wrong username or password' });
  }
  loginAttempts.delete(ip);
  res.json({ ok: true, token: issueAdminToken(effectiveUser, Date.now()), username: effectiveUser });
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(422).json({ ok: false, error: 'currentPassword and newPassword are required' });
  if (String(newPassword).length < 8) return res.status(422).json({ ok: false, error: 'new password must be at least 8 characters' });
  try {
    const changed = await store.changePassword(req.adminUser, currentPassword, newPassword);
    if (!changed) return res.status(401).json({ ok: false, error: 'current password is incorrect' });
    res.json({ ok: true, message: 'password updated — session refreshed', token: issueAdminToken(req.adminUser, Date.now()) });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

/* ---------- admin: orders / zones / stats ---------- */

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await store.listOrders({ status: req.query.status, limit: Math.min(200, +(req.query.limit) || 100) });
    res.json({ ok: true, orders });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

app.post('/api/admin/orders/:number/status', requireAdmin, async (req, res) => {
  const { status, detail } = req.body || {};
  const allowed = ['pending_payment', 'placed', 'paid', 'failed', 'roasting', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(422).json({ ok: false, error: 'invalid status' });
  const result = await store.setOrderStatus(req.params.number, status, detail || 'admin');
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, order: result.order });
});

app.put('/api/admin/products/:id/stock', requireAdmin, async (req, res) => {
  const { stock } = req.body || {};
  try {
    const p = await store.setStock(req.params.id, stock);
    if (!p) return res.status(404).json({ ok: false, error: 'unknown product' });
    res.json({ ok: true, product: p });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.put('/api/admin/zones/:id', requireAdmin, async (req, res) => {
  try {
    const z = await store.updateZone(req.params.id, req.body || {});
    if (!z) return res.status(404).json({ ok: false, error: 'unknown zone' });
    res.json({ ok: true, zone: z });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, stats: await store.stats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: `db error: ${err.message}` });
  }
});

/* ---------- admin: products CRUD ---------- */

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const p = await store.createProduct(req.body || {});
    res.status(201).json({ ok: true, product: p });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.patch('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const p = await store.updateProduct(req.params.id, req.body || {});
    if (!p) return res.status(404).json({ ok: false, error: 'unknown product' });
    res.json({ ok: true, product: p });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const p = await store.deleteProduct(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'unknown product' });
  res.json({ ok: true, product: p });
});

app.post('/api/admin/products/:id/restore', requireAdmin, async (req, res) => {
  const p = await store.restoreProduct(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'unknown product' });
  res.json({ ok: true, product: p });
});

/* ---------- admin: product images (upload → Supabase Storage) ---------- */

app.post('/api/admin/products/:id/images', requireAdmin, requireUploadedFile, async (req, res) => {
  try {
    const url = await gateways.uploadProductImage(req.rawImage.buffer, req.rawImage.contentType, req.params.id);
    const image = await store.addProductImage(req.params.id, url);
    if (!image) return res.status(404).json({ ok: false, error: 'unknown product' });
    res.status(201).json({ ok: true, image });
  } catch (err) {
    res.status(502).json({ ok: false, error: `upload failed: ${err.message}` });
  }
});

app.delete('/api/admin/products/:id/images/:imageId', requireAdmin, async (req, res) => {
  const okDeleted = await store.deleteProductImage(req.params.imageId);
  if (!okDeleted) return res.status(404).json({ ok: false, error: 'unknown image' });
  res.json({ ok: true });
});

app.put('/api/admin/products/:id/images', requireAdmin, async (req, res) => {
  try {
    const p = await store.setProductImages(req.params.id, (req.body || {}).images || []);
    if (!p) return res.status(404).json({ ok: false, error: 'unknown product' });
    res.json({ ok: true, product: p });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

/* ---------- admin: settings (payment methods & store defaults) ---------- */

app.put('/api/admin/settings/payments', requireAdmin, async (req, res) => {
  try {
    const paymentMethods = await store.savePaymentMethods((req.body || {}).paymentMethods);
    res.json({ ok: true, paymentMethods });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.put('/api/admin/settings/store', requireAdmin, async (req, res) => {
  try {
    const storeDefaults = await store.saveStoreDefaults(req.body || {});
    res.json({ ok: true, storeDefaults });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

/* ---------- mock gateway (sandbox only) ---------- */

if (gateways.MOCK_ALLOWED) {
  app.get('/mock-gateway', async (req, res) => {
    const number = String(req.query.order || '');
    const amount = Number(req.query.amount || 0);
    const intent = await store.getIntent(number);
    if (!intent || intent.provider !== 'mock') {
      return res.status(404).send('<h1>Unknown session</h1><p><a href="/">back to store</a></p>');
    }
    const egp = (amount / 100).toLocaleString('en-EG', { style: 'currency', currency: 'EGP' });
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Secure Gateway — SIP OF DEATH</title>
<style>
  body{margin:0;background:#0D0D0D;color:#F5F5F5;font-family:'Trebuchet MS',Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
  .box{width:min(440px,92vw);border:1px solid #333;padding:34px;text-align:center}
  .mark{font-size:34px;letter-spacing:4px;color:#B80000;font-weight:700}
  .amt{font-size:30px;margin:16px 0 4px;font-weight:700}
  .ord{color:#9a9a9a;letter-spacing:2px;font-size:12px;margin-bottom:26px}
  button{width:100%;padding:14px;margin-top:10px;font-size:14px;letter-spacing:2px;border:0;cursor:pointer;font-weight:700}
  .pay{background:#B80000;color:#fff}.pay:hover{background:#e02020}
  .fail{background:none;color:#e02020;border:1px solid #e02020}
  .lock{color:#9a9a9a;font-size:11px;letter-spacing:1px;margin-top:22px}
</style></head><body>
  <div class="box">
    <div class="mark">SIP OF DEATH · PAY</div>
    <div class="amt">${egp}</div>
    <div class="ord">ORDER ${number} · SANDBOX · NO REAL CHARGE</div>
    <button class="pay" onclick="sim('success')">PAY ${egp}</button>
    <button class="fail" onclick="sim('failure')">SIMULATE DECLINE</button>
    <div class="lock">🔒 Simulated 3-D Secure challenge</div>
  </div>
<script>
  let busy = false;
  async function sim(outcome){
    if (busy) return; busy = true;
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    await fetch('/api/payments/simulate/${encodeURIComponent(number)}', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ outcome })
    });
    location.href = '${STORE_URL}/#/payment-return?order=${encodeURIComponent(number)}&provider=mock&result=' + (outcome === 'success' ? 'success' : 'failure');
  }
</script>
</body></html>`);
  });

  app.post('/api/payments/simulate/:number', async (req, res) => {
    try {
      const order = await store.getOrder(req.params.number);
      if (!order) return res.status(404).json({ ok: false, error: 'unknown order' });
      const intent = await store.getIntent(order.number);
      if (!intent || intent.provider !== 'mock') {
        return res.status(400).json({ ok: false, error: `simulation only allowed for mock provider (order provider: ${intent ? intent.provider : 'none'})` });
      }
      const outcome = req.body && req.body.outcome === 'failure' ? 'failure' : 'success';
      const origin = `${req.protocol}://${req.get('host')}`;
      const result = await gateways.simulate(order, origin, outcome);
      res.status(result.status).json({ simulated: outcome, ...result.body });
    } catch (err) {
      res.status(500).json({ ok: false, error: `db error: ${err.message}` });
    }
  });
}

/* uploaded images land in api/data/uploads when Supabase is not configured */
app.use('/api/data/uploads', express.static(path.join(__dirname, 'data', 'uploads'), { maxAge: '1d', immutable: true }));

/* ---------- static storefront ---------- */

const STATIC_ROOT = path.join(__dirname, '..');
app.use(express.static(STATIC_ROOT, { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not found' });
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

/* ---------- boot ---------- */

async function boot() {
  await ensureReady();
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log('☠ SIP OF DEATH API');
      console.log(`   storefront + API → http://localhost:${PORT}`);
      console.log(`   postgres → ${String(process.env.DATABASE_URL || '').replace(/\/\/([^:]+):[^@]*@/, '//\$1:***@')}`);
      console.log(`   provider: ${gateways.pickProvider() || 'NONE — set PAYMOB_* / STRIPE_* env vars'}`);
      console.log(`   admin login: username "${ADMIN_USERNAME}" (default password — CHANGE IT from /admin → Settings)`);
      resolve();
    });
  });
}

/* Run the server only when executed directly (node server.js) —
   when required from the Vercel serverless wrapper (api/index.js)
   just export the app. */
if (require.main === module) {
  boot().catch((err) => {
    console.error('boot failed:', err.message);
    process.exit(1);
  });
}

module.exports = { app, boot, ensureReady };
