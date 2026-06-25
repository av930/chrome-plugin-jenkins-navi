// Jenkins Shortcuts - Content Script
// Provides keyboard shortcuts for Jenkins menu navigation

(function () {
  'use strict';

  // State management
  let fModeActive = false; // F key prefix mode
  let config = null;
  let urlMenuVisible = false;
  let lastSavedUrl = ''; // Track last saved URL to avoid duplicates
  let actionNoticeTimer = null;
  let scrollOverlayTimer = null;
  let breadcrumbToggleIndex = 0;
  let gShortcutChainActive = false;
  let gBottomReachedCount = 0;
  let bTopReachedCount = 0;

  const JOB_BASE_URL_PATTERN = /^(.*?\/job\/[^\/]+(?:\/job\/[^\/]+)*)\/?\/?/;
  const BUILD_BASE_URL_PATTERN = /^(.*?\/job\/[^\/]+(?:\/job\/[^\/]+)*\/\d+)\/?/;
  const NODE_BASE_URL_PATTERN = /^(.*?\/computer\/[^\/]+)\/?/;
  const SYNTHETIC_SHORTCUT_MENU_SELECTOR = '[data-jenkins-synthetic-shortcut]';
  const TIMESTAMPS_PATH = '/timestamps/?time=HH:mm:ss&timeZone=GMT+9&appendLog';

  function normalizeUrlProtocolForCurrentPage(url) {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) return normalizedUrl;

    if (window.location.protocol === 'https:' && /^http:\/\//i.test(normalizedUrl)) {
      return normalizedUrl.replace(/^http:\/\//i, 'https://');
    }

    return normalizedUrl;
  }

  function normalizeComparableUrl(url) {
    return String(url || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$|[?#].*$/g, '')
      .toLowerCase();
  }

  function extractJobNameFromUrl(url) {
    const matches = [...String(url || '').matchAll(/\/job\/([^\/?#]+)/gi)];
    if (matches.length === 0) return null;

    try {
      return decodeURIComponent(matches[matches.length - 1][1]).toLowerCase();
    } catch (error) {
      return matches[matches.length - 1][1].toLowerCase();
    }
  }

  function getCanonicalViewJobUrl(url) {
    // Support multi-level jobs: /view/xxx/job/folder/job/name
    // Also handle build URLs like /30 or /30/console, /30/artifact, etc.
    const match = String(url || '').match(/^(https?:\/\/[^?#]+?\/view\/[^\/?#]+\/job\/.+?)(?:\/\d+(?:\/[^\/]*)?)?[\/]?(?:[?#].*)?$/i);
    if (match) {
      const jobPath = match[1].replace(/\/+$/, '');
      // Ensure it ends with a job segment, not a build number or other path
      if (/\/job\/[^\/?#]+$/.test(jobPath)) {
        return `${jobPath}/`;
      }
    }
    return null;
  }

  function getCanonicalBareJobUrl(url) {
    // Support multi-level jobs: /job/folder/job/name
    const jobBaseUrl = getJobBaseUrl(url);
    if (!jobBaseUrl) return null;
    
    // Check if this is NOT a view job URL (no /view/ prefix)
    if (/\/view\/[^\/]+\/job\//i.test(url)) return null;
    
    return `${jobBaseUrl.replace(/\/+$/, '')}/`;
  }

  function getSitePrefixFromViewJobUrl(url) {
    // Support multi-level jobs: remove /view/xxx/job/... pattern
    return String(url || '').replace(/\/view\/[^\/]+\/job\/.+$/i, '').replace(/\/+$/, '');
  }

  function getSitePrefixFromBareJobUrl(url) {
    // Support multi-level jobs: remove /job/... pattern
    return String(url || '').replace(/\/job\/.+$/i, '').replace(/\/+$/, '');
  }

  function getSitePrefixFromAnyJobUrl(url) {
    const viewCanonical = getCanonicalViewJobUrl(url);
    if (viewCanonical) return getSitePrefixFromViewJobUrl(viewCanonical);

    const bareCanonical = getCanonicalBareJobUrl(url);
    if (bareCanonical) return getSitePrefixFromBareJobUrl(bareCanonical);

    const jobBase = getJobBaseUrl(url);
    if (!jobBase) return null;

    return getCanonicalViewJobUrl(jobBase)
      ? getSitePrefixFromViewJobUrl(jobBase)
      : getSitePrefixFromBareJobUrl(jobBase);
  }

  function sanitizeUrlHistory(rawHistory = {}) {
    const sanitized = {};

    Object.entries(rawHistory).forEach(([url, data]) => {
      const canonical = getCanonicalViewJobUrl(url);
      if (!canonical) return;

      const safeData = {
        count: Math.max(1, Number(data?.count || 1)),
        firstVisit: Number(data?.firstVisit || Date.now()),
        lastVisit: Number(data?.lastVisit || Date.now())
      };

      if (!sanitized[canonical]) {
        sanitized[canonical] = safeData;
        return;
      }

      sanitized[canonical] = {
        count: sanitized[canonical].count + safeData.count,
        firstVisit: Math.min(sanitized[canonical].firstVisit, safeData.firstVisit),
        lastVisit: Math.max(sanitized[canonical].lastVisit, safeData.lastVisit)
      };
    });

    // Convert bare job entries into existing view-job entries when mapping is possible.
    Object.entries(rawHistory).forEach(([url, data]) => {
      const bareCanonical = getCanonicalBareJobUrl(url);
      if (!bareCanonical) return;

      const mappedViewUrl = findMappedViewJobUrlForBareJob(bareCanonical, sanitized);
      if (!mappedViewUrl || !sanitized[mappedViewUrl]) return;

      const safeData = {
        count: Math.max(1, Number(data?.count || 1)),
        firstVisit: Number(data?.firstVisit || Date.now()),
        lastVisit: Number(data?.lastVisit || Date.now())
      };

      sanitized[mappedViewUrl] = {
        count: sanitized[mappedViewUrl].count + safeData.count,
        firstVisit: Math.min(sanitized[mappedViewUrl].firstVisit, safeData.firstVisit),
        lastVisit: Math.max(sanitized[mappedViewUrl].lastVisit, safeData.lastVisit)
      };
    });

    return sanitized;
  }

  function findMappedViewJobUrlForBareJob(bareJobUrl, urlHistory) {
    const bareJobName = extractJobNameFromUrl(bareJobUrl);
    const bareSitePrefix = normalizeComparableUrl(getSitePrefixFromBareJobUrl(bareJobUrl));
    if (!bareJobName || !bareSitePrefix) return null;

    for (const savedUrl of Object.keys(urlHistory || {})) {
      const viewJobName = extractJobNameFromUrl(savedUrl);
      if (!viewJobName || viewJobName !== bareJobName) continue;

      const viewSitePrefix = normalizeComparableUrl(getSitePrefixFromViewJobUrl(savedUrl));
      if (viewSitePrefix === bareSitePrefix) {
        return savedUrl;
      }
    }

    return null;
  }

  // Unified shortcut mappings (no pageType distinction)
  // When multiple entries share the same key, the first matching entry wins
  const SHORTCUTS = [
    { key: 'B', text: ['Build with Parameters', 'Build Now', '빌드 실행'], selector: '#side-panel a[href*="build?"], .task a[href*="build?"]' },
    { key: 'R', text: ['Retrigger Last', 'Retrigger/Retry/Rebuild Last'], selector: null },
    { key: 'D', text: ['Delete build', '빌드 삭제'], selector: '#side-panel a[href*="doDelete"], .task a[href*="doDelete"]' },
    { key: 'D', text: ['Disconnect', '연결끊기'], selector: '#side-panel a[href*="toggleOffline"], .task a[href*="toggleOffline"]' },
    { key: 'C/T', text: ['Console Output', '콘솔 출력'], selector: '#side-panel a[href*="/console"], .task a[href*="/console"], .task a[href*="/consoleText"], .task a[href*="/consoleFull"]' },
    { key: 'E', text: ['Environment Variables'], selector: '#side-panel a[href*="injectedEnvVars"], .task a[href*="injectedEnvVars"]' },
    { key: 'X', text: ['구성', 'Configure'], selector: '#side-panel a[href$="/configure"], .task a[href$="/configure"]' },
    { key: 'B', text: ['Build History'], selector: '#side-panel a[href*="builds"], .task a[href*="builds"]' },
    { key: 'S', text: ['System Information'], selector: '#side-panel a[href*="systemInfo"], .task a[href*="systemInfo"]' },
    { key: 'H', text: ['Agent Config History'], selector: '#side-panel a[href*="nodeConfigHistory"], .task a[href*="nodeConfigHistory"]' },
    { key: 'C/T', text: ['Log'], selector: '#side-panel a[href*="log"], .task a[href*="log"]' }
  ];

  // Save URL visit history to storage
  async function saveUrlVisit(url) {
    if (!url || !url.includes('jenkins')) return;

    try {
      if (!chrome.runtime?.id) return;

      const result = await chrome.storage.local.get(['urlHistory']);
      let urlHistory = sanitizeUrlHistory(result.urlHistory || {});

      let normalizedUrl = getCanonicalViewJobUrl(url);

      if (!normalizedUrl) {
        const bareJobUrl = getCanonicalBareJobUrl(url);
        if (!bareJobUrl) {
          await chrome.storage.local.set({ urlHistory });
          return;
        }

        // Try to find mapped view job URL, but if not found, save bare job URL
        normalizedUrl = findMappedViewJobUrlForBareJob(bareJobUrl, urlHistory) || bareJobUrl;
      }

      if (normalizedUrl === lastSavedUrl) return;
      lastSavedUrl = normalizedUrl;

      // If this is a view job URL, check if there's a matching bare job URL in history
      // If found, migrate the bare job data to the view job URL
      const isViewJobUrl = /\/view\/[^\/]+\/job\/[^\/]+\/?$/i.test(normalizedUrl);
      if (isViewJobUrl) {
        const viewJobName = extractJobNameFromUrl(normalizedUrl);
        const viewSitePrefix = normalizeComparableUrl(getSitePrefixFromViewJobUrl(normalizedUrl));
        
        if (viewJobName && viewSitePrefix) {
          // Find matching bare job URLs
          const bareJobUrlsToMigrate = [];
          
          for (const [savedUrl, data] of Object.entries(urlHistory)) {
            // Skip if it's already a view job URL
            if (/\/view\/[^\/]+\/job\/[^\/]+\/?$/i.test(savedUrl)) continue;
            
            // Check if it's a bare job URL
            if (!/\/job\/[^\/]+\/?$/i.test(savedUrl)) continue;
            
            const bareJobName = extractJobNameFromUrl(savedUrl);
            const bareSitePrefix = normalizeComparableUrl(getSitePrefixFromBareJobUrl(savedUrl));
            
            // Check if job name and site prefix match
            if (bareJobName === viewJobName && bareSitePrefix === viewSitePrefix) {
              bareJobUrlsToMigrate.push({ url: savedUrl, data });
            }
          }
          
          // Migrate bare job data to view job URL
          if (bareJobUrlsToMigrate.length > 0) {
            console.log('Migrating bare job URLs to view job URL:', normalizedUrl);
            
            for (const { url: bareUrl, data: bareData } of bareJobUrlsToMigrate) {
              console.log('  Migrating:', bareUrl);
              
              if (urlHistory[normalizedUrl]) {
                // Merge data if view job URL already exists
                urlHistory[normalizedUrl].count += bareData.count;
                urlHistory[normalizedUrl].firstVisit = Math.min(
                  urlHistory[normalizedUrl].firstVisit,
                  bareData.firstVisit
                );
                urlHistory[normalizedUrl].lastVisit = Math.max(
                  urlHistory[normalizedUrl].lastVisit,
                  bareData.lastVisit
                );
              } else {
                // Copy bare job data to view job URL
                urlHistory[normalizedUrl] = { ...bareData };
              }
              
              // Remove bare job URL
              delete urlHistory[bareUrl];
            }
          }
        }
      }

      const entries = Object.entries(urlHistory);
      entries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
      const recentUrls = entries.slice(0, 5).map(([url]) => url);

      if (recentUrls.includes(normalizedUrl)) return;

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

      const allEntries = Object.entries(urlHistory);
      if (allEntries.length > 90) {
        allEntries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
        urlHistory = Object.fromEntries(allEntries.slice(0, 90));
      }

      await chrome.storage.local.set({ urlHistory });
    } catch (error) {
      console.error('Failed to save URL visit:', error);
    }
  }

  async function navigateToMatchedFrequentView(currentUrl = window.location.href) {
    const currentJobBaseUrl = getJobBaseUrl(currentUrl);
    if (!currentJobBaseUrl) return false;

    const currentJobName = extractJobNameFromUrl(currentJobBaseUrl);
    const currentSitePrefix = normalizeComparableUrl(getSitePrefixFromAnyJobUrl(currentUrl));
    if (!currentJobName || !currentSitePrefix) return false;

    if (!chrome.runtime?.id) return false;

    const result = await chrome.storage.local.get(['urlHistory']);
    const urlHistory = sanitizeUrlHistory(result.urlHistory || {});

    const historyJobs = Object.entries(urlHistory)
      .map(([url, data]) => ({
        url,
        lastVisit: Number(data?.lastVisit || 0),
        count: Number(data?.count || 0)
      }))
      .filter((item) => /\/view\/[^\/]+\/job\/[^\/]+\/?$/i.test(item.url))
      .sort((a, b) => b.lastVisit - a.lastVisit);

    if (historyJobs.length === 0) return false;

    let matchedJob = historyJobs.find((item) => {
      const frequentJobName = extractJobNameFromUrl(item.url);
      if (!frequentJobName || frequentJobName !== currentJobName) return false;

      const frequentSitePrefix = normalizeComparableUrl(getSitePrefixFromAnyJobUrl(item.url));
      return frequentSitePrefix === currentSitePrefix;
    });

    if (!matchedJob) {
      matchedJob = historyJobs.find((item) => extractJobNameFromUrl(item.url) === currentJobName);
    }

    if (!matchedJob) return false;

    const viewMatch = String(matchedJob.url).match(/^(https?:\/\/[^?#]+?\/view\/[^\/?#]+)\/job\/[^\/?#]+\/?$/i);
    if (!viewMatch?.[1]) return false;

    deactivateFMode();
    window.location.href = `${viewMatch[1].replace(/\/+$/, '')}/`;
    return true;
  }

  // Detect if current page is a Jenkins site (based on configured sites)
  async function isJenkinsSite() {
    try {
      if (!chrome.runtime?.id) return;

      const result = await chrome.storage.local.get(['userConfigText']);
      if (result.userConfigText) {
        config = JSON.parse(result.userConfigText);
        const sites = config.sites || {};
        const currentUrl = window.location.href;

        for (const [siteName, siteUrl] of Object.entries(sites)) {
          if (currentUrl.startsWith(siteUrl) || currentUrl.includes('jenkins')) {
            return true;
          }
        }
      }

      return window.location.href.includes('jenkins');
    } catch (error) {
      return window.location.href.includes('jenkins');
    }
  }

  // Check if current page has job/build/node patterns (used for shortcut context)
  function hasJobUrl() {
    return !!getJobBaseUrl();
  }

  function hasBuildUrl() {
    return !!getBuildBaseUrl();
  }

  function hasNodeUrl() {
    return /\/computer\/[^\/]+\/?($|#|configure|builds|systemInfo)/.test(window.location.href);
  }

  // Find the first matching shortcut for a key by checking if its menu item exists on page
  function findFirstMatchingShortcut(keyUpper) {
    const matchingShortcuts = SHORTCUTS.filter(s => s.key.toUpperCase() === keyUpper);
    for (const shortcut of matchingShortcuts) {
      if (!shortcut.selector) {
        // null selector means it's a synthetic shortcut (like Retrigger) - always match
        return { shortcut, link: null };
      }
      const link = findShortcutLinkByConfig(shortcut);
      if (link) {
        return { shortcut, link };
      }
    }
    return null;
  }

  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function isSectionCollapsed(toggle, content) {
    const details = toggle?.closest('details');
    if (details) return !details.open;

    const expanded = toggle?.getAttribute('aria-expanded');
    if (expanded === 'false') return true;
    if (expanded === 'true') return false;

    if (!content) return false;
    return !isElementVisible(content);
  }

  function isBuildExecutorStatusLabel(text = '') {
    const normalizedText = text.trim().toLowerCase();
    return normalizedText.includes('build executor status') || normalizedText.includes('빌드 실행 상태');
  }

  function findBuildExecutorStatusSection() {
    const interactiveSelector = 'button, summary, a, [role="button"], [aria-controls], [aria-expanded]';
    const toggleCandidates = Array.from(document.querySelectorAll(interactiveSelector));

    for (const candidate of toggleCandidates) {
      const relatedElements = [
        candidate,
        candidate.parentElement,
        candidate.closest('details, .jenkins-section, .optionalBlock-container, .optionalBlock, .pane-frame, .section, .row, div')
      ].filter(Boolean);

      if (!relatedElements.some((element) => isBuildExecutorStatusLabel(element.textContent || ''))) {
        continue;
      }

      const controlsId = candidate.getAttribute('aria-controls');
      let content = controlsId ? document.getElementById(controlsId) : null;

      if (!content) {
        const container = candidate.closest('details, .jenkins-section, .optionalBlock-container, .optionalBlock, .pane-frame, .section, .row, div');
        if (container) {
          content = Array.from(container.children).find((child) => child !== candidate && !child.contains(candidate));
        }
      }

      if (!content && candidate.nextElementSibling) {
        content = candidate.nextElementSibling;
      }

      return { toggle: candidate, content };
    }

    const labelElement = Array.from(document.querySelectorAll('div, span, strong, h1, h2, h3, h4, label')).find((element) => {
      return isBuildExecutorStatusLabel(element.textContent || '');
    });
    if (!labelElement) return null;

    const container = labelElement.closest('details, .jenkins-section, .optionalBlock-container, .optionalBlock, .pane-frame, .section, .row, div');
    const toggle = labelElement.closest(interactiveSelector) || container?.querySelector(interactiveSelector);
    if (!toggle) return null;

    const controlsId = toggle.getAttribute('aria-controls');
    let content = controlsId ? document.getElementById(controlsId) : null;

    if (!content && container) {
      content = Array.from(container.children).find((child) => child !== toggle && !child.contains(toggle));
    }

    if (!content && toggle.nextElementSibling) {
      content = toggle.nextElementSibling;
    }

    return { toggle, content };
  }

  function ensureNodeBuildExecutorStatusExpanded() {
    if (!hasNodeUrl()) return;

    const executorsPane = document.getElementById('executors');
    if (executorsPane?.classList.contains('collapsed')) {
      const expandLink = executorsPane.querySelector('a[href*="toggleCollapse?paneId=executors"]');
      if (expandLink) {
        expandLink.click();
        return;
      }
    }

    const section = findBuildExecutorStatusSection();
    if (!section) return;

    if (isSectionCollapsed(section.toggle, section.content)) {
      section.toggle.click();
      const details = section.toggle.closest('details');
      if (details && !details.open) {
        details.open = true;
      }
    }
  }

  function getBreadcrumbDropdownToggles() {
    return Array.from(document.querySelectorAll('#breadcrumbs li.children, .jenkins-breadcrumbs li.children'))
      .slice(0, 2)
      .map((element) => element.querySelector('a, button, [role="button"]') || element)
      .filter(Boolean);
  }

  function findVisibleBreadcrumbMenu() {
    const menuSelectors = [
      '.yuimenu',
      '.yui-module',
      '.tippy-box',
      '.jenkins-dropdown',
      '[role="menu"]'
    ];

    return Array.from(document.querySelectorAll(menuSelectors.join(', '))).find((element) => {
      if (!isElementVisible(element)) return false;
      if (element.id === 'jenkins-url-menu' || element.closest('#jenkins-url-menu')) return false;
      return true;
    }) || null;
  }

  function triggerBreadcrumbToggle(toggle) {
    if (!toggle) return false;

    ['mousedown', 'mouseup', 'click'].forEach((eventName) => {
      toggle.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    });

    if (typeof toggle.click === 'function') {
      toggle.click();
    }

    return true;
  }

  function toggleBreadcrumbDropdown() {
    const toggles = getBreadcrumbDropdownToggles();
    if (toggles.length === 0) return false;

    const targetIndex = breadcrumbToggleIndex % toggles.length;
    const openMenu = findVisibleBreadcrumbMenu();
    if (openMenu) {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    const triggered = triggerBreadcrumbToggle(toggles[targetIndex]);
    if (triggered) {
      breadcrumbToggleIndex = (targetIndex + 1) % toggles.length;
    }

    return triggered;
  }

  function getJenkinsUrlParts(url = window.location.href) {
    const normalizedUrl = normalizeUrlProtocolForCurrentPage(url);
    const buildMatch = normalizedUrl.match(BUILD_BASE_URL_PATTERN);
    const jobMatch = normalizedUrl.match(JOB_BASE_URL_PATTERN);
    const nodeMatch = normalizedUrl.match(NODE_BASE_URL_PATTERN);

    return {
      jobBaseUrl: jobMatch ? jobMatch[1].replace(/\/$/, '') : null,
      buildBaseUrl: buildMatch ? buildMatch[1].replace(/\/$/, '') : null,
      nodeBaseUrl: nodeMatch ? nodeMatch[1].replace(/\/$/, '') : null
    };
  }

  function getJobBaseUrl(url = window.location.href) {
    return getJenkinsUrlParts(url).jobBaseUrl;
  }

  function getBuildBaseUrl(url = window.location.href) {
    return getJenkinsUrlParts(url).buildBaseUrl;
  }

  function getNodeBaseUrl(url = window.location.href) {
    return getJenkinsUrlParts(url).nodeBaseUrl;
  }

  async function getLastBuildInfo(url = window.location.href) {
    const jobBaseUrl = normalizeUrlProtocolForCurrentPage(getJobBaseUrl(url));
    console.log('getLastBuildInfo - input URL:', url);
    console.log('getLastBuildInfo - extracted jobBaseUrl:', jobBaseUrl);
    if (!jobBaseUrl) return null;

    try {
      const apiUrl = normalizeUrlProtocolForCurrentPage(`${jobBaseUrl}/api/json?tree=lastBuild[number,url]`);
      console.log('getLastBuildInfo - fetching:', apiUrl);
      const response = await fetch(apiUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load last build info: ${response.status}`);

      const data = await response.json();
      const buildNumber = Number(data?.lastBuild?.number);
      if (!buildNumber) return null;

      const buildBaseUrl = normalizeUrlProtocolForCurrentPage(
        String(data?.lastBuild?.url || `${jobBaseUrl}/${buildNumber}`).replace(/\/$/, '')
      );
      
      // Fetch builtOn info from the build's detailed API (same as getBuildNodeUrl)
      let builtOn = null;
      let nodeUrl = null;
      const siteUrl = getJenkinsSiteUrl(buildBaseUrl) || jobBaseUrl;
      console.log('getLastBuildInfo - siteUrl:', siteUrl);
      
      try {
        const buildApiUrl = normalizeUrlProtocolForCurrentPage(`${buildBaseUrl}/api/json?tree=builtOn,builtOnStr`);
        console.log('getLastBuildInfo - fetching build details:', buildApiUrl);
        const buildResponse = await fetch(buildApiUrl, { credentials: 'include' });
        if (buildResponse.ok) {
          const buildData = await buildResponse.json();
          builtOn = buildData?.builtOn || buildData?.builtOnStr || null;
          console.log('Build node info - builtOn:', builtOn);
          if (builtOn) {
            console.log('Site URL:', siteUrl);
            nodeUrl = getNodeUrlFromName(builtOn, siteUrl);
            console.log('Node URL:', nodeUrl);
          } else {
            console.log('No builtOn field in build data:', buildData);
          }
        } else {
          console.log('Failed to fetch build details, status:', buildResponse.status);
        }
      } catch (buildError) {
        console.log('Failed to fetch build node info:', buildError);
      }
      
      return { jobBaseUrl, buildNumber, buildBaseUrl, builtOn, nodeUrl };
    } catch (error) {
      console.log('Failed to resolve last build info:', error);
      return null;
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getJenkinsSiteUrl(url = window.location.href) {
    const siteInfo = getMatchedSiteInfo(url);
    if (siteInfo?.siteUrl) return siteInfo.siteUrl;

    // Extract site URL by removing /view/ or /job/ paths
    const siteMatch = String(url).match(/^(https?:\/\/[^?#]+?)(?:\/(?:view|job|computer|build)\/.+)?$/i);
    if (siteMatch) {
      const potentialSite = siteMatch[1].replace(/\/$/, '');
      // If we found a view or job, extract everything before it
      const viewJobMatch = String(url).match(/^(https?:\/\/[^?#]+?)\/(?:view|job)\//i);
      if (viewJobMatch) {
        return viewJobMatch[1].replace(/\/$/, '');
      }
      return potentialSite;
    }

    const originMatch = String(url).match(/^(https?:\/\/[^\/]+(?:\/[^\/]+)?)/i);
    return originMatch ? originMatch[1].replace(/\/$/, '') : null;
  }

  function getNodeUrlFromName(nodeName, siteUrl) {
    const normalizedNodeName = String(nodeName || '').trim();
    if (!normalizedNodeName || !siteUrl) return null;

    const lowerNodeName = normalizedNodeName.toLowerCase();
    if (['built-in node', 'built in node', '(built-in)', 'master', '(master)'].includes(lowerNodeName)) {
      const builtInPath = lowerNodeName.includes('master') ? '(master)' : '(built-in)';
      return `${siteUrl}/computer/${encodeURIComponent(builtInPath)}/`;
    }

    return `${siteUrl}/computer/${encodeURIComponent(normalizedNodeName)}/`;
  }

  function getBuildInfoFromCurrentUrl(url = window.location.href) {
    const buildBaseUrl = getBuildBaseUrl(url);
    const buildNumber = getCurrentBuildNumber(url);
    const jobBaseUrl = getJobBaseUrl(url);

    if (!buildBaseUrl || !buildNumber || !jobBaseUrl) return null;

    return { buildBaseUrl, buildNumber, jobBaseUrl };
  }

  function navigateToJobConfigure() {
    const jobBaseUrl = getJobBaseUrl();
    if (!jobBaseUrl) return false;

    deactivateFMode();
    window.location.href = `${jobBaseUrl}/configure`;
    return true;
  }

  function navigateToNodeConfigure() {
    const nodeBaseUrl = getNodeBaseUrl();
    if (!nodeBaseUrl) return false;

    deactivateFMode();
    window.location.href = `${nodeBaseUrl}/configure`;
    return true;
  }

  function navigateToJobHistory() {
    const jobBaseUrl = getJobBaseUrl();
    if (!jobBaseUrl) return false;

    deactivateFMode();
    window.location.href = `${jobBaseUrl}/jobConfigHistory`;
    return true;
  }

  async function getTargetBuildBaseUrl(url = window.location.href) {
    const currentBuildInfo = getBuildInfoFromCurrentUrl(url);
    if (currentBuildInfo?.buildBaseUrl) return currentBuildInfo.buildBaseUrl;

    const lastBuildInfo = await getLastBuildInfo(url);
    return lastBuildInfo?.buildBaseUrl || null;
  }

  // Console toggle: console <-> consoleFull
  async function getConsoleToggleUrl(url = window.location.href) {
    const targetBuildBaseUrl = await getTargetBuildBaseUrl(url);
    if (!targetBuildBaseUrl) return null;

    const buildUrlPattern = escapeRegExp(targetBuildBaseUrl);

    // consoleFull -> console
    if (new RegExp(`^${buildUrlPattern}/consoleFull/?(?:[?#].*)?$`, 'i').test(url)) {
      return `${targetBuildBaseUrl}/console`;
    }

    // console -> consoleFull
    if (new RegExp(`^${buildUrlPattern}/console/?(?:[?#].*)?$`, 'i').test(url)) {
      return `${targetBuildBaseUrl}/consoleFull`;
    }

    // Default: go to console
    return `${targetBuildBaseUrl}/console`;
  }

  async function navigateToConsoleToggle() {
    const nodeBaseUrl = getNodeBaseUrl();
    if (nodeBaseUrl) {
      deactivateFMode();
      window.location.href = `${nodeBaseUrl}/log`;
      return true;
    }

    const targetUrl = await getConsoleToggleUrl();
    if (!targetUrl) return false;

    deactivateFMode();
    window.location.href = targetUrl;
    return true;
  }

  // Timestamps toggle: consoleText <-> timestamps
  async function getTimestampsToggleUrl(url = window.location.href) {
    const targetBuildBaseUrl = await getTargetBuildBaseUrl(url);
    if (!targetBuildBaseUrl) return null;

    const buildUrlPattern = escapeRegExp(targetBuildBaseUrl);

    // consoleText -> timestamps
    if (new RegExp(`^${buildUrlPattern}/consoleText/?(?:[?#].*)?$`, 'i').test(url)) {
      return `${targetBuildBaseUrl}${TIMESTAMPS_PATH}`;
    }

    // timestamps -> consoleText
    if (url.includes('timestamps')) {
      return `${targetBuildBaseUrl}/consoleText`;
    }

    // Default: go to timestamps
    return `${targetBuildBaseUrl}${TIMESTAMPS_PATH}`;
  }

  async function navigateToTimestampsToggle() {
    const nodeBaseUrl = getNodeBaseUrl();
    if (nodeBaseUrl) {
      deactivateFMode();
      window.location.href = `${nodeBaseUrl}/log`;
      return true;
    }

    const targetUrl = await getTimestampsToggleUrl();
    if (!targetUrl) return false;

    deactivateFMode();
    window.location.href = targetUrl;
    return true;
  }

  async function getTargetBuildInfo(url = window.location.href) {
    return getBuildInfoFromCurrentUrl(url) || await getLastBuildInfo(url);
  }

  async function getBuildNodeUrl(url = window.location.href) {
    const targetBuildInfo = await getTargetBuildInfo(url);
    if (!targetBuildInfo?.buildBaseUrl) return null;

    const buildUrl = `${targetBuildInfo.buildBaseUrl}/`;
    const siteUrl = getJenkinsSiteUrl(targetBuildInfo.buildBaseUrl) || targetBuildInfo.jobBaseUrl;

    try {
      const response = await fetch(`${targetBuildInfo.buildBaseUrl}/api/json?tree=builtOn,builtOnStr`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load build node info: ${response.status}`);

      const data = await response.json();
      const nodeUrl = getNodeUrlFromName(data?.builtOn || data?.builtOnStr, siteUrl);
      if (!nodeUrl) throw new Error('Build node is missing in API response');

      return nodeUrl;
    } catch (error) {
      console.log('Failed to resolve build node info from API, falling back to build page:', error);
    }

    try {
      const response = await fetch(buildUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load build page: ${response.status}`);

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodeLink = doc.querySelector('#builtOn a[href*="/computer/"], a[href*="/computer/"], a.model-link[href*="/computer/"]');
      const nodeUrl = resolveActionUrl(nodeLink, buildUrl);
      if (nodeUrl) return nodeUrl.replace(/#.*$/, '');

      const pageText = doc.body?.textContent || '';
      const builtOnMatch = pageText.match(/built\s+on\s+([^\n\r]+)/i);
      if (builtOnMatch?.[1]) return getNodeUrlFromName(builtOnMatch[1].trim(), siteUrl);

      return getNodeUrlFromName('built-in node', siteUrl);
    } catch (error) {
      console.log('Failed to resolve build node info from build page:', error);
      return null;
    }
  }

  async function navigateToBuildNode() {
    const nodeUrl = await getBuildNodeUrl();
    if (!nodeUrl) {
      showActionNotice('node not found');
      return true;
    }

    deactivateFMode();
    window.location.href = nodeUrl;
    return true;
  }

  function getCurrentBuildNumber(url = window.location.href) {
    const buildBaseUrl = getBuildBaseUrl(url);
    if (!buildBaseUrl) return null;

    const buildNumberMatch = buildBaseUrl.match(/\/(\d+)$/);
    return buildNumberMatch ? Number(buildNumberMatch[1]) : null;
  }

  function getBuildRelativeSuffix(url = window.location.href) {
    const buildBaseUrl = getBuildBaseUrl(url);
    if (!buildBaseUrl) return '';
    return url.slice(buildBaseUrl.length);
  }

  async function navigateToPreviousOrNextBuild(keyUpper) {
    // If on a job page (no build number), go to last build console
    if (hasJobUrl() && !hasBuildUrl()) {
      const lastBuildInfo = await getLastBuildInfo();
      if (!lastBuildInfo?.buildBaseUrl) return false;

      deactivateFMode();
      window.location.href = `${lastBuildInfo.buildBaseUrl}/console`;
      return true;
    }

    if (!hasBuildUrl()) return false;

    const jobBaseUrl = getJobBaseUrl();
    const currentBuildNumber = getCurrentBuildNumber();
    if (!jobBaseUrl || !currentBuildNumber) return false;

    if (keyUpper === 'N') {
      const lastBuildInfo = await getLastBuildInfo();
      if (lastBuildInfo?.buildNumber && currentBuildNumber >= lastBuildInfo.buildNumber) {
        showActionNotice('current is last build');
        return true;
      }
    }

    const nextBuildNumber = keyUpper === 'P' ? currentBuildNumber - 1 : currentBuildNumber + 1;
    if (nextBuildNumber <= 0) return false;

    const relativeSuffix = getBuildRelativeSuffix();
    deactivateFMode();
    window.location.href = `${jobBaseUrl}/${nextBuildNumber}${relativeSuffix}`;
    return true;
  }

  function getShortcutMenuContainer() {
    return document.getElementById('tasks') || document.querySelector('#side-panel .tasks') || document.getElementById('side-panel');
  }

  function findExistingMenuLink(action) {
    const definitions = {
      configure: {
        selector: '#side-panel a[href$="/configure"], .task a[href$="/configure"], #tasks a[href$="/configure"]',
        text: ['구성', 'Configure']
      },
      history: {
        selector: '#side-panel a[href*="jobConfigHistory"], .task a[href*="jobConfigHistory"], #tasks a[href*="jobConfigHistory"]',
        text: ['Job Config History', 'History']
      },
      console: {
        selector: '#side-panel a[href*="/console"], .task a[href*="/console"], .task a[href*="/consoleFull"]',
        text: ['Console Output', '콘솔 출력']
      }
    };

    const definition = definitions[action];
    if (!definition) return null;

    const directLink = document.querySelector(definition.selector);
    if (directLink) return directLink;

    const allLinks = document.querySelectorAll('#side-panel a, .task a, #tasks a');
    for (const link of allLinks) {
      const text = link.textContent.trim();
      if (definition.text.some(value => text.includes(value))) return link;
    }

    return null;
  }

  function removeSyntheticShortcutMenuItems() {
    document.querySelectorAll(SYNTHETIC_SHORTCUT_MENU_SELECTOR).forEach((element) => element.remove());
  }

  function ensureSyntheticShortcutMenuItems() {
    if (!getJobBaseUrl()) {
      removeSyntheticShortcutMenuItems();
      return [];
    }

    const container = getShortcutMenuContainer();
    if (!container) return [];

    const foundLinks = [];
    // Don't add Configure link on build pages (X key should navigate to job configure instead)
    const isBuildPage = hasBuildUrl();
    const configureLink = findExistingMenuLink('configure');
    if (configureLink && !isBuildPage) {
      foundLinks.push({ key: 'X', link: configureLink, text: ['Configure'] });
    }

    const historyLink = findExistingMenuLink('history');
    if (historyLink) {
      foundLinks.push({ key: 'H', link: historyLink, text: ['History'] });
    }

    const syntheticDefinitions = [
      {
        key: 'R',
        label: 'Retrigger > Retry > Rebuild',
        title: 'Press R to try retrigger, then retry, then rebuild',
        action: 'retry-chain',
        onClick: async () => navigateToCurrentOrLastBuildRetryOrRebuild()
      },
      {
        key: 'G/t',
        label: 'Page Down (chain)',
        title: 'Press F then G once, then keep pressing G to page down',
        action: 'page-down-chain',
        onClick: async () => {
          gShortcutChainActive = true;
          deactivateFMode();
          return handleGShortcutScroll();
        }
      },
      // Show Configure/History shortcut if on a build page
      ...(hasBuildUrl() ? [{
        key: 'X/H',
        label: 'Configure/History',
        title: 'Press X for configure and H for history',
        action: 'job-configure-history',
        onClick: async () => navigateToJobConfigure()
      }] : []),
      {
        key: 'P/N/O',
        label: 'Previous/Next/Node',
        title: 'Press P for previous, N for next, and O for node navigation',
        action: 'previous-next-node',
        onClick: async () => navigateToPreviousOrNextBuild('P')
      },
      // Show C/T shortcut if no console link is found but we are on a job page
      ...(!findExistingMenuLink('console') && hasJobUrl() ? [{
        key: 'C/T',
        label: 'Console / Timestamps',
        title: 'Press C for console toggle, T for timestamps toggle',
        action: 'console-toggle',
        onClick: async () => navigateToConsoleToggle()
      }] : [])
    ];

    const syntheticLinks = syntheticDefinitions.map((definition) => {
      const selector = `${SYNTHETIC_SHORTCUT_MENU_SELECTOR} a[data-jenkins-shortcut-action="${definition.action}"]`;
      let link = document.querySelector(selector);

      if (!link) {
        const wrapper = document.createElement('div');
        wrapper.className = 'task';
        wrapper.setAttribute('data-jenkins-synthetic-shortcut', definition.action);

        link = document.createElement('a');
        link.href = '#';
        link.textContent = definition.label;
        link.title = definition.title;
        link.setAttribute('data-jenkins-shortcut-action', definition.action);
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          await definition.onClick();
        });

        wrapper.appendChild(link);
        container.appendChild(wrapper);
      }

      return { key: definition.key, link, text: [definition.label] };
    });

    return foundLinks.concat(syntheticLinks);
  }

  function resolveActionUrl(link, baseUrl) {
    const href = link?.getAttribute('href');
    return href ? new URL(href, baseUrl).href : null;
  }

  function showActionNotice(message) {
    const existingNotice = document.getElementById('jenkins-action-notice');
    if (existingNotice) existingNotice.remove();

    if (actionNoticeTimer) {
      clearTimeout(actionNoticeTimer);
      actionNoticeTimer = null;
    }

    const notice = document.createElement('div');
    notice.id = 'jenkins-action-notice';
    notice.textContent = message;
    notice.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10001;
      padding: 12px 18px;
      background: rgba(20, 20, 20, 0.9);
      color: #fff;
      border-radius: 6px;
      font-size: 14px;
      font-family: Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      text-align: center;
      min-width: 180px;
    `;
    document.body.appendChild(notice);

    actionNoticeTimer = window.setTimeout(() => {
      notice.remove();
      actionNoticeTimer = null;
    }, 2000);
  }

  function getScrollBounds() {
    const docElement = document.documentElement;
    const body = document.body;
    const maxScrollY = Math.max(
      (docElement?.scrollHeight || 0) - window.innerHeight,
      (body?.scrollHeight || 0) - window.innerHeight,
      0
    );

    return { maxScrollY };
  }

  function moveToPageBoundary(target) {
    const { maxScrollY } = getScrollBounds();
    const top = target === 'bottom' ? maxScrollY : 0;

    // Jump directly to page boundary, equivalent to a full top/bottom navigation action.
    window.scrollTo({ top, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
  }

  function showScrollOverlay(direction, isLimitReached) {
    const existingOverlay = document.getElementById('jenkins-g-scroll-overlay');
    if (existingOverlay) existingOverlay.remove();

    if (scrollOverlayTimer) {
      clearTimeout(scrollOverlayTimer);
      scrollOverlayTimer = null;
    }

    const arrow = direction === 'up' ? '↑'
      : direction === 'down' ? '↓'
      : direction === 'left' ? '←'
      : '→';

    const overlay = document.createElement('div');
    overlay.id = 'jenkins-g-scroll-overlay';
    overlay.textContent = arrow;
    overlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10002;
      width: 68px;
      height: 68px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 42px;
      font-weight: bold;
      color: #ffffff;
      background: ${isLimitReached ? 'rgba(220, 53, 69, 0.92)' : 'rgba(40, 167, 69, 0.92)'};
      border: 2px solid ${isLimitReached ? '#ffb3be' : '#b8f0c8'};
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
      pointer-events: none;
      user-select: none;
    `;

    document.body.appendChild(overlay);

    scrollOverlayTimer = window.setTimeout(() => {
      overlay.remove();
      scrollOverlayTimer = null;
    }, 300);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function handleGShortcutScroll() {
    const { maxScrollY } = getScrollBounds();

    const previousY = window.scrollY;
    const pageDownAmount = Math.max(Math.floor(window.innerHeight * 0.92), 200);
    window.scrollBy(0, pageDownAmount);

    const currentY = window.scrollY;
    const reachedBottom = currentY >= maxScrollY - 2;
    const moved = currentY > previousY + 1;

    if (!reachedBottom && moved) {
      gBottomReachedCount = 0;
      bTopReachedCount = 0;
      showScrollOverlay('down', false);
      return true;
    }

    gBottomReachedCount += 1;

    if (gBottomReachedCount <= 2) {
      showScrollOverlay('down', true);
      return true;
    }

    moveToPageBoundary('top');
    gBottomReachedCount = 0;
    bTopReachedCount = 0;
    return true;
  }

  function handleBShortcutScroll() {
    const previousY = window.scrollY;
    const pageUpAmount = Math.max(Math.floor(window.innerHeight * 0.92), 200);
    window.scrollBy(0, -pageUpAmount);

    const currentY = window.scrollY;
    const reachedTop = currentY <= 1;
    const moved = currentY < previousY - 1;

    if (!reachedTop && moved) {
      bTopReachedCount = 0;
      gBottomReachedCount = 0;
      showScrollOverlay('up', false);
      return true;
    }

    bTopReachedCount += 1;

    if (bTopReachedCount <= 2) {
      showScrollOverlay('up', true);
      return true;
    }

    moveToPageBoundary('bottom');
    bTopReachedCount = 0;
    gBottomReachedCount = 0;
    return true;
  }

  function navigateWithNotice(url, message) {
    showActionNotice(message);
    deactivateFMode();
    window.setTimeout(() => {
      window.location.href = url;
    }, 1000);
    return true;
  }

  function getMatchedSiteInfo(url = window.location.href) {
    const sites = config?.sites || {};
    const normalizedUrl = url.replace(/^https?:\/\//i, '');

    for (const [siteName, siteUrl] of Object.entries(sites)) {
      const normalizedSiteUrl = String(siteUrl).replace(/^https?:\/\//i, '').replace(/\/$/, '');
      if (normalizedUrl.startsWith(normalizedSiteUrl)) {
        return {
          server: siteName,
          siteUrl: String(siteUrl).replace(/\/$/, '')
        };
      }
    }

    const originMatch = url.match(/^(https?:\/\/[^\/]+(?:\/[^\/]+)?)/i);
    if (originMatch) {
      const siteUrl = originMatch[1].replace(/\/$/, '');
      return {
        server: siteUrl.split('/').pop() || 'Jenkins',
        siteUrl
      };
    }

    return null;
  }

  function findShortcutLinkByConfig(shortcut) {
    let link = null;
    if (shortcut.selector) {
      link = document.querySelector(shortcut.selector);
    }

    if (!link) {
      const allLinks = document.querySelectorAll('#side-panel a, .task a, #tasks a');
      for (const a of allLinks) {
        const text = a.textContent.trim();
        if (shortcut.text.some(t => text.includes(t))) {
          link = a;
          break;
        }
      }
    }

    return link;
  }

  function activateLink(link) {
    if (!link) return false;

    if (link.onclick) {
      try {
        const result = link.onclick.call(link, new MouseEvent('click'));
        if (result === false) {
          deactivateFMode();
          return true;
        }
      } catch (e) {
        // Ignore onclick errors
      }
    }

    if (link.href && link.href !== '#' && link.href !== 'javascript:void(0)') {
      window.location.href = link.href;
    } else {
      link.click();
    }

    deactivateFMode();
    return true;
  }

  async function triggerNodeLabels() {
    if (!config) {
      try {
        const result = await chrome.storage.local.get(['userConfigText']);
        if (result.userConfigText) {
          config = JSON.parse(result.userConfigText);
        }
      } catch (error) {
        console.error('Failed to load config for Jenkins Labels:', error);
      }
    }

    const siteInfo = getMatchedSiteInfo();
    if (!siteInfo?.siteUrl) {
      console.log('Could not determine Jenkins site for Jenkins Labels');
      return false;
    }

    const labelPageUrl = chrome.runtime.getURL(
      `label_page.html?server=${encodeURIComponent(siteInfo.server)}&site=${encodeURIComponent(siteInfo.siteUrl)}`
    );

    deactivateFMode();

    try {
      await chrome.runtime.sendMessage({
        type: 'openLabelPage',
        url: labelPageUrl
      });
    } catch (error) {
      console.error('Failed to open Jenkins Labels page:', error);
    }

    return true;
  }

  async function navigateToCurrentOrLastBuildRetryOrRebuild() {
    const jobBaseUrl = getJobBaseUrl();
    if (!jobBaseUrl) return false;

    let buildBaseUrl;
    if (hasBuildUrl()) {
      buildBaseUrl = getBuildBaseUrl();
    } else {
      const lastBuildInfo = await getLastBuildInfo();
      if (!lastBuildInfo?.buildBaseUrl) return false;
      buildBaseUrl = lastBuildInfo.buildBaseUrl;
    }

    const buildUrl = `${buildBaseUrl}/`;
    const rebuildFallbackUrl = `${buildUrl}rebuild/parameterized`;

    try {
      const response = await fetch(buildUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load build page: ${response.status}`);

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const retriggerLink = doc.querySelector('#side-panel a[href*="retrigger"], .task a[href*="retrigger"], #tasks a[href*="retrigger"]');
      const retriggerUrl = resolveActionUrl(retriggerLink, buildUrl);
      if (retriggerUrl) return navigateWithNotice(retriggerUrl, 'Executed via Retrigger');

      const retryLink = doc.querySelector('#side-panel a[href*="retry"], .task a[href*="retry"], #tasks a[href*="retry"]');
      const retryUrl = resolveActionUrl(retryLink, buildUrl);
      if (retryUrl) return navigateWithNotice(retryUrl, 'Executed via Retry');
    } catch (error) {
      console.log('Failed to inspect build retry action, falling back to rebuild:', error);
    }

    return navigateWithNotice(rebuildFallbackUrl, 'Retrigger/Retry unavailable. Executed via Rebuild');
  }

  // ========== F-Mode Management ==========

  function activateFMode() {
    if (fModeActive) return;
    fModeActive = true;
    ensureNodeBuildExecutorStatusExpanded();
    showShortcuts();
    showUrlMenu();
    updateFButtonState();
  }

  function deactivateFMode() {
    if (!fModeActive) return;
    fModeActive = false;
    hideShortcuts();
    hideUrlMenu();
    updateFButtonState();
  }

  function toggleFMode() {
    if (fModeActive) {
      deactivateFMode();
    } else {
      activateFMode();
    }
  }

  function updateFButtonState() {
    const toggleButton = document.getElementById('jenkins-toggle-f-button');
    if (toggleButton) {
      toggleButton.style.background = fModeActive
        ? 'linear-gradient(to bottom, #e55050 0%, #c03030 100%)'
        : 'linear-gradient(to bottom, #4a90e2 0%, #357abd 100%)';
    }
  }

  // Navigate to menu by shortcut key
  async function navigateByShortcut(key) {
    if (!fModeActive) return false;

    const keyUpper = key.toUpperCase();

    // R key: Retrigger/Retry/Rebuild
    if (keyUpper === 'R' && hasJobUrl()) {
      return navigateToCurrentOrLastBuildRetryOrRebuild();
    }

    // X key: Configure (always job configure)
    if (keyUpper === 'X') {
      // On build pages, skip finding build's configure link and go directly to job configure
      if (hasBuildUrl() && hasJobUrl()) {
        return navigateToJobConfigure();
      }
      
      const match = findFirstMatchingShortcut('X');
      if (match?.link) return activateLink(match.link);
      if (hasJobUrl()) return navigateToJobConfigure();
      if (hasNodeUrl()) return navigateToNodeConfigure();
      return false;
    }

    // H key: History
    if (keyUpper === 'H') {
      const match = findFirstMatchingShortcut('H');
      if (match?.link) return activateLink(match.link);
      if (hasJobUrl()) return navigateToJobHistory();
      return false;
    }

    // C key: Console toggle (console -> consoleText -> consoleFull)
    if (keyUpper === 'C') {
      return navigateToConsoleToggle();
    }

    // T key: Timestamps toggle (consoleText <-> timestamps)
    if (keyUpper === 'T') {
      return navigateToTimestampsToggle();
    }

    // E key: Clone current tab
    if (keyUpper === 'E') {
      deactivateFMode();
      chrome.runtime.sendMessage({ type: 'cloneTab' }, (response) => {
        if (response?.ok) {
          console.log('Tab cloned successfully');
        } else {
          console.error('Failed to clone tab:', response?.error);
        }
      });
      return true;
    }

    // P/N key: Previous/Next build
    if (keyUpper === 'P' || keyUpper === 'N') {
      deactivateFMode();
      showScrollOverlay(keyUpper === 'P' ? 'left' : 'right', false);
      await delay(120);
      return navigateToPreviousOrNextBuild(keyUpper);
    }

    // O key: Navigate to build node
    if (keyUpper === 'O') {
      return navigateToBuildNode();
    }

    // Z key: z-report on job pages, labels on node pages
    if (keyUpper === 'Z') {
      if (hasNodeUrl()) {
        return await triggerNodeLabels();
      }
      if (hasJobUrl()) {
        await showStatisticsReport();
        return true;
      }
      return false;
    }

    // G key: Page Down chain shortcut
    if (keyUpper === 'G') {
      gShortcutChainActive = true;
      deactivateFMode();
      return handleGShortcutScroll();
    }

    // For all other keys, find first matching shortcut
    const match = findFirstMatchingShortcut(keyUpper);
    if (match) {
      if (match.link) {
        return activateLink(match.link);
      }
      // Synthetic shortcut with null selector was matched
      return false;
    }

    console.log(`No shortcut found for key: ${keyUpper}`);
    return false;
  }

  // ========== Shortcut Display ==========

  // Find menu links based on shortcut configuration
  function findMenuLinks() {
    const syntheticMenuLinks = ensureSyntheticShortcutMenuItems();
    const foundLinks = [];
    const usedKeys = new Set();
    const isBuildPage = hasBuildUrl();

    SHORTCUTS.forEach(shortcut => {
      const keyUpper = shortcut.key.toUpperCase();

      // On build pages, suppress X/E hint badges for menu rows like
      // "Edit Build Information" and "Environment Variables".
      if (isBuildPage && (keyUpper === 'X' || keyUpper === 'E')) return;

      // Skip if we already found a link for this key
      if (usedKeys.has(keyUpper)) return;

      let link = null;
      if (shortcut.selector) {
        link = document.querySelector(shortcut.selector);
      }

      if (!link) {
        const allLinks = document.querySelectorAll('#side-panel a, .task a, #tasks a');
        for (const a of allLinks) {
          const text = a.textContent.trim().toLowerCase();
          const foundByText = shortcut.text.some(t => text.includes(t.toLowerCase()));
          if (foundByText) {
            link = a;
            break;
          }
        }
      }

      if (link) {
        foundLinks.push({ key: shortcut.key, link: link, text: shortcut.text });
        usedKeys.add(keyUpper);
      }
    });

    syntheticMenuLinks.forEach((item) => {
      // Filter out X/E shortcuts on build pages, except for 'X/H' Configure/History synthetic menu
      const itemKey = item.key.toUpperCase();
      if (isBuildPage && itemKey !== 'X/H') {
        const itemKeyPrefix = itemKey.split('/')[0];
        if (itemKeyPrefix === 'X' || itemKeyPrefix === 'E') return;
      }
      
      if (!foundLinks.some(existingItem => existingItem.key === item.key)) {
        foundLinks.push(item);
      }
    });

    return foundLinks;
  }

  // Show keyboard shortcuts hints
  function showShortcuts() {
    const links = findMenuLinks();

    if (links.length === 0) return;

    // Show context action buttons
    const reportButton = document.getElementById('jenkins-report-button');
    if (reportButton) {
      reportButton.style.display = 'inline-block';
    }
    const labelButton = document.getElementById('jenkins-label-button');
    if (labelButton) {
      labelButton.style.display = 'inline-block';
    }

    // Add shortcut hints to each menu item
    links.forEach(item => {
      const link = item.link;

      if (link.querySelector && link.querySelector('.jenkins-shortcut-hint')) return;

      const hint = document.createElement('span');
      hint.className = 'jenkins-shortcut-hint';
      hint.textContent = item.key;
      hint.title = `Press ${item.key} to navigate`;

      let insertPosition = null;
      const iconElements = link.querySelectorAll('svg, img');
      if (iconElements.length > 0) {
        insertPosition = iconElements[iconElements.length - 1].nextSibling;
      } else {
        insertPosition = link.firstChild;
      }

      if (insertPosition) {
        link.insertBefore(hint, insertPosition);
      } else {
        link.appendChild(hint);
      }
    });
  }

  // Hide keyboard shortcuts hints
  function hideShortcuts() {
    const hints = document.querySelectorAll('.jenkins-shortcut-hint');
    hints.forEach(hint => {
      if (!hint.closest('#jenkins-url-menu') && !hint.closest('#jenkins-nav-buttons')) {
        hint.remove();
      }
    });

    // Hide context action buttons
    const reportButton = document.getElementById('jenkins-report-button');
    if (reportButton) {
      reportButton.style.display = 'none';
    }
    const labelButton = document.getElementById('jenkins-label-button');
    if (labelButton) {
      labelButton.style.display = 'none';
    }

    removeSyntheticShortcutMenuItems();
  }

  // ========== URL Menu ==========

  // Shorten URL for display
  function shortenUrl(url, maxWidth) {
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.style.fontSize = '14px';
    tempSpan.style.fontFamily = 'Arial, sans-serif';
    tempSpan.textContent = url;
    document.body.appendChild(tempSpan);

    const fullWidth = tempSpan.offsetWidth;
    document.body.removeChild(tempSpan);

    if (fullWidth <= maxWidth) return url;

    const viewJobMatch = url.match(/^(https?:\/\/)(.+?\/view\/[^\/]+)(\/job\/.*)$/);
    if (viewJobMatch) {
      const shortened1 = viewJobMatch[1] + '~~~' + viewJobMatch[3];
      tempSpan.textContent = shortened1;
      document.body.appendChild(tempSpan);
      const width1 = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);
      if (width1 <= maxWidth) return shortened1;
      
      // If still too long, extract just the job name from /job/...
      const jobnameMatch = viewJobMatch[3].match(/\/job\/([^\/]+)/);
      if (jobnameMatch) {
        const shortened3 = '~~~/' + jobnameMatch[1];
        tempSpan.textContent = shortened3;
        document.body.appendChild(tempSpan);
        const width3 = tempSpan.offsetWidth;
        document.body.removeChild(tempSpan);
        if (width3 <= maxWidth) return shortened3;
      }
      return shortened1;
    }

    const jobMatch = url.match(/^(https?:\/\/)(.+?)(\/job\/.*)$/);
    if (jobMatch) {
      const shortened2 = jobMatch[1] + '~~~' + jobMatch[3];
      tempSpan.textContent = shortened2;
      document.body.appendChild(tempSpan);
      const width2 = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);

      if (width2 <= maxWidth) return shortened2;

      const jobnameMatch = jobMatch[3].match(/\/job\/([^\/]+)/);
      if (jobnameMatch) {
        const shortened4 = '~~~/' + jobnameMatch[1];
        tempSpan.textContent = shortened4;
        document.body.appendChild(tempSpan);
        const width4 = tempSpan.offsetWidth;
        document.body.removeChild(tempSpan);
        if (width4 <= maxWidth) return shortened4;
      }
      return shortened2;
    }

    const fallbackMatch = url.match(/^(https?:\/\/)(.+?)(\/.+)$/);
    if (fallbackMatch) return fallbackMatch[1] + '~~~' + fallbackMatch[3];

    return url;
  }

  // Check if a URL is a real job (not a folder/view with jobs inside)
  async function isRealJob(url) {
    try {
      const jobBaseUrl = getJobBaseUrl(url);
      if (!jobBaseUrl) return false;
      
      const apiUrl = normalizeUrlProtocolForCurrentPage(`${jobBaseUrl}/api/json?tree=_class,views`);
      const response = await fetch(apiUrl, { credentials: 'include' });
      if (!response.ok) return false;
      
      const data = await response.json();
      // If views field exists and has items, it's a folder/view, not a job
      if (data?.views && Array.isArray(data.views)) {
        return false;
      }
      
      return true;
    } catch (error) {
      console.log('Failed to check if URL is real job:', url, error);
      // On error, assume it might be a job (don't filter out)
      return true;
    }
  }

  // Get top visited URLs from storage
  async function getTopVisitedUrls() {
    try {
      if (!chrome.runtime?.id) return { views: [], jobs: [], recentJobs: [] };

      const result = await chrome.storage.local.get(['urlHistory']);
      const urlHistory = result.urlHistory || {};

      const entries = Object.entries(urlHistory);
      const viewMap = new Map();
      const potentialJobsWithData = [];

      entries.forEach(([url, data]) => {
        const viewMatch = url.match(/(https?:\/\/.+?\/view\/[^\/]+\/)/);
        if (viewMatch) {
          const viewUrl = viewMatch[1];
          if (viewMap.has(viewUrl)) {
            const existing = viewMap.get(viewUrl);
            viewMap.set(viewUrl, {
              count: existing.count + data.count,
              lastVisit: Math.max(existing.lastVisit, data.lastVisit)
            });
          } else {
            viewMap.set(viewUrl, { count: data.count, lastVisit: data.lastVisit });
          }
        }

        // Check if URL is a job (including multi-level jobs like /job/folder/job/name)
        // Use getJobBaseUrl which supports multi-level jobs via JOB_BASE_URL_PATTERN
        const jobBaseUrl = getJobBaseUrl(url);
        if (jobBaseUrl) {
          // Verify it's a job URL by checking if normalized URL ends with the job pattern
          const normalizedUrl = url.replace(/\/$/, '') + '/';
          const jobPattern = jobBaseUrl.replace(/\/$/, '') + '/';
          if (normalizedUrl === jobPattern || normalizedUrl.startsWith(jobPattern)) {
            potentialJobsWithData.push({ url, count: data.count, lastVisit: data.lastVisit });
          }
        }
      });

      // Filter out folders/views that look like jobs by checking API
      const jobsWithData = [];
      for (const item of potentialJobsWithData) {
        if (await isRealJob(item.url)) {
          jobsWithData.push(item);
        } else {
          console.log('Filtered out folder/view from jobs:', item.url);
        }
      }

      const views = Array.from(viewMap.entries())
        .map(([url, data]) => ({ url, count: data.count }))
        .sort((a, b) => a.count - b.count)
        .slice(-4);

      // Frequent Jobs: Top 5 by visit count
      const topJobs = [...jobsWithData]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const topJobUrls = new Set(topJobs.map(j => normalizeComparableUrl(j.url)));

      // Recent Jobs: Most recent 5 by lastVisit (exclude duplicates from frequent jobs)
      const recentJobsCandidates = [...jobsWithData]
        .filter(j => !topJobUrls.has(normalizeComparableUrl(j.url)))
        .sort((a, b) => b.lastVisit - a.lastVisit)
        .slice(0, 5);

      // If not enough recent jobs (less than 5), fill with frequent jobs by recent visit
      const recentJobs = recentJobsCandidates.length >= 5 
        ? recentJobsCandidates
        : [
            ...recentJobsCandidates,
            ...topJobs
              .filter(j => !recentJobsCandidates.some(r => normalizeComparableUrl(r.url) === normalizeComparableUrl(j.url)))
              .sort((a, b) => b.lastVisit - a.lastVisit)
          ].slice(0, 5);

      console.log('Frequent Jobs (by count):', topJobs);
      console.log('Recent Jobs (by lastVisit):', recentJobs);

      return {
        views,
        jobs: topJobs.reverse(),
        recentJobs: recentJobs.reverse()
      };
    } catch (error) {
      console.error('Failed to get URL history:', error);
      return { views: [], jobs: [], recentJobs: [] };
    }
  }

  // Show URL menu
  async function showUrlMenu() {
    if (urlMenuVisible) return;

    if (!chrome.runtime?.id) {
      alert('Extension was reloaded. Please refresh this page (F5) to use the URL menu.');
      return;
    }

    const topUrls = await getTopVisitedUrls();

    if (topUrls.views.length === 0 && topUrls.jobs.length === 0 && topUrls.recentJobs.length === 0) {
      console.log('No URL history available');
      return;
    }

    urlMenuVisible = true;

    const menu = document.createElement('div');
    menu.id = 'jenkins-url-menu';
    menu.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 40%;
      max-height: 100%;
      background: rgba(211, 211, 211, 0.6);
      color: #00008B;
      z-index: 10000;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
      font-family: Arial, sans-serif;
    `;

    let content = '<h2 style="margin-top: 0; color: #000; font-size: 15px;">Recent Views</h2>';

    if (topUrls.views.length > 0) {
      content += '<div style="margin-bottom: 30px;">';
      topUrls.views.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item view-item" data-url="${item.url}" data-bg="rgba(128, 128, 0, 0.6)" data-hover="rgba(107, 142, 35, 0.8)" style="
            padding: 10px;
            margin: 8px 0;
            background: rgba(128, 128, 0, 0.6);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #fff;
          ">
            <div style="font-size: 14px;">${displayUrl}</div>
          </div>
        `;
      });
      content += '</div>';
    }

    content += '<h2 style="color: #000; font-size: 15px;">Frequent Jobs</h2>';

    if (topUrls.jobs.length > 0) {
      content += '<div>';
      topUrls.jobs.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item job-item frequent-job-item" data-url="${item.url}" data-bg="rgba(0, 139, 139, 0.6)" data-hover="rgba(0, 111, 111, 0.8)" style="
            padding: 10px 83px 10px 10px;
            margin: 8px 0;
            background: rgba(0, 139, 139, 0.6);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #fff;
            position: relative;
          ">
            <div style="font-size: 14px; position: relative; z-index: 2;">${displayUrl}</div>
            <div style="position: absolute; right: 41px; top: 50%; transform: translateY(-50%); z-index: 3; width: 26px; height: 20px; line-height: 20px; text-align: center; border: 1px solid #000; border-radius: 2px; background: #fff; color: #000; font-size: 12px; font-weight: bold; font-family: Arial, sans-serif;">⚙</div>
            <div style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 3; width: 26px; height: 20px; line-height: 20px; text-align: center; border: 1px solid #000; border-radius: 2px; background: #fff; color: #000; font-size: 13px; font-weight: bold; font-family: 'Courier New', monospace;">&gt;_</div>
          </div>
        `;
      });
      content += '</div>';
    }

    if (topUrls.recentJobs.length > 0) {
      content += '<h2 style="color: #000; font-size: 15px; margin-top: 18px;">Recent Jobs</h2>';
      content += '<div>';
      topUrls.recentJobs.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item job-item recent-job-item" data-url="${item.url}" data-bg="rgba(70, 130, 180, 0.6)" data-hover="rgba(60, 111, 153, 0.8)" style="
            padding: 10px 83px 10px 10px;
            margin: 8px 0;
            background: rgba(70, 130, 180, 0.6);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #fff;
            position: relative;
          ">
            <div style="font-size: 14px; position: relative; z-index: 2;">${displayUrl}</div>
            <div style="position: absolute; right: 41px; top: 50%; transform: translateY(-50%); z-index: 3; width: 26px; height: 20px; line-height: 20px; text-align: center; border: 1px solid #000; border-radius: 2px; background: #fff; color: #000; font-size: 12px; font-weight: bold; font-family: Arial, sans-serif;">⚙</div>
            <div style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 3; width: 26px; height: 20px; line-height: 20px; text-align: center; border: 1px solid #000; border-radius: 2px; background: #fff; color: #000; font-size: 13px; font-weight: bold; font-family: 'Courier New', monospace;">&gt;_</div>
          </div>
        `;
      });
      content += '</div>';
    }

    menu.innerHTML = content;

    // Add click handlers for view items
    menu.querySelectorAll('.view-item').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.background = e.currentTarget.getAttribute('data-hover') || 'rgba(107, 142, 35, 0.8)';
      });
      item.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.background = e.currentTarget.getAttribute('data-bg') || 'rgba(128, 128, 0, 0.6)';
      });
      item.addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        if (url) {
          window.location.href = url;
          hideUrlMenu();
        }
      });
    });

    // Add click handlers for job items (icon click: specific action, other area: job URL)
    menu.querySelectorAll('.job-item').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.background = e.currentTarget.getAttribute('data-hover') || 'rgba(0, 111, 111, 0.8)';
      });
      item.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.background = e.currentTarget.getAttribute('data-bg') || 'rgba(0, 139, 139, 0.6)';
      });
      item.addEventListener('click', async (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        if (url) {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const elementWidth = rect.width;

          let targetUrl = url;

          // Console icon area: right: 10px, width: 26px → click area: elementWidth - 36 or more
          if (clickX > elementWidth - 36) {
            const lastBuildInfo = await getLastBuildInfo(url);
            if (!lastBuildInfo?.buildBaseUrl) return;
            targetUrl = `${lastBuildInfo.buildBaseUrl}/console`;
          }
          // Node icon area: right: 41px, width: 26px → click area: elementWidth - 67 to elementWidth - 36
          else if (clickX > elementWidth - 67 && clickX <= elementWidth - 36) {
            console.log('Node icon clicked, fetching build info for URL:', url);
            const lastBuildInfo = await getLastBuildInfo(url);
            console.log('Last build info:', lastBuildInfo);
            
            if (!lastBuildInfo || !lastBuildInfo.buildBaseUrl) {
              console.error('Could not fetch build information');
              showActionNotice('Cannot find node');
              // Still try to navigate to job URL as fallback
              targetUrl = url;
            } else {
              // Check if we have valid node information
              const hasValidNode = lastBuildInfo.builtOn && 
                                   lastBuildInfo.builtOn.toLowerCase() !== 'built-in node' &&
                                   lastBuildInfo.builtOn.toLowerCase() !== '(built-in)' &&
                                   lastBuildInfo.builtOn.toLowerCase() !== 'master' &&
                                   lastBuildInfo.builtOn.toLowerCase() !== '(master)';
              
              if (hasValidNode && lastBuildInfo.nodeUrl) {
                // Valid node found, navigate to node
                targetUrl = lastBuildInfo.nodeUrl;
              } else {
                // No valid node info, fallback to console
                console.log('No valid node info, fallback to console');
                showActionNotice('Cannot find node');
                targetUrl = `${lastBuildInfo.buildBaseUrl}/console`;
              }
            }
          }
          // All other area: job URL (default)

          window.location.href = targetUrl;
          hideUrlMenu();
        }
      });
    });

    document.body.appendChild(menu);
  }

  // Hide URL menu
  function hideUrlMenu() {
    if (!urlMenuVisible) return;

    const menu = document.getElementById('jenkins-url-menu');
    if (menu) menu.remove();

    urlMenuVisible = false;
  }

  // ========== Statistics Report ==========

  async function showStatisticsReport() {
    try {
      const jobBaseUrl = getJobBaseUrl();

      if (!jobBaseUrl) {
        alert('Cannot determine job URL. Please navigate to a Jenkins job page.');
        return;
      }

      const apiUrl = jobBaseUrl + '/api/json?tree=fullDisplayName,url,buildable,queueItem,allBuilds[number,building,timestamp,duration,result,url,displayName,description]';

      const response = await fetch(apiUrl);

      if (!response.ok) throw new Error(`Failed to fetch data: ${response.status}`);

      const data = await response.json();

      const reportWindow = window.open('', '_blank');

      if (!reportWindow) {
        alert('Please allow popups to view the statistics report.');
        return;
      }

      const html = generateStatisticsReportHtml(data, jobBaseUrl);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      reportWindow.location.href = url;

    } catch (error) {
      console.error('Failed to generate statistics report:', error);
      alert(`Failed to generate statistics report: ${error.message}`);
    }
  }

  function generateStatisticsReportHtml(data, jobBaseUrl) {
    const allBuilds = data.allBuilds || [];

    const totalBuilds = allBuilds.length;
    const successBuilds = allBuilds.filter(b => b.result === 'SUCCESS').length;
    const failureBuilds = allBuilds.filter(b => b.result === 'FAILURE').length;
    const abortedBuilds = allBuilds.filter(b => b.result === 'ABORTED').length;

    const successRate = totalBuilds > 0 ? ((successBuilds / totalBuilds) * 100).toFixed(2) : '0.00';
    const failureRate = totalBuilds > 0 ? ((failureBuilds / totalBuilds) * 100).toFixed(2) : '0.00';
    const abortRate = totalBuilds > 0 ? ((abortedBuilds / totalBuilds) * 100).toFixed(2) : '0.00';

    const buildNumbers = allBuilds.map(b => b.number).filter(n => n);
    const minBuild = buildNumbers.length > 0 ? Math.min(...buildNumbers) : 0;
    const maxBuild = buildNumbers.length > 0 ? Math.max(...buildNumbers) : 0;
    const buildRange = `${minBuild}~${maxBuild} (${totalBuilds})`;

    const successfulDurations = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 0)
      .map(b => b.duration);

    const avgDuration = successfulDurations.length > 0
      ? successfulDurations.reduce((a, b) => a + b, 0) / successfulDurations.length
      : 0;

    const under20min = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 0 && b.duration <= 1200000)
      .map(b => b.duration);
    const avgUnder20 = under20min.length > 0
      ? under20min.reduce((a, b) => a + b, 0) / under20min.length
      : 0;

    const between20minAnd3h = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 1200000 && b.duration <= 10800000)
      .map(b => b.duration);
    const avgBetween = between20minAnd3h.length > 0
      ? between20minAnd3h.reduce((a, b) => a + b, 0) / between20minAnd3h.length
      : 0;

    const over3h = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 10800000)
      .map(b => b.duration);
    const avgOver3h = over3h.length > 0
      ? over3h.reduce((a, b) => a + b, 0) / over3h.length
      : 0;

    const formatDuration = (ms) => {
      if (!ms || ms === 0) return '-';
      const seconds = Math.floor(ms / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const formatTimestamp = (ts) => {
      if (!ts) return '-';
      const date = new Date(ts);
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    };

    const getResultColor = (result) => {
      switch (result) {
        case 'SUCCESS': return '#4CAF50';
        case 'FAILURE': return '#f44336';
        case 'ABORTED': return '#9E9E9E';
        case 'UNSTABLE': return '#FF9800';
        default: return '#2196F3';
      }
    };

    const tableRows = allBuilds.map(build => {
      const buildUrl = build.url || `${jobBaseUrl}/${build.number}`;
      const timestampUrl = `${buildUrl}/timestamps/?time=HH:mm:ss&timeZone=GMT+9&appendLog&locale=en`;
      const resultColor = getResultColor(build.result);
      const isBuilding = build.building ? ' class="building-blink"' : '';

      return `
        <tr>
          <td style="text-align: center;"${isBuilding}><a href="${buildUrl}" target="_blank" style="color: #1976D2; text-decoration: none;">#${build.number}</a></td>
          <td style="text-align: center;">
            <span style="color: white; background-color: ${resultColor}; padding: 4px 8px; border-radius: 3px; text-decoration: none; display: inline-block;">
              ${build.result || 'RUNNING'}
            </span>
          </td>
          <td style="text-align: center;"><a href="${timestampUrl}" target="_blank" style="color: #1976D2; text-decoration: none;">${formatTimestamp(build.timestamp)}</a></td>
          <td style="text-align: center;">${formatDuration(build.duration)}</td>
          <td>${build.displayName || '-'}</td>
          <td style="font-size: 12px;">${build.description || '-'}</td>
        </tr>
      `;
    }).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Z-report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
    .header { background-color: #1976D2; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px 0; font-size: 24px; }
    .header-info { font-size: 14px; margin: 5px 0; }
    .stats-container { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: nowrap; overflow-x: auto; }
    .stat-card { flex: 1; min-width: 140px; background-color: white; padding: 12px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-card h3 { margin: 0 0 8px 0; font-size: 12px; color: #666; white-space: nowrap; }
    .stat-card .value { font-size: 24px; font-weight: bold; color: #1976D2; }
    .stat-card .sub-text { font-size: 11px; color: #666; margin-top: 4px; }
    .table-container { background-color: white; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { background-color: #1976D2; color: white; padding: 12px; text-align: left; font-weight: bold; position: sticky; top: 0; cursor: pointer; user-select: none; }
    th:hover { background-color: #1565C0; }
    td { padding: 10px; border-bottom: 1px solid #ddd; }
    tr:hover { background-color: #f5f5f5; }
    @keyframes blink { 0%, 50%, 100% { opacity: 1; } 25%, 75% { opacity: 0.3; } }
    .building-blink { animation: blink 2s infinite; }
    .delete-container { display: flex; align-items: center; gap: 8px; margin-left: auto; }
    .delete-container input { width: 70px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 3px; font-size: 14px; text-align: center; }
    .delete-container input[type=number]::-webkit-inner-spin-button,
    .delete-container input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .delete-container input[type=number] { -moz-appearance: textfield; }
    .delete-container button { background-color: #f44336; color: white; border: none; padding: 6px 16px; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold; }
    .delete-container button:hover { background-color: #d32f2f; }
    .delete-container button:disabled { background-color: #ccc; cursor: not-allowed; }
    #deleteStatus { font-size: 12px; color: #666; margin-left: 5px; }
    .table-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }
    .table-header h2 { margin: 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Build Statistics Report</h1>
    <div class="header-info"><strong>Job:</strong> ${data.fullDisplayName || 'N/A'}</div>
    <div class="header-info"><strong>URL:</strong> <a href="${data.url || jobBaseUrl}" target="_blank" style="color: white;">${data.url || jobBaseUrl}</a></div>
    <div class="header-info"><strong>Buildable:</strong> ${data.buildable !== undefined ? (data.buildable ? 'Yes' : 'No') : 'N/A'}</div>
    <div class="header-info"><strong>Build Range:</strong> ${buildRange}</div>
  </div>

  <div class="stats-container">
    <div class="stat-card"><h3>Success Rate</h3><div class="value">${successRate}%</div><div class="sub-text">${successBuilds} / ${totalBuilds}</div></div>
    <div class="stat-card"><h3>Failure Rate</h3><div class="value">${failureRate}%</div><div class="sub-text">${failureBuilds} / ${totalBuilds}</div></div>
    <div class="stat-card"><h3>Abort Rate</h3><div class="value">${abortRate}%</div><div class="sub-text">${abortedBuilds} / ${totalBuilds}</div></div>
    <div class="stat-card"><h3>Avg (Success)</h3><div class="value" style="font-size: 18px;">${formatDuration(avgDuration)}</div><div class="sub-text">${successfulDurations.length} builds</div></div>
    <div class="stat-card"><h3>Avg (≤20min)</h3><div class="value" style="font-size: 18px;">${formatDuration(avgUnder20)}</div><div class="sub-text">${under20min.length} builds</div></div>
    <div class="stat-card"><h3>Avg (20m~3h)</h3><div class="value" style="font-size: 18px;">${formatDuration(avgBetween)}</div><div class="sub-text">${between20minAnd3h.length} builds</div></div>
    <div class="stat-card"><h3>Avg (≥3h)</h3><div class="value" style="font-size: 18px;">${formatDuration(avgOver3h)}</div><div class="sub-text">${over3h.length} builds</div></div>
  </div>

  <div class="table-container">
    <div class="table-header">
      <h2>All Builds (${totalBuilds})</h2>
      <div class="delete-container">
        <span style="font-weight: bold; font-size: 14px;">Delete build</span>
        <input type="number" id="deleteStartBuild" value="${minBuild}" min="1" />
        <span>~</span>
        <input type="number" id="deleteEndBuild" value="${maxBuild}" min="1" />
        <button id="deleteBuildBtn" onclick="deleteBuildsInRange()">Delete</button>
        <span id="deleteStatus"></span>
      </div>
    </div>
    <table id="buildsTable">
      <thead>
        <tr>
          <th style="text-align: center;" data-column="0">Number ▼</th>
          <th style="text-align: center;" data-column="1">Result ▼</th>
          <th style="text-align: center;" data-column="2">Timestamp ▼</th>
          <th style="text-align: center;" data-column="3">Duration ▼</th>
          <th data-column="4">Display Name ▼</th>
          <th data-column="5">Description ▼</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <div style="margin-top: 20px; text-align: center; color: #666; font-size: 12px;">
    Generated at ${new Date().toLocaleString('ko-KR')}
  </div>

  <script>
    document.title = 'Z-report';

    const JOB_BASE_URL = '${jobBaseUrl}';
    let sortDirections = [1, 1, 1, 1, 1, 1];

    async function deleteBuildsInRange() {
      const startBuild = parseInt(document.getElementById('deleteStartBuild').value);
      const endBuild = parseInt(document.getElementById('deleteEndBuild').value);
      const statusEl = document.getElementById('deleteStatus');
      const deleteBtn = document.getElementById('deleteBuildBtn');

      if (isNaN(startBuild) || isNaN(endBuild)) { alert('Please enter valid build numbers'); return; }
      if (startBuild > endBuild) { alert('Start build number must be less than or equal to end build number'); return; }
      if (!window.opener) { alert('Cannot communicate with parent window. Please open z-report from Jenkins page.'); return; }

      const count = endBuild - startBuild + 1;
      if (!confirm(\`Are you sure you want to delete \${count} builds from #\${startBuild} to #\${endBuild}?\\nAfter deleting this, you have to renew the report manually to refresh.\`)) return;

      deleteBtn.disabled = true;
      statusEl.textContent = 'Preparing...';
      statusEl.style.color = '#666';

      let successCount = 0;
      let failCount = 0;
      let errors = [];

      for (let buildNum = startBuild; buildNum <= endBuild; buildNum++) {
        const deleteUrl = \`\${JOB_BASE_URL}/\${buildNum}/doDelete\`;
        statusEl.textContent = \`Deleting #\${buildNum} (\${buildNum - startBuild + 1}/\${count})...\`;

        try {
          const result = await new Promise((resolve, reject) => {
            const messageId = 'delete_' + Date.now() + '_' + Math.random();
            const messageHandler = (event) => {
              if (event.data && event.data.type === 'deleteResponse' && event.data.messageId === messageId) {
                window.removeEventListener('message', messageHandler);
                resolve(event.data);
              }
            };
            window.addEventListener('message', messageHandler);
            window.opener.postMessage({ type: 'deleteRequest', messageId: messageId, deleteUrl: deleteUrl }, '*');
            setTimeout(() => { window.removeEventListener('message', messageHandler); reject(new Error('Timeout')); }, 15000);
          });

          if (result.success) { successCount++; }
          else { failCount++; errors.push(\`#\${buildNum}: \${result.error || 'Unknown error'}\`); }
        } catch (error) {
          failCount++;
          errors.push(\`#\${buildNum}: \${error.message}\`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      deleteBtn.disabled = false;
      statusEl.textContent = \`Done: \${successCount} deleted, \${failCount} failed\`;
      statusEl.style.color = failCount > 0 ? '#f44336' : '#4CAF50';

      if (failCount === count) alert('All deletions failed. Check console for details.');
    }

    function sortTable(columnIndex) {
      const table = document.getElementById('buildsTable');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));

      sortDirections[columnIndex] *= -1;
      const direction = sortDirections[columnIndex];

      rows.sort((a, b) => {
        let aValue = a.cells[columnIndex].textContent.trim();
        let bValue = b.cells[columnIndex].textContent.trim();

        if (columnIndex === 0) {
          aValue = parseInt(aValue.replace('#', '')) || 0;
          bValue = parseInt(bValue.replace('#', '')) || 0;
          return direction * (aValue - bValue);
        }
        if (columnIndex === 3) {
          const aSeconds = timeToSeconds(aValue);
          const bSeconds = timeToSeconds(bValue);
          return direction * (aSeconds - bSeconds);
        }
        if (columnIndex === 2) {
          const aDate = new Date(aValue).getTime() || 0;
          const bDate = new Date(bValue).getTime() || 0;
          return direction * (aDate - bDate);
        }
        return direction * aValue.localeCompare(bValue);
      });

      tbody.innerHTML = '';
      rows.forEach(row => tbody.appendChild(row));

      const headers = table.querySelectorAll('th');
      headers.forEach((th, idx) => {
        const text = th.textContent.replace(' ▼', '').replace(' ▲', '');
        if (idx === columnIndex) {
          th.textContent = text + (direction === 1 ? ' ▲' : ' ▼');
        } else {
          th.textContent = text + ' ▼';
        }
      });
    }

    function timeToSeconds(timeStr) {
      if (timeStr === '-') return 0;
      const parts = timeStr.split(':');
      if (parts.length !== 3) return 0;
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }

    document.addEventListener('DOMContentLoaded', function() {
      const headers = document.querySelectorAll('#buildsTable th');
      headers.forEach((th, index) => {
        th.addEventListener('click', function() { sortTable(index); });
      });
    });
  </script>
</body>
</html>
    `;
  }

  // ========== Help Modal ==========
  // Help modal data is defined in help.js

  function showHelpModal() {
    // Remove existing modal if any
    const existingModal = document.getElementById('jenkins-help-modal');
    if (existingModal) {
      existingModal.remove();
      return; // Toggle off
    }

    const modal = document.createElement('div');
    modal.id = 'jenkins-help-modal';
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 255, 255, 0.97);
      color: #333;
      padding: 30px;
      border-radius: 12px;
      z-index: 100000;
      width: 1000px;
      height: 600px;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-family: Arial, sans-serif;
      user-select: none;
      border: 1px solid #ddd;
    `;

    // Generate HTML from JSON data
    let helpContent = `
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0 0 10px 0; color: #2E7D32;">${HELP_MODAL_DATA.title}</h2>
        <p style="margin: 0; color: #666; font-size: 14px;">${HELP_MODAL_DATA.subtitle}</p>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1.8fr 1fr; gap: 25px;">
    `;

    // Generate columns
    HELP_MODAL_DATA.columns.forEach(column => {
      helpContent += '<div>';
      
      // Generate sections in this column
      column.sections.forEach(section => {
        helpContent += `
          <div style="margin-bottom: 18px;">
            <h3 style="color: #2E7D32; border-bottom: 2px solid #4CAF50; padding-bottom: 5px; margin-bottom: 10px; font-size: 15px;">${section.title}</h3>
            <table style="width: 100%; border-collapse: collapse;">
        `;
        
        // Generate shortcuts in this section
        section.shortcuts.forEach(shortcut => {
          helpContent += `
              <tr>
                <td style="padding: 5px 0;">
                  <kbd style="background: #e8f5e9; color: #2E7D32; padding: 2px 7px; border-radius: 3px; font-family: monospace; border: 1px solid #4CAF50; font-weight: bold;">${shortcut.key}</kbd>
                </td>
                <td style="padding: 5px 8px; font-size: 13px; white-space: pre-line;">${shortcut.description}</td>
              </tr>
          `;
        });
        
        helpContent += `
            </table>
          </div>
        `;
      });
      
      helpContent += '</div>';
    });

    helpContent += `
      </div>

      <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #ccc;">
        <p style="margin: 0; color: #666; font-size: 13px;">${HELP_MODAL_DATA.footer}</p>
      </div>
    `;

    modal.innerHTML = helpContent;
    document.body.appendChild(modal);

    // Close on ESC or clicking outside
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    modal.addEventListener('mousedown', (e) => {
      isDragging = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    });

    modal.addEventListener('mousemove', (e) => {
      if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) {
        isDragging = true;
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal && !isDragging) {
        modal.remove();
        document.removeEventListener('keydown', closeModal);
      }
    });

    const closeModal = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        modal.remove();
        document.removeEventListener('keydown', closeModal);
      }
    };
    
    document.addEventListener('keydown', closeModal);
  }

  // ========== Download Config XML ==========

  async function downloadConfigXml() {
    try {
      const jobBaseUrl = getJobBaseUrl();

      if (!jobBaseUrl) {
        alert('현재 URL이 Job이나 Build URL이 아닙니다. Job 또는 Build 페이지에서 실행해주세요.');
        return;
      }

      const configUrl = jobBaseUrl + '/config.xml';
      
      const response = await fetch(configUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch config.xml: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();
      
      // Decode HTML entities in the XML text
      const decodedXml = decodeHtmlEntitiesInXml(xmlText);
      
      // Format XML with indentation
      const formattedXml = formatXml(decodedXml);

      // Extract job name from URL for filename
      const jobName = extractJobNameFromUrl(jobBaseUrl) || 'config';
      const filename = `${jobName}_config.xml`;

      // Create download blob
      const blob = new Blob([formattedXml], { type: 'application/xml' });
      const downloadUrl = URL.createObjectURL(blob);

      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(downloadUrl);

      console.log(`Successfully downloaded config.xml as ${filename}`);

    } catch (error) {
      console.error('Failed to download config.xml:', error);
      alert(`Config.xml 다운로드 실패: ${error.message}`);
    }
  }

  // Decode HTML entities in XML text while preserving XML structure
  function decodeHtmlEntitiesInXml(xmlText) {
    // Simple approach: decode entities using string replacement
    // This preserves ALL XML structure including tags, attributes, etc.
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&#39;': "'",
      '&#x27;': "'",
      '&#x2F;': '/'
    };
    
    let result = xmlText;
    
    // Replace HTML entities
    for (const [entity, char] of Object.entries(entities)) {
      result = result.split(entity).join(char);
    }
    
    // Decode numeric entities (&#123; and &#xAB;)
    result = result.replace(/&#(\d+);/g, (match, dec) => {
      return String.fromCharCode(parseInt(dec, 10));
    });
    
    result = result.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    
    return result;
  }

  // Format XML with proper indentation
  function formatXml(xml) {
    const PADDING = '  '; // 2 spaces for indentation
    const reg = /(>)(<)(\/*)/g;
    let formatted = '';
    let pad = 0;

    xml = xml.replace(reg, '$1\r\n$2$3');

    xml.split('\r\n').forEach((node) => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (node.match(/^<\/\w/)) {
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (node.match(/^<\w([^>]*[^\/])?>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }

      formatted += PADDING.repeat(pad) + node + '\r\n';
      pad += indent;
    });

    return formatted;
  }

  // ========== Input Detection ==========

  function isFocusInInput() {
    const activeElement = document.activeElement;
    const tagName = activeElement.tagName.toLowerCase();

    if (tagName === 'input' || tagName === 'textarea') return true;
    if (activeElement.isContentEditable) return true;

    return false;
  }

  // ========== Keyboard Event Handler ==========

  async function handleKeyPress(event) {
    // ESC key: Close URL menu and deactivate F mode
    if (event.key === 'Escape') {
      if (fModeActive) {
        event.preventDefault();
        deactivateFMode();
        return;
      }
      return;
    }

    // Don't handle if in input field
    if (isFocusInInput()) return;

    const key = event.key.toUpperCase();

    if (!event.ctrlKey && !event.altKey && !event.metaKey && key !== 'G' && key !== 'T') {
      gBottomReachedCount = 0;
      bTopReachedCount = 0;
    }

    // === Independent keys (work without F mode) ===

    // A key: Go back to previous page
    if (key === 'A' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;
      window.history.back();
      return;
    }

    // Q key: Go to parent URL (one level up)
    if (key === 'Q' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;

      const currentUrl = window.location.href;
      const currentPath = currentUrl.split('?')[0].replace(/\/$/, '');
      const jobBaseUrl = getJobBaseUrl(currentUrl);
      const jobPath = jobBaseUrl ? jobBaseUrl.split('?')[0].replace(/\/$/, '') : null;

      if (fModeActive && jobPath && currentPath === jobPath) {
        const movedToFrequentView = await navigateToMatchedFrequentView(currentUrl);
        if (movedToFrequentView) return;
      }

      let parentUrl = currentUrl;

      if (jobPath && currentPath !== jobPath) {
        parentUrl = jobBaseUrl;
      } else {
        parentUrl = parentUrl.split('?')[0].replace(/\/$/, '');

        // 1. Strip console/timestamps if present
        if (parentUrl.endsWith('/console') || parentUrl.endsWith('/consoleFull') || parentUrl.endsWith('/consoleText')) {
          parentUrl = parentUrl.replace(/\/(console|consoleFull|consoleText)$/, '');
        }
        else if (parentUrl.includes('/timestamps')) {
          parentUrl = parentUrl.replace(/\/timestamps.*$/, '');
        }

        // 2. Strip the next level of URL
        if (parentUrl.match(/\/\d+$/)) {
          parentUrl = parentUrl.replace(/\/\d+$/, '');
        }
        else if (parentUrl.match(/\/job\/[^\/]+$/)) {
          parentUrl = parentUrl.replace(/\/job\/[^\/]+$/, '');
        }
        else if (parentUrl.match(/\/view\/[^\/]+$/)) {
          parentUrl = parentUrl.replace(/\/view\/[^\/]+$/, '');
        }
        else if (parentUrl.match(/\/[^\/]+$/)) {
          const lastPart = parentUrl.match(/\/([^\/]+)$/)[1];
          if (lastPart.includes('jenkins') || lastPart.length < 15) {
            parentUrl = parentUrl.replace(/\/[^\/]+$/, '');
          }
        }
      }

      if (!parentUrl || parentUrl === currentUrl || !parentUrl.includes('://')) {
        const urlMatch = currentUrl.match(/^(https?:\/\/[^\/]+)/);
        if (urlMatch) {
          parentUrl = urlMatch[1];
        } else {
          return;
        }
      }

      window.location.href = parentUrl;
      return;
    }

    // W key: Toggle breadcrumb dropdown
    if (key === 'W' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;
      toggleBreadcrumbDropdown();
      return;
    }

    // F key: Toggle F mode (shortcuts display and URL menu)
    if (key === 'F' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;

      // Pressing F always exits scroll mode.
      gShortcutChainActive = false;
      gBottomReachedCount = 0;
      bTopReachedCount = 0;

      toggleFMode();
      return;
    }

    // G key: requires F->G once, then supports repeated G presses
    if (key === 'G' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (!fModeActive && !gShortcutChainActive) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;

      gShortcutChainActive = true;
      if (fModeActive) deactivateFMode();
      handleGShortcutScroll();
      return;
    }

    // P/N keys: in scroll mode, previous/next build without F prefix
    if (gShortcutChainActive && !event.ctrlKey && !event.altKey && !event.metaKey && (key === 'P' || key === 'N')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;

      if (fModeActive) deactivateFMode();
      showScrollOverlay(key === 'P' ? 'left' : 'right', false);
      await delay(120);
      await navigateToPreviousOrNextBuild(key);
      return;
    }

    // T key: in scroll mode, page-up chain (top reached x2 -> jump to bottom on next T)
    if (key === 'T' && !event.ctrlKey && !event.altKey && !event.metaKey && gShortcutChainActive) {

      event.preventDefault();
      event.stopImmediatePropagation();
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) return;

      if (fModeActive) deactivateFMode();
      handleBShortcutScroll();
      return;
    }

    // === F-mode dependent keys ===
    if (fModeActive) {
      // Ctrl+C: ignore in F mode (allow browser copy)
      if (event.ctrlKey && key === 'C') {
        return;
      }

      // ? key: Show help modal
      if (key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showHelpModal();
        return;
      }

      const handled = await navigateByShortcut(key);
      if (handled) {
        event.preventDefault();
        // F mode is deactivated inside navigateByShortcut via deactivateFMode()
      }
    }
  }

  // ========== Navigation Buttons ==========

  function addNavigationButtons() {
    const checkAndInsert = () => {
      const backToDashboard = document.querySelector('a[href*="dashboard"]');
      const sidePanel = document.getElementById('side-panel');
      const breadcrumb = document.querySelector('.jenkins-breadcrumbs');

      let insertionPoint = null;
      if (backToDashboard && backToDashboard.closest('.task')) {
        insertionPoint = backToDashboard.closest('.task');
      } else if (sidePanel && sidePanel.firstChild) {
        insertionPoint = sidePanel.firstChild;
      } else if (breadcrumb) {
        insertionPoint = breadcrumb.nextSibling;
      }

      if (insertionPoint && !document.getElementById('jenkins-nav-buttons')) {
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'jenkins-nav-buttons';
        buttonContainer.style.cssText = `
          padding: 2px 10px;
          margin: 2px 0;
          display: flex;
          gap: 0px;
          justify-content: flex-start;
        `;

        // Q/W/A button
        const navButton = document.createElement('span');
        navButton.textContent = 'Q/W/A';
        navButton.className = 'jenkins-shortcut-hint';
        navButton.title = 'Q: Go to parent | W: Breadcrumb dropdown | A: Go back';
        navButton.style.marginLeft = '0px';
        navButton.style.marginRight = '0px';

        navButton.onclick = (e) => {
          const rect = navButton.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const elementWidth = rect.width;

          if (clickX < elementWidth / 3) {
            // Q (parent)
            const event = new KeyboardEvent('keydown', { key: 'Q' });
            document.dispatchEvent(event);
          } else if (clickX < (elementWidth * 2) / 3) {
            // W (breadcrumb)
            toggleBreadcrumbDropdown();
          } else {
            // A (back)
            window.history.back();
          }
        };

        buttonContainer.appendChild(navButton);

        // F toggle button
        const toggleButton = document.createElement('span');
        toggleButton.textContent = 'F';
        toggleButton.id = 'jenkins-toggle-f-button';
        toggleButton.className = 'jenkins-shortcut-hint';
        toggleButton.title = 'F: Toggle shortcuts and URL menu';
        toggleButton.style.marginLeft = '8px';
        toggleButton.onclick = () => {
          toggleFMode();
        };

        buttonContainer.appendChild(toggleButton);

        // Page-specific action buttons (hidden initially)
        if (hasJobUrl()) {
          const reportButton = document.createElement('span');
          reportButton.textContent = 'z-report';
          reportButton.className = 'jenkins-shortcut-hint';
          reportButton.id = 'jenkins-report-button';
          reportButton.title = 'Press Z for Build Statistics Report';
          reportButton.style.marginLeft = '8px';
          reportButton.style.cursor = 'pointer';
          reportButton.style.display = 'none';

          reportButton.onclick = () => {
            showStatisticsReport();
          };

          buttonContainer.appendChild(reportButton);
        }

        if (hasNodeUrl()) {
          const labelButton = document.createElement('span');
          labelButton.textContent = 'z-label';
          labelButton.className = 'jenkins-shortcut-hint';
          labelButton.id = 'jenkins-label-button';
          labelButton.title = 'Press Z for Jenkins Labels';
          labelButton.style.marginLeft = '8px';
          labelButton.style.cursor = 'pointer';
          labelButton.style.display = 'none';

          labelButton.onclick = async () => {
            await triggerNodeLabels();
          };

          buttonContainer.appendChild(labelButton);
        }

        if (insertionPoint.parentNode) {
          insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
        }
      }
    };

    checkAndInsert();
    setTimeout(checkAndInsert, 500);
    setTimeout(checkAndInsert, 1000);
  }

  // ========== Initialize ==========

  async function init() {
    const isJenkins = await isJenkinsSite();
    if (!isJenkins) return;

    addNavigationButtons();
    await saveUrlVisit(window.location.href);

    // Add keyboard event listener (capture phase)
    document.addEventListener('keydown', handleKeyPress, { capture: true });

    // Listen for z-report and downConfig trigger from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'triggerZReport') {
        showStatisticsReport();
        sendResponse({ ok: true });
        return true;
      }
      
      if (request.type === 'triggerDownConfig') {
        downloadConfigXml();
        sendResponse({ ok: true });
        return true;
      }
    });

    // Listen for delete requests from z-report window
    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'deleteRequest') {
        const { messageId, deleteUrl } = event.data;

        try {
          let crumb = null;
          try {
            const url = new URL(deleteUrl);
            const pathParts = url.pathname.split('/').filter(p => p);
            let jenkinsPath = '';
            if (pathParts.length > 0 && pathParts[0].includes('jenkins')) {
              jenkinsPath = '/' + pathParts[0];
            }
            const jenkinsBaseUrl = url.origin + jenkinsPath;
            const crumbUrl = jenkinsBaseUrl + '/crumbIssuer/api/json';

            const crumbResponse = await chrome.runtime.sendMessage({
              type: 'getJenkinsCrumb',
              url: crumbUrl
            });

            if (crumbResponse.ok && crumbResponse.crumb) {
              crumb = {
                field: crumbResponse.crumb.crumbRequestField,
                value: crumbResponse.crumb.crumb
              };
            }
          } catch (crumbError) {
            console.error('Could not get Jenkins Crumb:', crumbError);
          }

          const response = await chrome.runtime.sendMessage({
            type: 'deleteBuild',
            url: deleteUrl,
            crumbField: crumb ? crumb.field : null,
            crumbValue: crumb ? crumb.value : null
          });

          event.source.postMessage({
            type: 'deleteResponse',
            messageId: messageId,
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            error: response.error
          }, '*');
        } catch (error) {
          console.error('Error processing delete request:', error);
          event.source.postMessage({
            type: 'deleteResponse',
            messageId: messageId,
            success: false,
            error: error.message
          }, '*');
        }
      }
    });

    // Monitor URL changes (for SPA navigation)
    let lastUrl = window.location.href;

    const observer = new MutationObserver(async () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        await saveUrlVisit(currentUrl);
      }
    });

    observer.observe(document, { subtree: true, childList: true });

    window.addEventListener('popstate', async () => {
      await saveUrlVisit(window.location.href);
    });
  }

  // Run initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
