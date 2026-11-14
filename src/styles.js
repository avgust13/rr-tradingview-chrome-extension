// Overlay CSS as a string: content_scripts CSS does not reach the chart's blob: iframe,
// so it is injected as a <style> into the iframe document.
// Every class is prefixed: TradingView ships generic global rules such as
// `.show { display: block !important }` that would otherwise hijack ours.
(function () {
  'use strict';
  const NS = (window.__utexRR = window.__utexRR || {});

  NS.CSS = `
.utexrr-dock, .utexrr-pill, .utexrr-pop, .utexrr-toast, .utexrr-tip {
  position: fixed; z-index: 50; box-sizing: border-box;
  font: 600 12px/1 -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  color: #d1d4dc; user-select: none; white-space: nowrap;
}
.utexrr-dock button, .utexrr-pill button, .utexrr-pop button {
  flex: none; height: 20px; min-width: 22px; padding: 0 6px; border-radius: 3px; cursor: pointer;
  background: #2a2e39; border: 1px solid transparent; color: #d1d4dc; font: inherit;
}
.utexrr-dock button:hover, .utexrr-pill button:hover, .utexrr-pop button:hover { background: #363a45; color: #fff; }

/* Dock: bottom-left corner of the chart */
.utexrr-dock {
  display: flex; align-items: center; gap: 4px; padding: 3px;
  background: rgba(30,34,45,.85); border: 1px solid #363a45; border-radius: 5px;
  transform: translateY(-100%); opacity: .9; transition: opacity .15s;
}
.utexrr-dock:hover { opacity: 1; }
/* Icon-only buttons; the tooltip says what each does */
.utexrr-dock .rr-ico-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; min-width: 0; padding: 0;
}
.utexrr-dock .rr-ico { display: block; width: 14px; height: 14px; }
.utexrr-dock .rr-toggle.rr-on { background: #2962ff; color: #fff; }
.utexrr-dock .rr-logo { display: block; flex: none; }
.utexrr-dock .rr-ctrls { display: none; align-items: center; gap: 4px; }
.utexrr-dock .rr-ctrls.rr-visible { display: inline-flex; }
.utexrr-dock .rr-side.rr-long { background: #089981; color: #fff; }
.utexrr-dock .rr-side.rr-short { background: #f23645; color: #fff; }
.utexrr-dock .rr-sum { display: none; gap: 8px; padding: 0 4px; }
.utexrr-dock .rr-sum.rr-visible { display: inline-flex; }
.utexrr-dock .rr-loss { color: #f23645; }
.utexrr-dock .rr-gain { color: #089981; }

/* Pill: narrow vertical stack (+step / qty / −step) glued to the Entry line label */
.utexrr-pill {
  display: none; flex-direction: column; align-items: stretch; gap: 1px; width: 44px; padding: 2px;
  background: rgba(30,34,45,.85); border: 1px solid #2962ff; border-radius: 4px;
  transform: translateY(-50%);
}
.utexrr-pill.rr-visible { display: flex; }
.utexrr-pill.rr-edge { border-style: dashed; }
.utexrr-pill button {
  height: 15px; min-width: 0; padding: 0; border-radius: 2px;
  background: transparent; font-size: 11px; line-height: 15px;
}
.utexrr-pill .rr-minus { color: #f23645; }
.utexrr-pill .rr-plus { color: #089981; }
.utexrr-pill input {
  flex: none; width: 100%; height: 18px; padding: 0; border-radius: 3px; text-align: center;
  background: #131722; border: 1px solid #434651; color: #fff; font: inherit;
}
.utexrr-pill input:focus { outline: none; border-color: #2962ff; }

.utexrr-pop {
  display: none; padding: 8px; gap: 6px; flex-direction: column;
  background: #1e222d; border: 1px solid #434651; border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.5);
}
.utexrr-pop.rr-visible { display: flex; }
.utexrr-pop label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 500; }
.utexrr-pop label.rr-check { justify-content: flex-start; gap: 6px; cursor: pointer; }
.utexrr-pop label.rr-check input { width: auto; height: auto; margin: 0; }
.utexrr-pop input {
  width: 60px; height: 20px; padding: 0 4px; border-radius: 3px; text-align: right;
  background: #131722; border: 1px solid #434651; color: #fff; font: inherit;
}
.utexrr-pop .rr-hint { color: #787b86; font-weight: 400; font-size: 11px; line-height: 1.3; max-width: 190px; white-space: normal; }

.utexrr-toast {
  padding: 6px 10px; border-radius: 4px; background: #2a2e39; border: 1px solid #434651;
  opacity: 0; transition: opacity .2s; pointer-events: none;
}
.utexrr-toast.rr-visible { opacity: 1; }

/* Hover tooltip: name, then a grey explanation */
.utexrr-tip {
  z-index: 51; max-width: 240px; padding: 6px 8px; border-radius: 4px; white-space: normal;
  background: #2a2e39; border: 1px solid #434651; box-shadow: 0 2px 8px rgba(0,0,0,.4);
  opacity: 0; visibility: hidden; transition: opacity .12s; pointer-events: none;
}
.utexrr-tip.rr-visible { opacity: 1; visibility: visible; }
.utexrr-tip .rr-tip-head { color: #fff; line-height: 1.3; }
.utexrr-tip .rr-tip-desc {
  margin-top: 3px; color: #b2b5be; font-weight: 400; font-size: 11px; line-height: 1.35; white-space: pre-line;
}
`;
})();
