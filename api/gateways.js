'use strict';

/* ============================================================
   SIP OF DEATH — payment gateway adapters
   paymob : REAL implementation (auth → order → payment key → iframe)
   stripe : REAL call sketch (Checkout Session, form-encoded REST)
   mock   : sandbox hosted page; signs a real paymob-style webhook
   Money: integer piasters everywhere.
   ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PAYMOB = {
  apiKey: process.env.PAYMOB_API_KEY || '',
  integrationId: process.env.PAYMOB_INTEGRATION_ID || '',
  iframeId: process.env.PAYMOB_IFRAME_ID || '',
  hmacSecret: process.env.PAYMOB_HMAC_SECRET || '',
  base: process.env.PAYMOB_BASE || 'https://accept.paymob.com/api',
};

const STRIPE = {
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  base: 'https://api.stripe.com/v1',
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const MOCK_ALLOWED = process.env.MOCK_GATEWAY !== 'off' && NODE_ENV !== 'production';

function pickProvider() {
  if (PAYMOB.apiKey && PAYMOB.integrationId && PAYMOB.iframeId) return 'paymob';
  if (STRIPE.secretKey) return 'stripe';
  if (MOCK_ALLOWED) return 'mock';
  return null;
}

/* ---------- HTTPS (no deps) ---------- */

function httpsRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require('https').request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: null, text }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('gateway timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function hmac(algo, secret, payload) {
  return crypto.createHmac(algo, secret).update(payload).digest('hex');
}

/* ---------- intent creation ---------- */

