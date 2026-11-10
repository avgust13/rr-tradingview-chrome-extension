// What differs between exchanges. The chart (TradingView Charting Library), the lines and
// the overlay are shared; only quantity units and the order form are per site.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

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
  ];

  NS.site = SITES.find((s) => s.host.test(location.hostname)) || SITES[0];
})();
