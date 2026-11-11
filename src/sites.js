// What differs between exchanges. The chart (TradingView Charting Library), the lines and
// the overlay are shared; only quantity units and the order form are per site.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  // "BTC/USD" -> "BTC"; stock tickers ("DOCN") have no base currency.
  const slashBase = (ticker) => {
    const i = ticker ? ticker.indexOf('/') : -1;
    return i > 0 ? ticker.slice(0, i) : null;
  };

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
    },
    {
      id: 'bitfinex',
      name: 'Bitfinex',
      host: /(^|\.)bitfinex\.com$/,
      qtyTitle: 'Количество в базовой валюте (BTC в BTC/USD)',
      qtyDecimals: 8,              // Bitfinex amounts go to 8 decimals
      perTicker: true,             // 0.01 BTC and 0.01 DOGE are different worlds
      fineStep: (step) => step / 10,
      // First visit on a pair: step = smallest power of ten worth about this much in the
      // quote currency (≈ $10 → 0.001 BTC, 10 XRP, 1000 DOGE).
      stepValue: (quote) => ({ BTC: 0.0001, ETH: 0.003, JPY: 1000 })[String(quote).toUpperCase()] || 10,
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
    },
  ];

  NS.site = SITES.find((s) => s.host.test(location.hostname)) || SITES[0];
  // Main-dex precisions are needed on almost every visit: ask before the tool is opened.
  if (NS.site.id === 'hyperliquid') NS.hyperliquid.load('perp:');
})();
