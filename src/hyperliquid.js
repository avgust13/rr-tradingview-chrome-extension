// Hyperliquid specifics: chart symbol -> coin, and each coin's size precision (szDecimals)
// from the public info API. The order form silently ignores a Size with more decimals than
// the coin allows (0.123456 BTC is refused, BTC takes 5 decimals), so Qty must respect it.
(function (root) {
  'use strict';
  const API = 'https://api.hyperliquid.xyz/info';
  const RETRY_MS = 10000;

  // Chart symbol names as the site's datafeed builds them:
  //   perps        "BTCUSD", "kPEPEUSD"
  //   HIP-3 perps  "xyz:TSLAUSD"          (builder-deployed dex "xyz")
  //   spot         "HYPE/USDC-@107", "PURR/USDC"
  // -> { spot, coin: name in the info API, dex: perp dex ('' = main, null for spot),
  //      base: what the order form's Size unit says ("BTC", "TSLA", "HYPE") }
  function parseTicker(name) {
    if (!name) return null;
    const s = String(name);
    const slash = s.indexOf('/');
    if (slash > 0) {
      const at = s.lastIndexOf('-@');
      return { spot: true, coin: at > slash ? s.slice(at + 1) : s, dex: null, base: s.slice(0, slash) };
    }
    // Quote suffix: USD on the main dex; HIP-3 dexes may use another stablecoin (USDH, USDT0…).
    const m = /^(.+?)USD[A-Z0-9]{0,2}$/.exec(s);
    const coin = m ? m[1] : s;
    const colon = coin.indexOf(':');
    return {
      spot: false,
      coin,
      dex: colon > 0 ? coin.slice(0, colon) : '',
      base: colon > 0 ? coin.slice(colon + 1) : coin,
    };
  }

  // ---------- size precision, loaded once per dex ----------

  const decimals = {};  // 'perp:<coin>' | 'spot:<coin>' -> szDecimals
  const requested = {}; // 'perp:<dex>' | 'spot' -> true while loading or loaded

  function post(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
  }

  function indexPerps(meta) {
    for (const a of (meta && meta.universe) || []) decimals['perp:' + a.name] = a.szDecimals;
  }

  // Spot pairs carry no precision of their own: it is the base token's szDecimals.
  function indexSpot(meta) {
    const tokens = {};
    for (const t of (meta && meta.tokens) || []) tokens[t.index] = t.szDecimals;
    for (const p of (meta && meta.universe) || []) {
      const d = tokens[p.tokens && p.tokens[0]];
      if (d == null) continue;
      decimals['spot:' + p.name] = d;
      decimals['spot:@' + p.index] = d;
    }
  }

  function load(key) {
    if (requested[key]) return;
    requested[key] = true;
    const dex = key.startsWith('perp:') ? key.slice(5) : null;
    const req = key === 'spot'
      ? post({ type: 'spotMeta' }).then(indexSpot)
      : post(dex ? { type: 'meta', dex } : { type: 'meta' }).then(indexPerps);
    req.catch((e) => {
      console.warn('[R/R] Hyperliquid meta failed', key, e);
      setTimeout(() => { requested[key] = false; }, RETRY_MS);
    });
  }

  // Size decimals for a chart symbol; null until the API has answered (a request is started).
  function sizeDecimals(ticker) {
    const t = parseTicker(ticker);
    if (!t) return null;
    const id = (t.spot ? 'spot:' : 'perp:') + t.coin;
    if (decimals[id] != null) return decimals[id];
    load(t.spot ? 'spot' : 'perp:' + t.dex);
    return null;
  }

  // ---------- daily candles (for the ATR stop) ----------

  // The site's own datafeed can't be used for this: its getBars() stores the requested
  // resolution on the shared datafeed object, which would break the chart's live candles.
  // -> [{ time (ms), open, high, low, close }], oldest first.
  function dailyBars(ticker, count) {
    const t = parseTicker(ticker);
    if (!t) return Promise.reject(new Error('unknown symbol ' + ticker));
    const end = Date.now();
    const req = { coin: t.coin, interval: '1d', startTime: end - (count + 1) * 86400000, endTime: end };
    return post({ type: 'candleSnapshot', req }).then((rows) => (Array.isArray(rows) ? rows : []).map((c) => ({
      time: c.t, open: +c.o, high: +c.h, low: +c.l, close: +c.c,
    })));
  }

  const hl = { parseTicker, sizeDecimals, load, dailyBars };

  if (typeof module !== 'undefined' && module.exports) module.exports = hl;
  else (root.__utexRR = root.__utexRR || {}).hyperliquid = hl;
})(typeof window !== 'undefined' ? window : globalThis);
