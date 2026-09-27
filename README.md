# ☠ SIP OF DEATH COFFEE CO. — Full-Stack Store

**STRONG COFFEE. STRONGER YOU.**

A complete e-commerce stack for a premium high-caffeine coffee brand:
a vanilla-JS storefront + an **Express + PostgreSQL (Supabase) API** that
owns catalog, orders, stock, payments (Paymob / Stripe / sandbox mock) and
a full non-technical **admin CMS** (products CRUD with image uploads,
payment-method toggles, quick price/stock edits).

> 🚀 **Deploying?** Read **[DEPLOYMENT.md](./DEPLOYMENT.md)** — a step-by-step
> Arabic guide to host the whole store free on Render + Supabase.

```
Browser (SPA)  ──►  Express API (:5050)  ──►  Postgres (Supabase)
   cart/wishlist      catalog · orders          products · stock
   local only         payments + webhooks       orders · intents
   admin console      admin (HMAC session)      settings · images
```

---

## Quick start (local)

```bash
cd sip-of-death-store/api
npm install
npm start          # needs DATABASE_URL — any Postgres works
```

Set `DATABASE_URL` in `api/.env` (copy `api/.env.example`). On boot the
server creates the schema, seeds the catalog and the first admin user —
no manual setup.

- Storefront + API + admin: **http://localhost:5050**
- Admin console: **http://localhost:5050/admin** (`admin` / `ChangeMe123!`
  by default — change it from SETTINGS after first login).

**Smoke test** (89 assertions — boots its own embedded scratch Postgres
on :5433 and a server on :5055, fully isolated):

```bash
npm run smoke
```

The pure-frontend build still works without the API:
`node build-standalone.js` → `standalone.html` renders from a cached
catalog snapshot, but orders require the API server.

---

## Architecture

```
sip-of-death-store/
  index.html            SPA shell
  styles.css            design system (dark grunge, responsive, a11y)
  config.js             brand, currencies, thresholds, API base
  catalog.js            SHARED catalog — loaded by browser AND required by the API
  data.js               merch art + localStorage keys
  art.js                SVG system: skull-cup emblem, icons, packet renders
  ui.js                 currency fmt, toasts, modal manager, validators
  store.js              client state: local cart/wishlist + server-backed orders
  views.js              route views (home/shop/product/cart/checkout/track/admin…)
  admin.js              admin CMS (orders · products CRUD · stock · zones · payments · settings)
  app.js                hash router, header, mini-cart drawer, boot
  build-standalone.js   single-file build
  render.yaml           one-click Render blueprint
  DEPLOYMENT.md         Arabic deployment guide (Render + Supabase)
  api/
    server.js           Express app: REST + payment intents + webhooks + static
    db.js               Postgres layer (pg pool, transactions, schema + seeds)
    gateways.js         Paymob (real) · Stripe (sketch) · mock · image uploads
    smoke.js            89-assertion end-to-end test (embedded Postgres)
    .env.example        configuration template
    data/               local fallback uploads (gitignored)
```

### Why the server is the authority

- **Pricing:** the client's cart is only a *hint*. `POST /api/orders`
  re-prices every line against the DB (weight multipliers, promos, zone
  fees, free-shipping threshold, COD fee) and stores its own totals.
  Client-computed prices are never trusted.
