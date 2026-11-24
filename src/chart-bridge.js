// Everything that touches TradingView internals lives here, so a site/TV update
// is fixed in one place. Verified against Charting Library v27.000 on margin.utex.io,
// v27.005 on trading.bitfinex.com, v28.5.0 on app.hyperliquid.xyz and on www.tradingview.com.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  function getApi(iframe) {
    try {
      return (iframe && iframe.contentWindow && iframe.contentWindow.tradingViewApi) || null;
    } catch (e) {
      return null;
    }
  }

  // The chart, or null while there is none yet. Exchanges embed the Charting Library in an
  // iframe tradingview_* with window.tradingViewApi inside; on tradingview.com the chart is
  // the page itself and the API is window.TradingViewApi.
  function find() {
    const own = window.TradingViewApi;
    if (own && typeof own.activeChart === 'function') {
      try { return own.activeChart() ? new Bridge(null, own) : null; } catch (e) { return null; }
    }
    const iframe = document.querySelector('iframe[id^="tradingview_"]');
    const api = getApi(iframe);
    return api ? new Bridge(iframe, api) : null;
  }

  class Bridge {
    // iframe: the Charting Library iframe, or null when the chart is this page (tradingview.com).
    constructor(iframe, api) {
      this.iframe = iframe;
      this.win = iframe ? iframe.contentWindow : window;
      this.doc = this.win.document;
      this.api = api;
      // tradingview.com layouts hold several charts: the tool sits on the one active now and
      // moves to another (alive() turns false, boot makes a new Bridge) when that is made active.
      this.pinned = iframe ? null : api.activeChart();
    }

    alive() {
      try {
        if (!this.iframe) return window.TradingViewApi === this.api && this.api.activeChart() === this.pinned;
        return this.iframe.isConnected && this.iframe.contentWindow === this.win && !!this.win.tradingViewApi;
      } catch (e) {
        return false;
      }
    }

    chart() {
      return this.pinned || this.api.activeChart();
    }

    // Internal model: the public API has no "last price" getter.
    mainSeries() {
      try {
        return this.chart().chartModel().mainSeries();
      } catch (e) {
        return null;
      }
    }

    lastPrice() {
      try {
        const bar = this.mainSeries().bars().last();
        const close = bar && bar.value && bar.value[4];
        return Number.isFinite(close) ? close : null;
      } catch (e) {
        return null;
      }
    }

    symbolInfo() {
      try {
        return this.mainSeries().symbolInfo() || null;
      } catch (e) {
        return null;
      }
    }

    tick() {
      const si = this.symbolInfo();
      return si && si.pricescale ? (si.minmov || 1) / si.pricescale : 0.01;
    }

    // Human ticker ("DOCN", "BTC/USD", "BTCUSD"); chart().symbol() is UTEX's internal id. null while loading.
    // tradingview.com adds the exchange ("BINANCE:BTCUSDT"): one name trades on many of them.
    ticker() {
      const si = this.symbolInfo();
      if (!si) return null;
      return (NS.site.ticker ? NS.site.ticker(si) : si.name || si.ticker) || null;
    }

    // Quote currency ("USD", "USDt", "BTC"); null when the feed doesn't say (UTEX).
    quote() {
      const si = this.symbolInfo();
      return (si && si.currency_code) || null;
    }

    // Money per 1.0 of price per unit of Qty: 50 for an ES futures contract, 1 for stocks and
    // coins. Only tradingview.com says (symbolInfo.pointvalue); the exchanges trade units.
    pointValue() {
      const si = this.iframe ? null : this.symbolInfo();
      const pv = si && Number(si.pointvalue);
      return pv > 0 ? pv : 1;
    }

    // Main price pane (first row of the chart table). On tradingview.com the one of the
    // pinned chart: a layout has a table per chart.
    paneEl() {
      if (!this.iframe) {
        try {
          const row = this.pinned.chartWidget().paneWidgets()[0].getElement();
          const el = row && row.querySelector('.chart-gui-wrapper');
          if (el) return el;
        } catch (e) { /* internal API moved: the first table below */ }
      }
      return this.doc.querySelector('.chart-markup-table.pane .chart-gui-wrapper');
    }

    paneRect() {
      const el = this.paneEl();
      return el ? el.getBoundingClientRect() : null;
    }

    // Price -> Y inside the main pane, in pane pixels. null if unknown.
    priceToY(price) {
      // 1) Internal price scale: handles log / percent / inverted scales.
      try {
        const ms = this.mainSeries();
        const y = ms.priceScale().priceToCoordinate(price, ms.firstValue());
        if (Number.isFinite(y)) return y;
      } catch (e) { /* fall through */ }
      // 2) Public API: invert coordinateToPrice by interpolation.
      try {
        const pane = this.chart().getPanes()[0];
        const h = pane.getHeight();
        const ps = pane.getMainSourcePriceScale();
        const p0 = ps.coordinateToPrice(0);
        const pH = ps.coordinateToPrice(h);
        if (ps.getMode() === 1 && p0 > 0 && pH > 0 && price > 0) {
          return ((Math.log(p0) - Math.log(price)) / (Math.log(p0) - Math.log(pH))) * h;
        }
        return ((p0 - price) / (p0 - pH)) * h;
      } catch (e) {
        return null;
      }
    }

    // Pane x where the empty space right of the last candle begins (null if unknown).
    freeZoneX() {
      try {
        const ts = this.chart().getTimeScale();
        return ts.width() - ts.rightOffset() * ts.barSpacing();
      } catch (e) {
        return null;
      }
    }

    // Scrolls so at least `px` of empty space is right of the last candle. Leaves the
    // chart alone when the user is looking at history (last candle off-screen).
    ensureRightSpace(px) {
      try {
        const ts = this.chart().getTimeScale();
        const off = ts.rightOffset();
        const sp = ts.barSpacing();
        if (off < -1 || off * sp >= px || !(sp > 0)) return false;
        ts.setRightOffset(Math.ceil(px / sp));
        return true;
      } catch (e) {
        return false;
      }
    }

    // Last `count` daily bars of the chart's symbol from the site's own datafeed, which the
    // widget leaves on the parent page as window[<iframe id>].datafeed. [{ time (ms), open,
    // high, low, close }]. A separate request: the chart's own bars are untouched.
    dailyBars(count) {
      const si = this.symbolInfo();
      let feed = null;
      try { feed = window[this.iframe.id].datafeed; } catch (e) { /* not exposed */ }
      if (!si || !feed || typeof feed.getBars !== 'function') return Promise.reject(new Error('no datafeed'));
      const res = (si.supported_resolutions || []).find((r) => /^1?D$/.test(r)) || '1D';
      const to = Math.floor(Date.now() / 1000);
      // Calendar days: stocks skip weekends and holidays.
      const from = to - Math.ceil(count * 1.6 + 5) * 86400;
      return new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error('timeout')), 10000);
        try {
          feed.getBars(si, res, { from, to, countBack: count, firstDataRequest: false },
            (bars) => { clearTimeout(timer); ok(bars || []); },
            (err) => { clearTimeout(timer); fail(new Error(String(err))); });
        } catch (e) {
          clearTimeout(timer);
          fail(e);
        }
      });
    }

    // tradingview.com: last `count` daily bars of the chart's symbol from TradingView's server,
    // through the page's own connection (ChartApi). A chart session of our own with one
    // series, closed once the bars are in: the chart on screen is untouched.
    serverDailyBars(count) {
      const ca = this.api && this.api._chartApiInstance;
      const si = this.symbolInfo();
      const symbol = si && (si.pro_name || si.full_name);
      if (!ca || typeof ca.createSession !== 'function' || !symbol) return Promise.reject(new Error('no chart api'));
      const id = 'cs_rr' + Math.random().toString(36).slice(2, 12);
      return new Promise((ok, fail) => {
        const plots = {}; // bar index -> [time (s), open, high, low, close, volume]
        let sent = false;
        let done = false;
        const end = (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { if (sent) ca.chartDeleteSession(id); } catch (e) { /* disconnected */ }
          try { ca.removeSession(id); } catch (e) { /* gone */ }
          if (err) return fail(err);
          ok(Object.keys(plots).map(Number).sort((a, b) => a - b).map((i) => {
            const [time, open, high, low, close] = plots[i];
            return { time: time * 1000, open, high, low, close };
          }));
        };
        const timer = setTimeout(() => end(new Error('timeout')), 10000);
        const send = () => {
          sent = true;
          ca.chartCreateSession(id, false);
          ca.resolveSymbol(id, 'sds_sym_1', '=' + JSON.stringify({ symbol, adjustment: 'splits' }), (m) => {
            if (m.method === 'symbol_error') end(new Error('symbol_error'));
          });
          ca.createSeries(id, 'sds_1', 's1', 'sds_sym_1', '1D', count, null, (m) => {
            if (m.method === 'data_update') {
              // The first update has all the bars, later ones only the forming day.
              for (const p of (m.params && m.params.plots) || []) {
                if (p && Array.isArray(p.value) && p.value.length >= 5) plots[p.index] = p.value;
              }
            } else if (m.method === 'series_completed') end();
            else if (m.method === 'series_error') end(new Error('series_error'));
          });
        };
        try {
          // "connected" comes right away when the socket is up, otherwise once it connects.
          ca.createSession(id, {
            onMessage: (m) => {
              if (m.method === 'connected' && !sent) {
                try { send(); } catch (e) { end(e); }
              } else if (m.method === 'disconnected' || m.method === 'critical_error') {
                end(new Error(m.method));
              }
            },
          });
        } catch (e) {
          end(e);
        }
      });
    }

    // Returns an unsubscribe function.
    subscribe(eventName, cb) {
      try {
        const chart = this.chart();
        const sub = chart[eventName]();
        sub.subscribe(null, cb);
        return () => {
          try { sub.unsubscribe(null, cb); } catch (e) { /* chart gone */ }
        };
      } catch (e) {
        return () => {};
      }
    }
  }

  NS.bridge = { find, Bridge };
})();