async function createIntent(order, storeUrl) {
  const provider = pickProvider();
  if (!provider) {
    const err = new Error('No payment provider configured (set PAYMOB_* or STRIPE_* env vars; mock disabled).');
    err.code = 'NO_PROVIDER';
    throw err;
  }

  const amountCents = Math.round(order.totals.total * 100);
  const currency = 'EGP';

  if (provider === 'paymob') {
    /* 1. auth token */
    const auth = await httpsRequest(`${PAYMOB.base}/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: PAYMOB.apiKey }),
    });
    if (auth.status !== 201 || !auth.json || !auth.json.token) throw new Error(`paymob auth failed (${auth.status})`);
    const token = auth.json.token;

    /* 2. gateway order */
    const pmOrder = await httpsRequest(`${PAYMOB.base}/ecommerce/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: false,
        amount_cents: amountCents,
        currency,
        merchant_order_id: order.number,
        items: order.items.map((it) => ({
          name: String(it.name).slice(0, 64),
          amount_cents: Math.round(it.unitPrice * 100),
          description: it.weightG ? `${it.weightG}g ${it.grind || 'whole bean'}` : 'merch',
          quantity: it.qty,
        })),
      }),
    });
    if (pmOrder.status !== 201 || !pmOrder.json || !pmOrder.json.id) throw new Error(`paymob order failed (${pmOrder.status})`);

    /* 3. payment key with billing data */
    const nameParts = String(order.customer.name || 'Reaper Customer').trim().split(/\s+/);
    const paymentKey = await httpsRequest(`${PAYMOB.base}/acceptance/payment_keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        order_id: pmOrder.json.id,
        amount_cents: amountCents,
        currency,
        integration_id: Number(PAYMOB.integrationId),
        lock_order_when_paid: true,
        billing_data: {
          first_name: nameParts[0] || 'Reaper',
          last_name: nameParts.slice(1).join(' ') || 'Customer',
          email: order.customer.email,
          phone_number: order.customer.phone || '+20000000000',
          street: order.shipping.address || '—',
          city: order.shipping.city || 'Cairo',
          country: 'EG',
          state: order.shipping.zoneName || 'Cairo',
          building: 'NA', floor: 'NA', apartment: 'NA', postal_code: 'NA',
        },
      }),
    });
    if (paymentKey.status !== 201 || !paymentKey.json || !paymentKey.json.token) {
      throw new Error(`paymob payment key failed (${paymentKey.status})`);
    }

    return {
      provider,
      providerRef: String(pmOrder.json.id),
      amount: amountCents,
      currency,
      redirectUrl: `${PAYMOB.base.replace('/api', '')}/api/acceptance/iframes/${PAYMOB.iframeId}?payment_token=${paymentKey.json.token}`,
    };
  }

  if (provider === 'stripe') {
    /* fold the promo discount proportionally into line amounts
       (Stripe has no negative line items) */
    const factor = order.totals.subtotal > 0
      ? (order.totals.subtotal - order.totals.discount) / order.totals.subtotal
      : 1;
    const lines = [];
    let folded = 0;
    order.items.forEach((it, i) => {
      const isLast = i === order.items.length - 1;
      const raw = Math.round(it.unitPrice * it.qty * 100 * factor);
      const amount = isLast ? Math.round(it.unitPrice * it.qty * 100) - folded : raw;
      folded += raw;
      lines.push({
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amount,
          product_data: { name: `${it.name}${it.weightG ? ` ${it.weightG}g ${it.grind || ''}` : ''}`.slice(0, 120) },
        },
      });
    });
    if (order.totals.shipping > 0) lines.push({ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: Math.round(order.totals.shipping * 100), product_data: { name: 'Shipping' } } });
    if (order.totals.codFee > 0) lines.push({ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: Math.round(order.totals.codFee * 100), product_data: { name: 'COD handling' } } });

    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('client_reference_id', order.number);
    form.set('success_url', `${storeUrl}/#/payment-return?order=${order.number}&provider=stripe&result=success`);
    form.set('cancel_url', `${storeUrl}/#/payment-return?order=${order.number}&provider=stripe&result=cancel`);
    form.set('metadata[order_number]', order.number);
    form.set('payment_intent_data[metadata][order_number]', order.number);
    lines.forEach((l, i) => {
      form.set(`line_items[${i}][quantity]`, l.quantity);
      form.set(`line_items[${i}][price_data][currency]`, l.price_data.currency);
      form.set(`line_items[${i}][price_data][unit_amount]`, l.price_data.unit_amount);
      form.set(`line_items[${i}][price_data][product_data][name]`, l.price_data.product_data.name);
    });

    const resp = await httpsRequest(`${STRIPE.base}/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (resp.status !== 200 || !resp.json || !resp.json.url) {
      const msg = resp.json && resp.json.error ? resp.json.error.message : `HTTP ${resp.status}`;
      throw new Error(`stripe session failed: ${msg}`);
    }
    return { provider, providerRef: resp.json.id, amount: amountCents, currency, redirectUrl: resp.json.url };
  }

  /* mock */
  return {
    provider,
    providerRef: `mock_${crypto.randomBytes(6).toString('hex')}`,
    amount: amountCents,
    currency,
    redirectUrl: `/mock-gateway?order=${encodeURIComponent(order.number)}&amount=${amountCents}`,
  };
}

/* ---------- webhook verification ---------- */

function paymobConcat(txn) {
  const parts = [
    txn.amount_cents, txn.created_at, txn.currency, txn.error_occured,
    txn.has_parent_transaction, txn.id, txn.integration_id, txn.is_3d_secure,
    txn.is_auth, txn.is_capture, txn.is_refunded, txn.is_standalone_payment,
    txn.is_voided, txn.order && txn.order.id, txn.order && txn.order.merchant_order_id,
    txn.owner, txn.pending,
    txn.source_data && txn.source_data.pan,
    txn.source_data && txn.source_data.sub_type,
    txn.source_data && txn.source_data.type,
    txn.success,
  ];
  return parts.map((v) => (v === null || v === undefined ? '' : String(v))).join('');
}

function webhookHmacSecret() {
  if (PAYMOB.hmacSecret) return PAYMOB.hmacSecret;
  if (MOCK_ALLOWED) return process.env.MOCK_HMAC_SECRET || 'sod-mock-hmac-secret';
  return '';
}

function verifyPaymobHmac(rawBody, providedHex) {
  const secret = webhookHmacSecret();
  if (!secret) return { ok: false, reason: 'PAYMOB_HMAC_SECRET not configured' };
  if (!providedHex) return { ok: false, reason: 'missing hmac header' };
  const txn = (() => { try { return JSON.parse(rawBody.toString('utf8')).obj; } catch { return null; } })();
  if (!txn) return { ok: false, reason: 'unparseable payload (expected {obj:…})' };
  const expected = hmac('sha512', secret, paymobConcat(txn));
  if (!safeEqual(expected, String(providedHex).toLowerCase())) return { ok: false, reason: 'signature mismatch' };
  return { ok: true, txn };
}

function verifyStripeSignature(rawBody, header) {
  if (!STRIPE.webhookSecret) return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET not configured' };
  if (!header) return { ok: false, reason: 'missing Stripe-Signature header' };
  const parts = Object.fromEntries(
    String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim())).filter((p) => p.length === 2)
  );
  if (!parts.t || !parts.v1) return { ok: false, reason: 'malformed signature header' };
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (age > 300) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = hmac('sha256', STRIPE.webhookSecret, `${parts.t}.${rawBody.toString('utf8')}`);
  if (!safeEqual(expected, parts.v1)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true, event: (() => { try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; } })() };
}

/* ---------- product image uploads (Supabase Storage) ---------- */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'product-images';

async function uploadProductImage(buffer, contentType, productId) {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[contentType] || 'png';

  /* No Supabase configured → store on local disk (dev / smoke).
     Render's disk is ephemeral, so configure Supabase Storage in production. */
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    const dir = path.join(__dirname, 'data', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${productId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buffer);
    return `/api/data/uploads/${name}`;
  }

  const objectPath = `products/${productId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: buffer,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`supabase storage ${resp.status}: ${detail.slice(0, 200)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}`;
}

/* Sandbox helper: signs + posts a transaction to our own webhook. */
async function simulate(order, origin, outcome) {
  const txn = {
    id: Math.floor(1e9 + Math.random() * 9e9),
    amount_cents: Math.round(order.totals.total * 100),
    created_at: new Date().toISOString().replace('T', ' ').split('.')[0],
    currency: 'EGP',
    error_occured: outcome === 'failure',
    has_parent_transaction: false,
    integration_id: 1,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: false,
    is_voided: false,
    order: { id: 111222333, merchant_order_id: order.number, owner: 'sandbox' },
    owner: 'sandbox',
    pending: false,
    source_data: { pan: '2346', sub_type: 'Mastercard', type: 'card' },
    success: outcome === 'success',
  };
  const signature = hmac('sha512', process.env.MOCK_HMAC_SECRET || 'sod-mock-hmac-secret', paymobConcat(txn));
  const resp = await fetch(`${origin}/api/payments/webhook/paymob`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Paymob-Hmac': signature },
    body: JSON.stringify({ obj: txn }),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
}

module.exports = {
  pickProvider, MOCK_ALLOWED,
  createIntent,
  verifyPaymobHmac, verifyStripeSignature, paymobConcat,
  simulate,
  uploadProductImage,
  config: { PAYMOB, STRIPE },
};
