'use strict';

/* ============================================================
   SIP OF DEATH — storefront views
   Each view returns { html, mount(root) }.
   Interactions use data-action delegation.
   ============================================================ */

const Views = {};

function bindActions(root, handlers) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const fn = handlers[btn.dataset.action];
    if (fn) fn(btn, e);
  });
}

function bindChanges(root, handlers) {
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const fn = handlers[el.dataset.change];
    if (fn) fn(el, e);
  });
}

/* ---------- shared fragments ---------- */

function artFor(p, cls = '') {
  if (MERCH_ART[p.id]) return `<div class="merch-art ${cls}">${MERCH_ART[p.id]}</div>`;
  return packetArt(p, cls);
}

function shippingProgress() {
  const remaining = Store.freeShippingRemaining();
  const after = Store.subtotal() - Store.discount();
  const pct = Math.min(100, Math.round((after / STORE.freeShippingThreshold) * 100));
  const done = remaining <= 0 && after > 0;
  return `
  <div class="ship-progress" role="status">
    <div class="ship-progress__label">
      ${done
        ? `<span class="text-accent">${icon('bolt', 'ic-s')} UNLOCKED — FREE SHIPPING</span>`
        : `ADD <strong>${fmt(remaining)}</strong> MORE FOR FREE SHIPPING`}
    </div>
    <div class="ship-progress__bar"><div class="ship-progress__fill ${done ? 'is-done' : ''}" style="width:${pct}%"></div></div>
  </div>`;
}

function cartLineHTML(line, compact = false) {
  const p = Store.product(line.productId);
  const variant = Store.isCoffee(p)
    ? `${line.weightG}g · ${esc(line.grind)}`
    : esc(p.roastLabel);
  return `
  <div class="cart-line" data-key="${esc(line.key)}">
    <a href="#/product/${esc(p.id)}" class="cart-line__art" aria-label="${esc(p.name)}">${artFor(p, 'cart-line__svg')}</a>
    <div class="cart-line__info">
      <div class="cart-line__top">
        <a class="cart-line__name" href="#/product/${esc(p.id)}">${esc(p.name)}</a>
        <button class="line-x" data-action="remove-line" data-key="${esc(line.key)}" aria-label="Remove ${esc(p.name)} from cart">${icon('trash', 'ic-s')}</button>
      </div>
      <div class="cart-line__variant">${variant}</div>
      <div class="cart-line__row">
        <div class="qty" data-qty>
          <button class="qty__btn" data-action="qty-dec" data-key="${esc(line.key)}" aria-label="Decrease quantity">−</button>
          <span class="qty__val" aria-live="polite">${line.qty}</span>
          <button class="qty__btn" data-action="qty-inc" data-key="${esc(line.key)}" aria-label="Increase quantity">+</button>
        </div>
        <span class="cart-line__price">${fmt(line.unitPrice * line.qty)}</span>
      </div>
      ${line.qty >= p.stock ? `<div class="cart-line__max text-accent">MAX STOCK</div>` : ''}
    </div>
  </div>`;
}

function totalsHTML(q, { showZone = true } = {}) {
  return `
  <div class="totals">
    <div class="totals__row"><span>Subtotal</span><span>${fmt(q.sub)}</span></div>
    ${q.discount ? `<div class="totals__row totals__row--accent"><span>Discount</span><span>−${fmt(q.discount)}</span></div>` : ''}
    ${showZone ? `<div class="totals__row"><span>Shipping</span><span>${q.zoneId ? (q.freeShipping ? 'FREE' : fmt(q.shipping)) : '<span class="muted">pick zone</span>'}</span></div>` : ''}
    ${q.codFee ? `<div class="totals__row"><span>COD handling</span><span>${fmt(q.codFee)}</span></div>` : ''}
    <div class="totals__row totals__row--grand"><span>TOTAL</span><span>${fmt(q.total)}</span></div>
  </div>`;
}

function productCard(p) {
  const wish = Store.inWish(p.id);
  const isCoffee = Store.isCoffee(p);
  const low = p.stock > 0 && p.stock <= STORE.lowStockThreshold;
  return `
  <article class="card" data-pid="${esc(p.id)}">
    <div class="card__media">
      <a href="#/product/${esc(p.id)}" aria-label="View ${esc(p.name)}">
        ${artFor(p, 'card__svg')}
      </a>
      ${p.badge ? `<span class="card__badge">${esc(p.badge)}</span>` : ''}
      ${low ? `<span class="card__badge card__badge--low">ONLY ${p.stock} LEFT</span>` : ''}
      ${p.stock <= 0 ? `<div class="card__soldout"><span>SOLD OUT</span></div>` : ''}
      <button class="wish ${wish ? 'is-on' : ''}" data-action="wish" data-pid="${esc(p.id)}"
              aria-pressed="${wish}" aria-label="${wish ? 'Remove from' : 'Add to'} wishlist">
        ${icon(wish ? 'heartFill' : 'heart', 'ic-s')}
      </button>
    </div>
    <div class="card__body">
      <div class="card__roast">${esc(p.roastLabel)}${p.caffeine ? ` · ${esc(p.caffeine)}` : ''}</div>
      <h3 class="card__title"><a href="#/product/${esc(p.id)}">${esc(p.name)}</a></h3>
      <div class="card__notes">${p.notes.map(esc).join(' · ')}</div>
      ${starRow(p.rating, p.reviewsCount)}
      ${isCoffee ? `
      <div class="card__opts">
        <label class="sel">
          <span class="sel__label">Weight</span>
          <select data-change="card-weight">${WEIGHTS.map((w) => `<option value="${w.g}">${w.label}</option>`).join('')}</select>
        </label>
        <label class="sel">
          <span class="sel__label">Grind</span>
          <select data-change="card-grind">${GRINDS.map((g) => `<option>${g}</option>`).join('')}</select>
        </label>
      </div>` : ''}
      <div class="card__foot">
        <span class="card__price" data-card-price>${isCoffee ? fmt(p.basePrice) : fmt(p.basePrice)}</span>
        <button class="btn btn--accent btn--sm" data-action="card-add" ${p.stock <= 0 ? 'disabled' : ''}>
          ${icon('cart', 'ic-s')} ADD
        </button>
      </div>
    </div>
  </article>`;
}

/* ============================================================
   HOME
   ============================================================ */
