// Integrated popup and run_dialog functionality

// ========== Configuration and State ==========
let config = {};
let previousJobUrl = ''; // ^http.*/job/.*/ 패턴과 정확히 match되는 이전 URL 저장
let previousBuildUrl = ''; // ^http.*/job/.*/[0-9]+/ 패턴의 정확히 match되는 이전 URL 저장
const NODE_MENU_TOGGLE_STORAGE_KEY = 'nodeMenuViewBySite';

// Save URL visit history to storage
async function saveUrlVisit(url) {
  if (!url || !url.includes('jenkins')) return;
  
  try {
    // Normalize URL: Remove build numbers, console, etc. Keep only up to /job/jobname
    let normalizedUrl = url;
    
    // Pattern: http://~/job/jobname/12345/... or /console -> keep only http://~/job/jobname
    const jobMatch = url.match(/^(https?:\/\/.+?\/job\/[^\/]+)/);
    if (jobMatch) {
      normalizedUrl = jobMatch[1] + '/';
    }
    
    const result = await chrome.storage.local.get(['urlHistory']);
    let urlHistory = result.urlHistory || {};
    
    // Check if URL is in the last 5 entries
    const entries = Object.entries(urlHistory);
    entries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
    const recentUrls = entries.slice(0, 5).map(([url]) => url);
    
    if (recentUrls.includes(normalizedUrl)) {
      console.log('URL already in recent 5, skipping:', normalizedUrl);
      return;
    }
    
    // 기존 방문 횟수 증가 또는 새로 추가
    if (urlHistory[normalizedUrl]) {
      urlHistory[normalizedUrl].count++;
      urlHistory[normalizedUrl].lastVisit = Date.now();
    } else {
      urlHistory[normalizedUrl] = {
        count: 1,
        firstVisit: Date.now(),
        lastVisit: Date.now()
      };
    }
    
    // 최근 90개만 유지 (가장 최근 방문 기준)
    const allEntries = Object.entries(urlHistory);
    if (allEntries.length > 90) {
      allEntries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
      urlHistory = Object.fromEntries(allEntries.slice(0, 90));
    }
    
    await chrome.storage.local.set({ urlHistory });
    console.log('URL visit saved:', normalizedUrl, 'count:', urlHistory[normalizedUrl].count);
  } catch (error) {
    console.error('Failed to save URL visit:', error);
  }
}

// Default parameters text for run dialog
const DEFAULT_PARAMS = `ACTION=remove_history
PARAM1=http://vjenkins.rge.com/job/11.automigration_downSrcMig/
PARAM2=0-11`;

// ========== Detect Mode: Popup or Run Dialog ==========
const urlParams = new URLSearchParams(window.location.search);
let baseUrl = decodeURIComponent(urlParams.get('url') || '');
const runButton = urlParams.get('button'); // run button name (e.g., 'remove-his', 'copy_job')
const pageUrl = urlParams.get('pageUrl') || ''; // Current page URL before opening dialog (keep encoded)
const isRunDialogMode = !!baseUrl; // Run dialog mode if URL parameter exists

// Convert https to http (force http)
if (baseUrl && baseUrl.startsWith('https://')) {
  baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
}

console.log('Mode:', isRunDialogMode ? 'Run Dialog' : 'Popup');
console.log('Base URL:', baseUrl);

// ========== Array Cycling Support ==========

// Get the next value from an array, cycling through indices stored in chrome.storage
async function getNextArrayValue(sectionName, itemName, values) {
  const storageKey = `cycle_${sectionName}_${itemName}`;
  const result = await chrome.storage.local.get([storageKey]);
  const currentIndex = result[storageKey] || 0;
  const value = values[currentIndex];
  const nextIndex = (currentIndex + 1) % values.length;
  await chrome.storage.local.set({ [storageKey]: nextIndex });
  return value;
}

// Resolve a value - if it's a string starting with "function/", handle as internal function
// Returns { type: 'url', url: '...' } or { type: 'function', name: '...' }
function resolveValueType(value) {
  if (typeof value === 'string') {
    if (value.startsWith('function/')) {
      return { type: 'function', name: value.substring('function/'.length) };
    } else if (value.startsWith('fuction/')) {
      return { type: 'function', name: value.substring('fuction/'.length) };
    }
  }
  return { type: 'url', url: value };
}

