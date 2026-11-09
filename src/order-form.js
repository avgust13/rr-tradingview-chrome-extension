// Puts the quantity into the UTEX order form. Never clicks Buy/Sell.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  // Field ids seen on margin.utex.io (LIMIT/MARKET/STOP tabs share them).
  const QTY_IDS = { buy: 'BUYqty', sell: 'SELLqty' };

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

  function fillQty(side, qty) {
    const id = side > 0 ? QTY_IDS.buy : QTY_IDS.sell;
    const el = document.getElementById(id);
    if (!el) return { ok: false, id };
    setReactInput(el, qty);
    flash(el);
    return { ok: true, id };
  }

  NS.orderForm = { fillQty };
})();
