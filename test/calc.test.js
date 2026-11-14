// Run: node test/calc.test.js
const assert = require('node:assert/strict');
const c = require('../src/calc.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('decimalsFromTick', () => {
  assert.equal(c.decimalsFromTick(0.01), 2);
  assert.equal(c.decimalsFromTick(1), 0);
  assert.equal(c.decimalsFromTick(0.0001), 4);
  assert.equal(c.decimalsFromTick(1e-7), 7);
});

t('roundToTick', () => {
  assert.equal(c.roundToTick(73.9449, 0.01), 73.94);
  assert.equal(c.roundToTick(73.945001, 0.01), 73.95);
  assert.equal(c.roundToTick(101.3, 0.5), 101.5);
});

t('long: screenshot example (entry 73.94, SL 68.80, TP 82.62, qty 52)', () => {
  const r = c.compute({ side: 1, qty: 52, entry: 73.94, stop: 68.8, target: 82.62 });
  near(r.atStop, -267.28);
  near(r.atTarget, 451.36);
  near(r.rr, 451.36 / 267.28);
  near(r.value, 3844.88);
  near(r.atStopPct, -6.9516, 1e-3);
});

t('short: stop above, target below', () => {
  const r = c.compute({ side: -1, qty: 10, entry: 100, stop: 105, target: 90 });
  near(r.atStop, -50);
  near(r.atTarget, 100);
  near(r.rr, 2);
  near(r.atTargetPct, 10);
});

t('stop on wrong side gives no R:R', () => {
  const r = c.compute({ side: 1, qty: 10, entry: 100, stop: 101, target: 110 });
  assert.ok(r.atStop > 0);
  assert.equal(r.rr, null);
});

t('live P&L for frozen entry', () => {
  const long = c.compute({ side: 1, qty: 20, entry: 50, stop: 48, target: 55, last: 51.5 });
  near(long.live, 30);
  near(long.livePct, 3);
  const short = c.compute({ side: -1, qty: 20, entry: 50, stop: 52, target: 45, last: 51.5 });
  near(short.live, -30);
});

t('levelsFromPct / pctFromLevels round-trip', () => {
  const L = c.levelsFromPct(100, 1, 2, 4, 0.01);
  assert.deepEqual(L, { stop: 98, target: 104 });
  const S = c.levelsFromPct(100, -1, 2, 4, 0.01);
  assert.deepEqual(S, { stop: 102, target: 96 });
  const p = c.pctFromLevels(100, -1, 102, 96);
  near(p.slPct, 2);
  near(p.tpPct, 4);
});

t('mirror flips levels around entry', () => {
  assert.deepEqual(c.mirror(100, 98, 104, 0.01), { stop: 102, target: 96 });
});

t('stepQty clamps to min', () => {
  assert.equal(c.stepQty(52, 10), 62);
  assert.equal(c.stepQty(5, -10), 1);
  assert.equal(c.stepQty('7', 1), 8);
});

t('stepQty with decimals (crypto)', () => {
  assert.equal(c.stepQty(0.01, 0.001, 0.0001, 8), 0.011);
  assert.equal(c.stepQty(0.1, 0.2, 0.0001, 8), 0.3); // no 0.30000000000000004
  assert.equal(c.stepQty(0.001, -0.01, 0.0001, 8), 0.0001);
  assert.equal(c.stepQty(12.5, 0, 1, 0), 13);
});

t('autoStep: power of ten worth ~10 quote units', () => {
  assert.equal(c.autoStep(73200, 10, 8), 0.001);
  assert.equal(c.autoStep(1.0434, 10, 8), 10);
  assert.equal(c.autoStep(0.067546, 10, 8), 1000);
  assert.equal(c.autoStep(1, 10, 8), 10);
  assert.equal(c.autoStep(0.027662, 0.0001, 8), 0.01); // ETH/BTC
  assert.equal(c.autoStep(1e9, 10, 2), 0.01); // capped by decimals
});

