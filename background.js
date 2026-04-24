// background.js - Handles Jenkins REST API fetch to bypass CORS

// Function to initialize and show the extension icon
function initializeIcon() {
  chrome.action.enable().then(() => {
    chrome.action.setIcon({
      path: {
        "16": "icon16.png",
        "48": "icon48.png",
        "128": "icon128.png"
      }
    });
  }).catch(err => {
    console.error('Failed to enable action:', err);
  });
}

// Initialize extension icon on install and startup
chrome.runtime.onInstalled.addListener(() => {
  initializeIcon();
});

chrome.runtime.onStartup.addListener(() => {
  initializeIcon();
});

// Also initialize immediately when service worker loads
initializeIcon();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'triggerJenkinsJob') {
    const { url } = request;
    fetch(url, {
      method: 'GET',
      credentials: 'include'
    })
      .then(resp => sendResponse({ ok: resp.ok, status: resp.status }))
      .catch(err => sendResponse({ ok: false, error: err.toString() }));
    // Return true to indicate async response
    return true;
  }
});
