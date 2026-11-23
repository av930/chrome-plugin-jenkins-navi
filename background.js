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

  if (request.type === 'openTabRight') {
    chrome.tabs.create({
      url: request.url,
      active: true,
      index: sender.tab.index + 1,
      openerTabId: sender.tab.id
    })
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch(err => {
        console.error('Failed to open tab:', err);
        sendResponse({ ok: false, error: err.toString() });
      });
    return true;
  }

  if (request.type === 'cloneTab') {
    const currentUrl = sender.tab.url;
    const currentIndex = sender.tab.index;
    
    // Insert to the left (same index) or right (index + 1) of current tab
    const insertIndex = request.insertLeft ? currentIndex : currentIndex + 1;
    
    chrome.tabs.create({ url: currentUrl, active: false, index: insertIndex })
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

// ========== Compare 저장 ==========
// compare 화면의 저장용 iframe에 실제 Jenkins configure 페이지를 띄우고, 그 frame에서 job_config_save.js를 실행한다.
// Jenkins는 X-Frame-Options/CSP로 iframe을 막으므로, 저장 중에만 해당 compare tab의 sub_frame 응답에서 두 header를 제거한다.
// compare tab당 저장은 한 번에 하나이므로 tab id를 session rule id로 쓴다.
async function allowCompareSaveFrame(tabId, configUrl) {
  const url = new URL(configUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Jenkins URL이 아닙니다');
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{
      id: tabId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' }
        ]
      },
      condition: { tabIds: [tabId], resourceTypes: ['sub_frame'], requestDomains: [url.hostname] }
    }]
  });
}

function endCompareSaveFrame(tabId) {
  return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
}

async function runCompareSave(tabId, edits) {
  // compare 화면의 다른 iframe(원문 view)은 about:blank이므로 http(s) 하위 frame은 저장용 iframe뿐이다.
  const frames = ((await chrome.webNavigation.getAllFrames({ tabId })) || [])
    .filter((frame) => frame.parentFrameId === 0 && /^https?:/.test(frame.url));
  if (frames.length !== 1) throw new Error('저장용 iframe에 Jenkins 페이지를 띄우지 못했습니다 (로그인/iframe 차단 확인)');
  const frame = frames[0];
  if (!/\/configure\/?$/.test(new URL(frame.url).pathname)) {
    throw new Error(`Jenkins 설정 화면이 아닌 페이지가 열렸습니다 (로그인 확인): ${frame.url}`);
  }
  const target = { tabId, frameIds: [frame.frameId] };
  await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['compare_extract.js', 'job_config_save.js'] });
  const [injection] = await chrome.scripting.executeScript({
    target, world: 'MAIN', func: (changes) => globalThis.ComparedJobSave.save(changes), args: [edits]
  });
  return injection?.result || { ok: false, message: 'Jenkins 저장 스크립트 응답 없음' };
}

chrome.tabs.onRemoved.addListener((tabId) => { endCompareSaveFrame(tabId).catch(() => {}); });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'compareSave') return;
  (async () => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !sender.url?.startsWith(chrome.runtime.getURL('compare_page.html'))) {
      throw new Error('비교 화면의 저장 요청이 아닙니다');
    }
    if (request.step === 'allow') await allowCompareSaveFrame(tabId, request.configUrl);
    else if (request.step === 'run') return runCompareSave(tabId, request.edits);
    else await endCompareSaveFrame(tabId);
    return { ok: true };
  })().then(sendResponse, (error) => sendResponse({ ok: false, message: error.message }));
  return true;
});
