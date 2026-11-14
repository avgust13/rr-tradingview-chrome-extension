// Controller: tool state, update loop, chart lifecycle.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  if (NS.started) return;
  NS.started = true;

  const { calc, settings, site, bridge: B, Lines, Overlay, orderForm, atr } = NS;
  const BOOT_POLL_MS = 1000;
  const SYMBOL_FALLBACK_MS = 3000;
  const ATR_WAIT_MS = 1500;   // after a symbol switch, hold the lines this long for the new ATR
  const FALLBACK_SL_PCT = 2;  // default SL while (or if) the ticker has no daily candles
  // Qty decimals. Fixed per site, except where each coin has its own precision
  // (Hyperliquid): then it follows the ticker, see syncDecimals().
  let QD = site.qtyDecimals;

  const cfg = settings.load();
  const sz0 = settings.sizing(null) || { qty: 1, step: 1 }; // per-ticker sites size on activation
  const S = {
    active: false,
    side: cfg.side === -1 ? -1 : 1,
    qty: Math.max(1, sz0.qty | 0),
    step: sz0.step,
    entry: null,       // fixed: set on placement, by dragging the line or by → Price
    stop: null,
    target: null,
    ticker: null,
    auto: true,        // SL/TP are the ATR defaults, not placed by the user on this ticker
    waitAtr: null,     // ticker whose defaults went out with FALLBACK_SL_PCT, redone when ATR loads
    rebuildAt: 0,      // >0: waiting for new symbol data, rebuild by this time at the latest
    switchedAt: 0,     // when the symbol switch was noticed
    needSpace: false,  // make room for the labels right of the last candle on next frame
  };

  let ctx = null;      // { bridge, overlay, unsubs }
  let lines = null;
  let raf = 0;

  // ---------- helpers ----------

  const tick = () => ctx.bridge.tick();
  const round = (p) => calc.roundToTick(p, tick());
  const fmtPrice = (p) => calc.fmtNum(p, calc.decimalsFromTick(tick()));
  const fmtMoney = (v, signed) => calc.fmtMoney(v, signed, ctx.bridge.quote());
  const fmtQty = (q) => calc.fmtQty(q, QD);
  // Shift+click / wheel / arrows step; also the smallest Qty (1 share on UTEX).
  const fineStep = () => Math.max(calc.roundQty(site.fineStep(S.step), QD), minQty());
  const clampQty = (q) => calc.stepQty(q, 0, fineStep(), QD);

  const minQty = () => Math.pow(10, -QD);
  const clampStep = (s) => Math.max(calc.roundQty(s, QD), minQty());

  // Picks up the current ticker's size precision. Returns true when it changed.
  // On Hyperliquid it comes from the API and may arrive after the tool is already on.
  function syncDecimals() {
    const d = site.sizeDecimals ? site.sizeDecimals(S.ticker) : null;
    const qd = d == null ? site.qtyDecimals : d;
    if (qd === QD) return false;
    QD = qd;
    return true;
  }

  // Qty and step for the current ticker. On per-ticker sites a first-time pair gets a
  // round step worth about $10 and Qty = 10 steps.
  function loadSizing(price) {
    S.ticker = ctx.bridge.ticker();
    syncDecimals();
    const sz = settings.sizing(S.ticker);
    if (sz) {
      S.step = clampStep(sz.step);
      S.qty = clampQty(sz.qty);
    } else {
      S.step = calc.autoStep(price, site.stepValue(ctx.bridge.quote()), QD);
      S.qty = clampQty(10 * S.step);
    }
  }

  // A line was dragged: from now on this ticker opens with these distances, not the ATR ones.
  function rememberDistances() {
    S.auto = false;
    S.waitAtr = null;
    if (S.entry == null || S.stop == null || S.target == null || !S.ticker) return;
    const { slPct, tpPct } = calc.pctFromLevels(S.entry, S.side, S.stop, S.target);
    if (slPct > 0 && tpPct > 0) settings.saveDistances(S.ticker, slPct, tpPct);
  }

  // Entry at `entry` (tick-rounded). SL/TP: the distances dragged earlier on this ticker,
  // else the ATR defaults.
  function placeLevels(entry) {
    S.entry = entry;
    const d = settings.distances(S.ticker);
    if (!d) return placeDefaults();
    S.auto = false;
    S.waitAtr = null;
    const lv = calc.levelsFromPct(entry, S.side, d.slPct, d.tpPct, tick());
    S.stop = lv.stop;
    S.target = lv.target;
  }

  // SL = slAtr × daily ATR from the current entry, TP = rr × that risk. Until the daily
  // candles are in, SL is FALLBACK_SL_PCT of entry and the levels are redone on arrival.
  function placeDefaults() {
    const c = settings.load();
    const a = atr.value(S.ticker, c.atrDays);
    const risk = a != null ? a * c.slAtr : S.entry * FALLBACK_SL_PCT / 100;
    const lv = calc.levelsFromRisk(S.entry, S.side, risk, c.rr, tick());
    S.stop = lv.stop;
    S.target = lv.target;
    S.auto = true;
    if (a == null) waitForAtr(S.ticker);
  }

  function waitForAtr(tk) {
    if (!tk || S.waitAtr === tk) return;
    S.waitAtr = tk;
    atr.load(tk, ctx.bridge).then(() => {
      if (S.waitAtr !== tk) return;
      S.waitAtr = null;
      if (!ctx || !S.active || !S.auto || S.rebuildAt || S.ticker !== tk) return;
      if (atr.value(tk, settings.load().atrDays) == null) {
        ctx.overlay.toast(`Нет дневных свечей для ATR — SL ${FALLBACK_SL_PCT}% от входа`);
      } else {
        placeDefaults();
      }
    });
  }

  // Warm the ATR cache for the chart's symbol so activation places the ATR levels at once.
  function prefetchAtr() {
    const tk = ctx && ctx.bridge.ticker();
    if (tk && !settings.distances(tk)) atr.load(tk, ctx.bridge);
  }

  // "SL 1×ATR(5) · TP 3R": the defaults, as the Reset tooltip and the toasts show them.
  function defaultsText() {
    const c = settings.load();
    const n = (v) => String(+(+v).toFixed(2));
    return `SL ${n(c.slAtr)}×ATR(${c.atrDays}) · TP ${n(c.rr)}R`;
  }

  // The ATR itself for the Reset tooltip: "ATR(5) 1,234.50 (1.84%)".
  function atrText() {
    const c = settings.load();
    const a = S.ticker ? atr.value(S.ticker, c.atrDays) : null;
    if (a == null) return `ATR(${c.atrDays}): нет данных`;
    const pctTxt = S.entry ? ` (${calc.fmtNum(a / S.entry * 100, 2)}%)` : '';
    return `ATR(${c.atrDays}) ${fmtPrice(a)}${pctTxt}`;
  }

  function buildLines() {
    if (lines) lines.remove();
    lines = new Lines(ctx.bridge.chart(), ctx.bridge.doc, {
      onMove: onLineMove,
      onClose: deactivate,
    });
    S.ticker = ctx.bridge.ticker();
    S.needSpace = true;
  }

  // ---------- activation ----------

  function activate() {
    if (!ctx) return;
    const price = ctx.bridge.lastPrice();
    if (price == null) { ctx.overlay.toast('Нет цены — график ещё грузится'); return; }
    loadSizing(price);
    prefetchAtr(); // refreshes a stale cache; the levels use what is loaded
    placeLevels(round(price));
    try {
      buildLines();
    } catch (e) {
      console.warn('[R/R] createOrderLine failed', e);
      ctx.overlay.toast('Не удалось нарисовать линии на графике');
      return;
    }
    S.active = true;
    startLoop();
  }

  function deactivate() {
    S.active = false;
    S.rebuildAt = 0;
    if (lines) { lines.remove(); lines = null; }
    stopLoop();
    if (ctx) ctx.overlay.update(viewState());
  }

  function toggle() {
    S.active ? deactivate() : activate();
  }

  // ---------- events from lines and overlay ----------

  function onLineMove(name, price, final) {
    if (!Number.isFinite(price)) return;
    const p = round(price);
    if (name === 'entry') S.entry = p;
    else if (name === 'stop') S.stop = p;
    else if (name === 'target') S.target = p;
    if (final) rememberDistances();
  }

  const overlayHandlers = {
    onToggle: toggle,
    onClose: deactivate,
    onStep(dir, fine) {
      setQty(calc.stepQty(S.qty, dir * (fine ? fineStep() : S.step), fineStep(), QD));
    },
    onQty: (n) => setQty(clampQty(n)),
    onSide() {
      if (S.entry != null) {
        const m = calc.mirror(S.entry, S.stop, S.target, tick());
        S.stop = m.stop;
        S.target = m.target;
      }
      S.side = -S.side;
      settings.save({ side: S.side });
    },
    // → Price: entry jumps to the current price, SL and TP stay where they are. Levels the
    // user placed are remembered as they now stand; ATR defaults stay defaults.
    onPrice() {
      const live = ctx.bridge.lastPrice();
      if (live == null || S.rebuildAt) return;
      S.entry = round(live);
      if (!S.auto) rememberDistances();
    },
    // Reset button: forget this ticker's dragged levels, entry at the current price,
    // SL/TP from ATR again.
    onReset() {
      const live = ctx.bridge.lastPrice();
      if (S.rebuildAt || live == null || ctx.bridge.ticker() !== S.ticker) {
        ctx.overlay.toast('График переключается на другой тикер — подождите секунду');
        return;
      }
      settings.clearDistances(S.ticker);
      S.entry = round(live);
      placeDefaults();
      ctx.overlay.toast(`${defaultsText()} от ${fmtPrice(S.entry)}`);
    },
    // For the Reset button's tooltip, read on hover.
    resetInfo: () => `${defaultsText()} · ${atrText()}`,
    onForm() {
      // Qty belongs to S.ticker. Right after a symbol switch the chart is already on the new
      // one: don't hand the old coin's Qty to the new market (10000 DOGE → 10000 TSLA).
      if (S.rebuildAt || ctx.bridge.ticker() !== S.ticker) {
        ctx.overlay.toast('График переключается на другой тикер — подождите секунду');
        return;
      }
      const base = site.base(S.ticker);
      const r = orderForm.fillQty(S.side, fmtQty(S.qty), base);
      const btn = S.side > 0 ? 'Buy' : 'Sell';
      ctx.overlay.toast(
        r.ok ? `Qty ${fmtQty(S.qty)}${r.unit ? ' ' + r.unit : ''} → форма, жмите ${btn}`
        : r.reason === 'market' ? `Форма ордера на ${r.unit}, а график — ${base}`
        : r.reason === 'unit' ? `Размер в форме — в ${r.unit}, переключите на ${base}`
        : 'Поле Qty в форме ордера не найдено');
    },
    onSettings(patch) {
      if (patch.step != null) {
        S.step = clampStep(patch.step);
        delete patch.step;
        setQty(clampQty(S.qty));
      }
      const c = settings.load();
      const redo = ['slAtr', 'rr', 'atrDays'].some((k) => patch[k] != null && patch[k] !== c[k]);
      ctx.overlay.settings = settings.save(patch);
      // New defaults apply right away where the levels are still the defaults.
      if (redo && S.active && S.auto && !S.rebuildAt && S.entry != null) placeDefaults();
    },
  };

  function setQty(n) {
    S.qty = n;
    settings.saveSizing(S.ticker, S.qty, S.step);
  }

  // ---------- render loop ----------

  function viewState() {
    return { active: S.active, qty: fmtQty(S.qty), side: S.side, step: fmtQty(S.step) };
  }

  function render(live) {
    const r = calc.compute({
      // Live price to the tick like the entry: some feeds carry extra decimals (UTEX 387.109).
      side: S.side, qty: S.qty, entry: S.entry, stop: S.stop, target: S.target,
      last: live != null ? round(live) : null,
    });
    const sideTxt = S.side > 0 ? 'LONG' : 'SHORT';
    // Value for sizing; P&L shows how far the price has moved off the planned entry.
    const entryText = `${sideTxt} @ ${fmtPrice(S.entry)} · ${fmtMoney(r.value)}`
      + (r.live != null ? ` · P&L ${fmtMoney(r.live, true)}` : '');
    lines.set('entry', { price: S.entry, text: entryText, qty: fmtQty(S.qty) });
    lines.set('stop', {
      price: S.stop,
      text: `SL ${fmtPrice(S.stop)} (${calc.fmtPct(r.atStopPct)})`,
      qty: fmtMoney(r.atStop, true),
    });
    lines.set('target', {
      price: S.target,
      text: `TP ${fmtPrice(S.target)} (${calc.fmtPct(r.atTargetPct)})` + (r.rr != null ? ` · R:R ${r.rr.toFixed(2)}` : ''),
      qty: fmtMoney(r.atTarget, true),
    });
    return r;
  }

  function frame() {
    raf = 0;
    if (!S.active || !ctx) return;
    const br = ctx.bridge;
    const now = Date.now();

    // Symbol changed: drop our lines and rebuild at the new price once new data is in.
    const tk = br.ticker();
    if (tk && !S.ticker) S.ticker = tk;
    else if (tk && !S.rebuildAt && tk !== S.ticker) {
      if (lines) { lines.remove(); lines = null; }
      S.rebuildAt = now + SYMBOL_FALLBACK_MS;
      S.switchedAt = now;
      prefetchAtr(); // the new ticker's default SL
    }

    if (S.rebuildAt) {
      if (now >= S.rebuildAt) rebuildForNewSymbol();
    } else {
      if (syncDecimals()) {
        // Precision arrived late or differs from the guess: snap step and Qty to it.
        S.step = clampStep(S.step);
        setQty(clampQty(S.qty));
      }
      const live = br.lastPrice();
      if (lines && lines.broken) { try { buildLines(); } catch (e) { /* retry next frame */ } }
      const r = lines && S.entry != null ? render(live) : null;
      placeControls(r);
    }
    ctx.overlay.update(viewState());
    raf = ctx.bridge.win.requestAnimationFrame(frame);
  }

  // The ± pill goes right before the Entry label and avoids covering any line label.
  // r: numbers from render(); SL/TP scrolled off the pane get repeated in the dock.
  function placeControls(r) {
    const br = ctx.bridge;
    const rect = br.paneRect();
    ctx.overlay.placeDock(rect);
    const yE = br.priceToY(S.entry);
    const yS = br.priceToY(S.stop);
    const yT = br.priceToY(S.target);
    if (rect && r) {
      const off = (y) => y == null || y < 0 || y > rect.height;
      const parts = [];
      if (off(yS)) parts.push({ cls: 'loss', text: 'SL ' + fmtMoney(r.atStop, true) });
      if (off(yT)) parts.push({ cls: 'gain', text: 'TP ' + fmtMoney(r.atTarget, true) });
      ctx.overlay.setSummary(parts);
    }
    if (!rect || !lines) return ctx.overlay.placePill(rect, yE);
    const boxes = [
      lines.bodyBox('entry', rect.width, yE),
      lines.bodyBox('stop', rect.width, yS),
      lines.bodyBox('target', rect.width, yT),
    ];
    if (S.needSpace) makeRoomForLabels(rect, boxes);
    ctx.overlay.placePill(rect, yE, boxes[0], boxes, br.freeZoneX());
  }

  // Once per placement: scroll the chart so the labels (at the price scale) sit in the
  // empty space right of the last candle instead of on top of it.
  function makeRoomForLabels(rect, boxes) {
    S.needSpace = false;
    if (settings.load().autoSpace === false) return;
    const span = (b) => (b ? rect.width - b.left : 0);
    // The qty pill sits beside the Entry label, so that row needs the pill's width too.
    const need = Math.max(span(boxes[1]), span(boxes[2]), span(boxes[0]) + 6 + ctx.overlay.pillWidth());
    if (need > 0) ctx.bridge.ensureRightSpace(need + 16);
  }

  function rebuildForNewSymbol() {
    const price = ctx.bridge.lastPrice();
    S.rebuildAt = 0;
    if (price == null) { S.rebuildAt = Date.now() + 500; return; }
    // Give the new ticker's ATR a moment, so SL/TP don't jump right after appearing.
    if (atr.pending(ctx.bridge.ticker()) && Date.now() - S.switchedAt < ATR_WAIT_MS) {
      S.rebuildAt = Date.now() + 100;
      return;
    }
    loadSizing(price);
    placeLevels(round(price));
    try { buildLines(); } catch (e) { S.rebuildAt = Date.now() + 500; }
  }

  function startLoop() {
    if (!raf && ctx) raf = ctx.bridge.win.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (raf && ctx) ctx.bridge.win.cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---------- chart lifecycle ----------

  function onKey(e) {
    if (e.altKey && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    }
  }

  function setup(bridge) {
    const overlay = new Overlay(bridge.doc, overlayHandlers);
    overlay.settings = settings.load();
    ctx = { bridge, overlay, unsubs: [] };

    // New data after a symbol change: rebuild right away instead of waiting for the fallback.
    // Also fires on symbol switches while the tool is off: warm that ticker's ATR.
    ctx.unsubs.push(bridge.subscribe('onDataLoaded', () => {
      if (S.active && S.rebuildAt) S.rebuildAt = Date.now();
      prefetchAtr();
    }));
    prefetchAtr();

    bridge.win.addEventListener('keydown', onKey, true);
    ctx.unsubs.push(() => { try { bridge.win.removeEventListener('keydown', onKey, true); } catch (e) { /* gone */ } });

    const placeDock = () => overlay.placeDock(bridge.paneRect());
    placeDock();
    bridge.win.addEventListener('resize', placeDock);
    ctx.unsubs.push(() => { try { bridge.win.removeEventListener('resize', placeDock); } catch (e) { /* gone */ } });

    overlay.update(viewState());
    if (S.active) {
      // Iframe was replaced while the tool was on: bring it back.
      S.active = false;
      activate();
    }
  }

  function teardown() {
    stopLoop();
    if (lines) { lines.remove(); lines = null; }
    if (ctx) {
      ctx.unsubs.forEach((f) => f());
      try { ctx.overlay.destroy(); } catch (e) { /* iframe gone */ }
    }
    ctx = null;
  }

  function boot() {
    if (ctx) {
      if (ctx.bridge.alive()) {
        ctx.overlay.placeDock(ctx.bridge.paneRect());
        return;
      }
      const wasActive = S.active;
      teardown();
      S.active = wasActive;
    }
    const iframe = B.findIframe();
    const api = B.getApi(iframe);
    if (!api) return;
    const bridge = new B.Bridge(iframe, api);
    if (bridge.lastPrice() == null || !bridge.paneEl()) return; // chart not ready yet
    setup(bridge);
  }

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('pagehide', teardown);
  const bootTimer = setInterval(boot, BOOT_POLL_MS);
  boot();

  // Called by the toolbar icon (background.js).
  NS.toggle = toggle;

  // DevTools helpers: __utexRR.debug(), __utexRR.stop() (removes everything, allows re-inject).
  NS.debug = () => ({ state: Object.assign({}, S), hasChart: !!ctx, hasLines: !!lines });
  NS.stop = () => {
    clearInterval(bootTimer);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pagehide', teardown);
    teardown();
    NS.started = false;
  };
})();
