// Per-browser settings in the page's localStorage (MAIN world has no chrome.storage).
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  const KEY = 'utexRR.settings';
  // Default SL/TP on a ticker the user hasn't adjusted: SL = slAtr × ATR(atrDays) of daily
  // candles, TP = rr × that risk. levels: per ticker, the Entry / SL / TP prices and the side
  // as the user left them (up to 0.5: only the SL/TP distances in % of entry).
  // autoSpace: scroll the chart once on activation so the labels sit right of the last candle.
  // labelSide: 'right' — line labels and the ±Qty pill at the price scale; 'left' — at the
  // pane's left edge (autoSpace does nothing there).
  // step/qty: used where sizing is global (UTEX); per-ticker sites keep them in byTicker.
  const DEFAULTS = {
    step: 10, slAtr: 1, rr: 3, atrDays: 5, side: 1, qty: 10, autoSpace: true, labelSide: 'right',
    byTicker: {}, levels: {},
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

  const isPrice = (v) => Number.isFinite(v) && v > 0;

  // Entry / SL / TP and side as the user left them on this ticker: { entry, stop, target,
  // side }, prices as they were, wherever the market is now. null = never placed by hand
  // here. Per ticker on every site.
  function position(ticker) {
    const p = ticker && load().levels && load().levels[ticker];
    if (!p || !isPrice(p.entry) || !isPrice(p.stop) || !isPrice(p.target)) return null;
    return { entry: p.entry, stop: p.stop, target: p.target, side: p.side === -1 ? -1 : 1 };
  }

  function savePosition(ticker, { entry, stop, target, side }) {
    if (!ticker || !isPrice(entry) || !isPrice(stop) || !isPrice(target)) return load();
    const levels = Object.assign({}, load().levels);
    levels[ticker] = { entry, stop, target, side: side === -1 ? -1 : 1 };
    return save({ levels });
  }

  // Tickers adjusted before 0.6 have only the SL/TP distances: { slPct, tpPct } (% of entry).
  // They open at the current price with those until a line is moved again.
  function distances(ticker) {
    const d = ticker && load().levels && load().levels[ticker];
    return d && d.slPct > 0 && d.tpPct > 0 ? { slPct: d.slPct, tpPct: d.tpPct } : null;
  }

  function clearLevels(ticker) {
    const levels = Object.assign({}, load().levels);
    if (!(ticker in levels)) return load();
    delete levels[ticker];
    return save({ levels });
  }

  // Another tab of this site saved: drop the cache, or this tab's next save would write its
  // old copy over that tab's levels.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) cur = null;
  });

  NS.settings = { load, save, sizing, saveSizing, position, savePosition, distances, clearLevels, DEFAULTS };
})();
