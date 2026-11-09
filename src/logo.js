// The logo, as rects on a 128×128 grid: [x, y, width, height, cornerRadius, fill].
// Green TP zone over a smaller red SL zone, split by the blue entry line.
// Used by the chart button (overlay.js) and by tools/make-icons.js for the PNG icons.
(function (root) {
  'use strict';
  const LOGO_RECTS = [
    [4, 4, 120, 120, 26, '#131722'],   // background
    [26, 20, 76, 40, 6, '#089981'],    // take-profit zone
    [12, 62, 104, 10, 4, '#2962ff'],   // entry line
    [26, 76, 76, 28, 6, '#f23645'],    // stop-loss zone
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = { LOGO_RECTS };
  else (root.__utexRR = root.__utexRR || {}).LOGO_RECTS = LOGO_RECTS;
})(typeof window !== 'undefined' ? window : globalThis);