// Handle internal function calls from popup
async function handleInternalFunction(funcName) {
  const server = getSelectedServer();
  const siteUrl = server ? config.sites[server] : null;

  if (funcName === 'label') {
    // Open label_page.html
    if (!siteUrl) {
      console.error('No server selected for function/label');
      return;
    }
    const labelPageUrl = chrome.runtime.getURL(
      `label_page.html?server=${encodeURIComponent(server)}&site=${encodeURIComponent(siteUrl)}`
    );
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.update(tabs[0].id, { url: labelPageUrl });
    });
  } else if (funcName === 'report' || funcName === 'z-report') {
    // Send message to content script to generate z-report
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'triggerZReport' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to trigger z-report:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  } else if (funcName === 'downConfig' || funcName === 'downloadConfig') {
    // Send message to content script to download config.xml
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'triggerDownConfig' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to trigger downConfig:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  } else {
    console.warn('Unknown internal function:', funcName);
  }
}

// ========== Popup Functions ==========

// Generate version string: v년도.날짜시간분
function generateVersion() {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString();
  const day = now.getDate().toString();
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes();
  const minuteStr = minute.toString().padStart(2, '0');

  return `v${year}.${month}${day}${hour}${minuteStr}`;
}

// Display version info
function displayVersion() {
  const versionElement = document.getElementById('versionInfo');
  if (versionElement) {
    versionElement.textContent = generateVersion();
  }
}

