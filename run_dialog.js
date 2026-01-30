// Integrated popup and run_dialog functionality

// ========== Configuration and State ==========
let config = {};
let previousJobUrl = ''; // ^http.*/job/.*/ 패턴과 정확히 match되는 이전 URL 저장
let previousBuildUrl = ''; // ^http.*/job/.*/[0-9]+/ 패턴의 정확히 match되는 이전 URL 저장

// Default parameters text for run dialog
const DEFAULT_PARAMS = `ACTION=remove_history
PARAM1=http://vjenkins.rge.com/job/11.automigration_downSrcMig/
PARAM2=0-11`;

// ========== Detect Mode: Popup or Run Dialog ==========
const urlParams = new URLSearchParams(window.location.search);
let baseUrl = decodeURIComponent(urlParams.get('url') || '');
const runButton = urlParams.get('button'); // run button name (e.g., 'remove-his', 'copy_job')
const isRunDialogMode = !!baseUrl; // Run dialog mode if URL parameter exists

// Convert https to http (force http)
if (baseUrl && baseUrl.startsWith('https://')) {
  baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
}

console.log('Mode:', isRunDialogMode ? 'Run Dialog' : 'Popup');
console.log('Base URL:', baseUrl);

// ========== Popup Functions ==========

// Generate version string: v년도.날짜시간분 (분은 10분 단위)
function generateVersion() {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2); // 년도 마지막 2자리
  const month = (now.getMonth() + 1).toString(); // 월
  const day = now.getDate().toString(); // 일
  const hour = now.getHours().toString().padStart(2, '0'); // 시간 (2자리)
  const minute = now.getMinutes(); // 10분 단위로 내림
  const minuteStr = minute.toString().padStart(2, '0'); // 분 (2자리)

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
      // Fallback to config.list file
      const response = await fetch('config.list');
      config = await response.json();
      console.log('Config loaded from config.list (default)');
    }

    // 라디오 버튼 생성
    createRadioButtons();

    // 메뉴 버튼 생성 (menus + job + custom)
    createMenuButtons();
    createJobButtons();
    createCustomButtons();

  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// config.list의 sites로부터 라디오 버튼 생성
