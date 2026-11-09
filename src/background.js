// Toolbar icon: on a UTEX tab it shows/hides the tool, anywhere else it opens UTEX.
// activeTab grants access to the clicked tab, so no host permissions are needed.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !/^https:\/\/margin\.utex\.io\//.test(tab.url)) {
    chrome.tabs.create({ url: 'https://margin.utex.io/stocks-usdt/' });
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
    console.warn('[UTEX R/R] toggle failed', e);
  }
});