// Load configuration
async function loadConfig() {
  try {
    // Try to load user config from storage first (as text to preserve order)
    const result = await chrome.storage.local.get(['userConfigText']);

    if (result.userConfigText) {
      config = JSON.parse(result.userConfigText);
      console.log('Config loaded from storage (user settings)');
    } else {
      // Fallback to config.default file
      console.log('userConfigText not found in storage, loading config.default');
      const defaultResponse = await fetch('config.default');
      const defaultText = await defaultResponse.text();
      config = JSON.parse(defaultText);

      // Save the default config as userConfigText in storage
      await chrome.storage.local.set({ userConfigText: defaultText });
      console.log('Config loaded from config.default and saved to storage as userConfigText');
    }

    // 라디오 버튼 생성 (await로 완료 대기)
    await createRadioButtons();

    // config의 순서대로 버튼 생성 (sites 제외)
    createButtonsInOrder();

  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// config의 순서대로 버튼 생성
function createButtonsInOrder() {
  const buttonGrid = document.getElementById('buttonGrid');
  if (!buttonGrid) return;

  buttonGrid.innerHTML = ''; // 기존 내용 제거

  // config 객체를 순회하면서 sites를 제외한 항목들을 순서대로 처리
  for (const [sectionName, sectionData] of Object.entries(config)) {
    if (sectionName === 'sites') continue; // sites는 이미 라디오 버튼으로 처리됨

    console.log(`Creating buttons for section: ${sectionName}`);

    if (sectionName === 'menus') {
      createSectionButtons(sectionData, 'menu-btn', sectionName, (menuName, menuPath) => {
        handleMenuClick(menuName, menuPath, sectionName);
      });
    } else if (sectionName === 'run') {
      createSectionButtons(sectionData, 'run-btn', sectionName, (runName, runPath) => {
        handleRunClick(runPath, runName);
      }, '▶ ');
    } else if (sectionName === 'job') {
      createSectionButtons(sectionData, 'job-btn', sectionName, (jobName, jobPath) => {
        handleJobClick(jobPath, sectionName, jobName);
      });
    } else if (sectionName === 'custom') {
      // custom은 URL에 따라 클래스가 다름
      for (const [customName, customValue] of Object.entries(sectionData)) {
        const button = document.createElement('button');
        // Check the first URL for styling (handle both string and array)
        const firstUrl = Array.isArray(customValue) ? customValue[0] : customValue;
        if (firstUrl.toLowerCase().includes('jenkins')) {
          button.className = 'action-btn jenkins-btn';
        } else {
          button.className = 'action-btn custom-btn';
        }
        button.dataset.action = customName;
        button.textContent = customName;
        button.addEventListener('click', async () => {
          const value = Array.isArray(customValue)
            ? await getNextArrayValue(sectionName, customName, customValue)
            : customValue;
          const resolved = resolveValueType(value);
          if (resolved.type === 'function') {
            await handleInternalFunction(resolved.name);
          } else {
            handleCustomClick(resolved.url);
          }
        });
        buttonGrid.appendChild(button);
      }
    }
  }
}

// 섹션별 버튼 생성 헬퍼 함수 (배열 순환 지원)
function createSectionButtons(sectionData, className, sectionName, clickHandler, prefix = '') {
  const buttonGrid = document.getElementById('buttonGrid');

  for (const [name, pathOrArray] of Object.entries(sectionData)) {
    const button = document.createElement('button');
    button.className = `action-btn ${className}`;
    button.dataset.action = name;
    button.textContent = prefix + name;
    button.addEventListener('click', async () => {
      const value = Array.isArray(pathOrArray)
        ? await getNextArrayValue(sectionName, name, pathOrArray)
        : pathOrArray;
      const resolved = resolveValueType(value);
      if (resolved.type === 'function') {
        await handleInternalFunction(resolved.name);
      } else {
        clickHandler(name, resolved.url);
      }
    });
    buttonGrid.appendChild(button);
  }
}

// config의 sites로부터 라디오 버튼 생성
async function createRadioButtons() {
  const radioGroup = document.getElementById('radioGroup');
  if (!radioGroup) return;

  radioGroup.innerHTML = ''; // 기존 내용 제거

  const sites = config.sites;
  if (!sites) {
    console.error('Sites not found in config');
    return;
  }

  // 현재 활성화된 탭의 URL 가져오기 (pageUrl이 없을 경우)
  let currentTabUrl = '';
  if (pageUrl) {
    currentTabUrl = decodeURIComponent(pageUrl);
    console.log('Current page URL (from param):', currentTabUrl);
  } else {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        currentTabUrl = tabs[0].url || '';
        console.log('Current tab URL:', currentTabUrl);
      }
    } catch (error) {
      console.error('Failed to get current tab URL:', error);
    }
  }

  // URL 방문 기록 저장
  if (currentTabUrl) {
    await saveUrlVisit(currentTabUrl);
  }

  // 현재 URL과 매치되는 site 찾기 (프로토콜 무시)
  let matchedSite = null;
  for (const [siteName, siteUrl] of Object.entries(sites)) {
    if (currentTabUrl) {
      // 프로토콜을 제거하고 비교 (http:// 또는 https://)
      const normalizedCurrentUrl = currentTabUrl.replace(/^https?:\/\//, '');
      const normalizedSiteUrl = siteUrl.replace(/^https?:\/\//, '');
      
      if (normalizedCurrentUrl.startsWith(normalizedSiteUrl)) {
        matchedSite = siteName;
        console.log('Matched site from URL:', matchedSite, '(', siteUrl, ')');
        break;
      }
    }
  }

  // 저장된 site 불러오기 (URL 매치가 없을 경우 fallback)
  const result = await chrome.storage.local.get(['selectedSite']);
  const savedSite = result.selectedSite;
  console.log('Saved site:', savedSite);

  // 선택 우선순위: 1) URL 매치 2) 저장된 site 3) 첫 번째 항목
  const siteToSelect = matchedSite || savedSite;

  let isFirst = true;
  for (const [siteName, siteUrl] of Object.entries(sites)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const span = document.createElement('span');

    input.type = 'radio';
    input.name = 'server';
    input.value = siteName;

    // 우선순위에 따라 선택
    if (siteToSelect) {
      input.checked = (siteName === siteToSelect);
    } else if (isFirst) {
      input.checked = true;
      isFirst = false;
    }

    span.textContent = siteName;

    label.appendChild(input);
    label.appendChild(document.createTextNode(' '));
    label.appendChild(span);

    radioGroup.appendChild(label);
  }
}

// Get currently selected server
function getSelectedServer() {
  const radio = document.querySelector('input[name="server"]:checked');
  return radio ? radio.value : null;
}

// handleMenuClick handles menu button click
async function handleMenuClick(menuName, menuPath, sectionName) {
  const server = getSelectedServer();

  if (!server) {
    console.error('No server selected');
    return;
  }

  const siteUrl = config.sites[server];
  if (!siteUrl) {
    console.error('Server URL not found:', server);
    return;
  }

  const url = `${siteUrl}/${menuPath}`;

  console.log('Opening URL:', url);

  // Open URL in current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.update(tabs[0].id, { url: url });
  });
}