t('fmtQty', () => {
  assert.equal(c.fmtQty(151, 0), '151');
  assert.equal(c.fmtQty(0.0123, 8), '0.0123');
  assert.equal(c.fmtQty(1e-7, 8), '0.0000001');
  assert.equal(c.fmtQty(2000, 8), '2000');
});

t('fmtMoney by quote currency', () => {
  assert.equal(c.fmtMoney(-12.5, true, 'USD'), '−$12.50');
  assert.equal(c.fmtMoney(12.5, true, 'USDt'), '+$12.50');
  assert.equal(c.fmtMoney(1234.5, false, 'EUR'), '€1,234.50');
  assert.equal(c.fmtMoney(-0.00031250, true, 'BTC'), '−0.00031250 BTC');
  assert.equal(c.fmtMoney(0, true, 'BTC'), '0.00000000 BTC');
  assert.equal(c.fmtMoney(5, true, null), '+$5.00');
});

t('formatting', () => {
  assert.equal(c.fmtMoney(-267.28, true), '−$267.28');
  assert.equal(c.fmtMoney(1451.364, true), '+$1,451.36');
  assert.equal(c.fmtMoney(3844.88), '$3,844.88');
  assert.equal(c.fmtPct(-6.9516), '−6.95%');
  assert.equal(c.fmtPct(0), '0.00%');
});

t('levelsFromRisk: TP is rr × the rounded risk', () => {
  assert.deepEqual(c.levelsFromRisk(100, 1, 2.004, 3, 0.01), { stop: 98, target: 106 });
  assert.deepEqual(c.levelsFromRisk(100, -1, 2.004, 3, 0.01), { stop: 102, target: 94 });
  // Risk below one tick still leaves a one-tick stop
  assert.deepEqual(c.levelsFromRisk(100, 1, 0.001, 3, 0.01), { stop: 99.99, target: 100.03 });
});

const DAY = 86400000;
const bar = (d, high, low, close) => ({ time: d * DAY, open: close, high, low, close });

t('atr: mean true range of completed days, gaps count', () => {
  const bars = [
    bar(0, 10, 9, 9.5),       // TR 1 (no previous close)
    bar(1, 11, 10, 10.5),     // TR 1.5 (high − prev close)
    bar(2, 10.6, 9.6, 10),    // TR 1
    bar(3, 12, 11.5, 11.8),   // TR 2 (gap up)
    bar(4, 20, 5, 6),         // still forming at now = day 4
  ];
  near(c.atr(bars, 3, 4 * DAY), 1.5);
  near(c.atr(bars, 10, 4 * DAY), 1.375); // fewer days than the period: mean of what there is
  near(c.atr(bars.slice().reverse(), 3, 4 * DAY), 1.5); // newest-first input (Bitfinex)
  near(c.atr(bars, 1, null), 15); // no `now`: the last bar counts
  assert.equal(c.atr([bar(4, 20, 5, 6)], 5, 4 * DAY), null);
  assert.equal(c.atr([], 5, 0), null);
});

t('atr: UTEX DOCN daily bars', () => {
  const D = (iso, o, h, l, cl) => ({ time: Date.parse(iso), open: o, high: h, low: l, close: cl });
  const bars = [
    D('2026-11-05T05:00:00Z', 79.72, 81.215, 69.85, 70.7),
    D('2026-11-06T05:00:00Z', 78.4, 78.5, 69.78, 72.48),
    D('2026-11-09T05:00:00Z', 73.66, 79.16, 72.26, 78.3),
    D('2026-11-10T05:00:00Z', 76.93, 85, 75.38, 79.52),
    D('2026-11-11T05:00:00Z', 85.9, 89.56, 84.34, 87.15),
    D('2026-11-12T05:00:00Z', 82.2, 92.24, 81.99, 90.07),
    D('2026-11-13T05:00:00Z', 90.54, 91.29, 83.5501, 86.32),
  ];
  near(c.atr(bars, 5, Date.parse('2026-11-14T12:00:00Z')), 8.90998, 1e-5);
  near(c.atr(bars, 5, Date.parse('2026-11-14T02:00:00Z')), 9.106, 1e-5); // Nov 13 not closed yet
});

console.log(`\n${n} tests passed`);
