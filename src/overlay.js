// HTML controls on top of the chart pane, inside the chart iframe. Kept off the candles:
//  - pill: [−10] [qty] [+10], glued to the left of the Entry label (labels sit at the price scale);
//  - dock: bottom-left corner, the R/R toggle plus LONG/SHORT, LIVE/FIX, → Form, ⚙, ✕.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  const DOCK_LEFT = 64;     // right of the TradingView logo
  const DOCK_BOTTOM = 8;
  const PILL_GAP = 6;       // px between the pill and the Entry label
  const PILL_MIN_LEFT = 8;
  const EDGE_PAD = 14;      // keep the pill this far inside the pane
  // State classes are prefixed: TradingView has global rules like .show{display:block!important}.
  const VIS = 'rr-visible';
  const ON = 'rr-on';

  function el(doc, tag, cls, text, title) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (title) e.title = title;
    return e;
  }

  // Same drawing as icons/logo.svg: TP zone over SL zone, split by the entry line.
  function logo(doc, size) {
    const NSVG = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NSVG, 'svg');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'rr-logo');
    for (const [x, y, w, h, rx, fill] of NS.LOGO_RECTS) {
      const r = doc.createElementNS(NSVG, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('rx', rx); r.setAttribute('fill', fill);
      svg.appendChild(r);
    }
    return svg;
  }

  // Keep keyboard/mouse input on our controls away from TradingView
  // (typing digits on the chart opens its symbol search, wheel zooms, etc).
  function isolate(node) {
    for (const t of ['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) {
      node.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  class Overlay {
    // h: { onToggle, onStep(dir, fine), onQty(n), onSide, onFreeze, onForm, onClose, onSettings(patch) }
    constructor(doc, h) {
      this.doc = doc;
      this.h = h;
      this.toastTimer = 0;

      this.style = el(doc, 'style');
      this.style.textContent = NS.CSS;
      doc.head.appendChild(this.style);

      // Dock (bottom-left): toggle + secondary controls
      const dock = (this.dock = el(doc, 'div', 'utexrr-dock'));
      this.toggle = el(doc, 'button', 'rr-toggle', null, 'UTEX R/R — показать/убрать инструмент (Alt+Shift+R)');
      this.toggle.append(logo(doc, 14), el(doc, 'span', '', 'R/R'));
      this.ctrls = el(doc, 'span', 'rr-ctrls');
      this.btnSide = el(doc, 'button', 'rr-side', 'LONG', 'Переключить Long/Short (SL и TP зеркалятся)');
      this.btnFreeze = el(doc, 'button', 'rr-freeze', '', '');
      this.sum = el(doc, 'span', 'rr-sum', null, 'Линия за пределами видимой шкалы');
      this.sumKey = '';
      this.btnForm = el(doc, 'button', 'rr-form', '→ Form', 'Подставить Qty в форму ордера UTEX (ордер не отправляется)');
      this.btnGear = el(doc, 'button', 'rr-gear', '⚙', 'Настройки');
      this.btnClose = el(doc, 'button', 'rr-close', '✕', 'Убрать инструмент');
      this.ctrls.append(this.btnSide, this.btnFreeze, this.sum, this.btnForm, this.btnGear, this.btnClose);
      dock.append(this.toggle, this.ctrls);
      isolate(dock);

      // Pill on the Entry line: the ±step buttons the tool is about
      const pill = (this.pill = el(doc, 'div', 'utexrr-pill'));
      this.btnMinus = el(doc, 'button', 'rr-minus', '', 'Уменьшить Qty (Shift — на 1)');
      this.qty = el(doc, 'input');
      this.qty.type = 'text';
      this.qty.inputMode = 'numeric';
      this.qty.title = 'Количество акций (колесо мыши, ↑/↓ — ±1)';
      this.btnPlus = el(doc, 'button', 'rr-plus', '', 'Увеличить Qty (Shift — на 1)');
      pill.append(this.btnMinus, this.qty, this.btnPlus);
      isolate(pill);

      this.toggle.addEventListener('click', () => h.onToggle());
      this.btnMinus.addEventListener('click', (e) => h.onStep(-1, e.shiftKey));
      this.btnPlus.addEventListener('click', (e) => h.onStep(1, e.shiftKey));
      this.qty.addEventListener('change', () => this.commitQty());
      this.qty.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { this.commitQty(); this.qty.blur(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); h.onStep(1, true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); h.onStep(-1, true); }
      });
      this.qty.addEventListener('wheel', (e) => { e.preventDefault(); h.onStep(e.deltaY < 0 ? 1 : -1, true); }, { passive: false });
      this.btnSide.addEventListener('click', () => h.onSide());
      this.btnFreeze.addEventListener('click', () => h.onFreeze());
      this.btnForm.addEventListener('click', () => h.onForm());
      this.btnGear.addEventListener('click', () => this.togglePop());
      this.btnClose.addEventListener('click', () => h.onClose());

      // Settings popover (opens above the dock)
      const pop = (this.pop = el(doc, 'div', 'utexrr-pop'));
      const field = (label, step) => {
        const row = el(doc, 'label', '', label);
        const inp = el(doc, 'input');
        inp.type = 'number';
        inp.step = step;
        inp.min = '0';
        row.appendChild(inp);
        pop.appendChild(row);
        return inp;
      };
      this.inStep = field('Шаг Qty', '1');
      this.inSl = field('SL по умолч., %', '0.1');
      this.inTp = field('TP по умолч., %', '0.1');
      const spaceRow = el(doc, 'label', 'rr-check', 'Освобождать место справа');
      this.inSpace = el(doc, 'input');
      this.inSpace.type = 'checkbox';
      this.inSpace.title = 'При включении инструмента сдвигать график так, чтобы подписи линий не закрывали свечи';
      spaceRow.prepend(this.inSpace);
      pop.appendChild(spaceRow);
      pop.appendChild(el(doc, 'div', 'rr-hint', 'SL/TP по умолчанию — дистанция от цены при запуске и смене тикера. Перетаскивание линий запоминает новую дистанцию.'));
      const ok = el(doc, 'button', '', 'OK');
      ok.addEventListener('click', () => this.commitSettings());
      pop.appendChild(ok);
      pop.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.commitSettings(); });
      isolate(pop);

      this.toast_ = el(doc, 'div', 'utexrr-toast');

      doc.body.append(this.dock, this.pill, this.pop, this.toast_);
    }

    commitQty() {
      const n = parseInt(String(this.qty.value).replace(/[^\d]/g, ''), 10);
      this.h.onQty(Number.isFinite(n) ? n : 1);
    }

    togglePop(force) {
      const show = force != null ? force : !this.pop.classList.contains(VIS);
      if (show && this.settings) {
        this.inStep.value = this.settings.step;
        this.inSl.value = +this.settings.slPct.toFixed(2);
        this.inTp.value = +this.settings.tpPct.toFixed(2);
        this.inSpace.checked = this.settings.autoSpace !== false;
      }
      this.pop.classList.toggle(VIS, show);
      if (show) this.placePop();
    }

    commitSettings() {
      const num = (inp, min) => {
        const v = parseFloat(inp.value);
        return Number.isFinite(v) && v >= min ? v : null;
      };
      const patch = { autoSpace: this.inSpace.checked };
      const step = num(this.inStep, 1);
      const sl = num(this.inSl, 0.01);
      const tp = num(this.inTp, 0.01);
      if (step != null) patch.step = Math.round(step);
      if (sl != null) patch.slPct = sl;
      if (tp != null) patch.tpPct = tp;
      this.h.onSettings(patch);
      this.togglePop(false);
    }

    // Called every frame while the tool is active; cheap when nothing changed.
    update({ active, qty, side, frozen, step }) {
      this.toggle.classList.toggle(ON, active);
      this.ctrls.classList.toggle(VIS, active);
      this.pill.classList.toggle(VIS, active);
      if (!active) this.togglePop(false);
      const stepTxt = String(step);
      if (this.btnMinus.textContent !== '−' + stepTxt) {
        this.btnMinus.textContent = '−' + stepTxt;
        this.btnPlus.textContent = '+' + stepTxt;
      }
      if (this.doc.activeElement !== this.qty && this.qty.value !== String(qty)) this.qty.value = String(qty);
      const sideTxt = side > 0 ? 'LONG' : 'SHORT';
      if (this.btnSide.textContent !== sideTxt) {
        this.btnSide.textContent = sideTxt;
        this.btnSide.classList.toggle('rr-long', side > 0);
        this.btnSide.classList.toggle('rr-short', side < 0);
      }
      if (this.btnFreeze.classList.contains(ON) !== frozen || !this.btnFreeze.textContent) {
        this.btnFreeze.classList.toggle(ON, frozen);
        this.btnFreeze.textContent = frozen ? '🔒 FIX' : '● LIVE';
        this.btnFreeze.title = frozen
          ? 'Вход зафиксирован (линию Entry можно двигать). Нажмите — вход снова за текущей ценой'
          : 'Вход идёт за текущей ценой. Нажмите — зафиксировать вход и смотреть живой P&L';
      }
    }

    // parts: [{ cls: 'loss'|'gain', text }] for SL/TP lines that are scrolled off the pane.
    setSummary(parts) {
      const key = (parts || []).map((p) => p.cls + p.text).join('|');
      if (key === this.sumKey) return;
      this.sumKey = key;
      this.sum.textContent = '';
      for (const p of parts || []) this.sum.appendChild(el(this.doc, 'span', 'rr-' + p.cls, p.text));
      this.sum.classList.toggle(VIS, !!key);
    }

    placeDock(rect) {
      if (!rect) return;
      this.dock.style.left = rect.left + DOCK_LEFT + 'px';
      this.dock.style.top = rect.bottom - DOCK_BOTTOM + 'px'; // CSS lifts it by its own height
      if (this.pop.classList.contains(VIS)) this.placePop();
    }

    placePop() {
      const dr = this.dock.getBoundingClientRect();
      const gr = this.btnGear.getBoundingClientRect();
      this.pop.style.left = Math.max(dr.left, gr.right - this.pop.offsetWidth) + 'px';
      this.pop.style.top = dr.top - this.pop.offsetHeight - 6 + 'px';
    }

    // y: Entry price in pane px. label: the Entry label box; obstacles: all label boxes
    // (pane px). freeX: pane x where the empty space right of the last candle begins.
    // Tries beside the label on the line, then stacked above/below it; prefers spots in
    // the empty space so the pill doesn't sit on candles.
    placePill(rect, y, label, obstacles, freeX) {
      if (!rect || y == null || !Number.isFinite(y)) return;
      const pw = this.pill.offsetWidth || 130;
      const ph = this.pill.offsetHeight || 22;
      const clamped = Math.min(Math.max(y, EDGE_PAD), rect.height - EDGE_PAD);
      this.pill.classList.toggle('rr-edge', clamped !== y);

      const cands = [];
      if (label) {
        const beside = Math.round(label.left - PILL_GAP - pw);
        const stacked = Math.round(label.right - pw);
        const row = ph / 2 + 13; // clears a 22px label plus a 2px gap
        cands.push(
          [beside, clamped], [stacked, clamped - row], [stacked, clamped + row],
          [beside, clamped - row], [beside, clamped + row],
          [stacked, clamped - 2 * row], [stacked, clamped + 2 * row]);
      } else {
        cands.push([PILL_MIN_LEFT, clamped]);
      }
      const fits = ([x, cy]) => x >= PILL_MIN_LEFT && cy - ph / 2 >= 0 && cy + ph / 2 <= rect.height
        && !(obstacles || []).some((o) => o
          && x < o.right && x + pw > o.left && cy - ph / 2 < o.bottom && cy + ph / 2 > o.top);
      const inFree = ([x]) => freeX == null || x >= freeX;
      const [x, cy] = cands.find((c) => fits(c) && inFree(c)) || cands.find(fits) || cands[0];
      this.pill.style.left = rect.left + Math.max(PILL_MIN_LEFT, x) + 'px';
      this.pill.style.top = rect.top + cy + 'px';
    }

    toast(msg) {
      this.toast_.textContent = msg;
      this.toast_.classList.add(VIS);
      const dr = this.dock.getBoundingClientRect();
      this.toast_.style.left = dr.left + 'px';
      this.toast_.style.top = dr.top - 36 + 'px';
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toast_.classList.remove(VIS), 2200);
    }

    destroy() {
      clearTimeout(this.toastTimer);
      for (const n of [this.style, this.dock, this.pill, this.pop, this.toast_]) n.remove();
    }
  }

  NS.Overlay = Overlay;
})();
