'use strict';

/* SIP OF DEATH COFFEE CO. — global configuration.
   Catalog data lives in catalog.js (shared with the API server). */

const BRAND = {
  name: 'SIP OF DEATH COFFEE CO.',
  short: 'SIP OF DEATH',
  tagline: 'STRONG COFFEE. STRONGER YOU.',
  established: 2024,
};

/* Storefront currency switcher: price shown = EGP base × rate */
const CURRENCIES = {
  EGP: { code: 'EGP', symbol: 'E£', label: 'Egyptian Pound', rate: 1 },
  USD: { code: 'USD', symbol: '$', label: 'US Dollar', rate: 1 / 48 },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro', rate: 1 / 52 },
};

const STORE = {
  freeShippingThreshold: 800, // EGP — "Add X more for free shipping"
  lowStockThreshold: 4,
  codFee: 15, // flat handling fee for Cash on Delivery
  codMax: 6000, // max COD order value (EGP)
  currency: 'EGP', // active currency code
};

/* API base: '' = same origin (served by api/server.js).
   Override at runtime via localStorage 'sod.api'. */
const API_BASE = '';

const CHECKOUT_STEPS = ['Customer Info', 'Shipping Details', 'Payment', 'Review'];
