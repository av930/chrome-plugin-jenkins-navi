// background.js - Handles Jenkins REST API fetch to bypass CORS

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
