// Toolbar icon: on a supported chart tab it shows/hides the tool. Elsewhere on tradingview.com
// it opens TradingView's chart, anywhere else UTEX.
// activeTab grants access to the clicked tab, so no host permissions are needed.
const SUPPORTED = /^https:\/\/(margin\.utex\.io|trading\.bitfinex\.com|app\.hyperliquid\.xyz|([\w-]+\.)?tradingview\.com\/chart)\//;
const TRADINGVIEW = /^https:\/\/(([\w-]+\.)?tradingview\.com)\//;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !SUPPORTED.test(tab.url)) {
    const tv = tab.url && tab.url.match(TRADINGVIEW);
    chrome.tabs.create({ url: tv ? `https://${tv[1]}/chart/` : 'https://margin.utex.io/stocks-usdt/' });
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const ns = window.__utexRR;
        if (ns && ns.toggle) ns.toggle();
      },
    });
  } catch (e) {
    console.warn('[R/R] toggle failed', e);
  }
});
