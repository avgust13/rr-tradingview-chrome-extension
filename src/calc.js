// Pure risk/reward math. No DOM, no chart access — testable in node.
(function (root) {
  'use strict';

  function decimalsFromTick(tick) {
    if (!(tick > 0)) return 2;
    const s = String(tick);
    if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }

  function roundToTick(price, tick) {
    if (!(tick > 0) || !isFinite(price)) return price;
    const d = decimalsFromTick(tick);
    return +(Math.round(price / tick) * tick).toFixed(d);
  }

  // side: +1 long, -1 short. Distances are percentages of entry (positive numbers).
  function levelsFromPct(entry, side, slPct, tpPct, tick) {
    return {
      stop: roundToTick(entry * (1 - side * slPct / 100), tick),
      target: roundToTick(entry * (1 + side * tpPct / 100), tick),
    };
  }

  // Distances of existing levels from entry, as positive-ish percentages for the given side.
  function pctFromLevels(entry, side, stop, target) {
    return {
      slPct: ((entry - stop) / entry) * 100 * side,
      tpPct: ((target - entry) / entry) * 100 * side,
    };
  }

  // Reflect stop and target around entry (used when switching Long <-> Short).
  function mirror(entry, stop, target, tick) {
    return {
      stop: roundToTick(2 * entry - stop, tick),
      target: roundToTick(2 * entry - target, tick),
    };
  }

  // Signed P&L of closing at `exit` a position of `qty` opened at `entry`.
  function pnl(entry, exit, qty, side) {
    return (exit - entry) * qty * side;
  }

  function pct(entry, exit, side) {
    return entry ? ((exit - entry) / entry) * 100 * side : 0;
  }

  // Everything the tool displays. atStop is normally negative, atTarget positive.
  function compute({ side, qty, entry, stop, target, last }) {
    const atStop = pnl(entry, stop, qty, side);
    const atTarget = pnl(entry, target, qty, side);
    const rr = atStop < 0 && atTarget > 0 ? atTarget / -atStop : null;
    const out = {
      atStop,
      atStopPct: pct(entry, stop, side),
      atTarget,
      atTargetPct: pct(entry, target, side),
      rr,
      value: entry * qty,
    };
    if (last != null && isFinite(last)) {
      out.live = pnl(entry, last, qty, side);
      out.livePct = pct(entry, last, side);
    }
    return out;
  }

  // Quantity rounded to `decimals` places (0 = whole shares), without float noise.
  function roundQty(qty, decimals) {
    const d = decimals || 0;
    const f = Math.pow(10, d);
    return +(Math.round((Number(qty) || 0) * f) / f).toFixed(d);
  }

  function stepQty(qty, delta, min, decimals) {
    const m = min == null ? 1 : min;
    const n = roundQty((Number(qty) || 0) + delta, decimals);
    return Math.max(m, n);
  }

  // Smallest power of ten whose value at `price` is at least `minValue` (quote currency):
  // BTC 73,000 → 0.001, XRP 1.04 → 10, DOGE 0.07 → 1000. Not finer than `decimals` allow.
  function autoStep(price, minValue, decimals) {
    const d = decimals || 0;
    if (!(price > 0) || !(minValue > 0)) return Math.pow(10, -d);
    const p = Math.max(-d, Math.ceil(Math.log10(minValue / price) - 1e-9));
    return roundQty(Math.pow(10, p), d);
  }

  // Plain digits for the Qty field and the order form: no exponent, no thousands separator.
  function fmtQty(qty, decimals) {
    const s = roundQty(qty, decimals).toFixed(decimals || 0);
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  }

  function fmtNum(v, decimals) {
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  // Quote currencies shown as a symbol with cents. Anything else (BTC, ETH…) is written
  // out with 8 decimals: "0.00012345 BTC". No currency (UTEX) means dollars.
  const MONEY = { USD: '$', USDT: '$', UST: '$', USDC: '$', EUR: '€', GBP: '£', JPY: '¥' };

  function fmtMoney(v, signed, currency) {
    const sym = currency ? MONEY[String(currency).toUpperCase()] : '$';
    const abs = sym ? sym + fmtNum(Math.abs(v), 2) : fmtNum(Math.abs(v), 8) + ' ' + currency;
    if (!signed) return (v < 0 ? '−' : '') + abs;
    if (Math.abs(v) < (sym ? 0.005 : 5e-9)) return abs;
    return (v < 0 ? '−' : '+') + abs;
  }

  function fmtPct(v) {
    if (Math.abs(v) < 0.005) return '0.00%';
    return (v < 0 ? '−' : '+') + fmtNum(Math.abs(v), 2) + '%';
  }

  const calc = {
    decimalsFromTick, roundToTick, levelsFromPct, pctFromLevels, mirror,
    pnl, pct, compute, roundQty, stepQty, autoStep, fmtQty, fmtNum, fmtMoney, fmtPct,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = calc;
  else (root.__utexRR = root.__utexRR || {}).calc = calc;
})(typeof window !== 'undefined' ? window : globalThis);