async function createRadioButtons() {
  const radioGroup = document.getElementById('radioGroup');
  if (!radioGroup) return;

  radioGroup.innerHTML = ''; // 기존 내용 제거

  const sites = config.sites;
  if (!sites) {
    console.error('Sites not found in config');
    return;
  }

  // 저장된 site 불러오기
  const result = await chrome.storage.local.get(['selectedSite']);
  const savedSite = result.selectedSite;
  console.log('Saved site:', savedSite);

  let isFirst = true;
  for (const [siteName, siteUrl] of Object.entries(sites)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const span = document.createElement('span');

    input.type = 'radio';
    input.name = 'server';
    input.value = siteName;

    // 저장된 site가 있으면 그것을 선택, 없으면 첫 번째 항목 선택
    if (savedSite) {
      input.checked = (siteName === savedSite);
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

// config.list의 menus로부터 버튼 생성 (올리브색)
function createMenuButtons() {
  const buttonGrid = document.getElementById('buttonGrid');
  if (!buttonGrid) return;

  buttonGrid.innerHTML = ''; // 기존 내용 제거

  const menus = config.menus;
  if (!menus) {
    console.error('Menus not found in config');
    return;
  }

  // 메뉴 버튼 생성
  for (const [menuName, menuPath] of Object.entries(menus)) {
    const button = document.createElement('button');
    button.className = 'action-btn menu-btn';
    button.dataset.action = menuName;
    button.dataset.path = menuPath;
    button.textContent = menuName;
    button.addEventListener('click', () => {
      handleMenuClick(menuName, menuPath);
    });
    buttonGrid.appendChild(button);
  }

  // run 버튼 생성 (menu 버튼 다음에 개별적으로 추가)
  if (config.run) {
    for (const [runName, runPath] of Object.entries(config.run)) {
      const button = document.createElement('button');
      button.className = 'action-btn run-btn';
      button.dataset.action = runName;
      button.dataset.path = runPath;
      button.textContent = '▶ ' + runName;
      button.addEventListener('click', () => {
        handleRunClick(runPath, runName);
      });
      buttonGrid.appendChild(button);
    }
  }
}

// config.list의 job으로부터 버튼 생성 (steelblue색)
function createJobButtons() {
  const buttonGrid = document.getElementById('buttonGrid');
  if (!buttonGrid) return;

  const jobMenus = config.job;
  if (!jobMenus) {
    console.log('Job menus not found in config');
    return;
  }

  for (const [jobName, jobPath] of Object.entries(jobMenus)) {
    const button = document.createElement('button');
    button.className = 'action-btn job-btn'; // job-btn 클래스 추가
    button.dataset.action = jobName;
    button.dataset.path = jobPath;
    button.textContent = jobName;

    button.addEventListener('click', () => {
      handleJobClick(jobPath);
    });

    buttonGrid.appendChild(button);
  }
}

// config.list의 custom으로부터 버튼 생성 (darkcyan색)
function createCustomButtons() {
  console.log('=== createCustomButtons START ===');
  const buttonGrid = document.getElementById('buttonGrid');
  if (!buttonGrid) return;

  const customMenus = config.custom;
  console.log('Custom menus:', customMenus);

  if (!customMenus) {
    console.log('Custom menus not found in config');
    return;
  }

  for (const [customName, customUrl] of Object.entries(customMenus)) {
    console.log(`Creating button: ${customName} -> ${customUrl}`);
    const button = document.createElement('button');

    // URL에 'jenkins'가 포함되어 있으면 jenkins-btn 클래스 추가, 아니면 custom-btn
    if (customUrl.toLowerCase().includes('jenkins')) {
      button.className = 'action-btn jenkins-btn';
    } else {
      button.className = 'action-btn custom-btn';
    }

    button.dataset.action = customName;
    button.dataset.url = customUrl;
    button.textContent = customName;

    button.addEventListener('click', () => {
      console.log(`Button clicked: ${customName}`);
      handleCustomClick(customUrl);
    });

    buttonGrid.appendChild(button);
    console.log(`Button added: ${customName}`);
  }

  console.log('=== createCustomButtons END ===');
}

// Get currently selected server
function getSelectedServer() {
  const radio = document.querySelector('input[name="server"]:checked');
  return radio ? radio.value : null;
}

// Handle menu button click
function handleMenuClick(menuName, menuPath) {
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

  // URL 구성: siteUrl + '/' + menuPath
  const url = `${siteUrl}/${menuPath}`;

  console.log('Opening URL:', url);

  // Open URL in current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.update(tabs[0].id, { url: url });
  });

  // Close popup after 2 seconds
  setTimeout(() => {
    window.close();
  }, 2000);
}

// Handle run button click (파라미터 입력 다이얼로그 열기)
async function handleRunClick(runUrl, buttonName) {
  console.log('Opening run dialog for URL:', runUrl);

  // URL을 인코딩하여 run_dialog.html에 전달
  const encodedUrl = encodeURIComponent(runUrl);
  const encodedButton = encodeURIComponent(buttonName);
  const dialogUrl = `run_dialog.html?url=${encodedUrl}&button=${encodedButton}`;

  // 다이얼로그 창 열기
  chrome.windows.create({
    url: dialogUrl,
    type: 'popup',
    width: 550,
    height: 380,
    left: 300,
    top: 200
  });

  // Close current popup
  window.close();
}

// Handle custom button click (직접 URL로 이동)
function handleCustomClick(customUrl) {
  console.log('=== handleCustomClick START ===');
  console.log('Opening custom URL:', customUrl);

  // URL에 'jenkins'가 포함되어 있으면 sites 항목과 비교하여 라디오 버튼 선택
  if (customUrl.toLowerCase().includes('jenkins')) {
    const sites = config.sites;
    if (sites) {
      // sites의 각 item을 순회하며 customUrl이 해당 siteUrl을 포함하는지 확인
      for (const [siteName, siteUrl] of Object.entries(sites)) {
        if (customUrl.includes(siteUrl)) {
          // 해당 site의 라디오 버튼 선택
          const radioButton = document.querySelector(`input[name="server"][value="${siteName}"]`);
          if (radioButton) {
            radioButton.checked = true;
            console.log(`Auto-selected radio button: ${siteName} (matched with ${siteUrl})`);

            // 선택한 site를 storage에 저장
            chrome.storage.local.set({ selectedSite: siteName }, () => {
              console.log('Saved selected site:', siteName);
            });

            break; // 첫 번째 매칭되는 항목만 선택
          }
        }
      }
    }
  }

  console.log('About to query tabs...');

  // Open URL in current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log('=== Inside chrome.tabs.query callback ===');
    console.log('Tabs:', tabs);

    if (!tabs || tabs.length === 0) {
      console.error('No active tab found!');
      return;
    }

    const currentUrl = tabs[0].url;
    let targetUrl = customUrl;

    // URL 정규화 함수 (프로토콜과 끝 슬래시 제거)
    const normalizeUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    console.log('Current URL:', currentUrl);
    console.log('Custom URL:', customUrl);
    console.log('Normalized current:', normalizeUrl(currentUrl));
    console.log('Normalized custom:', normalizeUrl(customUrl));

    // 현재 URL과 customUrl이 같으면 (프로토콜, 슬래시 무시) job/.* 부분 제거
    if (normalizeUrl(currentUrl) === normalizeUrl(customUrl)) {
      console.log('URLs MATCH! Checking for job pattern...');
      const jobMatch = customUrl.match(/^https?:\/\/(.*)\/job\/[^\/]+\/?$/);
      console.log('Job match result:', jobMatch);

      if (jobMatch) {
        // 현재 URL의 프로토콜 사용
        const protocol = currentUrl.match(/^https?:\/\//)[0];
        targetUrl = protocol + jobMatch[1] + '/';
        console.log('✓ Current URL matches custom URL, removed job/.*');
        console.log('Target URL:', targetUrl);
      } else {
        console.log('✗ No job pattern found in customUrl');
      }
    } else {
      console.log('✓ URLs do not match, navigating to custom URL');
    }

    console.log('Final target URL:', targetUrl);
    console.log('Updating tab...');
    chrome.tabs.update(tabs[0].id, { url: targetUrl }, () => {
      console.log('Tab updated successfully');
    });
  });

  // Close popup after 2 seconds
  setTimeout(() => {
    window.close();
  }, 2000);

  console.log('=== handleCustomClick END ===');
}

