// Load config.list and setup event handlers
let config = {};
let previousJobUrl = ''; // ^http.*/job/.*/ 패턴과 정확히 match되는 이전 URL 저장
let previousBuildUrl = ''; // ^http.*/job/.*/[0-9]+/ 패턴의 정확히 match되는 이전 URL 저장

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
}// config.list의 sites로부터 라디오 버튼 생성
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

// config.list의 menus로부터 버튼 생성 (올리브색)
function createMenuButtons() {
  const buttonGrid = document.getElementById('buttonGrid');
  buttonGrid.innerHTML = ''; // 기존 내용 제거

  const menus = config.menus;
  if (!menus) {
    console.error('Menus not found in config');
    return;
  }

  for (const [menuName, menuPath] of Object.entries(menus)) {
    const button = document.createElement('button');
    button.className = 'action-btn menu-btn'; // menu-btn 클래스 추가
    button.dataset.action = menuName;
    button.dataset.path = menuPath;
    button.textContent = menuName;

    button.addEventListener('click', () => {
      handleMenuClick(menuName, menuPath);
    });

    buttonGrid.appendChild(button);
  }
}

// config.list의 job으로부터 버튼 생성 (steelblue색)
function createJobButtons() {
  const buttonGrid = document.getElementById('buttonGrid');

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
  const buttonGrid = document.getElementById('buttonGrid');

  const customMenus = config.custom;
  if (!customMenus) {
    console.log('Custom menus not found in config');
    return;
  }

  for (const [customName, customUrl] of Object.entries(customMenus)) {
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
      handleCustomClick(customUrl);
    });

    buttonGrid.appendChild(button);
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

// Handle custom button click (직접 URL로 이동)
function handleCustomClick(customUrl) {
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

  // Open URL in current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.update(tabs[0].id, { url: customUrl });
  });
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
