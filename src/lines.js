// Entry / SL / TP drawn as TradingView order lines: native rendering, draggable,
// stays correct on zoom and scroll.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  const COLORS = {
    entry: '#2962ff',
    stop: '#f23645',
    target: '#089981',
    body: 'rgba(30,34,45,0.8)', // candles show through the labels
  };
  const FONT = 'bold 12px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
  // Label's right edge sits at (100 - line length)% of pane width. LINE_LENGTH = 1 keeps the
  // labels against the price scale, in the empty space right of the last candle (default).
  // On the left the length is worked out per label, so its left edge sits LEFT_PAD px in.
  const LINE_LENGTH = 1;
  const LEFT_PAD = 8;

  // Label geometry measured on the v27 renderer: text box = text + 20px,
  // quantity box = text + 11px, cancel button = 20px, height ≈ 22px.
  const BODY_PAD = 20;
  const QTY_PAD = 11;
  const CANCEL_W = 20;
  const BODY_HALF_H = 11;

  function makeLine(chart, color, style) {
    const l = chart.createOrderLine();
    l.setExtendLeft(true)
      .setLineLength(LINE_LENGTH)
      .setLineStyle(style)
      .setLineWidth(1)
      .setLineColor(color)
      .setBodyBorderColor(color)
      .setBodyBackgroundColor(COLORS.body)
      .setBodyTextColor(color)
      .setBodyFont(FONT)
      .setQuantityBorderColor(color)
      .setQuantityBackgroundColor(color)
      .setQuantityTextColor('#ffffff')
      .setQuantityFont(FONT)
      .setCancelButtonBorderColor(color)
      .setCancelButtonBackgroundColor(COLORS.body)
      .setCancelButtonIconColor(color)
      .setEditable(true);
    return l;
  }

  class Lines {
    // handlers: { onMove(name, price, final), onClose() }
    constructor(chart, doc, handlers) {
      this.broken = false;
      this.cache = {};
      this.measure = doc.createElement('canvas').getContext('2d');
      this.measure.font = FONT;
      this.lines = {
        target: makeLine(chart, COLORS.target, 2),
        stop: makeLine(chart, COLORS.stop, 2),
        entry: makeLine(chart, COLORS.entry, 0),
      };
      for (const name of Object.keys(this.lines)) {
        const l = this.lines[name];
        l.onMoving(() => handlers.onMove(name, l.getPrice(), false));
        l.onMove(() => handlers.onMove(name, l.getPrice(), true));
        l.setCancellable(name === 'entry');
      }
      this.lines.entry.onCancel(() => handlers.onClose());
    }

    // Only calls into TradingView when something actually changed.
    set(name, { price, text, qty }) {
      const l = this.lines[name];
      const c = this.cache[name] || (this.cache[name] = {});
      try {
        if (price != null && c.price !== price) { l.setPrice(price); c.price = price; }
        if (text != null && c.text !== text) { l.setText(text); c.text = text; }
        if (qty != null && c.qty !== qty) { l.setQuantity(qty); c.qty = qty; }
      } catch (e) {
        this.broken = true; // TradingView dropped the line (e.g. chart reset)
      }
    }

    // Label width in px as TradingView draws it, from the text set last.
    labelWidth(name) {
      const c = this.cache[name] || {};
      const m = (s) => (s ? this.measure.measureText(s).width : 0);
      return m(c.text) + BODY_PAD
        + (c.qty ? m(c.qty) + QTY_PAD : 0)
        + (name === 'entry' ? CANCEL_W : 0);
    }

    // Labels against the price scale (left = false) or the pane's left edge. Called every
    // frame after set(): on the left the length follows the label's width and the pane's.
    place(paneWidth, left) {
      for (const name of Object.keys(this.lines)) {
        const c = this.cache[name] || (this.cache[name] = {});
        let len = LINE_LENGTH;
        if (left && paneWidth > 0) {
          const pct = 100 * (1 - (LEFT_PAD + this.labelWidth(name)) / paneWidth);
          len = Math.round(Math.min(100, Math.max(LINE_LENGTH, pct)) * 100) / 100;
        }
        if (c.len === len) continue;
        try { this.lines[name].setLineLength(len); c.len = len; } catch (e) { this.broken = true; }
      }
    }

    // Where TradingView draws this line's label, in pane pixels.
    bodyBox(name, paneWidth, y) {
      const c = this.cache[name];
      if (!c || y == null) return null;
      const width = this.labelWidth(name);
      const right = paneWidth * (1 - (c.len != null ? c.len : LINE_LENGTH) / 100);
      return { left: right - width, right, top: y - BODY_HALF_H, bottom: y + BODY_HALF_H };
    }

    remove() {
      for (const l of Object.values(this.lines)) {
        try { l.remove(); } catch (e) { /* already gone */ }
      }
      this.lines = {};
    }
  }

  NS.Lines = Lines;
  NS.COLORS = COLORS;
})();
