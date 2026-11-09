// Per-browser settings in the page's localStorage (MAIN world has no chrome.storage).
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  const KEY = 'utexRR.settings';
  // autoSpace: scroll the chart once on activation so the labels sit right of the last candle.
  const DEFAULTS = { step: 10, slPct: 2, tpPct: 4, side: 1, qty: 10, autoSpace: true };

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

  NS.settings = { load, save, DEFAULTS };
})();