Views.home = () => {
  const html = `
  <section class="hero" aria-label="Featured products">
    <div class="hero__slides" data-hero-slides></div>
    <div class="hero__inner container">
      <div class="hero__copy">
        <div class="hero__kicker">EST. ${BRAND.established} — ${esc(BRAND.tagline)}</div>
        <h1 class="hero__title" data-hero-title>SIP OF DEATH</h1>
        <p class="hero__sub" data-hero-sub>High-caffeine coffee for people who refuse to slow down. Roasted dark. Brewed violent.</p>
        <div class="hero__ctas">
          <a href="#/shop" class="btn btn--accent btn--lg">SHOP HIGH CAFFEINE NOW ${icon('arrow', 'ic-s')}</a>
          <a href="#/track" class="btn btn--ghost">TRACK MY ORDER</a>
        </div>
        <ul class="hero__usps" aria-label="Why SIP OF DEATH">
          <li>${flame('ic-s')} <strong>DARK ROAST</strong><span>Bold flavor</span></li>
          <li>${bolt('ic-s')} <strong>HIGH CAFFEINE</strong><span>Max focus</span></li>
          <li>${skullIcon('ic-s')} <strong>NO MERCY</strong><span>Just coffee</span></li>
        </ul>
      </div>
      <div class="hero__art" data-hero-art aria-hidden="true"></div>
    </div>
    <div class="hero__dots" data-hero-dots role="tablist" aria-label="Hero slides"></div>
  </section>

  <section class="section container" aria-labelledby="cats-h">
    <div class="section__head">
      <h2 id="cats-h" class="section__title">CHOOSE YOUR <span class="text-accent">WEAPON</span></h2>
      <a class="section__link" href="#/shop">ALL PRODUCTS ${icon('arrow', 'ic-s')}</a>
    </div>
    <div class="cat-grid">
      ${CATEGORIES.map((c) => {
        const count = PRODUCTS.filter((p) => p.categoryId === c.id).length;
        return `
        <a class="cat-tile" href="#/shop?cat=${esc(c.id)}">
          <span class="cat-tile__x">${brushX()}</span>
          <span class="cat-tile__name">${esc(c.name.split(' / ')[0])}</span>
          <span class="cat-tile__tag">${esc(c.tag)}</span>
          <span class="cat-tile__count">${count} PRODUCT${count === 1 ? '' : 'S'}</span>
        </a>`;
      }).join('')}
    </div>
  </section>

  <section class="section container" aria-labelledby="flag-h">
    <div class="section__head">
      <h2 id="flag-h" class="section__title">THE <span class="text-accent">ARSENAL</span></h2>
    </div>
    <div class="grid grid--4" data-featured></div>
  </section>

  <section class="strip" aria-label="Brand promise">
    <div class="container strip__in">
      <span>${flame('ic-s')} FRESHLY ROASTED</span>
      <span class="strip__x">${brushX('strip__brush')}</span>
      <span>${bolt('ic-s')} MAX CAFFEINE</span>
      <span class="strip__x">${brushX('strip__brush')}</span>
      <span>${skullIcon('ic-s')} NO MERCY</span>
      <span class="strip__x">${brushX('strip__brush')}</span>
      <span>${icon('truck', 'ic-s')} FAST DISPATCH</span>
    </div>
  </section>

  <section class="section container" aria-labelledby="best-h">
    <div class="section__head">
      <h2 id="best-h" class="section__title">MOST <span class="text-accent">LETHAL</span></h2>
    </div>
    <div class="grid grid--4" data-bestsellers></div>
  </section>`;

  const slides = [
    { name: 'DEATH SHOT', pid: 'death-shot', line: 'Dark roast. Bold. Intense. Lethal.' },
    { name: 'WAKE THE DEAD', pid: 'wake-the-dead', line: 'Espresso blend. Rich. Powerful. Unstoppable.' },
    { name: 'LAST BREATH', pid: 'last-breath', line: 'Medium roast. Smooth. Balanced. Deadly.' },
  ];

  return {
    html,
    mount(root) {
      $('[data-hero-slides]', root).innerHTML = heroBackdrop('hero__bg');
      const featured = PRODUCTS.filter((p) => p.badge).slice(0, 4);
      const best = [...PRODUCTS].sort((a, b) => b.reviewsCount - a.reviewsCount).slice(0, 4);
      $('[data-featured]', root).innerHTML = featured.map(productCard).join('');
      $('[data-bestsellers]', root).innerHTML = best.map(productCard).join('');

      /* hero slider */
      const slidesEl = $('[data-hero-slides]', root);
      const titleEl = $('[data-hero-title]', root);
      const subEl = $('[data-hero-sub]', root);
      const artEl = $('[data-hero-art]', root);
      const dotsEl = $('[data-hero-dots]', root);
      let idx = 0;
      let timer = null;

      dotsEl.innerHTML = slides.map((s, i) =>
        `<button class="hero__dot ${i === 0 ? 'is-on' : ''}" role="tab" aria-selected="${i === 0}"
          aria-label="Show slide ${i + 1}: ${esc(s.name)}" data-slide="${i}"></button>`).join('');

      function apply(i) {
        const s = slides[i];
        const p = Store.product(s.pid);
        titleEl.textContent = s.name;
        subEl.textContent = s.line;
        artEl.innerHTML = artFor(p, 'hero__svg');
        titleEl.classList.remove('anim-in');
        void titleEl.offsetWidth;
        titleEl.classList.add('anim-in');
        $$('.hero__dot', dotsEl).forEach((d, di) => {
          d.classList.toggle('is-on', di === i);
          d.setAttribute('aria-selected', di === i);
        });
        idx = i;
      }
      function next() { apply((idx + 1) % slides.length); }
      function restart() { clearInterval(timer); timer = setInterval(next, 5000); }

      slidesEl.addEventListener('click', (e) => {
        const d = e.target.closest('[data-slide]');
        if (d) { apply(+d.dataset.slide); restart(); }
      });
      root.addEventListener('pointerdown', () => clearInterval(timer), { once: false });

      apply(0);
      restart();
    },
  };
};

/* ============================================================
   SHOP (with filters)
   ============================================================ */