// Handle run button click (파라미터 입력 다이얼로그 열기)
async function handleRunClick(runUrl, buttonName) {
  // Get current page URL before opening dialog
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentPageUrl = tabs && tabs.length > 0 ? tabs[0].url : '';

  // Encode parameters for URL
  const encodedUrl = encodeURIComponent(runUrl);
  const encodedButton = encodeURIComponent(buttonName);
  const encodedPageUrl = encodeURIComponent(currentPageUrl);
  const dialogUrl = `run_dialog.html?url=${encodedUrl}&button=${encodedButton}&pageUrl=${encodedPageUrl}`;

  // Open dialog window
  chrome.windows.create({
    url: dialogUrl,
    type: 'popup',
    width: 1040,
    height: 450,
    left: 300,
    top: 200
  });

  window.close();
}

// Handle custom button click (직접 URL로 이동)
function handleCustomClick(customUrl) {
  console.log('Opening custom URL:', customUrl);

  // URL에 'jenkins'가 포함되어 있으면 sites 항목과 비교하여 라디오 버튼 선택
  if (customUrl.toLowerCase().includes('jenkins')) {
    const sites = config.sites;
    if (sites) {
      for (const [siteName, siteUrl] of Object.entries(sites)) {
        if (customUrl.includes(siteUrl)) {
          const radioButton = document.querySelector(`input[name="server"][value="${siteName}"]`);
          if (radioButton) {
            radioButton.checked = true;
            chrome.storage.local.set({ selectedSite: siteName });
            break;
          }
        }
      }
    }
  }

  // Open URL in current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error('No active tab found!');
      return;
    }

    const currentUrl = tabs[0].url;
    let targetUrl = customUrl;

    chrome.tabs.update(tabs[0].id, { url: targetUrl });
  });
}

// Handle job button click (현재 URL 분석 후 경로 추가)
function handleJobClick(jobPath, sectionName, jobName) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentUrl = tabs[0].url;
    let newUrl = '';
    let baseUrl = '';

    // 현재 URL이 .*/job/.*/[0-9]+/.* 패턴인지 확인 (build URL)
    if (/.*\/job\/[^\/]+\/\d+\/.*/.test(currentUrl)) {
      // 현재 URL이 이전 build_url을 포함하고 있는지 확인
      if (previousBuildUrl && currentUrl.includes(previousBuildUrl)) {
        baseUrl = previousBuildUrl;
      } else {
        const match = currentUrl.match(/^(https?:\/\/.*\/job\/[^\/]+\/\d+\/)/);
        if (match) {
          baseUrl = match[1];
          previousBuildUrl = baseUrl;
        } else {
          console.error('Failed to extract build URL pattern');
          return;
        }
      }

      // jobPath에서 lastBuild/ 제거하고 추가
      const pathWithoutLastBuild = jobPath.replace(/^lastBuild\//, '');
      newUrl = baseUrl + pathWithoutLastBuild;
    }
    // 현재 URL이 .*/job/.*/[0-9]+/.* 패턴이 아닌 경우 (job URL)
    else {
      // 현재 URL이 이전 job_url을 포함하고 있는지 확인
      if (previousJobUrl && currentUrl.includes(previousJobUrl)) {
        baseUrl = previousJobUrl;
      } else {
        const match = currentUrl.match(/^(https?:\/\/.*\/job\/[^\/]+\/)/);
        if (match) {
          baseUrl = match[1];
          previousJobUrl = baseUrl;
        } else {
          console.error('Failed to extract job URL pattern');
          return;
        }
      }

      // jobPath 추가 (lastBuild 포함)
      newUrl = baseUrl + jobPath;
    }

    console.log('Opening new URL:', newUrl);
    chrome.tabs.update(tabs[0].id, { url: newUrl });
  });
}

// ========== Run Dialog Functions ==========

// Load saved parameters or use default
async function loadParameters() {
  const storageKey = `run_cmd_${runButton}`;

  try {
    const result = await chrome.storage.local.get([storageKey]);
    if (result[storageKey]) {
      return result[storageKey];
    }
  } catch (error) {
    console.error('Failed to load parameters:', error);
  }

  return DEFAULT_PARAMS;
}

// Save parameters to storage
async function saveParameters(params) {
  const storageKey = `run_cmd_${runButton}`;

  try {
    await chrome.storage.local.set({ [storageKey]: params });
    console.log('Parameters saved:', storageKey);
  } catch (error) {
    console.error('Failed to save parameters:', error);
  }
}

