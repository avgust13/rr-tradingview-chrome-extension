// Per-browser settings in the page's localStorage (MAIN world has no chrome.storage).
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  const KEY = 'utexRR.settings';
  // Default SL/TP on a ticker the user hasn't adjusted: SL = slAtr × ATR(atrDays) of daily
  // candles, TP = rr × that risk. levels: per-ticker SL/TP distances (% of entry) once dragged.
  // autoSpace: scroll the chart once on activation so the labels sit right of the last candle.
  // step/qty: used where sizing is global (UTEX); per-ticker sites keep them in byTicker.
  const DEFAULTS = {
    step: 10, slAtr: 1, rr: 3, atrDays: 5, side: 1, qty: 10, autoSpace: true, byTicker: {}, levels: {},
  };

  let cur = null;

  function load() {
    if (cur) return cur;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
    cur = Object.assign({}, DEFAULTS, saved);
    // Up to 0.4 SL/TP were one global % for every ticker; now they come from each ticker's ATR.
    delete cur.slPct;
    delete cur.tpPct;
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

  // SL/TP distances the user set on this ticker by dragging: { slPct, tpPct } (% of entry).
  // null = never adjusted, use the ATR defaults. Per ticker on every site: ATRs differ.
  function distances(ticker) {
    const d = ticker && load().levels && load().levels[ticker];
    return d && d.slPct > 0 && d.tpPct > 0 ? { slPct: d.slPct, tpPct: d.tpPct } : null;
  }

  function saveDistances(ticker, slPct, tpPct) {
    if (!ticker) return load();
    const levels = Object.assign({}, load().levels);
    levels[ticker] = { slPct: +slPct.toFixed(4), tpPct: +tpPct.toFixed(4) };
    return save({ levels });
  }

  function clearDistances(ticker) {
    const levels = Object.assign({}, load().levels);
    if (!(ticker in levels)) return load();
    delete levels[ticker];
    return save({ levels });
  }

  NS.settings = { load, save, sizing, saveSizing, distances, saveDistances, clearDistances, DEFAULTS };
})();