Views.shop = (params) => {
  const state = {
    cat: params.get('cat') || 'all',
    roast: 'all',
    maxPrice: 600,
    sort: 'featured',
    q: params.get('q') || '',
  };

  const html = `
  <section class="page-head">
    <div class="container">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>SHOP</span></nav>
      <h1 class="page-title">THE <span class="text-accent">CATALOG</span></h1>
      <p class="page-sub">Every bag roasted to kill. Pick your poison.</p>
    </div>
  </section>
  <section class="shop container">
    <aside class="filters" aria-label="Product filters">
      <div class="filters__block">
        <h3 class="filters__h">SEARCH</h3>
        <div class="field field--search">
          ${icon('search', 'field__ic')}
          <input type="search" data-filter="q" placeholder="Search the arsenal…" value="${esc(state.q)}" aria-label="Search products">
        </div>
      </div>
      <div class="filters__block">
        <h3 class="filters__h">CATEGORY</h3>
        <div class="chipcol" data-filter="cat" role="radiogroup" aria-label="Category">
          ${[['all', 'ALL']].concat(CATEGORIES.map((c) => [c.id, c.name.split(' / ')[0]])).map(([v, l]) =>
            `<button class="chip ${state.cat === v ? 'is-on' : ''}" data-val="${v}" role="radio" aria-checked="${state.cat === v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="filters__block">
        <h3 class="filters__h">ROAST</h3>
        <div class="chipcol" data-filter="roast" role="radiogroup" aria-label="Roast">
          ${[['all', 'ALL']].concat(ROASTS.map((r) => [r, r.toUpperCase()])).map(([v, l]) =>
            `<button class="chip ${state.roast === v ? 'is-on' : ''}" data-val="${v}" role="radio" aria-checked="${state.roast === v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="filters__block">
        <h3 class="filters__h">MAX PRICE — <span data-price-out>${fmt(state.maxPrice)}</span></h3>
        <input type="range" min="90" max="600" step="10" value="${state.maxPrice}" data-filter="maxPrice" aria-label="Maximum price">
      </div>
    </aside>

    <div class="shop__main">
      <div class="shop__bar">
        <p class="shop__count" data-count aria-live="polite"></p>
        <label class="sel sel--inline">
          <span class="sel__label">Sort</span>
          <select data-filter="sort" aria-label="Sort products">
            <option value="featured">Featured</option>
            <option value="price-asc">Price ↑</option>
            <option value="price-desc">Price ↓</option>
            <option value="rating">Top rated</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      <div class="grid grid--3" data-results></div>
      <div class="empty" data-empty hidden>
        ${skullIcon('empty__skull')}
        <p>Nothing survived your filter.</p>
        <button class="btn btn--ghost btn--sm" data-action="reset-filters">RESET FILTERS</button>
      </div>
    </div>
  </section>`;

  function matches(p) {
    if (state.cat !== 'all' && p.categoryId !== state.cat) return false;
    if (state.roast !== 'all' && p.roast !== state.roast) return false;
    if (p.basePrice > state.maxPrice) return false;
    if (state.q) {
      const hay = `${p.name} ${p.shortName} ${p.notes.join(' ')} ${p.roastLabel}`.toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }

  function apply() {
    let list = PRODUCTS.filter(matches);
    const sorters = {
      'price-asc': (a, b) => a.basePrice - b.basePrice,
      'price-desc': (a, b) => b.basePrice - a.basePrice,
      rating: (a, b) => b.rating - a.rating,
      name: (a, b) => a.name.localeCompare(b.name),
      featured: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.rating - a.rating,
    };
    list = list.sort(sorters[state.sort] || sorters.featured);
    $('[data-results]', root).innerHTML = list.map(productCard).join('');
    $('[data-count]', root).textContent = `${list.length} PRODUCT${list.length === 1 ? '' : 'S'}`;
    $('[data-empty]', root).hidden = list.length > 0;
    $('[data-price-out]', root).textContent = fmt(state.maxPrice);
  }

  let root;
  return {
    html,
    mount(r) {
      root = r;
      apply();

      /* chip groups */
      $$('.chipcol', root).forEach((col) => {
        col.addEventListener('click', (e) => {
          const chip = e.target.closest('.chip');
          if (!chip) return;
          state[col.dataset.filter] = chip.dataset.val;
          $$('.chip', col).forEach((c) => {
            const on = c === chip;
            c.classList.toggle('is-on', on);
            c.setAttribute('aria-checked', on);
          });
          apply();
        });
      });

      /* search + price + sort */
      root.addEventListener('input', (e) => {
        const f = e.target.closest('[data-filter]');
        if (!f) return;
        if (f.dataset.filter === 'q') {
          debounce(() => { state.q = f.value; apply(); }, 200)();
        } else if (f.dataset.filter === 'maxPrice') {
          state.maxPrice = +f.value;
          apply();
        }
      });
      root.addEventListener('change', (e) => {
        const f = e.target.closest('[data-filter="sort"]');
        if (f) { state.sort = f.value; apply(); }
      });

      bindActions(root, {
        'reset-filters': () => {
          state.cat = 'all'; state.roast = 'all'; state.maxPrice = 600; state.q = '';
          const q = $('[data-filter="q"]', root); if (q) q.value = '';
          const r = $('[data-filter="maxPrice"]', root); if (r) { r.value = 600; }
          $$('.chipcol', root).forEach((col) => $$('.chip', col).forEach((c) => {
            const on = c.dataset.val === 'all';
            c.classList.toggle('is-on', on);
            c.setAttribute('aria-checked', on);
          }));
          apply();
        },
      });
    },
  };
};

/* ============================================================
   PRODUCT DETAIL
   ============================================================ */
Views.product = (params) => {
  const p = Store.product(params.get('id'));
  if (!p) return Views.notFound();

  const sel = { weightG: 250, grind: 'Whole Bean', qty: 1 };
  const isCoffee = Store.isCoffee(p);
  const unitPrice = () => (isCoffee ? Store.variantPrice(p, sel.weightG) : p.basePrice);
  const reviews = REVIEWS.filter((r) => r.productId === p.id);
  const related = PRODUCTS.filter((x) => x.categoryId === p.categoryId && x.id !== p.id).slice(0, 4);
  const wish = Store.inWish(p.id);

  const html = `
  <section class="pdp container">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="#/">HOME</a> / <a href="#/shop">SHOP</a> /
      <a href="#/shop?cat=${esc(p.categoryId)}">${esc(CATEGORIES.find((c) => c.id === p.categoryId).name.split(' / ')[0])}</a> /
      <span>${esc(p.name)}</span>
    </nav>
    <div class="pdp__grid">
      <div class="pdp__media">
        ${artFor(p, 'pdp__svg')}
        ${p.badge ? `<span class="card__badge pdp__badge">${esc(p.badge)}</span>` : ''}
      </div>
      <div class="pdp__info">
        <div class="pdp__roast">${esc(p.roastLabel)}${p.caffeine ? ` — ${esc(p.caffeine)}` : ''}</div>
        <h1 class="pdp__title">${esc(p.name)}</h1>
        <div class="pdp__rating">${starRow(p.rating, p.reviewsCount)}</div>
        <p class="pdp__notes">${p.notes.map((n) => `<span class="tag">${esc(n)}</span>`).join(' ')}</p>
        <p class="pdp__desc">${esc(p.description)}</p>
        ${p.origin ? `<dl class="pdp__meta">
          <div><dt>ORIGIN</dt><dd>${esc(p.origin)}</dd></div>
          <div><dt>PROCESS</dt><dd>${esc(p.process)}</dd></div>
        </dl>` : ''}

        ${isCoffee ? `
        <div class="pdp__opt">
          <h3 class="pdp__opt-h">NET WEIGHT</h3>
          <div class="optrow" data-opt="weight" role="radiogroup" aria-label="Net weight">
            ${WEIGHTS.map((w) => `
              <button class="optpill ${w.g === sel.weightG ? 'is-on' : ''}" data-val="${w.g}" role="radio" aria-checked="${w.g === sel.weightG}">
                ${w.label}<small>${fmt(Math.round(p.basePrice * w.mult))}</small>
              </button>`).join('')}
          </div>
        </div>
        <div class="pdp__opt">
          <h3 class="pdp__opt-h">GRIND</h3>
          <div class="optrow" data-opt="grind" role="radiogroup" aria-label="Grind type">
            ${GRINDS.map((g) => `
              <button class="optpill ${g === sel.grind ? 'is-on' : ''}" data-val="${esc(g)}" role="radio" aria-checked="${g === sel.grind}">${g}</button>`).join('')}
          </div>
        </div>` : ''}

        <div class="pdp__buy">
          <div class="qty qty--lg" aria-label="Quantity">
            <button class="qty__btn" data-action="pd-dec" aria-label="Decrease quantity">−</button>
            <span class="qty__val" data-pd-qty aria-live="polite">1</span>
            <button class="qty__btn" data-action="pd-inc" aria-label="Increase quantity">+</button>
          </div>
          <div class="pdp__price" data-pd-price>${fmt(unitPrice())}</div>
          <button class="btn btn--accent btn--lg" data-action="pd-add" ${p.stock <= 0 ? 'disabled' : ''}>
            ${icon('cart', 'ic-s')} ${p.stock <= 0 ? 'SOLD OUT' : 'ADD TO CART'}
          </button>
          <button class="wish wish--lg ${wish ? 'is-on' : ''}" data-action="pd-wish"
                  aria-pressed="${wish}" aria-label="${wish ? 'Remove from' : 'Add to'} wishlist">
            ${icon(wish ? 'heartFill' : 'heart')}
          </button>
        </div>
        <p class="pdp__stock ${p.stock <= STORE.lowStockThreshold ? 'text-accent' : ''}" data-pd-stock aria-live="polite">
          ${p.stock <= 0 ? 'OUT OF STOCK — RESTOCKING FROM THE UNDERWORLD' :
            p.stock <= STORE.lowStockThreshold ? `ONLY ${p.stock} BAGS REMAIN` : `${p.stock} IN STOCK — SHIPS IN 24H`}
        </p>
        <ul class="pdp__perks">
          <li>${icon('truck', 'ic-s')} Free shipping over ${fmt(STORE.freeShippingThreshold)}</li>
          <li>${icon('lock', 'ic-s')} Card or cash on delivery</li>
          <li>${brushX('ic-xs')} Freshly roasted, sealed dark</li>
        </ul>
      </div>
    </div>

    ${reviews.length ? `
    <div class="pdp__reviews">
      <h2 class="section__title section__title--sm">SURVIVOR <span class="text-accent">TESTIMONIES</span></h2>
      <div class="rev-grid">
        ${reviews.map((r) => `
          <figure class="rev">
            <figcaption>${esc(r.author)} ${starRow(r.rating)}</figcaption>
            <blockquote>“${esc(r.text)}”</blockquote>
          </figure>`).join('')}
      </div>
    </div>` : ''}

    ${related.length ? `
    <div class="pdp__related">
      <h2 class="section__title section__title--sm">SAME <span class="text-accent">BATTLEFIELD</span></h2>
      <div class="grid grid--4">${related.map(productCard).join('')}</div>
    </div>` : ''}
  </section>`;

  return {
    html,
    mount(root) {
      function sync() {
        $('[data-pd-price]', root).textContent = fmt(unitPrice() * sel.qty);
        $('[data-pd-qty]', root).textContent = sel.qty;
        $$('.optrow [data-val]', root).forEach((b) => {
          const group = b.closest('[data-opt]').dataset.opt;
          const on = group === 'weight' ? +b.dataset.val === sel.weightG : b.dataset.val === sel.grind;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on);
        });
      }

      root.addEventListener('click', (e) => {
        const pill = e.target.closest('.optrow .optpill');
        if (pill) {
          const group = pill.closest('[data-opt]').dataset.opt;
          if (group === 'weight') sel.weightG = +pill.dataset.val;
          else sel.grind = pill.dataset.val;
          sync();
        }
      });

      bindActions(root, {
        'pd-dec': () => { sel.qty = Math.max(1, sel.qty - 1); sync(); },
        'pd-inc': () => { sel.qty = Math.min(p.stock || 99, sel.qty + 1); sync(); },
        'pd-add': () => {
          const res = Store.addToCart(p.id, { weightG: sel.weightG, grind: sel.grind, qty: sel.qty });
          if (res.ok) { App.openMiniCart(); toast(`${p.name} added to cart`); }
          else toast(res.error, 'err');
        },
        'pd-wish': (btn) => {
          const added = Store.toggleWish(p.id);
          btn.classList.toggle('is-on', added);
          btn.setAttribute('aria-pressed', added);
          btn.innerHTML = icon(added ? 'heartFill' : 'heart');
          toast(added ? 'Marked for the wishlist' : 'Removed from wishlist');
        },
      });
    },
  };
};

/* ============================================================
   WISHLIST
   ============================================================ */
Views.wishlist = () => {
  const items = Store.state.wishlist.map((id) => Store.product(id)).filter(Boolean);
  const html = `
  <section class="page-head"><div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>WISHLIST</span></nav>
    <h1 class="page-title">THE <span class="text-accent">HIT LIST</span></h1>
  </div></section>
  <section class="container section">
    ${items.length
      ? `<div class="grid grid--4">${items.map(productCard).join('')}</div>`
      : `<div class="empty">${skullIcon('empty__skull')}<p>Your list is empty. Nothing marked for death yet.</p>
         <a class="btn btn--accent btn--sm" href="#/shop">BROWSE THE CATALOG</a></div>`}
  </section>`;
  return { html, mount() {} };
};

/* ============================================================
   CART PAGE
   ============================================================ */
Views.cart = () => {
  const html = `
  <section class="page-head"><div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>CART</span></nav>
    <h1 class="page-title">YOUR <span class="text-accent">STASH</span></h1>
  </div></section>
  <section class="container cartpage" data-cart-root></section>`;
  return {
    html,
    mount(root) {
      function render() {
        const lines = Store.state.cart;
        const q = Store.quote({});
        if (!lines.length) {
          $('[data-cart-root]', root).innerHTML = `
            <div class="empty">${skullIcon('empty__skull')}
              <p>The cart is a graveyard. Bury something in it.</p>
              <a class="btn btn--accent" href="#/shop">SHOP NOW</a></div>`;
          return;
        }
        $('[data-cart-root]', root).innerHTML = `
        <div class="cartpage__grid">
          <div class="cartpage__lines">
            ${shippingProgress()}
            <div class="cart-lines">${lines.map((l) => cartLineHTML(l)).join('')}</div>
            <div class="cartpage__actions">
              <a class="btn btn--ghost btn--sm" href="#/shop">← CONTINUE SHOPPING</a>
              <button class="btn btn--ghost btn--sm" data-action="clear-cart">EMPTY THE GRAVE</button>
            </div>
          </div>
          <aside class="cartpage__side" aria-label="Order summary">
            <div class="panel">
              <h2 class="panel__h">SUMMARY</h2>
              ${totalsHTML(q, { showZone: false })}
              <form class="promo" data-promo-form>
                <input class="promo__input" name="promo" placeholder="Promo code (try REAPER10)" aria-label="Promo code" autocomplete="off">
                <button class="btn btn--ghost btn--sm" type="submit">APPLY</button>
              </form>
              ${Store.state.promo ? `<p class="promo__on">${icon('check', 'ic-s')} <strong>${esc(Store.state.promo.code)}</strong> applied — <button class="linklike" data-action="clear-promo">remove</button></p>` : ''}
              <a class="btn btn--accent btn--block ${q.sub - q.discount <= 0 ? 'is-disabled' : ''}"
                 href="#/checkout" aria-disabled="${q.sub - q.discount <= 0}">CHECKOUT ${icon('arrow', 'ic-s')}</a>
            </div>
          </aside>
        </div>`;
      }

      render();
      document.addEventListener('cart:change', render, { once: false });
      this._off = () => document.removeEventListener('cart:change', render);
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const key = btn.dataset.key;
        const line = Store.state.cart.find((l) => l.key === key);
        if (btn.dataset.action === 'qty-dec' && line) Store.setQty(key, line.qty - 1);
        if (btn.dataset.action === 'qty-inc' && line) Store.setQty(key, line.qty + 1);
        if (btn.dataset.action === 'remove-line') Store.removeLine(key);
        if (btn.dataset.action === 'clear-cart') {
          Store.clearCart();
          toast('Cart emptied');
        }
        if (btn.dataset.action === 'clear-promo') { Store.clearPromo(); render(); }
      });
      root.addEventListener('submit', (e) => {
        const form = e.target.closest('[data-promo-form]');
        if (!form) return;
        e.preventDefault();
        const input = form.querySelector('input[name="promo"]');
        const res = Store.applyPromo(input.value);
        if (res.ok) { toast('Promo applied'); render(); }
        else toast(res.error, 'err');
      });
    },
    unmount() { if (this._off) this._off(); },
  };
};

