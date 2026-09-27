'use strict';

/* ============================================================
   SIP OF DEATH — shared catalog (single source of truth)
   Loaded by the browser (script tag) and by the API server
   (require). Changing prices/stock defaults happens here.
   ============================================================ */

(function (root) {
  const CATEGORIES = [
    { id: 'dark',    name: 'Dark Roast / High Intensity', tag: 'BOLD · INTENSE · LETHAL' },
    { id: 'medium',  name: 'Medium Roast / Balanced',     tag: 'SMOOTH · BALANCED' },
    { id: 'espresso',name: 'Espresso Blends',             tag: 'RICH · POWERFUL' },
    { id: 'merch',   name: 'Merch & Accessories',         tag: 'MUGS · APPAREL · STICKERS' },
  ];

  const ROASTS = ['Dark', 'Medium', 'Espresso'];

  const WEIGHTS = [
    { g: 250, label: '250g', mult: 1 },
    { g: 500, label: '500g', mult: 1.8 },
    { g: 1000, label: '1kg', mult: 3.2 },
  ];
  const GRINDS = ['Whole Bean', 'Ground'];

  const PRODUCTS = [
    {
      id: 'death-shot', name: 'DEATH SHOT', categoryId: 'dark', roast: 'Dark',
      roastLabel: 'Dark Roast', shortName: 'Death Shot',
      notes: ['Bold', 'Intense', 'Lethal'],
      description: 'Our flagship assassination of drowsiness. Dark-roasted robusta-forward blend with a smoke-and-cocoa punch, engineered for maximum caffeine per sip. If mornings had a final boss, this is the weapon.',
      basePrice: 380, rating: 4.9, reviewsCount: 214, stock: 24,
      badge: 'FLAGSHIP', caffeine: 'High caffeine', art: '#B80000',
      origin: 'Brazil · Vietnam', process: 'Natural',
    },
    {
      id: 'last-breath', name: 'LAST BREATH', categoryId: 'medium', roast: 'Medium',
      roastLabel: 'Medium Roast', shortName: 'Last Breath',
      notes: ['Smooth', 'Balanced', 'Deadly'],
      description: 'Smooth operator. A medium roast with caramel sweetness, light nuttiness and a clean finish — the polite way to destroy a long day. 100% arabica from high-altitude estates.',
      basePrice: 340, rating: 4.7, reviewsCount: 168, stock: 30,
      badge: 'BEST SELLER', caffeine: 'Medium caffeine', art: '#C9A36A',
      origin: 'Colombia · Ethiopia', process: 'Washed',
    },
    {
      id: 'wake-the-dead', name: 'WAKE THE DEAD', categoryId: 'espresso', roast: 'Espresso',
      roastLabel: 'Espresso Blend', shortName: 'Wake the Dead',
      notes: ['Rich', 'Powerful', 'Unstoppable'],
      description: 'Crema like a shroud. Heavy-bodied espresso blend with dark chocolate, molasses and a whisper of burnt sugar. Pull it short and violent or stretch it into a flat white that raises the dead.',
      basePrice: 420, rating: 4.8, reviewsCount: 142, stock: 18,
      badge: 'NEW', caffeine: 'High caffeine', art: '#C9A36A',
      origin: 'Sumatra · Brazil', process: 'Wet-hulled',
    },
    {
      id: 'grim-reaper-reserve', name: 'GRIM REAPER RESERVE', categoryId: 'dark', roast: 'Dark',
      roastLabel: 'Dark Roast', shortName: 'Reaper Reserve',
      notes: ['Smoky', 'Syrupy', 'Merciless'],
      description: 'Small-batch micro-lot, roasted only on full moons (approximately). Syrupy body, burnt orange peel, bitter cacao nibs and a finish that outlives you. Numbered bags, strictly limited.',
      basePrice: 520, rating: 5.0, reviewsCount: 61, stock: 3,
      badge: 'LIMITED', caffeine: 'Extreme caffeine', art: '#7A0000',
      origin: 'Guatemala · Uganda', process: 'Honey',
    },
    {
      id: 'midnight-toast', name: 'MIDNIGHT TOAST', categoryId: 'medium', roast: 'Medium',
      roastLabel: 'Medium Roast', shortName: 'Midnight Toast',
      notes: ['Toasty', 'Velvety', 'Sly'],
      description: 'The night-shift companion. Toasted almond, butter cookie and a velvet body with low acidity. Crafted for those whose darkest hour is just getting started.',
      basePrice: 350, rating: 4.6, reviewsCount: 97, stock: 26,
      badge: null, caffeine: 'Medium caffeine', art: '#8a8a8a',
      origin: 'Honduras · Peru', process: 'Washed',
    },
    {
      id: 'graveyard-shift', name: 'GRAVEYARD SHIFT', categoryId: 'espresso', roast: 'Espresso',
      roastLabel: 'Espresso Blend', shortName: 'Graveyard Shift',
      notes: ['Dark chocolate', 'Crema', 'Fearless'],
      description: 'Tuned for machines and maniacs. Dense crema, bitter cocoa and roasted hazelnut built to cut through milk without vanishing. The official fuel of everything that happens after 2 a.m.',
      basePrice: 400, rating: 4.7, reviewsCount: 88, stock: 22,
      badge: null, caffeine: 'High caffeine', art: '#5c0000',
      origin: 'Brazil · India Cherry', process: 'Pulped natural',
    },
    {
      id: 'mug-skull', name: 'SKULL CUP MUG', categoryId: 'merch', roast: null,
      roastLabel: 'Merch', shortName: 'Skull Mug',
      notes: ['330ml', 'Matte black', 'Gloss skull'],
      description: 'Matte-black ceramic mug with the skull-cup emblem in glossy bone-white. Dishwasher safe, emotionally unsafe for decaf drinkers.',
      basePrice: 220, rating: 4.8, reviewsCount: 76, stock: 40,
      badge: null, caffeine: null, art: null,
    },
    {
      id: 'cup-black', name: 'REAPER TO-GO CUP', categoryId: 'merch', roast: null,
      roastLabel: 'Merch', shortName: 'To-Go Cup',
      notes: ['400ml', 'Steel', 'Keeps heat 6h'],
      description: 'Double-walled stainless reaper cup with the brand X etched on the lid. Keeps your brew lethal for six hours. Fits car holders and hearse cupholders alike.',
      basePrice: 320, rating: 4.5, reviewsCount: 41, stock: 25,
      badge: null, caffeine: null, art: null,
    },
    {
      id: 'tee-no-mercy', name: 'NO MERCY TEE', categoryId: 'merch', roast: null,
      roastLabel: 'Merch', shortName: 'No Mercy Tee',
      notes: ['Oversized', 'Cotton 240gsm', 'Brush print'],
      description: 'Heavyweight 240gsm cotton tee, boxy cut, with the brush-stroke SIP OF DEATH back print. Pre-shrunk so it survives whatever you do to it.',
      basePrice: 380, rating: 4.6, reviewsCount: 53, stock: 32,
      badge: null, caffeine: null, art: null,
    },
    {
      id: 'sticker-pack', name: 'DEATH STICKER PACK', categoryId: 'merch', roast: null,
      roastLabel: 'Merch', shortName: 'Sticker Pack',
      notes: ['12 pcs', 'Vinyl', 'Weatherproof'],
      description: 'Twelve weatherproof vinyl stickers: skull cup, brush X, ONE SIP stamp and more. Laptops, scooters, coffins — she dies nowhere.',
      basePrice: 90, rating: 4.9, reviewsCount: 129, stock: 80,
      badge: null, caffeine: null, art: null,
    },
  ];

  const REVIEWS = [
    { productId: 'death-shot', author: 'Karim A.', rating: 5, text: 'Tastes like a decision I cannot take back. Perfect.' },
    { productId: 'death-shot', author: 'Salma M.', rating: 5, text: 'Two sips and my calendar cleared itself.' },
    { productId: 'death-shot', author: 'Omar T.', rating: 4, text: 'Lethal, as promised. Docked a star because I now fear silence.' },
    { productId: 'last-breath', author: 'Nour H.', rating: 5, text: 'Smooth but with intent. My daily driver.' },
    { productId: 'last-breath', author: 'Ziad S.', rating: 4, text: 'Balanced. Dangerously drinkable.' },
    { productId: 'wake-the-dead', author: 'Mariam E.', rating: 5, text: 'Pulled a double shot, finished my thesis, watched the sunrise twice.' },
    { productId: 'wake-the-dead', author: 'Hassan B.', rating: 5, text: 'Crema thick enough to stand a spoon in.' },
    { productId: 'grim-reaper-reserve', author: 'Farida K.', rating: 5, text: 'Worth every piastre. The finish just… stays.' },
    { productId: 'graveyard-shift', author: 'Youssef R.', rating: 5, text: 'Cuts through milk like a threat.' },
    { productId: 'midnight-toast', author: 'Dina W.', rating: 5, text: 'Toasty, velvety, criminally easy to over-brew.' },
  ];

  const SHIPPING_ZONES = [
    { id: 'z1', name: 'Cairo', fee: 50, etaDays: '1–2 days' },
    { id: 'z2', name: 'Giza', fee: 50, etaDays: '1–2 days' },
    { id: 'z3', name: 'Alexandria', fee: 65, etaDays: '2–3 days' },
    { id: 'z4', name: 'Delta & Canal (Mansoura, Tanta, Zagazig…)', fee: 80, etaDays: '2–4 days' },
    { id: 'z5', name: 'Suez & Canal (Suez, Ismailia, Port Said)', fee: 80, etaDays: '2–4 days' },
    { id: 'z6', name: 'North Coast & Sahel', fee: 90, etaDays: '3–5 days' },
    { id: 'z7', name: 'Upper Egypt (Minya, Asyut, Sohag…)', fee: 100, etaDays: '3–5 days' },
    { id: 'z8', name: 'Red Sea / Sinai resorts', fee: 120, etaDays: '4–7 days' },
    { id: 'z9', name: 'Other / remote areas', fee: 130, etaDays: '4–7 days' },
  ];

  const PAYMENT_METHODS = [
    { id: 'card', label: 'Online Card Payment', detail: 'Visa · Mastercard · Secure hosted checkout', enabled: true },
    { id: 'cod', label: 'Cash on Delivery', detail: 'Pay cash to the courier', enabled: true },
    { id: 'bank_transfer', label: 'Bank Transfer', detail: 'Transfer & send the receipt on WhatsApp', enabled: false },
    { id: 'vodafone_cash', label: 'Vodafone Cash', detail: 'Send to the store wallet & confirm on WhatsApp', enabled: false },
  ];

  const STORE_DEFAULTS = {
    freeShippingThreshold: 800,
    lowStockThreshold: 4,
    codFee: 15,
    codMax: 6000,
  };

  const api = {
    CATEGORIES, ROASTS, WEIGHTS, GRINDS, PRODUCTS, REVIEWS,
    SHIPPING_ZONES, PAYMENT_METHODS, STORE_DEFAULTS,
  };

  /* browser globals */
  Object.assign(root, api);
  /* Node: module.exports + globalThis mirror for script convenience */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
