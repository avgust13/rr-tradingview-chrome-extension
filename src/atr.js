// Daily ATR per ticker: the default stop distance. Daily candles come from site.dailyBars(),
// are kept for an hour per ticker and averaged with the current period (calc.atr).
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  const BARS = 40;          // periods up to 30 days, plus the forming day and the previous close
  const TTL_MS = 3600e3;    // completed daily candles change once a day
  const RETRY_MS = 60e3;    // after a failed request
  const cache = {};         // ticker -> { bars (null = no data), at }
  const inflight = {};      // ticker -> Promise

  // Resolves with the ticker's daily bars (null if there are none). `bridge` must be on
  // `ticker` right now: the request reads the chart's current symbol.
  function load(ticker, bridge) {
    if (!ticker) return Promise.resolve(null);
    const old = cache[ticker];
    if (old && Date.now() - old.at < (old.bars ? TTL_MS : RETRY_MS)) return Promise.resolve(old.bars);
    if (inflight[ticker]) return inflight[ticker];
    const req = Promise.resolve()
      .then(() => NS.site.dailyBars(bridge, BARS))
      .then((bars) => (Array.isArray(bars) && bars.length ? bars : null))
      .catch((e) => {
        console.warn('[R/R] daily candles failed', ticker, e);
        return null;
      })
      .then((bars) => {
        delete inflight[ticker];
        // A failed refresh keeps the candles we had and tries again in a minute.
        cache[ticker] = bars || !(old && old.bars)
          ? { bars, at: Date.now() }
          : { bars: old.bars, at: Date.now() - TTL_MS + RETRY_MS };
        return cache[ticker].bars;
      });
    inflight[ticker] = req;
    return req;
  }

  // ATR in price units from what is loaded; null until load() has data.
  function value(ticker, period) {
    const c = cache[ticker];
    return c && c.bars ? NS.calc.atr(c.bars, period, Date.now()) : null;
  }

  const pending = (ticker) => !!inflight[ticker];

  NS.atr = { load, value, pending };
})();