/* ============================================================
   CHECKOUT — 4 steps
   ============================================================ */
const CK = { step: 1, data: {}, method: 'card' };

/* enabled payment methods come from the SERVER (admin settings) —
   catalog.js only holds the fallback defaults */
function paymentMethods() {
  return Array.isArray(window.PAYMENT_METHODS) && window.PAYMENT_METHODS.length
    ? window.PAYMENT_METHODS
    : (typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []);
}
const TRANSFER_METHODS = ['bank_transfer', 'vodafone_cash'];
function transferHint(methodId) {
  const m = (typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []).find((x) => x.id === methodId);
  return m ? m.detail : 'Transfer the total, then send the receipt to the store on WhatsApp.';
}

Views.checkout = () => {
  if (!Store.state.cart.length) {
    return {
      html: `<section class="container section"><div class="empty">
        ${skullIcon('empty__skull')}<p>Nothing to check out — the cart is empty.</p>
        <a class="btn btn--accent" href="#/shop">SHOP NOW</a></div></section>`,
      mount() {},
    };
  }
  CK.step = Math.min(CK.step, 4);

  const zoneOpts = SHIPPING_ZONES.map((z) =>
    `<option value="${z.id}" ${CK.data.zoneId === z.id ? 'selected' : ''}>${esc(z.name)} — ${fmt(z.fee)} · ${z.etaDays}</option>`).join('');

  const html = `
  <section class="page-head"><div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>CHECKOUT</span></nav>
    <h1 class="page-title">SEAL THE <span class="text-accent">DEAL</span></h1>
  </div></section>

  <section class="container checkout" data-ck-root>
    <ol class="steps" aria-label="Checkout progress">
      ${CHECKOUT_STEPS.map((s, i) => `
        <li class="steps__step ${CK.step > i + 1 ? 'is-done' : ''} ${CK.step === i + 1 ? 'is-current' : ''}"
            aria-current="${CK.step === i + 1 ? 'step' : 'false'}">
          <span class="steps__num">${CK.step > i + 1 ? icon('check', 'ic-s') : i + 1}</span>
          <span class="steps__label">${s}</span>
        </li>`).join('')}
    </ol>
    <div class="checkout__grid">
      <form class="checkout__main" data-ck-form novalidate>
        <input type="hidden" name="ck_step" value="${CK.step}">
        <!-- STEP 1: customer -->
        <fieldset class="ck-step ${CK.step === 1 ? 'is-active' : ''}" data-step="1">
          <legend class="panel__h">CUSTOMER INFO</legend>
          <div class="frow">
            <label class="field"><span class="field__label">FULL NAME *</span>
              <input name="name" data-validate="required" data-label="name" autocomplete="name" value="${esc(CK.data.name || '')}"></label>
            <label class="field"><span class="field__label">EMAIL *</span>
              <input name="email" type="email" data-validate="email" data-label="email" autocomplete="email" value="${esc(CK.data.email || '')}"></label>
          </div>
          <label class="field"><span class="field__label">PHONE *</span>
            <input name="phone" type="tel" data-validate="phone" data-label="phone" autocomplete="tel" value="${esc(CK.data.phone || '')}"></label>
          <label class="check">
            <input type="checkbox" name="createAccount" ${CK.data.createAccount ? 'checked' : ''}>
            <span>CREATE AN ACCOUNT (saves addresses & orders)</span>
          </label>
          <p class="muted">Guest checkout is automatic — no account needed to order.</p>
          <div class="ck-nav">
            <span></span>
            <button type="button" class="btn btn--accent" data-action="ck-next">SHIPPING ${icon('arrow', 'ic-s')}</button>
          </div>
        </fieldset>

        <!-- STEP 2: shipping -->
        <fieldset class="ck-step ${CK.step === 2 ? 'is-active' : ''}" data-step="2" ${CK.step !== 2 ? 'hidden' : ''}>
          <legend class="panel__h">SHIPPING DETAILS</legend>
          <label class="field"><span class="field__label">REGION / CITY *</span>
            <select name="zoneId" data-validate="required" data-label="region">
              <option value="">Select your zone…</option>${zoneOpts}
            </select></label>
          <label class="field"><span class="field__label">STREET ADDRESS *</span>
            <input name="address" data-validate="required" data-label="address" autocomplete="street-address" value="${esc(CK.data.address || '')}"></label>
          <div class="frow">
            <label class="field"><span class="field__label">CITY *</span>
              <input name="city" data-validate="required" data-label="city" autocomplete="address-level2" value="${esc(CK.data.city || '')}"></label>
            <label class="field"><span class="field__label">BUILDING / FLOOR / APT</span>
              <input name="address2" value="${esc(CK.data.address2 || '')}"></label>
          </div>
          <label class="field"><span class="field__label">DELIVERY NOTES</span>
            <textarea name="notes" rows="2" placeholder="Landmark, gate code, threats…">${esc(CK.data.notes || '')}</textarea></label>
          <div class="ck-nav">
            <button type="button" class="btn btn--ghost" data-action="ck-back">← BACK</button>
            <button type="button" class="btn btn--accent" data-action="ck-next">PAYMENT ${icon('arrow', 'ic-s')}</button>
          </div>
        </fieldset>

        <!-- STEP 3: payment -->
        <fieldset class="ck-step ${CK.step === 3 ? 'is-active' : ''}" data-step="3" ${CK.step !== 3 ? 'hidden' : ''}>
          <legend class="panel__h">PAYMENT METHOD</legend>
          <div class="paygrid" role="radiogroup" aria-label="Payment method">
            ${paymentMethods().filter((m) => m.enabled).map((m) => `
              <label class="paycard ${CK.method === m.id ? 'is-on' : ''}">
                <input type="radio" name="paymentMethod" value="${m.id}" ${CK.method === m.id ? 'checked' : ''}>
                <span class="paycard__ic">${m.id === 'card' ? icon('lock') : icon('box')}</span>
                <span class="paycard__t">${esc(m.label)}</span>
                <span class="paycard__d">${esc(m.detail)}${m.id === 'cod' ? ` · +${fmt(STORE.codFee)} fee · max ${fmt(STORE.codMax)}` : ''}</span>
              </label>`).join('')}
          </div>
          ${transferMethods.includes(CK.method) ? `<p class="cod-note">${icon('box', 'ic-s')} ${transferHint(CK.method)} — you'll find the order number and total on the confirmation screen.</p>` : ''}
          ${CK.method === 'cod' ? `<p class="cod-note">${icon('box', 'ic-s')} Pay <strong data-cod-amount></strong> in cash when the reaper knocks. COD fee ${fmt(STORE.codFee)} applies.</p>` : ''}
          <div class="ck-nav">
            <button type="button" class="btn btn--ghost" data-action="ck-back">← BACK</button>
            <button type="button" class="btn btn--accent" data-action="ck-next">REVIEW ${icon('arrow', 'ic-s')}</button>
          </div>
        </fieldset>

        <!-- STEP 4: review -->
        <fieldset class="ck-step ${CK.step === 4 ? 'is-active' : ''}" data-step="4" ${CK.step !== 4 ? 'hidden' : ''}>
          <legend class="panel__h">ORDER SUMMARY</legend>
          <div data-ck-review></div>
          <label class="check">
            <input type="checkbox" name="terms" data-validate="required" data-label="terms acceptance">
            <span>I ACCEPT THE CURSE (terms &amp; return policy) *</span>
          </label>
          <div class="ck-nav">
            <button type="button" class="btn btn--ghost" data-action="ck-back">← BACK</button>
            <button type="submit" class="btn btn--accent btn--lg" data-ck-place>
              ${CK.method === 'card' ? 'PAY & PLACE ORDER' : 'PLACE COD ORDER'} ${icon('bolt', 'ic-s')}
            </button>
          </div>
        </fieldset>
      </form>

      <aside class="checkout__side" aria-label="Order totals" data-ck-side></aside>
    </div>
  </section>`;

  return {
    html,
    mount(root) {
      const form = $('[data-ck-form]', root);
      const side = $('[data-ck-side]', root);

      /* keep CK.method valid when the admin disables a method mid-session */
      const enabledIds = paymentMethods().filter((m) => m.enabled).map((m) => m.id);
      if (!enabledIds.includes(CK.method)) CK.method = enabledIds[0] || 'card';

      function quote() {
        return Store.quote({ zoneId: CK.data.zoneId, paymentMethod: CK.method });
      }

      function renderSide() {
        const q = quote();
        side.innerHTML = `
        <div class="panel panel--sticky">
          <h2 class="panel__h">YOUR HAUL</h2>
          ${shippingProgress()}
          <div class="side-lines">
            ${Store.state.cart.map((l) => `
              <div class="side-line">
                <span class="side-line__qty">${l.qty}×</span>
                <span class="side-line__name">${esc(l.name)}
                  <small>${l.weightG ? `${l.weightG}g · ${esc(l.grind)}` : 'Merch'}</small></span>
                <span class="side-line__p">${fmt(l.unitPrice * l.qty)}</span>
              </div>`).join('')}
          </div>
          ${totalsHTML(q)}
          <p class="muted side-note">${icon('truck', 'ic-s')} ${q.zone ? `ETA ${q.zone.etaDays}` : 'Shipping calculated per zone'} · Free over ${fmt(STORE.freeShippingThreshold)}</p>
        </div>`;
      }

      function renderReview() {
        const box = $('[data-ck-review]', root);
        if (!box) return;
        const q = quote();
        const d = CK.data;
        const pay = PAYMENT_METHODS.find((m) => m.id === CK.method);
        box.innerHTML = `
        <div class="review">
          <div class="review__col">
            <h4>CUSTOMER</h4>
            <p>${esc(d.name || '—')}<br>${esc(d.email || '')}<br>${esc(d.phone || '')}</p>
            <h4>SHIP TO</h4>
            <p>${esc(d.address || '—')}${d.address2 ? `, ${esc(d.address2)}` : ''}<br>${esc(d.city || '')}, ${esc(q.zone ? q.zone.name : '')}<br>ETA ${q.zone ? q.zone.etaDays : '—'}</p>
            <h4>PAYMENT</h4>
            <p>${pay ? pay.label : ''}${CK.method === 'card' ? '<br>Redirects to the secure hosted gateway — card details never touch this site.' : ''}</p>
            ${d.notes ? `<h4>NOTES</h4><p>${esc(d.notes)}</p>` : ''}
          </div>
          <div class="review__items">
            ${Store.state.cart.map((l) => `
              <div class="side-line">
                <span class="side-line__qty">${l.qty}×</span>
                <span class="side-line__name">${esc(l.name)}
                  <small>${l.weightG ? `${l.weightG}g · ${esc(l.grind)}` : 'Merch'}</small></span>
                <span class="side-line__p">${fmt(l.unitPrice * l.qty)}</span>
              </div>`).join('')}
          </div>
        </div>`;
      }

      function renderCOD() {
        const el = $('[data-cod-amount]', root);
        if (el) el.textContent = fmt(quote().total);
      }

      function goto(step) {
        CK.step = step;
        form.querySelector('[name="ck_step"]').value = step;
        $$('.ck-step', form).forEach((fs) => {
          const on = +fs.dataset.step === step;
          fs.classList.toggle('is-active', on);
          fs.hidden = !on;
        });
        $$('.steps__step', root).forEach((li, i) => {
          li.classList.toggle('is-done', step > i + 1);
          li.classList.toggle('is-current', step === i + 1);
          li.setAttribute('aria-current', step === i + 1 ? 'step' : 'false');
        });
        if (step === 3) renderCOD();
        if (step === 4) renderReview();
        renderSide();
        form.closest('.checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function collect() {
        const fd = new FormData(form);
        for (const [k, v] of fd.entries()) {
          if (k !== 'ck_step' && k !== 'terms') CK.data[k] = typeof v === 'string' ? v : '';
        }
        const rb = form.querySelector('[name="paymentMethod"]:checked');
        if (rb) CK.method = rb.value; /* keep CK.method if the radio group is empty (no enabled methods) */
      }

      function validateStep(step) {
        const fs = form.querySelector(`[data-step="${step}"]`);
        const res = validateForm(fs);
        if (!res.ok && res.first) {
          res.first.focus();
          toast(`Fix the ${res.first.dataset.label || 'highlighted'} field`, 'err');
        }
        return res.ok;
      }

      bindActions(root, {
        'ck-next': () => {
          collect();
          if (CK.step === 1 && !validateStep(1)) return;
          if (CK.step === 2) {
            if (!validateStep(2)) return;
            /* COD cap check */
          }
          if (CK.step === 3) {
            if (!validateStep(3)) return;
            const q = quote();
            if (CK.method === 'cod' && q.total > STORE.codMax) {
              toast(`COD limited to ${fmt(STORE.codMax)} — use card`, 'err');
              return;
            }
          }
          goto(Math.min(4, CK.step + 1));
        },
        'ck-back': () => { collect(); goto(Math.max(1, CK.step - 1)); },
      });

      /* payment method switch */
      form.addEventListener('change', (e) => {
        if (e.target.name === 'paymentMethod') {
          CK.method = e.target.value;
          $$('.paycard', form).forEach((pc) => pc.classList.toggle('is-on', pc.querySelector('input').checked));
          renderCOD();
          renderSide();
        }
      });

      /* place order — the SERVER creates the order (re-prices cart,
         reserves stock) and returns a payment intent for card orders. */
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        collect();
        const fs4 = form.querySelector('[data-step="4"]');
        const terms = form.querySelector('[name="terms"]');
        if (!terms.checked) { toast('Accept the curse to continue', 'err'); terms.focus(); return; }
        if (!validateForm(fs4).ok) { toast('Accept the curse to continue', 'err'); return; }

        const btn = $('[data-ck-place]', form);
        btn.disabled = true;
        btn.innerHTML = CK.method === 'card' ? 'CREATING ORDER…' : 'PLACING ORDER…';

        const d = CK.data;
        try {
          const method = CK.method;
          const { order, payment } = await Store.submitOrder({
            name: d.name,
            email: d.email,
            phone: d.phone,
            zoneId: d.zoneId,
            address: d.address2 ? `${d.address}, ${d.address2}` : d.address,
            city: d.city,
            notes: d.notes,
            paymentMethod: CK.method,
          });
          sessionStorage.setItem('sod.lastOrder', order.number);
          if (d.createAccount) {
            localStorage.setItem(LS_KEYS.session, JSON.stringify({ name: d.name, email: d.email, guest: false, created: Date.now() }));
          }
          CK.step = 1; CK.data = {}; CK.method = 'card';

          if (order.paymentMethod !== 'card') {
            if (transferMethods.includes(order.paymentMethod)) {
              toast('Order placed — transfer now open', 'info');
              sessionStorage.setItem('sod.lastOrder', order.number);
              location.hash = `#/transfer?order=${encodeURIComponent(order.number)}`;
            } else {
              toast('COD order placed');
              location.hash = '#/success';
            }
            return;
          }
          if (payment && payment.redirectUrl) {
            location.href = payment.redirectUrl; /* Paymob iframe / Stripe Checkout / mock */
            return;
          }
          location.hash = '#/success';
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = 'PLACE ORDER';
          toast(String(err.message || err), 'err');
          if (err.status === 422 && err.data && Array.isArray(err.data.errors)) {
            CK.step = 2; // stock/promo/zone problems — let the customer adjust
          }
        }
      });

      renderSide();
      if (CK.step === 3) renderCOD();
      if (CK.step === 4) renderReview();
    },
  };
};

