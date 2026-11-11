// Run: node test/hyperliquid.test.js
const assert = require('node:assert/strict');
const hl = require('../src/hyperliquid.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('main-dex perps', () => {
  assert.deepEqual(hl.parseTicker('BTCUSD'), { spot: false, coin: 'BTC', dex: '', base: 'BTC' });
  assert.deepEqual(hl.parseTicker('kPEPEUSD'), { spot: false, coin: 'kPEPE', dex: '', base: 'kPEPE' });
});

t('HIP-3 perps keep the dex in the coin, not in the base', () => {
  assert.deepEqual(hl.parseTicker('xyz:TSLAUSD'), { spot: false, coin: 'xyz:TSLA', dex: 'xyz', base: 'TSLA' });
  assert.deepEqual(hl.parseTicker('km:EURUSD'), { spot: false, coin: 'km:EUR', dex: 'km', base: 'EUR' });
  assert.equal(hl.parseTicker('flx:TSLAUSDH').coin, 'flx:TSLA'); // other stablecoin collateral
});

t('coins that contain USD themselves', () => {
  assert.equal(hl.parseTicker('USUALUSD').coin, 'USUAL');
  assert.equal(hl.parseTicker('SUSDEUSD').coin, 'SUSDE');
  assert.equal(hl.parseTicker('BUSDUSD').coin, 'BUSD');
});

t('spot pairs', () => {
  assert.deepEqual(hl.parseTicker('HYPE/USDC-@107'), { spot: true, coin: '@107', dex: null, base: 'HYPE' });
  assert.deepEqual(hl.parseTicker('PURR/USDC'), { spot: true, coin: 'PURR/USDC', dex: null, base: 'PURR' });
});

t('nothing to parse', () => {
  assert.equal(hl.parseTicker(null), null);
  assert.equal(hl.parseTicker(''), null);
});

console.log(`\n${n} tests passed`);
