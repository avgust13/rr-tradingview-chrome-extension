// HTML controls on top of the chart pane, inside the chart iframe. Kept off the candles:
//  - pill: narrow stack of [+10] / [qty] / [−10], glued to the Entry label (labels sit at the price scale);
//  - dock: bottom-left corner, icon buttons: R/R toggle, long/short, entry to price, reset SL/TP,
//    Qty → order form, settings, close;
//  - tip: hover tooltip, the only place the buttons are explained.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  const DOCK_LEFT = 64;     // right of the TradingView logo
  const DOCK_BOTTOM = 8;
  const PILL_GAP = 6;       // px between the pill and the Entry label
  const PILL_MIN_LEFT = 8;
  const PILL_W = 44;        // fallbacks while the pill is still hidden (matches styles.js)
  const PILL_H = 56;
  const EDGE_PAD = 14;      // keep the pill this far inside the pane
  const TIP_DELAY_MS = 350; // hover this long before the first tooltip; moving on to the next is instant
  const TIP_GRACE_MS = 120; // the tip outlives mouseleave this long, so the pointer can reach a neighbour
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

  const NSVG = 'http://www.w3.org/2000/svg';

  // Same drawing as icons/logo.svg: TP zone over SL zone, split by the entry line.
  function logo(doc, size) {
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

  // Button icons on a 24×24 grid, stroked in the button's text colour. [tag, attributes];
  // the attributes override the stroke defaults in icon().
  const gearTeeth = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    const at = (r) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
    return `M${at(6.5)}L${at(9.6)}`;
  }).join('');
  const ICONS = {
    long: [['path', { d: 'M5 19L19 5M9 5h10v10' }]],              // arrow up
    short: [['path', { d: 'M5 5l14 14M19 9v10H9' }]],             // arrow down
    price: [                                                      // target: "go to the price"
      ['circle', { cx: 12, cy: 12, r: 6 }],
      ['path', { d: 'M12 2v4M12 18v4M2 12h4M18 12h4' }],
      ['circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }],
    ],
    reset: [['path', { d: 'M3 4v6h6' }], ['path', { d: 'M5.2 15A8.5 8.5 0 1 0 7 6.2L3 10' }]],
    form: [['path', { d: 'M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h11M11 8l4 4-4 4' }]], // into a box
    gear: [
      ['circle', { cx: 12, cy: 12, r: 6.5 }],
      ['path', { d: gearTeeth, 'stroke-width': 3.2, 'stroke-linecap': 'butt' }],
      ['circle', { cx: 12, cy: 12, r: 2.5 }],
    ],
    close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  };

  function icon(doc, name) {
    const svg = doc.createElementNS(NSVG, 'svg');
    const base = {
      viewBox: '0 0 24 24', class: 'rr-ico', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    };
    for (const k in base) svg.setAttribute(k, base[k]);
    for (const [tag, attrs] of ICONS[name]) {
      const n = doc.createElementNS(NSVG, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }
    return svg;
  }

  function iconButton(doc, cls, name) {
    const b = el(doc, 'button', 'rr-ico-btn ' + cls);
    b.appendChild(icon(doc, name));
    return b;
  }

  // Keep keyboard/mouse input on our controls away from TradingView
  // (typing digits on the chart opens its symbol search, wheel zooms, etc).
  function isolate(node) {
    for (const t of ['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) {
      node.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  class Overlay {
    // h: { onToggle, onStep(dir, fine), onQty(n), onSide, onPrice, onReset, resetInfo() -> text,
    //      onForm, onClose, onSettings(patch) }
    constructor(doc, h) {
      this.doc = doc;
      this.h = h;
      this.toastTimer = 0;
      this.tipTimer = 0;
      this.tips = new WeakMap(); // node -> tooltip text, or a function giving it at hover time

      this.style = el(doc, 'style');
      this.style.textContent = NS.CSS;
      doc.head.appendChild(this.style);

      // Dock (bottom-left): icon buttons only, each explained by its hover tooltip.
      const dock = (this.dock = el(doc, 'div', 'utexrr-dock'));
      const site = NS.site;
      this.view = {};
      this.tip = el(doc, 'div', 'utexrr-tip');
      this.toggle = el(doc, 'button', 'rr-ico-btn rr-toggle');
      this.toggle.appendChild(logo(doc, 14));
      this.ctrls = el(doc, 'span', 'rr-ctrls');
      this.btnSide = el(doc, 'button', 'rr-ico-btn rr-side'); // icon and tooltip follow the side, see update()
      this.btnPrice = iconButton(doc, 'rr-price', 'price');
      this.btnReset = iconButton(doc, 'rr-reset', 'reset');
      this.btnForm = iconButton(doc, 'rr-form', 'form');
      this.sum = el(doc, 'span', 'rr-sum');
      this.sumKey = '';
      this.btnGear = iconButton(doc, 'rr-gear', 'gear');
      this.btnClose = iconButton(doc, 'rr-close', 'close');
      this.ctrls.append(this.btnSide, this.btnPrice, this.btnReset, this.btnForm, this.sum, this.btnGear, this.btnClose);
      dock.append(this.toggle, this.ctrls);
      isolate(dock);
      this.setTip(this.toggle, 'R/R — показать / убрать инструмент\nAlt+Shift+R или значок расширения в панели Chrome');
      this.setTip(this.btnPrice, 'Вход — на текущую цену\nSL и TP остаются на своих уровнях');
      // Read at hover time: shows this ticker's ATR.
      this.setTip(this.btnReset, () => 'Сбросить SL/TP по ATR\nЗабыть перетащенные SL/TP этого тикера и поставить'
        + ' их заново от текущей цены.\n' + h.resetInfo());
      this.setTip(this.btnForm, `Qty в форму ордера ${site.name}\nОрдер не отправляется: Buy / Sell жмёте сами`);
      this.setTip(this.sum, 'Линия за видимой шкалой\nP&L на её уровне');
      this.setTip(this.btnGear, 'Настройки\nШаг Qty, SL в ATR, TP в R:R, период ATR');
      this.setTip(this.btnClose, 'Убрать инструмент\nТо же, что крестик на линии Entry');

      // Pill on the Entry line: the ±step buttons the tool is about
      const pill = (this.pill = el(doc, 'div', 'utexrr-pill'));
      const fineTxt = site.qtyDecimals > 0 ? 'Shift — на 1/10 шага' : 'Shift — на 1';
      this.btnMinus = el(doc, 'button', 'rr-minus', '', `Уменьшить Qty (${fineTxt})`);
      this.qty = el(doc, 'input');
      this.qty.type = 'text';
      this.qty.inputMode = site.qtyDecimals > 0 ? 'decimal' : 'numeric';
      this.qty.title = `${site.qtyTitle} (колесо мыши, ↑/↓ — мелкий шаг)`;
      this.btnPlus = el(doc, 'button', 'rr-plus', '', `Увеличить Qty (${fineTxt})`);
      pill.append(this.btnPlus, this.qty, this.btnMinus); // stacked: more on top, less below
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
      this.btnPrice.addEventListener('click', () => h.onPrice());
      this.btnReset.addEventListener('click', () => h.onReset());
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
      this.inStep = field(site.perTicker ? 'Шаг Qty (эта пара)' : 'Шаг Qty', site.qtyDecimals > 0 ? 'any' : '1');
      this.inSlAtr = field('SL, × ATR', '0.1');
      this.inRr = field('TP, × риск (R:R)', '0.5');
      this.inAtrDays = field('ATR, дней', '1');
      const spaceRow = el(doc, 'label', 'rr-check', 'Освобождать место справа');
      this.inSpace = el(doc, 'input');
      this.inSpace.type = 'checkbox';
      this.inSpace.title = 'При включении инструмента сдвигать график так, чтобы подписи линий не закрывали свечи';
      spaceRow.prepend(this.inSpace);
      pop.appendChild(spaceRow);
      pop.appendChild(el(doc, 'div', 'rr-hint', 'На новом тикере SL — на N × ATR от входа (средний диапазон дневных свечей за закрытые дни), TP — на R:R × риск.'
        + ' Перетащенные SL/TP запоминаются для тикера, кнопка ↺ в доке возвращает их к ATR.'
        + (site.perTicker ? ' Qty и шаг запоминаются для каждой пары отдельно.' : '')));
      const ok = el(doc, 'button', '', 'OK');
      ok.addEventListener('click', () => this.commitSettings());
      pop.appendChild(ok);
      pop.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.commitSettings(); });
      isolate(pop);

      this.toast_ = el(doc, 'div', 'utexrr-toast');

      doc.body.append(this.dock, this.pill, this.pop, this.toast_, this.tip);
    }

    // Hover tooltip of a dock button, shown above the dock: first line is the name, the rest
    // explains it. text: a string or a function (read at hover time). Can be replaced any time.
    setTip(node, text) {
      const bound = this.tips.has(node);
      this.tips.set(node, text);
      if (bound) return;
      node.addEventListener('mouseenter', () => this.showTip(node));
      node.addEventListener('mouseleave', () => this.hideTip(TIP_GRACE_MS));
      node.addEventListener('click', () => this.hideTip());
    }

    showTip(node) {
      clearTimeout(this.tipTimer);
      const delay = this.tip.classList.contains(VIS) ? 0 : TIP_DELAY_MS;
      this.tipTimer = setTimeout(() => {
        if (this.pop.classList.contains(VIS)) return; // would cover the settings opened above the dock
        const t = this.tips.get(node);
        const [head, ...rest] = String(typeof t === 'function' ? t() : t).split('\n');
        this.tip.replaceChildren(el(this.doc, 'div', 'rr-tip-head', head));
        if (rest.length) this.tip.appendChild(el(this.doc, 'div', 'rr-tip-desc', rest.join('\n')));
        this.tip.classList.add(VIS);
        const r = node.getBoundingClientRect();
        const tw = this.tip.offsetWidth;
        const th = this.tip.offsetHeight;
        const x = r.left + r.width / 2 - tw / 2;
        const y = this.dock.getBoundingClientRect().top - th - 6;
        const maxX = this.doc.documentElement.clientWidth - tw - 4;
        this.tip.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
        this.tip.style.top = Math.max(4, y) + 'px';
      }, delay);
    }

    // ms: hide after this delay unless showTip() comes first (the pointer moved to a neighbour).
    hideTip(ms) {
      clearTimeout(this.tipTimer);
      if (ms) this.tipTimer = setTimeout(() => this.tip.classList.remove(VIS), ms);
      else this.tip.classList.remove(VIS);
    }

    commitQty() {
      const n = parseFloat(String(this.qty.value).replace(',', '.').replace(/[^\d.]/g, ''));
      this.h.onQty(Number.isFinite(n) ? n : 0); // controller clamps to its minimum
    }

    togglePop(force) {
      const show = force != null ? force : !this.pop.classList.contains(VIS);
      if (show) this.hideTip();
      if (show && this.settings) {
        this.inStep.value = this.view.step;
        this.inSlAtr.value = this.settings.slAtr;
        this.inRr.value = this.settings.rr;
        this.inAtrDays.value = this.settings.atrDays;
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
      const step = num(this.inStep, NS.site.qtyDecimals > 0 ? 1e-8 : 1);
      const slAtr = num(this.inSlAtr, 0.05);
      const rr = num(this.inRr, 0.1);
      const days = num(this.inAtrDays, 1);
      if (step != null) patch.step = step; // controller rounds to the site's precision
      if (slAtr != null) patch.slAtr = slAtr;
      if (rr != null) patch.rr = rr;
      if (days != null) patch.atrDays = Math.min(30, Math.round(days)); // atr.js loads 40 daily bars
      this.h.onSettings(patch);
      this.togglePop(false);
    }

    // Called every frame while the tool is active; cheap when nothing changed.
    // qty and step come formatted ("151", "0.0123").
    update({ active, qty, side, step }) {
      this.view = { qty, step };
      this.toggle.classList.toggle(ON, active);
      this.ctrls.classList.toggle(VIS, active);
      this.pill.classList.toggle(VIS, active);
      if (!active) { this.togglePop(false); this.hideTip(); }
      if (this.btnMinus.textContent !== '−' + step) {
        this.btnMinus.textContent = '−' + step;
        this.btnPlus.textContent = '+' + step;
      }
      if (this.doc.activeElement !== this.qty && this.qty.value !== qty) this.qty.value = qty;
      // Fractional amounts ("0.0123") need a wider pill than share counts.
      const chars = Math.max(qty.length, step.length + 1);
      if (chars !== this.pillChars) {
        this.pillChars = chars;
        this.pill.style.width = chars > 4 ? `calc(${chars}ch + 14px)` : '';
      }
      if (side !== this.sideShown) {
        this.sideShown = side;
        this.btnSide.replaceChildren(icon(this.doc, side > 0 ? 'long' : 'short'));
        this.btnSide.classList.toggle('rr-long', side > 0);
        this.btnSide.classList.toggle('rr-short', side < 0);
        this.setTip(this.btnSide, (side > 0 ? 'Long\nНажмите — Short' : 'Short\nНажмите — Long')
          + ': SL и TP зеркалятся относительно входа');
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

    pillWidth() {
      return this.pill.offsetWidth || PILL_W;
    }

    // y: Entry price in pane px. label: the Entry label box; obstacles: all label boxes
    // (pane px). freeX: pane x where the empty space right of the last candle begins.
    // Tries beside the label on the line, then stacked above/below it; prefers spots in
    // the empty space so the pill doesn't sit on candles.
    placePill(rect, y, label, obstacles, freeX) {
      if (!rect || y == null || !Number.isFinite(y)) return;
      const pw = this.pillWidth();
      const ph = this.pill.offsetHeight || PILL_H;
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
      clearTimeout(this.tipTimer);
      for (const n of [this.style, this.dock, this.pill, this.pop, this.toast_, this.tip]) n.remove();
    }
  }

  NS.Overlay = Overlay;
})();