/* ============================================================
   SUCCESS
   ============================================================ */

/* transfer instructions (bank transfer / Vodafone Cash) */
Views.transfer = (params) => {
  const num = params && params.order ? params.order : sessionStorage.getItem('sod.lastOrder');
  const order = num ? (Store.state.orders.find((o) => o.number === num)
    || Store.findOrder(num, '')) : null;
  const m = TRANSFER_METHODS.includes(CK.method)
    ? (typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : []).find((x) => x.id === CK.method)
    : null;
  const methodLabel = m ? m.label : 'Bank Transfer / Vodafone Cash';
  const hint = m ? m.detail : 'Send the receipt to the store on WhatsApp to confirm.';
  return {
    html: `
    <section class="container success">
      <div class="success__mark">${icon('box')}</div>
      <h1 class="page-title">ORDER <span class="text-accent">RECEIVED</span></h1>
      <p class="success__num">Order <strong>${esc(order ? order.number : (num || '—'))}</strong></p>
      <p class="muted">Complete your <strong>${esc(methodLabel)}</strong> transfer, then send the receipt to the store on WhatsApp to confirm. ${esc(hint)}</p>
      ${order ? `
      <div class="panel success__panel">
        <div class="totals">
          <div class="totals__row"><span>Items (${order.items.reduce((n, l) => n + l.qty, 0)})</span><span>${fmt(order.totals.subtotal)}</span></div>
          ${order.totals.discount ? `<div class="totals__row totals__row--accent"><span>Discount</span><span>−${fmt(order.totals.discount)}</span></div>` : ''}
          <div class="totals__row"><span>Shipping</span><span>${order.totals.shipping === 0 ? 'FREE' : fmt(order.totals.shipping)}</span></div>
          ${order.totals.codFee ? `<div class="totals__row"><span>COD fee</span><span>${fmt(order.totals.codFee)}</span></div>` : ''}
          <div class="totals__row totals__row--grand"><span>TRANSFER TOTAL</span><span>${fmt(order.totals.total)}</span></div>
        </div>
      </div>` : ''}
      <div class="success__ctas">
        <a class="btn btn--accent" href="#/track">TRACK ORDER ${icon('arrow', 'ic-s')}</a>
        <a class="btn btn--ghost" href="#/shop">KEEP SHOPPING</a>
      </div>
    </section>`,
    mount() {},
  };
};