- **Stock:** reservation happens inside a transaction with a guarded
  `UPDATE … WHERE stock >= qty` — concurrent oversell is impossible
  (verified by the smoke test's parallel-order race check). Failed
  payments release stock; paid orders never do.
- **Payment methods are data, not code:** enabled methods live in the
  `settings` table; disabled methods are rejected server-side even if a
  tampered client tries to submit them.
- **Order numbers** come from a server counter (`SOD-YYYY-NNNNNN`).
- **Tracking** requires order number **+ email** (email is the capability).
- **Admin auth:** username + scrypt password hash, HMAC-signed 12h session
  tokens (invalidated by password change), login rate-limited (5 tries /
  10 min). Paid orders can never be downgraded (409).

### Payment flow

```
checkout ─► POST /api/orders            server prices + reserves stock
              ├─ card  → status "pending_payment" + intent
              │            ├─ paymob  auth → order → payment key → iframe URL
              │            ├─ stripe  Checkout Session (REST sketch)
              │            └─ mock    /mock-gateway sandbox page
              ├─ cod   → status "placed"
              └─ bank_transfer / vodafone_cash → status "placed"
                       + customer gets transfer instructions page
            redirect to hosted gateway (card)
            gateway ─► POST /api/payments/webhook/paymob|stripe
                          HMAC verification, idempotent settle
            admin confirms transfers manually from ORDERS tab
```

Webhook security is enforced before the JSON parser sees the body
(`express.raw` on those routes), signatures are constant-time compared,
replays are ignored, tampered payloads rejected, and paid orders are
protected from late failure events.

Provider selection is automatic: `PAYMOB_*` env → paymob, else
`STRIPE_SECRET_KEY` → stripe, else mock (sandbox only — disabled when
`NODE_ENV=production` or `MOCK_GATEWAY=off`).

## API overview

```
GET  /api/health                      service + provider
GET  /api/catalog                     products · categories · zones · paymentMethods · config
GET  /api/products/:id

POST /api/orders                      create (server re-prices; card → intent)
GET  /api/orders/:number?email=       tracking (email required)

POST /api/payments/intent             re-request gateway redirect for pending order
GET  /api/payments/status/:number     poll payment state
POST /api/payments/webhook/paymob     HMAC-SHA512 verified
POST /api/payments/webhook/stripe     Stripe signed header verified
POST /api/payments/simulate/:number   sandbox only (mock provider)

POST /api/admin/login                 {username,password} → {token}
POST /api/admin/change-password       rotate password (invalidates old sessions)
GET  /api/admin/orders[?status=]      list with items + events
POST /api/admin/orders/:n/status      transition (no downgrades from paid)
PUT  /api/admin/products/:id/stock    set stock
PUT  /api/admin/zones/:id             fee / eta
GET  /api/admin/stats                 revenue (settled only), units, low stock, top sellers

POST   /api/admin/products            create product
PATCH  /api/admin/products/:id        update product
DELETE /api/admin/products/:id        archive product (order history kept)
POST   /api/admin/products/:id/restore
POST   /api/admin/products/:id/images        upload image (Supabase Storage)
DELETE /api/admin/products/:id/images/:img  remove image
PUT    /api/admin/products/:id/images        replace image list
PUT    /api/admin/settings/payments   enable/disable/label payment methods
PUT    /api/admin/settings/store      free-shipping threshold, COD fee/cap, low-stock
```

## Data model (Postgres)

`categories, products, product_images, zones, orders, order_items,
order_events, payment_intents, counters, settings, admin_users` —
created idempotently at boot. Order events form the tracking timeline;
payment intents keep the gateway redirect for re-entry on abandoned
checkouts; settings hold payment methods and store rules; products are
soft-deleted so order history always resolves.

## Frontend behaviour

- Catalog (products, zones, **payment methods**, rules) hydrates from
  `/api/catalog`; a cached snapshot keeps the shop browsable offline.
- Cart + wishlist stay local; checkout submits product ids + qty and the
  server returns the priced order.
- Bank-transfer / Vodafone-Cash orders land on a transfer-instructions
  page with the order number and exact amount.
- 422 responses (stock ran out, promo invalid, unknown zone, disabled
  method) bounce the customer back with the reason toasted.

## Going live

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** (Arabic, step by step):
GitHub → Supabase (Postgres + Storage) → Render blueprint → change the
admin password from `/admin`. Webhooks point at
`POST /api/payments/webhook/paymob` / `/stripe`.
