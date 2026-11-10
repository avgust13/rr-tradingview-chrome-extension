// Per-browser settings in the page's localStorage (MAIN world has no chrome.storage).
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  const KEY = 'utexRR.settings';
  // autoSpace: scroll the chart once on activation so the labels sit right of the last candle.
  // step/qty: used where sizing is global (UTEX); per-ticker sites keep them in byTicker.
  const DEFAULTS = { step: 10, slPct: 2, tpPct: 4, side: 1, qty: 10, autoSpace: true, byTicker: {} };

  let cur = null;

  function load() {
    if (cur) return cur;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
    cur = Object.assign({}, DEFAULTS, saved);
    return cur;
  }

  function save(patch) {
    cur = Object.assign(load(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* storage blocked */ }
    return cur;
  }

  // Qty and its step: { qty, step }. Global on UTEX; per ticker on sites where units
  // differ wildly between tickers (crypto). null = this ticker was never sized.
  function sizing(ticker) {
    const c = load();
    if (!NS.site.perTicker) return { qty: c.qty, step: c.step };
    const t = ticker && c.byTicker && c.byTicker[ticker];
    return t && t.qty > 0 && t.step > 0 ? { qty: t.qty, step: t.step } : null;
  }

  function saveSizing(ticker, qty, step) {
    if (!NS.site.perTicker) return save({ qty, step });
    if (!ticker) return load();
    const byTicker = Object.assign({}, load().byTicker);
    byTicker[ticker] = { qty, step };
    return save({ byTicker });
  }

  NS.settings = { load, save, sizing, saveSizing, DEFAULTS };
})();
