// What differs between sites. The chart (TradingView Charting Library on the exchanges,
// TradingView itself on tradingview.com), the lines and the overlay are shared; quantity
// units, daily candles and the order form are per site.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  // "BTC/USD" -> "BTC"; stock tickers ("DOCN") have no base currency.
  const slashBase = (ticker) => {
    const i = ticker ? ticker.indexOf('/') : -1;
    return i > 0 ? ticker.slice(0, i) : null;
  };

  // First visit on a pair: step = smallest power of ten worth about this much in the
  // quote currency (≈ $10 → 0.001 BTC, 10 XRP, 1000 DOGE).
  const quoteStepValue = (quote) => ({ BTC: 0.0001, ETH: 0.003, JPY: 1000 })[String(quote).toUpperCase()] || 10;

  // tradingview.com symbol is a coin (spot, perp or crypto future), sized in fractions.
  const isCrypto = (si) => si.type === 'crypto' || (Array.isArray(si.typespecs) && si.typespecs.includes('crypto'));

  const SITES = [
    {
      id: 'utex',
      name: 'UTEX',
      host: /(^|\.)utex\.io$/,
      qtyTitle: 'Количество акций',
      qtyDecimals: 0,              // whole shares
      perTicker: false,            // one Qty and step for every ticker
      fineStep: () => 1,           // Shift+click, wheel, ↑/↓
      stepValue: () => 10,         // unused: sizing is never missing on UTEX
      base: slashBase,
      // LIMIT/MARKET/STOP tabs share these ids.
      qtyInput: (side) => document.getElementById(side > 0 ? 'BUYqty' : 'SELLqty'),
      formUnit: () => null,
      // Daily candles for the ATR stop: [{ time (ms), open, high, low, close }].
      // UTEX's datafeed keeps its state per resolution, so a 1D request is harmless.
      dailyBars: (bridge, count) => bridge.dailyBars(count),
    },
    {
      id: 'bitfinex',
      name: 'Bitfinex',
      host: /(^|\.)bitfinex\.com$/,
      qtyTitle: 'Количество в базовой валюте (BTC в BTC/USD)',
      qtyDecimals: 8,              // Bitfinex amounts go to 8 decimals
      perTicker: true,             // 0.01 BTC and 0.01 DOGE are different worlds
      fineStep: (step) => step / 10,
      stepValue: quoteStepValue,
      base: slashBase,
      // One Amount field for Buy and Sell; the side is the button you press.
      qtyInput: () => document.querySelector('#orderform-panel input[name="amount"]'),
      // "Amount BTC" -> "BTC": the market the order form is on.
      formUnit: (input) => {
        const box = input.closest('.ui-labeledinput__container');
        const label = box && box.querySelector('.ui-fieldlabel__innertag');
        const m = label && label.textContent.trim().match(/\s(\S+)$/);
        return m ? m[1] : null;
      },
      // Public candles API (CORS-open): newest first, [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME].
      // symbolInfo.ticker is the API pair ("BTCUSD", "DOGE:USD"). The datafeed is the fallback.
      dailyBars: (bridge, count) => {
        const si = bridge.symbolInfo();
        if (!si || !si.ticker) return bridge.dailyBars(count);
        const url = `https://api-pub.bitfinex.com/v2/candles/trade:1D:t${si.ticker}/hist?limit=${count}`;
        return fetch(url)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((rows) => rows.map(([time, open, close, high, low]) => ({ time, open, high, low, close })))
          .catch(() => bridge.dailyBars(count));
      },
    },
    {
      id: 'hyperliquid',
      name: 'Hyperliquid',
      host: /(^|\.)hyperliquid\.xyz$/,
      qtyTitle: 'Размер в базовой монете (BTC для BTC-USDC)',
      qtyDecimals: 8,              // upper bound; each coin's real precision is sizeDecimals()
      perTicker: true,
      fineStep: (step) => step / 10,
      stepValue: () => 10,         // perps and spot are all quoted in USD stablecoins
      base: (ticker) => {
        const t = NS.hyperliquid.parseTicker(ticker);
        return t ? t.base : null;
      },
      // Size precision of the coin (BTC 5, ETH 4, DOGE 0); null while the API is loading.
      sizeDecimals: (ticker) => NS.hyperliquid.sizeDecimals(ticker),
      // One Size field for Buy and Sell; the side is the Buy / Long or Sell / Short tab.
      qtyInput: () => document.querySelector('[data-testid="sz-input"] input'),
      // Unit picker right of the field: the coin ("BTC") or, if switched, the stablecoin.
      formUnit: (input) => {
        const u = input.nextElementSibling;
        const t = u && u.textContent.trim();
        return t || null;
      },
      // Info API only, never the datafeed (see hyperliquid.js).
      dailyBars: (bridge, count) => NS.hyperliquid.dailyBars(bridge.ticker(), count),
    },
    {
      // TradingView itself (www.tradingview.com/chart/): stocks, futures, forex and crypto from
      // every exchange, no order form of an exchange to fill.
      id: 'tradingview',
      name: 'TradingView',
      host: /(^|\.)tradingview\.com$/,
      qtyTitle: 'Количество: акции, контракты или монеты',
      qtyDecimals: 8,              // upper bound; per symbol in sizeDecimals()
      perTicker: true,             // AAPL shares and BTC coins on one site
      fineStep: (step) => step / 10,
      stepValue: quoteStepValue,
      // Levels and Qty are kept per exchange: BINANCE:BTCUSDT and BYBIT:BTCUSDT are two tickers.
      ticker: (si) => si.pro_name || si.full_name || si.name,
      base: () => null,            // only the order form needs it
      // Coins in fractions; shares, contracts and forex units whole.
      sizeDecimals: (ticker, si) => (si ? (isCrypto(si) ? 8 : 0) : null),
      // Right of the "TradingView" wordmark the chart draws in the pane's bottom-left corner.
      dockLeft: 176,
      // No qtyInput: the Qty → form button is not shown.
      dailyBars: (bridge, count) => bridge.serverDailyBars(count),
    },
  ];

  NS.site = SITES.find((s) => s.host.test(location.hostname)) || SITES[0];
  // Main-dex precisions are needed on almost every visit: ask before the tool is opened.
  if (NS.site.id === 'hyperliquid') NS.hyperliquid.load('perp:');
})();
