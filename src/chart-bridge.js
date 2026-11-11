// Everything that touches TradingView internals lives here, so a site/TV update
// is fixed in one place. Verified against Charting Library v27.000 on margin.utex.io,
// v27.005 on trading.bitfinex.com and v28.5.0 on app.hyperliquid.xyz.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  function findIframe() {
    return document.querySelector('iframe[id^="tradingview_"]');
  }

  function getApi(iframe) {
    try {
      return (iframe && iframe.contentWindow && iframe.contentWindow.tradingViewApi) || null;
    } catch (e) {
      return null;
    }
  }

  class Bridge {
    constructor(iframe, api) {
      this.iframe = iframe;
      this.win = iframe.contentWindow;
      this.doc = this.win.document;
      this.api = api;
    }

    alive() {
      try {
        return this.iframe.isConnected && this.iframe.contentWindow === this.win && !!this.win.tradingViewApi;
      } catch (e) {
        return false;
      }
    }

    chart() {
      return this.api.activeChart();
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
    ticker() {
      const si = this.symbolInfo();
      return (si && (si.name || si.ticker)) || null;
    }

    // Quote currency ("USD", "USDt", "BTC"); null when the feed doesn't say (UTEX).
    quote() {
      const si = this.symbolInfo();
      return (si && si.currency_code) || null;
    }

    // Base currency of a pair ("BTC" in "BTC/USD", "BTCUSD" on Hyperliquid); null for stocks.
    base() {
      return NS.site.base(this.ticker());
    }

    // Main price pane (first row of the chart table).
    paneEl() {
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

  NS.bridge = { findIframe, getApi, Bridge };
})();
