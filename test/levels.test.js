// Run: node test/levels.test.js
// The controller (main.js) with the real settings.js on a fake chart: levels the user moved
// on a ticker come back as they were when that ticker is opened again.
const assert = require('node:assert/strict');

const KEY = 'utexRR.settings';
const store = {};       // the page's localStorage
const listeners = {};   // window listeners by event type
const NS = {};
globalThis.window = {
  __utexRR: NS,
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener() {},
};
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// What the fake chart shows; `frame` is the pending requestAnimationFrame callback.
const chart = { ticker: 'AAA', price: 100, frame: null, loaded: [] };
let lines = null;       // the order lines on the chart now
let ui = null;          // the overlay
const toasts = [];

class Bridge {
  constructor() {
    this.doc = {};
    this.win = {
      requestAnimationFrame: (fn) => { chart.frame = fn; return 1; },
      cancelAnimationFrame: () => { chart.frame = null; },
      addEventListener() {},
      removeEventListener() {},
    };
  }
  alive() { return true; }
  chart() { return {}; }
  lastPrice() { return chart.price; }
  tick() { return 0.01; }
  ticker() { return chart.ticker; }
  quote() { return null; }
  symbolInfo() { return null; }
  pointValue() { return 1; }
  paneEl() { return {}; }
  paneRect() { return null; }
  priceToY() { return null; }
  subscribe(name, cb) { chart.loaded.push(cb); return () => {}; }
}

class Lines {
  constructor(c, doc, handlers) { this.h = handlers; this.broken = false; lines = this; }
  set() {}
  remove() { if (lines === this) lines = null; }
}

class Overlay {
  constructor(doc, h) { this.h = h; ui = this; }
  update() {}
  placeDock() {}
  placePill() {}
  setSummary() {}
  destroy() {}
  toast(msg) { toasts.push(msg); }
}

NS.calc = require('../src/calc.js');
NS.site = { name: 'Test', qtyDecimals: 0, perTicker: false, fineStep: () => 1, stepValue: () => 10, base: () => null };
NS.bridge = { find: () => new Bridge(), Bridge };
NS.Lines = Lines;
NS.Overlay = Overlay;
NS.orderForm = {};
NS.atr = { value: () => 2, load: () => Promise.resolve(null), pending: () => false }; // ATR 2 everywhere

// Opens the page (again): fresh settings.js and main.js over the same localStorage.
function loadPage() {
  if (NS.stop) NS.stop();
  for (const f of ['settings', 'main']) delete require.cache[require.resolve(`../src/${f}.js`)];
  chart.frame = null;
  chart.loaded = [];
  require('../src/settings.js');
  require('../src/main.js');
}

// The chart switches to another symbol while the tool is on.
function open(ticker, price) {
  chart.ticker = ticker;
  chart.price = price;
  chart.frame();                      // the switch is noticed
  chart.loaded.forEach((cb) => cb()); // onDataLoaded
  chart.frame();                      // lines rebuilt
}

const drag = (name, price) => lines.h.onMove(name, price, true);
const state = () => NS.debug().state;
const levels = () => {
  const s = state();
  return { entry: s.entry, stop: s.stop, target: s.target, side: s.side };
};

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('untouched ticker: entry at the price, SL/TP from ATR', () => {
  loadPage();
  NS.toggle();
  assert.deepEqual(levels(), { entry: 100, stop: 98, target: 106, side: 1 });
  assert.equal(state().auto, true);
});

t('moved lines come back after a visit to another ticker', () => {
  drag('entry', 95);
  drag('stop', 90);
  drag('target', 120);
  open('BBB', 50);
  assert.deepEqual(levels(), { entry: 50, stop: 48, target: 56, side: 1 });
  assert.equal(state().auto, true);
  toasts.length = 0;
  open('AAA', 130);
  assert.deepEqual(levels(), { entry: 95, stop: 90, target: 120, side: 1 });
  assert.equal(state().auto, false);
  assert.match(toasts.join(), /AAA/);
});

t('…after the tool is switched off and on', () => {
  NS.toggle();
  assert.equal(state().active, false);
  NS.toggle();
  assert.deepEqual(levels(), { entry: 95, stop: 90, target: 120, side: 1 });
});

t('…and after a page reload', () => {
  loadPage();
  assert.equal(state().active, false);
  NS.toggle();
  assert.deepEqual(levels(), { entry: 95, stop: 90, target: 120, side: 1 });
});

t('the side is kept with the levels; untouched tickers get the side chosen last', () => {
  ui.h.onSide(); // AAA: short, mirrored around the entry
  assert.deepEqual(levels(), { entry: 95, stop: 100, target: 70, side: -1 });
  open('BBB', 50);
  assert.deepEqual(levels(), { entry: 50, stop: 52, target: 44, side: -1 });
  ui.h.onSide(); // BBB still has the ATR levels: only the last chosen side changes
  open('AAA', 130);
  assert.deepEqual(levels(), { entry: 95, stop: 100, target: 70, side: -1 });
  open('CCC', 10);
  assert.deepEqual(levels(), { entry: 10, stop: 8, target: 16, side: 1 });
});

t('entry moved to the price by the button is remembered too', () => {
  open('AAA', 130);
  ui.h.onPrice();
  assert.deepEqual(levels(), { entry: 130, stop: 100, target: 70, side: -1 });
  open('BBB', 50);
  open('AAA', 140);
  assert.deepEqual(levels(), { entry: 130, stop: 100, target: 70, side: -1 });
});

t('Reset forgets the ticker', () => {
  ui.h.onReset();
  assert.deepEqual(levels(), { entry: 140, stop: 142, target: 134, side: -1 });
  assert.equal(state().auto, true);
  open('BBB', 50);
  open('AAA', 150);
  assert.deepEqual(levels(), { entry: 150, stop: 148, target: 156, side: 1 });
});

t('ticker adjusted before 0.6: its SL/TP distances at the current price', () => {
  const s = NS.settings;
  s.save({ levels: Object.assign({}, s.load().levels, { OLD: { slPct: 2, tpPct: 4 } }) });
  open('OLD', 200);
  assert.deepEqual(levels(), { entry: 200, stop: 196, target: 208, side: 1 });
  assert.equal(state().auto, false);
  drag('stop', 190); // from here on the prices themselves
  open('BBB', 50);
  open('OLD', 300);
  assert.deepEqual(levels(), { entry: 200, stop: 190, target: 208, side: 1 });
});

t('levels saved in another tab survive a save in this one', () => {
  const other = JSON.parse(store[KEY]);
  other.levels.ZZZ = { entry: 5, stop: 4, target: 8, side: 1 };
  store[KEY] = JSON.stringify(other);
  listeners.storage.forEach((fn) => fn({ key: KEY }));
  open('BBB', 50);
  drag('stop', 45);
  const saved = JSON.parse(store[KEY]).levels;
  assert.deepEqual(saved.ZZZ, { entry: 5, stop: 4, target: 8, side: 1 });
  assert.deepEqual(saved.BBB, { entry: 50, stop: 45, target: 56, side: 1 });
});

NS.stop();
console.log(`\n${n} tests passed`);
