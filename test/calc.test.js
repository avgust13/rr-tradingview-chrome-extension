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

t('formatting', () => {
  assert.equal(c.fmtMoney(-267.28, true), '−$267.28');
  assert.equal(c.fmtMoney(1451.364, true), '+$1,451.36');
  assert.equal(c.fmtMoney(3844.88), '$3,844.88');
  assert.equal(c.fmtPct(-6.9516), '−6.95%');
  assert.equal(c.fmtPct(0), '0.00%');
});

console.log(`\n${n} tests passed`);
