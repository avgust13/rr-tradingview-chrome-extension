// Controller: tool state, update loop, chart lifecycle.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});
  if (NS.started) return;
  NS.started = true;

  const { calc, settings, bridge: B, Lines, Overlay, orderForm } = NS;
  const BOOT_POLL_MS = 1000;
  const SYMBOL_FALLBACK_MS = 3000;

  const cfg = settings.load();
  const S = {
    active: false,
    side: cfg.side === -1 ? -1 : 1,
    qty: Math.max(1, cfg.qty | 0),
    frozen: false,
    entry: null,
    stop: null,
    target: null,
    ticker: null,
    rebuildAt: 0,      // >0: waiting for new symbol data, rebuild by this time at the latest
    needSpace: false,  // make room for the labels right of the last candle on next frame
  };

  let ctx = null;      // { bridge, overlay, unsubs }
  let lines = null;
  let raf = 0;

  // ---------- helpers ----------

  const tick = () => ctx.bridge.tick();
  const round = (p) => calc.roundToTick(p, tick());
  const fmtPrice = (p) => calc.fmtNum(p, calc.decimalsFromTick(tick()));

  function rememberDistances() {
    if (S.entry == null || S.stop == null || S.target == null) return;
    const { slPct, tpPct } = calc.pctFromLevels(S.entry, S.side, S.stop, S.target);
    if (slPct > 0 && tpPct > 0) settings.save({ slPct, tpPct });
  }

  function placeLevels(price) {
    const c = settings.load();
    S.entry = price;
    const lv = calc.levelsFromPct(price, S.side, c.slPct, c.tpPct, tick());
    S.stop = lv.stop;
    S.target = lv.target;
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
    S.frozen = false;
    placeLevels(price);
    try {
      buildLines();
    } catch (e) {
      console.warn('[UTEX R/R] createOrderLine failed', e);
      ctx.overlay.toast('Не удалось нарисовать линии на графике');
      return;
    }
    S.active = true;
    startLoop();
  }

  function deactivate() {
    rememberDistances();
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
    if (name === 'entry') { S.frozen = true; S.entry = p; }
    else if (name === 'stop') S.stop = p;
    else if (name === 'target') S.target = p;
    if (final) rememberDistances();
  }

  const overlayHandlers = {
    onToggle: toggle,
    onClose: deactivate,
    onStep(dir, fine) {
      const step = fine ? 1 : settings.load().step;
      setQty(calc.stepQty(S.qty, dir * step));
    },
    onQty: (n) => setQty(calc.stepQty(n, 0)),
    onSide() {
      if (S.entry != null) {
        const m = calc.mirror(S.entry, S.stop, S.target, tick());
        S.stop = m.stop;
        S.target = m.target;
      }
      S.side = -S.side;
      settings.save({ side: S.side });
    },
    onFreeze() {
      S.frozen = !S.frozen;
      if (!S.frozen) {
        const live = ctx.bridge.lastPrice();
        if (live != null) S.entry = live;
      }
    },
    onForm() {
      const r = orderForm.fillQty(S.side, S.qty);
      ctx.overlay.toast(r.ok
        ? `Qty ${S.qty} → ${S.side > 0 ? 'Buy' : 'Sell'} форма`
        : 'Поле Qty в форме ордера не найдено');
    },
    onSettings(patch) {
      ctx.overlay.settings = settings.save(patch);
    },
  };

  function setQty(n) {
    S.qty = n;
    settings.save({ qty: n });
  }

  // ---------- render loop ----------

  function viewState() {
    return { active: S.active, qty: S.qty, side: S.side, frozen: S.frozen, step: settings.load().step };
  }

  function render(live) {
    const r = calc.compute({
      side: S.side, qty: S.qty, entry: S.entry, stop: S.stop, target: S.target,
      last: S.frozen ? live : null,
    });
    const sideTxt = S.side > 0 ? 'LONG' : 'SHORT';
    const entryText = S.frozen && r.live != null
      ? `${sideTxt} @ ${fmtPrice(S.entry)} · P&L ${calc.fmtMoney(r.live, true)} (${calc.fmtPct(r.livePct)})`
      : `${sideTxt} @ ${fmtPrice(S.entry)} · ${calc.fmtMoney(r.value)}`;
    lines.set('entry', { price: S.entry, text: entryText, qty: String(S.qty) });
    lines.set('stop', {
      price: S.stop,
      text: `SL ${fmtPrice(S.stop)} (${calc.fmtPct(r.atStopPct)})`,
      qty: calc.fmtMoney(r.atStop, true),
    });
    lines.set('target', {
      price: S.target,
      text: `TP ${fmtPrice(S.target)} (${calc.fmtPct(r.atTargetPct)})` + (r.rr != null ? ` · R:R ${r.rr.toFixed(2)}` : ''),
      qty: calc.fmtMoney(r.atTarget, true),
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
    }

    if (S.rebuildAt) {
      if (now >= S.rebuildAt) rebuildForNewSymbol();
    } else {
      const live = br.lastPrice();
      if (!S.frozen && live != null) S.entry = round(live);
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
      if (off(yS)) parts.push({ cls: 'loss', text: 'SL ' + calc.fmtMoney(r.atStop, true) });
      if (off(yT)) parts.push({ cls: 'gain', text: 'TP ' + calc.fmtMoney(r.atTarget, true) });
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
    const widest = Math.max(0, ...boxes.filter(Boolean).map((b) => rect.width - b.left));
    if (widest > 0) ctx.bridge.ensureRightSpace(widest + 16);
  }

  function rebuildForNewSymbol() {
    const price = ctx.bridge.lastPrice();
    S.rebuildAt = 0;
    if (price == null) { S.rebuildAt = Date.now() + 500; return; }
    S.frozen = false;
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
    ctx.unsubs.push(bridge.subscribe('onDataLoaded', () => {
      if (S.active && S.rebuildAt) S.rebuildAt = Date.now();
    }));

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
