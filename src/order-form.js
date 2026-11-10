// Puts the quantity into the exchange's order form. Never clicks Buy/Sell.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  // React tracks the input's value internally; go through the native setter
  // so the change is picked up as user input.
  function setReactInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function flash(el) {
    try {
      el.animate(
        [{ boxShadow: '0 0 0 2px #2962ff' }, { boxShadow: '0 0 0 2px rgba(41,98,255,0)' }],
        { duration: 900, easing: 'ease-out' }
      );
    } catch (e) { /* no WAAPI */ }
  }

  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // qty: already formatted text. base: the chart's base currency (null for stocks).
  // Refuses when the form is on another market than the chart, e.g. after switching the
  // chart's symbol from inside TradingView.
  function fillQty(side, qty, base) {
    const el = NS.site.qtyInput(side);
    if (!el) return { ok: false, reason: 'missing' };
    const unit = NS.site.formUnit(el);
    if (unit && base && norm(unit) !== norm(base)) return { ok: false, reason: 'market', unit };
    setReactInput(el, qty);
    flash(el);
    return { ok: true, unit };
  }

  NS.orderForm = { fillQty };
})();