Views.success = () => {
  const num = sessionStorage.getItem('sod.lastOrder');
  const order = num ? Store.state.orders.find((o) => o.number === num) : null;
  if (!order) return Views.notFound();
  const q = order.totals;
  return {
    html: `
    <section class="container success">
      <div class="success__mark">${icon('check')}</div>
      <h1 class="page-title">ORDER <span class="text-accent">CONFIRMED</span></h1>
      <p class="success__num">Order <strong>${esc(order.number)}</strong></p>
      <p class="muted">${order.paymentMethod === 'card' ? 'Payment confirmed by the gateway. ' : 'Cash on delivery. '}The reaper rides at dawn — ETA ${esc(order.shipping.etaDays)}.</p>
      <div class="panel success__panel">
        <div class="totals">
          <div class="totals__row"><span>Items (${order.items.reduce((n, l) => n + l.qty, 0)})</span><span>${fmt(q.subtotal)}</span></div>
          ${q.discount ? `<div class="totals__row totals__row--accent"><span>Discount</span><span>−${fmt(q.discount)}</span></div>` : ''}
          <div class="totals__row"><span>Shipping</span><span>${q.shipping === 0 ? 'FREE' : fmt(q.shipping)}</span></div>
          ${q.codFee ? `<div class="totals__row"><span>COD fee</span><span>${fmt(q.codFee)}</span></div>` : ''}
          <div class="totals__row totals__row--grand"><span>TOTAL</span><span>${fmt(q.total)}</span></div>
        </div>
      </div>
      <div class="success__ctas">
        <a class="btn btn--accent" href="#/track?order=${esc(order.number)}&email=${encodeURIComponent(order.customer.email)}">TRACK ORDER ${icon('arrow', 'ic-s')}</a>
        <a class="btn btn--ghost" href="#/shop">KEEP SHOPPING</a>
      </div>
    </section>`,
    mount() {},
  };
};

