'use strict';

/* ============================================================
   SIP OF DEATH — UI helpers: currency, toasts, modals,
   focus management, validators, misc formatting.
   ============================================================ */

/* ---------- currency ---------- */
function curCode() {
  return localStorage.getItem(LS_KEYS.currency) || STORE.currency;
}

function setCurrency(code) {
  if (CURRENCIES[code]) {
    localStorage.setItem(LS_KEYS.currency, code);
    document.dispatchEvent(new CustomEvent('currency:change'));
  }
}

function fmt(amountEgp, opts = {}) {
  const cur = CURRENCIES[curCode()] || CURRENCIES.EGP;
  const value = amountEgp * cur.rate;
  const digits = value >= 100 || cur.code === 'EGP' ? 0 : 2;
  const num = value.toLocaleString('en-EG', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return opts.noSymbol ? num : `${cur.symbol}${num}`;
}

/* ---------- DOM ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/* ---------- toast ---------- */
let toastWrap = null;
function toast(msg, kind = 'ok') {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `
    <span class="toast__mark">${kind === 'ok' ? icon('check') : icon('close')}</span>
    <span>${esc(msg)}</span>`;
  toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 350);
  }, 2600);
}

/* ---------- modal ---------- */
const Modal = {
  lastFocus: null,

  open(html, { onClose, labelledBy } = {}) {
    this.close(true);
    this.lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-root';
    wrap.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal" role="dialog" aria-modal="true" ${labelledBy ? `aria-labelledby="${labelledBy}"` : ''}>
        <button class="modal__x" data-close aria-label="Close dialog">${icon('close')}</button>
        <div class="modal__body">${html}</div>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    this.root = wrap;
    this.onClose = onClose;

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.close();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if (e.key === 'Tab') this.trapTab(e);
    });
    const first = wrap.querySelector('input, button, select, textarea, a[href]');
    if (first) first.focus();
    return wrap;
  },

  trapTab(e) {
    const focusables = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', this.root)
      .filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  },

  close(silent = false) {
    if (this.root) {
      this.root.remove();
      this.root = null;
      document.body.classList.remove('no-scroll');
      if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
      if (!silent && typeof this.onClose === 'function') this.onClose();
      this.onClose = null;
    }
  },
};

/* ---------- validation ---------- */
const V = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()),
  phone: (v) => /^01[0125][0-9]{8}$/.test(String(v).replace(/[\s-]/g, '')) || /^\+?[0-9\s-]{8,15}$/.test(String(v).trim()),
  required: (v) => String(v ?? '').trim().length > 0,
  card: (v) => /^[0-9\s]{13,23}$/.test(String(v).trim()),
  expiry: (v) => /^(0[1-9]|1[0-2])\s?\/\s?([0-9]{2})$/.test(String(v).trim()),
  cvc: (v) => /^[0-9]{3,4}$/.test(String(v).trim()),
};

/* Validate a form: fields carry data-validate="rule" and data-label.
   Marks invalid fields, returns { ok, first }. */
function validateForm(form) {
  let first = null;
  $$('[data-validate]', form).forEach((input) => {
    if (input.closest('[hidden]')) return; // skip fields hidden by step/branch logic
    const rule = input.dataset.validate;
    const fn = V[rule];
    const ok = !fn || fn(input.value);
    input.closest('.field')?.classList.toggle('field--error', !ok);
    input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok && !first) first = input;
  });
  return { ok: !first, first };
}

function clearFieldError(input) {
  input.closest('.field')?.classList.remove('field--error');
  input.setAttribute('aria-invalid', 'false');
}

/* ---------- misc ---------- */
function starRow(rating, count) {
  const full = Math.round(rating);
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span class="star ${i < full ? 'star--on' : ''}">${icon('star')}</span>`).join('');
  return `<span class="stars" role="img" aria-label="Rated ${rating} out of 5">${stars}</span>
          <span class="stars__num">${rating.toFixed(1)}${count ? ` (${count})` : ''}</span>`;
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function orderNumber() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `SOD-${new Date().getFullYear()}-${n}`;
}