// Handle job button click (현재 URL 분석 후 경로 추가)
function handleJobClick(jobPath) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentUrl = tabs[0].url;
    console.log('Current URL:', currentUrl);
    console.log('Job path:', jobPath);
    console.log('Previous job URL:', previousJobUrl);
    console.log('Previous build URL:', previousBuildUrl);

    let newUrl = '';
    let baseUrl = '';

    // 현재 URL이 .*/job/.*/[0-9]+/.* 패턴인지 확인 (build URL)
    if (/.*\/job\/[^\/]+\/\d+\/.*/.test(currentUrl)) {
      console.log('Pattern matched: .*/job/.*/[0-9]+/.*');

      // 현재 URL이 이전 build_url을 포함하고 있는지 확인
      if (previousBuildUrl && currentUrl.includes(previousBuildUrl)) {
        // 이전 build_url에 jobPath 추가 (lastBuild 제거)
        baseUrl = previousBuildUrl;
        console.log('Current URL includes previous build URL, using previous build URL');
      } else {
        // 현재 URL에서 ^http.*/job/.*/[0-9]+/ 패턴 추출
        const match = currentUrl.match(/^(https?:\/\/.*\/job\/[^\/]+\/\d+\/)/);
        if (match) {
          baseUrl = match[1];
          // 현재 URL을 build_url로 저장
          previousBuildUrl = baseUrl;
          console.log('Using current URL as base, saved to previousBuildUrl');
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
      console.log('Pattern matched: job URL (not build URL)');

      // 현재 URL이 이전 job_url을 포함하고 있는지 확인
      if (previousJobUrl && currentUrl.includes(previousJobUrl)) {
        // 이전 job_url에 jobPath 추가
        baseUrl = previousJobUrl;
        console.log('Current URL includes previous job URL, using previous job URL');
      } else {
        // 현재 URL에서 ^http.*/job/.*/ 패턴 추출
        const match = currentUrl.match(/^(https?:\/\/.*\/job\/[^\/]+\/)/);
        if (match) {
          baseUrl = match[1];
          // 현재 URL을 job_url로 저장
          previousJobUrl = baseUrl;
          console.log('Using current URL as base, saved to previousJobUrl');
        } else {
          console.error('Failed to extract job URL pattern');
          return;
        }
      }

      // jobPath 추가 (lastBuild 포함)
      newUrl = baseUrl + jobPath;
    }

    console.log('Base URL:', baseUrl);
    console.log('Opening new URL:', newUrl);
    chrome.tabs.update(tabs[0].id, { url: newUrl });
  });

  // Close popup after 2 seconds
  setTimeout(() => {
    window.close();
  }, 2000);
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
  const textarea = document.getElementById('paramsInput');

  // Load saved parameters
  const savedParams = await loadParameters();
  textarea.value = savedParams;
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

    console.log('=== URL DEBUG INFO ===');
    console.log('Base URL:', baseUrl);
    console.log('Final URL after conversion:', finalUrl);
    console.log('Contains https:', finalUrl.includes('https://'));
    console.log('======================');

    // Save parameters before executing
    await saveParameters(paramsText);

    // Get current popup window ID
    const currentWindow = await chrome.windows.getCurrent();
    const popupWindowId = currentWindow.id;
    console.log('Current popup window ID:', popupWindowId);

    // Create new tab with URL (active: true to make it visible)
    console.log('Creating tab with URL:', finalUrl);

    try {
      const tab = await chrome.tabs.create({ url: finalUrl, active: true });
      console.log('Tab created successfully:', tab.id, 'URL:', finalUrl);

      // Close this popup window after 2 seconds
      setTimeout(() => {
        console.log('Closing popup window after 2 second delay');
        chrome.windows.remove(popupWindowId, () => {
          if (chrome.runtime.lastError) {
            console.error('Failed to close window:', chrome.runtime.lastError);
          } else {
            console.log('Popup window closed successfully');
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