/* ============================================================
   TRACK ORDER
   ============================================================ */
Views.track = (params) => {
  const html = `
  <section class="page-head"><div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>TRACK</span></nav>
    <h1 class="page-title">FOLLOW YOUR <span class="text-accent">COFFIN</span></h1>
    <p class="page-sub">Enter your order number + email to track the shipment.</p>
  </div></section>
  <section class="container track">
    <form class="panel track__form" data-track-form novalidate>
      <div class="frow">
        <label class="field"><span class="field__label">ORDER NUMBER *</span>
          <input name="number" data-validate="required" placeholder="SOD-2026-XXXXXX" value="${esc(params.get('order') || '')}"></label>
        <label class="field"><span class="field__label">EMAIL *</span>
          <input name="email" type="email" data-validate="email" value="${esc(params.get('email') || '')}"></label>
      </div>
      <button class="btn btn--accent" type="submit">TRACK ${icon('search', 'ic-s')}</button>
    </form>
    <div class="track__result" data-track-result></div>
  </section>`;

  const FLOW = ['placed', 'paid', 'roasting', 'shipped', 'delivered'];
  const LABEL = {
    placed: 'ORDER PLACED', paid: 'PAYMENT CONFIRMED', pending_payment: 'AWAITING PAYMENT',
    failed: 'PAYMENT FAILED', roasting: 'ROASTING',
    shipped: 'OUT FOR DELIVERY', delivered: 'DELIVERED', cancelled: 'CANCELLED',
  };

  function resultHTML(order) {
    const idx = FLOW.indexOf(order.status);
    const cancelled = order.status === 'cancelled';
    /* server orders carry `events` [{type: 'order.paid', at}], cached local
       copies carry `timeline` [{status, at}] — normalize to one shape */
    const timeline = (order.timeline || (order.events || []).map((e) => ({
      status: String(e.type || '').replace(/^order\./, ''),
      at: e.at,
    })));
    const at = (s) => {
      const hit = timeline.find((t) => t.status === s || String(t.type || '') === `order.${s}`);
      return hit ? new Date(hit.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    };
    return `
    <div class="panel track__panel">
      <div class="track__head">
        <div>
          <h2 class="panel__h">${esc(order.number)}</h2>
          <p class="muted">Placed ${new Date(order.createdAt).toLocaleString()} · ${esc(order.shipping.zoneName)} · ETA ${esc(order.shipping.etaDays)}</p>
        </div>
        <span class="statusbadge statusbadge--${esc(order.status)}">${LABEL[order.status] || order.status.toUpperCase()}</span>
      </div>
      ${cancelled
        ? `<p class="text-accent track__cancel">This order was cancelled. The beans have been released back into the wild.</p>`
        : order.status === 'pending_payment'
        ? `<p class="track__cancel" style="color:#e08a20">AWAITING PAYMENT — the gateway hasn't confirmed yet. The order settles automatically once the signed webhook arrives.</p>`
        : `<ol class="timeline">
        ${FLOW.map((s, i) => `
          <li class="timeline__step ${i <= idx ? 'is-done' : ''} ${i === idx ? 'is-now' : ''}">
            <span class="timeline__dot">${i < idx ? icon('check', 'ic-xs') : i === idx ? skullIcon('ic-xs') : ''}</span>
            <span class="timeline__label">${LABEL[s]}</span>
            <span class="timeline__at">${at(s)}</span>
          </li>`).join('')}
      </ol>`}
      <div class="track__items">
        ${order.items.map((l) => `
          <div class="side-line"><span class="side-line__qty">${l.qty}×</span>
            <span class="side-line__name">${esc(l.name)}<small>${l.weightG ? `${l.weightG}g · ${esc(l.grind)}` : 'Merch'}</small></span>
            <span class="side-line__p">${fmt(l.unitPrice * l.qty)}</span></div>`).join('')}
      </div>
      <div class="totals">
        <div class="totals__row totals__row--grand"><span>TOTAL</span><span>${fmt(order.totals.total)}</span></div>
      </div>
      ${['placed', 'paid'].includes(order.status)
        ? `<button class="btn btn--ghost btn--sm" data-action="cancel-order" data-num="${esc(order.number)}">CANCEL ORDER</button>` : ''}
    </div>`;
  }

  return {
    html,
    mount(root) {
      const form = $('[data-track-form]', root);
      const out = $('[data-track-result]', root);
      let current = null;

      function renderResult(order) {
        current = order;
        out.innerHTML = resultHTML(order);
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateForm(form).ok) return;
        const fd = new FormData(form);
        const number = fd.get('number');
        const email = fd.get('email');
        out.innerHTML = `<p class="muted" style="letter-spacing:.2em">CONSULTING THE UNDERWORLD…</p>`;
        const order = await Store.lookupOrder(number, email);
        if (!order) {
          out.innerHTML = `<div class="empty">${skullIcon('empty__skull')}
            <p>No order found for those details. Check the number and email.</p></div>`;
          return;
        }
        renderResult(order);
      });

      out.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="cancel-order"]');
        if (!btn || !current) return;
        Modal.open(`
          <h2 class="panel__h" id="cancel-h">CANCEL THIS ORDER?</h2>
          <p class="muted">Stock will be restored. This cannot be undone.</p>
          <div class="modal__actions">
            <button class="btn btn--ghost" data-close>KEEP IT</button>
            <button class="btn btn--accent" data-cancel-yes>YES, CANCEL</button>
          </div>`, { labelledBy: 'cancel-h' })
          .querySelector('[data-cancel-yes]').addEventListener('click', () => {
            Store.cancelOrder(current);
            Modal.close();
            toast('Order cancelled');
            renderResult(current);
          });
      });

      /* deep-link ?order=&email= auto-search (server lookup) */
      if (params.get('order') && params.get('email')) {
        Store.lookupOrder(params.get('order'), params.get('email')).then((order) => {
          if (order) renderResult(order);
        });
      }
    },
  };
};

/* ============================================================
   ABOUT + 404
   ============================================================ */
Views.about = () => ({
  html: `
  <section class="page-head"><div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">HOME</a> / <span>MANIFESTO</span></nav>
    <h1 class="page-title">THE <span class="text-accent">MANIFESTO</span></h1>
  </div></section>
  <section class="container section about">
    <div class="about__grid">
      <div class="about__art">${emblemSVG('about__emblem')}</div>
      <div class="about__copy">
        <p class="about__lede">We roast coffee the way the underworld runs: dark, hot, and without apology.</p>
        <p>SIP OF DEATH COFFEE CO. was founded in ${BRAND.established} on one belief — that most coffee is a warm apology, and yours shouldn't be. We source high-grown arabica and merciless robusta, roast past the point of politeness, and test every batch against one standard: would this wake the dead?</p>
        <ul class="about__list">
          <li>${flame('ic-s')} Small-batch roasted weekly</li>
          <li>${bolt('ic-s')} Caffeine calibrated for maximum focus</li>
          <li>${skullIcon('ic-s')} Zero compromise, zero mercy</li>
        </ul>
        <p class="about__tag">“${esc(BRAND.tagline)}”</p>
      </div>
    </div>
  </section>`,
  mount() {},
});

Views.notFound = () => {
  /* Guard: card orders still awaiting payment redirect to a 404-looking
     state if the lastOrder pointer is missing — show the right page. */
  const last = sessionStorage.getItem('sod.lastOrder');
  const order = last ? Store.state.orders.find((o) => o.number === last) : null;
  if (order && order.status === 'pending_payment') return Views.paymentReturn(new URLSearchParams(`order=${order.number}`));
  return Views.notFoundRender();
};

Views.notFoundRender = () => ({
  html: `
  <section class="container section empty empty--page">
    ${skullIcon('empty__skull')}
    <h1 class="page-title">404 — <span class="text-accent">DEAD END</span></h1>
    <p>This page drank the wrong cup.</p>
    <a class="btn btn--accent" href="#/">BACK TO THE LIVING</a>
  </section>`,
  mount() {},
});

/* ============================================================
   PAYMENT RETURN — hosted gateway redirects here after payment
   (#/payment-return?order=…&result=success|failure|cancel|pending)
   Reconciles with the payments server before trusting the query.
   ============================================================ */
Views.paymentReturn = (params) => {
  const number = params.get('order') || sessionStorage.getItem('sod.lastOrder') || '';
  const result = (params.get('result') || '').toLowerCase();
  const order = Store.state.orders.find((o) => o.number === number);

  if (!order) {
    return {
      html: `<section class="container section"><div class="empty">
        ${skullIcon('empty__skull')}<p>Unknown payment session.</p>
        <a class="btn btn--accent" href="#/">BACK TO THE STORE</a></div></section>`,
      mount() {},
    };
  }

  return {
    html: `
    <section class="container payment-return" data-pr-root>
      <div class="payment-return__box" data-pr-box>
        <div class="payment-return__spinner" aria-hidden="true"></div>
        <h1 class="page-title">CHECKING <span class="text-accent">PAYMENT…</span></h1>
        <p class="muted">Order ${esc(number)} — confirming with the gateway. Don't close this page.</p>
      </div>
    </section>`,
    mount(root) {
      const box = $('[data-pr-box]', root);

      function finalState(kind, detail) {
        const okState = kind === 'paid';
        box.innerHTML = `
          <div class="payment-return__mark ${okState ? 'is-ok' : 'is-bad'}">${icon(okState ? 'check' : 'close')}</div>
          <h1 class="page-title">${okState ? 'PAYMENT <span class="text-accent">CONFIRMED</span>' : 'PAYMENT <span class="text-accent">DECLINED</span>'}</h1>
          <p class="success__num">Order <strong>${esc(number)}</strong></p>
          <p class="muted">${esc(detail || '')}</p>
          <div class="payment-return__totals">
            <div class="totals__row totals__row--grand"><span>TOTAL</span><span>${fmt(order.totals.total)}</span></div>
          </div>
          <div class="payment-return__ctas">
            ${okState
              ? `<a class="btn btn--accent" href="#/track?order=${esc(number)}&email=${encodeURIComponent(order.customer.email)}">TRACK ORDER ${icon('arrow', 'ic-s')}</a>
                 <a class="btn btn--ghost" href="#/shop">KEEP SHOPPING</a>`
              : `<a class="btn btn--accent" href="#/shop">BACK TO THE SHOP</a>
                 <a class="btn btn--ghost" href="#/track?order=${esc(number)}&email=${encodeURIComponent(order.customer.email)}">VIEW ORDER STATE</a>`}
          </div>`;
      }

      (async () => {
        /* authoritative source = API payment status endpoint */
        let serverStatus = null;
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, i === 0 ? 400 : 1200));
          const st = await Store.syncPaymentStatus(number);
          if (st && ['paid', 'failed', 'placed'].includes(st.status)) { serverStatus = st.status; break; }
        }

        if (serverStatus === 'paid') {
          Store.markPaid(number);
          finalState('paid', 'The gateway confirmed the transaction.');
          return;
        }
        if (serverStatus === 'failed') {
          Store.markFailed(number);
          finalState('failed', 'The gateway reported a declined transaction.');
          return;
        }

        /* No confirmation from the server. Interpret the redirect result. */
        if (result === 'cancel' || result === 'failure') {
          Store.markFailed(number);
          finalState('failed', result === 'cancel'
            ? 'You cancelled at the gateway.'
            : 'The gateway reported a problem with this payment.');
          return;
        }

        /* Still pending (slow webhook, or no backend reachable). */
        const reason = params.get('reason') || '';
        box.innerHTML = `
          <div class="payment-return__mark is-pending">!</div>
          <h1 class="page-title">PAYMENT <span class="text-accent">PENDING</span></h1>
          <p class="success__num">Order <strong>${esc(number)}</strong></p>
          <p class="muted">${reason ? esc(reason) : "The gateway hasn't confirmed this payment yet."}</p>
          <p class="muted">Start the payments server and re-run checkout — the order settles through the signed webhook:</p>
          <pre class="pr-cmd">node payments/server.js</pre>
          <div class="payment-return__ctas">
            <button class="btn btn--accent" data-pr-recheck>RECHECK NOW</button>
            <a class="btn btn--ghost" href="#/track?order=${esc(number)}&email=${encodeURIComponent(order.customer.email)}">VIEW ORDER STATE</a>
            ${order.status === 'pending_payment' ? '<button class="btn btn--ghost" data-pr-cancel>CANCEL ORDER</button>' : ''}
          </div>`;
        $('[data-pr-recheck]', box).addEventListener('click', async () => {
          const re = await Store.syncPaymentStatus(number);
          if (re && re.status === 'paid') { Store.markPaid(number); finalState('paid', 'The gateway confirmed the transaction.'); }
          else if (re && re.status === 'failed') { Store.markFailed(number); finalState('failed', 'The gateway reported a declined transaction.'); }
          else toast('Still pending — try again shortly', 'err');
        });
        const cancelBtn = $('[data-pr-cancel]', box);
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
          const ord = Store.state.orders.find((o) => o.number === number);
          if (ord && Store.cancelOrder(ord)) { toast('Order cancelled — stock released'); location.hash = '#/shop'; }
        });
      })();
    },
  };
};
