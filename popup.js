// Load config.list and setup event handlers
let config = {};
let previousJobUrl = ''; // ^http.*/job/.*/ 패턴과 정확히 match되는 이전 URL 저장
let previousBuildUrl = ''; // ^http.*/job/.*/[0-9]+/ 패턴의 정확히 match되는 이전 URL 저장

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
      try {
        const response = await fetch('config.list');
        if (!response.ok) {
          throw new Error('config.list not found');
        }
        const text = await response.text();

        // Check if config.list is empty or invalid
        if (!text || text.trim() === '') {
          throw new Error('config.list is empty');
        }

        config = JSON.parse(text);
        console.log('Config loaded from config.list');
      } catch (configError) {
        // If config.list doesn't exist or is empty, copy from config.default
        console.log('config.list not found or empty, loading config.default:', configError.message);
        const defaultResponse = await fetch('config.default');
        const defaultText = await defaultResponse.text();
        config = JSON.parse(defaultText);

        // Save the default config as config.list in storage
        await chrome.storage.local.set({ userConfigText: defaultText });
        console.log('Config loaded from config.default and saved to storage');
      }
    }

    // 라디오 버튼 생성
    createRadioButtons();

    // config.list의 순서대로 버튼 생성 (sites 제외)
    createButtonsInOrder();

  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// config.list의 순서대로 버튼 생성
function createButtonsInOrder() {
  const buttonGrid = document.getElementById('buttonGrid');
  if (!buttonGrid) return;

  buttonGrid.innerHTML = ''; // 기존 내용 제거

  // config 객체를 순회하면서 sites를 제외한 항목들을 순서대로 처리
  for (const [sectionName, sectionData] of Object.entries(config)) {
    if (sectionName === 'sites') continue; // sites는 이미 라디오 버튼으로 처리됨

    console.log(`Creating buttons for section: ${sectionName}`);

    if (sectionName === 'menus') {
      createSectionButtons(sectionData, 'menu-btn', (menuName, menuPath) => {
        handleMenuClick(menuName, menuPath);
      });
    } else if (sectionName === 'run') {
      createSectionButtons(sectionData, 'run-btn', (runName, runPath) => {
        handleRunClick(runPath, runName);
      }, '▶ ');
    } else if (sectionName === 'job') {
      createSectionButtons(sectionData, 'job-btn', (jobName, jobPath) => {
        handleJobClick(jobPath);
      });
    } else if (sectionName === 'custom') {
      // custom은 URL에 따라 클래스가 다름
      for (const [customName, customUrl] of Object.entries(sectionData)) {
        const button = document.createElement('button');
        if (customUrl.toLowerCase().includes('jenkins')) {
          button.className = 'action-btn jenkins-btn';
        } else {
          button.className = 'action-btn custom-btn';
        }
        button.dataset.action = customName;
        button.dataset.url = customUrl;
        button.textContent = customName;
        button.addEventListener('click', () => {
          handleCustomClick(customUrl);
        });
        buttonGrid.appendChild(button);
      }
    }
  }
}

// 섹션별 버튼 생성 헬퍼 함수
function createSectionButtons(sectionData, className, clickHandler, prefix = '') {
  const buttonGrid = document.getElementById('buttonGrid');

  for (const [name, path] of Object.entries(sectionData)) {
    const button = document.createElement('button');
    button.className = `action-btn ${className}`;
    button.dataset.action = name;
    button.dataset.path = path;
    button.textContent = prefix + name;
    button.addEventListener('click', () => {
      clickHandler(name, path);
    });
    buttonGrid.appendChild(button);
  }
}

// config.list의 sites로부터 라디오 버튼 생성
async function createRadioButtons() {
  const radioGroup = document.getElementById('radioGroup');
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
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
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
});
