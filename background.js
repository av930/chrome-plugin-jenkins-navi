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
  
  if (request.type === 'deleteBuild') {
    const { url, crumbField, crumbValue } = request;
    
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    
    // Add Jenkins Crumb if provided
    if (crumbField && crumbValue) {
      headers[crumbField] = crumbValue;
    }
    
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers
      // Don't use redirect: 'manual' - let it follow redirects naturally
    })
      .then(async resp => {
        // Jenkins redirects on successful delete, which will result in status 200 after following redirect
        // Also accept 404 (build already deleted) and status 0 (opaque response)
        const success = resp.ok || resp.status === 302 || resp.status === 404 || resp.status === 0 || resp.type === 'opaqueredirect';
        
        if (success) {
          sendResponse({ ok: true, status: resp.status, statusText: resp.statusText });
        } else {
          // Get response body for error details
          let errorDetail = '';
          try {
            errorDetail = await resp.text();
            if (errorDetail.length > 200) errorDetail = errorDetail.substring(0, 200) + '...';
          } catch (e) {
            errorDetail = resp.statusText || 'Unknown error';
          }
          sendResponse({ 
            ok: false, 
            status: resp.status, 
            statusText: resp.statusText,
            error: `HTTP ${resp.status}: ${errorDetail}`
          });
        }
      })
      .catch(err => {
        console.error('Delete build error:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    // Return true to indicate async response
    return true;
  }
  
  if (request.type === 'getJenkinsCrumb') {
    const { url } = request;
    
    fetch(url, {
      credentials: 'include'
    })
      .then(resp => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        return resp.json();
      })
      .then(data => {
        sendResponse({ ok: true, crumb: data });
      })
      .catch(err => {
        console.error('Failed to get Jenkins Crumb:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    // Return true to indicate async response
    return true;
  }

  if (request.type === 'getJenkinsLabels') {
    const { url } = request;

    fetch(url, {
      credentials: 'include'
    })
      .then(async resp => {
        if (!resp.ok) {
          let errorDetail = '';
          try {
            errorDetail = await resp.text();
          } catch (error) {
            errorDetail = resp.statusText;
          }
          throw new Error(`HTTP ${resp.status}: ${errorDetail || resp.statusText}`);
        }
        return resp.json();
      })
      .then(data => {
        sendResponse({ ok: true, data });
      })
      .catch(err => {
        console.error('Failed to get Jenkins labels:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    return true;
  }

  if (request.type === 'openLabelPage') {
    const { url } = request;
    
    chrome.tabs.create({ url: url, active: true })
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch(err => {
        console.error('Failed to open label page:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    return true;
  }

  if (request.type === 'cloneTab') {
    const currentUrl = sender.tab.url;
    
    chrome.tabs.create({ url: currentUrl, active: false })
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch(err => {
        console.error('Failed to clone tab:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    return true;
  }
});