// Initialize run dialog
async function initializeRunDialog() {
  const previousTextarea = document.getElementById('previousParams');
  const textarea = document.getElementById('paramsInput');

  // Load saved parameters
  const savedParams = await loadParameters();
  previousTextarea.value = savedParams;

  // Check if current page URL matches any configured site and update PARAM1
  let updatedParams = savedParams;
  if (pageUrl && config.sites) {
    const normalizeUrl = (url) => url.replace(/^https?:\/\//, '');
    const normalizedCurrentUrl = normalizeUrl(pageUrl);

    // Find matching site
    const matchedSite = Object.entries(config.sites).find(([_, siteUrl]) =>
      normalizedCurrentUrl.includes(normalizeUrl(siteUrl))
    );

    if (matchedSite) {
      updatedParams = savedParams.replace(/^(PARAM1=)(.*)$/m, `$1${pageUrl}`);
    }
  }

  // Display in Enter Parameters
  textarea.value = updatedParams;
  textarea.focus();

  // Run button click handler
  document.getElementById('runBtn').addEventListener('click', async () => {
    const paramsText = textarea.value.trim();

    if (!baseUrl) {
      alert('Base URL is missing!');
      return;
    }

    // Parse parameters from textarea (each line should be KEY=VALUE format)
    const lines = paramsText.split('\n').filter(line => line.trim());
    const params = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && trimmedLine.includes('=')) {
        const eqIndex = trimmedLine.indexOf('=');
        const key = trimmedLine.substring(0, eqIndex).trim();
        const value = trimmedLine.substring(eqIndex + 1).trim();

        // Encode the value to prevent URL parsing issues
        const encodedValue = encodeURIComponent(value);
        params.push(`${key}=${encodedValue}`);
      }
    }

    // Build final URL
    let finalUrl = baseUrl;
    if (params.length > 0) {
      // Check if baseUrl already has query parameters
      const separator = baseUrl.includes('?') ? '&' : '?';
      finalUrl = baseUrl + separator + params.join('&');
    }

    // Convert https to http in final URL (force http - replace all occurrences)
    finalUrl = finalUrl.replace(/https:\/\//gi, 'http://');

    // Save parameters before executing
    await saveParameters(paramsText);

    // Get current popup window ID
    const currentWindow = await chrome.windows.getCurrent();
    const popupWindowId = currentWindow.id;

    // Create new tab with URL (active: true to make it visible)
    try {
      const tab = await chrome.tabs.create({ url: finalUrl, active: true });
      console.log('Tab created successfully:', tab.id, 'URL:', finalUrl);

      // Close this popup window after 2 seconds
      setTimeout(() => {
        chrome.windows.remove(popupWindowId, () => {
          if (chrome.runtime.lastError) {
            console.error('Failed to close window:', chrome.runtime.lastError);
          }
        });
      }, 2000);
    } catch (error) {
      console.error('Failed to create tab:', error);
      alert('Failed to create tab: ' + error.message);
    }
  });

  // Cancel button click handler
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });

  // Enter key handler (Ctrl+Enter to run)
  textarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      document.getElementById('runBtn').click();
    }
  });
}

// ========== Initialize Based on Mode ==========
document.addEventListener('DOMContentLoaded', async () => {
  if (isRunDialogMode) {
    // Run Dialog Mode
    console.log('Initializing Run Dialog Mode');
    document.body.classList.add('run-dialog-mode');
    document.getElementById('runDialogContent').style.display = 'flex';
    document.querySelector('.popup-window').style.display = 'none';

    // Load config for sites information
    await loadConfig();

    await initializeRunDialog();
  } else {
    // Popup Mode
    console.log('Initializing Popup Mode');
    displayVersion();
    await loadConfig();

    // 라디오 버튼 변경 이벤트 리스너는 동적으로 생성된 후에 추가
    setTimeout(() => {
      document.querySelectorAll('input[name="server"]').forEach(radio => {
        radio.addEventListener('change', () => {
          console.log('Server changed to:', radio.value);
          // 선택한 site를 storage에 저장
          chrome.storage.local.set({ selectedSite: radio.value }, () => {
            console.log('Saved selected site:', radio.value);
          });
        });
      });
    }, 100);
  }
});
