// Jenkins Shortcuts - Content Script
// Provides keyboard shortcuts for Jenkins menu navigation

(function() {
  'use strict';

  // State management
  let shortcutsActive = false;
  let config = null;
  let currentPageType = null; // 'job' or 'build'
  let urlMenuVisible = false;
  let lastSavedUrl = ''; // Track last saved URL to avoid duplicates

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
      
      // Skip if same as last saved URL
      if (normalizedUrl === lastSavedUrl) {
        return;
      }
      lastSavedUrl = normalizedUrl;
      
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        return;
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

  // Shortcut mappings for different page types
  const SHORTCUTS = {
    job: [
      { key: 'B', text: ['Build with Parameters', 'Build Now', '빌드 실행'], selector: '#side-panel a[href*="build?"], .task a[href*="build?"]' },
      { key: 'C', text: ['구성', 'Configure'], selector: '#side-panel a[href$="/configure"], .task a[href$="/configure"]' },
      { key: 'E', text: ['Rebuild Last'], selector: '#side-panel a[href*="rebuild"], .task a[href*="rebuild"]' },
      { key: 'H', text: ['Job Config History'], selector: '#side-panel a[href*="jobConfigHistory"], .task a[href*="jobConfigHistory"]' },
      { key: 'R', text: ['이름 바꾸기', 'Rename'], selector: '#side-panel a[href$="/confirm-rename"], .task a[href$="/confirm-rename"]' }
    ],
    build: [
      { key: 'D', text: ['Delete build', '빌드 삭제'], selector: '#side-panel a[href*="doDelete"], .task a[href*="doDelete"]' },
      { key: 'C/T', text: ['Console Output', '콘솔 출력'], selector: '#side-panel a[href*="/console"], .task a[href*="/console"]', isSpecial: true },
      { key: 'E', text: ['Environment Variables'], selector: '#side-panel a[href*="injectedEnvVars"], .task a[href*="injectedEnvVars"]' },
      { key: 'R', text: ['Retry'], selector: '#side-panel a[href*="retry"], .task a[href*="retry"]' },
      { key: 'B', text: ['Rebuild', '다시 빌드'], selector: '#side-panel a[href*="rebuild"], .task a[href*="rebuild"]' },
      { key: 'G', text: ['Retrigger'], selector: '#side-panel a[href*="retrigger"], .task a[href*="retrigger"]' },
      { key: 'P', text: ['Parameters'], selector: '#side-panel a[href*="parameters"], .task a[href*="parameters"]' }
    ]
  };

  // Detect if current page is a Jenkins site (based on configured sites)
  async function isJenkinsSite() {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.log('Extension context invalidated, using URL fallback');
        return window.location.href.includes('jenkins');
      }

      const result = await chrome.storage.local.get(['userConfigText']);
      if (result.userConfigText) {
        config = JSON.parse(result.userConfigText);
        const sites = config.sites || {};
        const currentUrl = window.location.href;
        
        // Check if current URL matches any configured Jenkins site
        for (const [siteName, siteUrl] of Object.entries(sites)) {
          if (currentUrl.startsWith(siteUrl) || currentUrl.includes('jenkins')) {
            return true;
          }
        }
      }
      
      // Fallback: check if URL contains 'jenkins'
      return window.location.href.includes('jenkins');
    } catch (error) {
      console.log('Failed to check Jenkins site (using URL fallback):', error.message);
      return window.location.href.includes('jenkins');
    }
  }

  // Detect current page type (job or build)
  function detectPageType() {
    const url = window.location.href;
    
    // Build page pattern: /job/jobname/buildnumber/
    if (/\/job\/[^\/]+\/\d+\/?/.test(url)) {
      return 'build';
    }
    
    // Job page pattern: /job/jobname/ or /job/jobname/buildTimeTrend, etc.
    if (/\/job\/[^\/]+\/?($|#|buildTimeTrend|changes|builds)/.test(url)) {
      return 'job';
    }
    
    return null;
  }

  // Find menu links based on shortcut configuration
  function findMenuLinks() {
    const pageType = detectPageType();
    if (!pageType) return [];

    currentPageType = pageType;
    const shortcuts = SHORTCUTS[pageType];
    const foundLinks = [];

    shortcuts.forEach(shortcut => {
      // Try to find by selector first
      let link = document.querySelector(shortcut.selector);
      
      // If not found by selector, try to find by text content (case-insensitive)
      if (!link) {
        const allLinks = document.querySelectorAll('#side-panel a, .task a, #tasks a');
        for (const a of allLinks) {
          const text = a.textContent.trim().toLowerCase();
          
          // Check text content
          const foundByText = shortcut.text.some(t => text.includes(t.toLowerCase()));
          
          if (foundByText) {
            link = a;
            break;
          }
        }
      }

      if (link) {
        foundLinks.push({
          key: shortcut.key,
          link: link,
          text: shortcut.text
        });
      }
    });

    return foundLinks;
  }

  // Show keyboard shortcuts hints
  function showShortcuts() {
    if (shortcutsActive) return;

    const links = findMenuLinks();
    if (links.length === 0) {
      console.log('No menu links found on this page');
      return;
    }

    shortcutsActive = true;

    // Add shortcut hints to each menu item
    links.forEach(item => {
      const link = item.link;
      
      // Skip if already has a hint
      if (link.querySelector && link.querySelector('.jenkins-shortcut-hint')) return;

      // Create hint element
      const hint = document.createElement('span');
      hint.className = 'jenkins-shortcut-hint';
      hint.textContent = item.key;
      hint.title = `Press ${item.key} to navigate`;

      // Find the right position to insert: after icon/image, before text
      let insertPosition = null;
      
      // Look for SVG or IMG elements
      const iconElements = link.querySelectorAll('svg, img');
      if (iconElements.length > 0) {
        // Insert after the last icon
        insertPosition = iconElements[iconElements.length - 1].nextSibling;
      } else {
        // No icon found, insert at the beginning
        insertPosition = link.firstChild;
      }
      
      if (insertPosition) {
        link.insertBefore(hint, insertPosition);
      } else {
        link.appendChild(hint);
      }
    });

    console.log(`Shortcuts activated for ${currentPageType} page:`, links.map(l => l.key).join(', '));
  }

  // Hide keyboard shortcuts hints
  function hideShortcuts() {
    if (!shortcutsActive) return;

    const hints = document.querySelectorAll('.jenkins-shortcut-hint');
    hints.forEach(hint => {
      // Don't remove hints that are inside the navigation button container
      if (!hint.closest('#jenkins-nav-buttons')) {
        hint.remove();
      }
    });

    shortcutsActive = false;
    console.log('Shortcuts deactivated');
  }

  // Navigate to menu by shortcut key
  function navigateByShortcut(key) {
    if (!shortcutsActive) return false;

    const pageType = currentPageType;
    if (!pageType) return false;

    const keyUpper = key.toUpperCase();

    // Special handling for H - Job Config History (always available)
    if (keyUpper === 'H') {
      const currentUrl = window.location.href;
      const jobUrl = currentUrl.match(/^(.*?\/job\/[^\/]+)\//);      if (jobUrl) {
        const targetUrl = jobUrl[1] + '/jobConfigHistory';
        console.log('Navigating to Job Config History:', targetUrl);
        window.location.href = targetUrl;
        hideShortcuts();
        return true;
      }
    }

    // Special handling for C and T on build page
    if (pageType === 'build' && (keyUpper === 'C' || keyUpper === 'T')) {
      const currentUrl = window.location.href;
      const buildUrl = currentUrl.match(/^(.*?\/job\/[^\/]+\/\d+)\/?/);
      if (buildUrl) {
        let targetUrl;
        if (keyUpper === 'C') {
          targetUrl = buildUrl[1] + '/console';
        } else if (keyUpper === 'T') {
          targetUrl = buildUrl[1] + '/timestamps/?time=HH:mm:ss&timeZone=GMT+9&appendLog&locale=en';
        }
        console.log('Navigating to:', targetUrl);
        window.location.href = targetUrl;
        hideShortcuts();
        return true;
      }
    }

    const shortcuts = SHORTCUTS[pageType];
    const shortcut = shortcuts.find(s => s.key.toUpperCase() === keyUpper);
    
    if (!shortcut) {
      console.log(`No shortcut found for key: ${keyUpper}`);
      return false;
    }
    
    console.log(`Found shortcut for ${keyUpper}:`, shortcut);

    // Find the link by selector first
    let link = document.querySelector(shortcut.selector);
    console.log(`Selector result for ${keyUpper}:`, link);
    
    // If not found by selector, try to find by text content
    if (!link) {
      const allLinks = document.querySelectorAll('#side-panel a, .task a');
      for (const a of allLinks) {
        const text = a.textContent.trim();
        if (shortcut.text.some(t => text.includes(t))) {
          link = a;
          console.log(`Found ${keyUpper} by text match:`, text);
          break;
        }
      }
    }

    if (link) {
      console.log('Navigating to:', link.href);
      
      // For links with onclick handlers, trigger the onclick first
      if (link.onclick) {
        try {
          const result = link.onclick.call(link, new MouseEvent('click'));
          // If onclick returns false, don't navigate
          if (result === false) {
            hideShortcuts();
            return true;
          }
        } catch (e) {
          console.log('onclick handler error:', e);
        }
      }
      
      // Use direct navigation instead of click() to bypass event handlers
      if (link.href && link.href !== '#' && link.href !== 'javascript:void(0)') {
        window.location.href = link.href;
      } else {
        link.click();
      }
      
      hideShortcuts();
      return true;
    }

    console.log('Link not found for shortcut:', key);
    return false;
  }

  // Shorten URL for display
  function shortenUrl(url, maxWidth) {
    // Create a temporary element to measure width
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
    
    if (fullWidth <= maxWidth) {
      return url;
    }
    
    // Step 1: If URL has /view/xxx/job/yyy pattern, shorten to https://~~~/job/yyy
    const viewJobMatch = url.match(/^(https?:\/\/)(.+?\/view\/[^\/]+)(\/job\/.*)$/);
    if (viewJobMatch) {
      const shortened1 = viewJobMatch[1] + '~~~' + viewJobMatch[3];
      tempSpan.textContent = shortened1;
      document.body.appendChild(tempSpan);
      const width1 = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);
      
      if (width1 <= maxWidth) {
        return shortened1;
      }
    }
    
    // Step 2: If URL has /job/ only (no /view/), shorten between // and /job
    const jobMatch = url.match(/^(https?:\/\/)(.+?)(\/job\/.*)$/);
    if (jobMatch) {
      const shortened2 = jobMatch[1] + '~~~' + jobMatch[3];
      tempSpan.textContent = shortened2;
      document.body.appendChild(tempSpan);
      const width2 = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);
      
      if (width2 <= maxWidth) {
        return shortened2;
      }
      
      // Step 3: If still too long, show only ~~~/jobname
      const jobnameMatch = jobMatch[3].match(/\/job\/([^\/]+)/);
      if (jobnameMatch) {
        const shortened3 = '~~~/' + jobnameMatch[1];
        return shortened3;
      }
      
      return shortened2;
    }
    
    // Fallback: just show domain and last part
    const fallbackMatch = url.match(/^(https?:\/\/)(.+?)(\/.+)$/);
    if (fallbackMatch) {
      return fallbackMatch[1] + '~~~' + fallbackMatch[3];
    }
    
    return url;
  }

  // Get top visited URLs from storage
  async function getTopVisitedUrls() {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.log('Extension context invalidated, please reload the page');
        return { views: [], jobs: [], recentJobs: [] };
      }
      
      const result = await chrome.storage.local.get(['urlHistory']);
      const urlHistory = result.urlHistory || {};
      
      const entries = Object.entries(urlHistory);
      
      // Extract unique views from all URLs
      const viewMap = new Map(); // url -> count
      const jobsWithData = []; // Array of {url, count, lastVisit}
      
      entries.forEach(([url, data]) => {
        // Extract view: /view/xxx/ pattern (before /job/)
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
        
        // Jobs: URLs matching job pattern (ending with /job/jobname)
        if (url.match(/\/job\/[^\/]+\/?$/)) {
          jobsWithData.push({ url, count: data.count, lastVisit: data.lastVisit });
        }
      });
      
      // Convert views to array and sort by count (ascending, so highest is at bottom)
      const views = Array.from(viewMap.entries())
        .map(([url, data]) => ({ url, count: data.count }))
        .sort((a, b) => a.count - b.count)  // Ascending order
        .slice(-4);  // Take last 4 (highest at bottom)
      
      // Top 5 jobs by count
      const topJobs = [...jobsWithData]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      const topJobUrls = new Set(topJobs.map(j => j.url));
      
      // Recent 3 jobs (excluding top jobs)
      const recentJobs = [...jobsWithData]
        .filter(j => !topJobUrls.has(j.url))
        .sort((a, b) => a.lastVisit - b.lastVisit)  // Ascending by lastVisit
        .slice(-3);  // Take last 3 (most recent at bottom)
      
      return { 
        views, 
        jobs: topJobs.reverse(),  // Reverse so highest is at bottom
        recentJobs 
      };
    } catch (error) {
      console.error('Failed to get URL history:', error);
      return { views: [], jobs: [], recentJobs: [] };
    }
  }

  // Show URL menu
  async function showUrlMenu() {
    if (urlMenuVisible) return;
    
    // Check if extension context is still valid
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
    
    // Create menu container
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
    
    // Create content
    let content = '<h2 style="margin-top: 0; color: #00008B; font-size: 15px;">Recent Views</h2>';
    
    if (topUrls.views.length > 0) {
      content += '<div style="margin-bottom: 30px;">';
      topUrls.views.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item view-item" data-url="${item.url}" style="
            padding: 10px;
            margin: 8px 0;
            background: rgba(160, 160, 160, 0.5);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #00008B;
          ">
            <div style="font-size: 14px;">${displayUrl}</div>
          </div>
        `;
      });
      content += '</div>';
    }
    
    content += '<h2 style="color: #00008B; font-size: 15px;">Recent Jobs</h2>';
    
    if (topUrls.jobs.length > 0) {
      content += '<div>';
      topUrls.jobs.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item job-item" data-url="${item.url}" style="
            padding: 10px;
            margin: 8px 0;
            background: rgba(160, 160, 160, 0.5);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #00008B;
            position: relative;
          ">
            <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #999; z-index: 1;"></div>
            <div style="font-size: 14px; position: relative; z-index: 2;">${displayUrl}</div>
          </div>
        `;
      });
      content += '</div>';
    }
    
    // Add separator if we have both top jobs and recent jobs
    if (topUrls.jobs.length > 0 && topUrls.recentJobs.length > 0) {
      content += '<hr style="border: none; border-top: 1px dashed #888; margin: 15px 0;">';
    }
    
    // Show recent jobs (excluding top jobs)
    if (topUrls.recentJobs.length > 0) {
      content += '<div>';
      topUrls.recentJobs.forEach(item => {
        const displayUrl = shortenUrl(item.url, window.innerWidth * 0.35);
        content += `
          <div class="url-item job-item" data-url="${item.url}" style="
            padding: 10px;
            margin: 8px 0;
            background: rgba(160, 160, 160, 0.5);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            word-break: break-all;
            color: #00008B;
            position: relative;
          ">
            <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #999; z-index: 1;"></div>
            <div style="font-size: 14px; position: relative; z-index: 2;">${displayUrl}</div>
          </div>
        `;
      });
      content += '</div>';
    }
    
    menu.innerHTML = content;
    
    // Add click handlers for view items (full click to navigate)
    menu.querySelectorAll('.view-item').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.background = 'rgba(140, 140, 140, 0.7)';
      });
      item.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.background = 'rgba(160, 160, 160, 0.5)';
      });
      item.addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        if (url) {
          window.location.href = url;
          hideUrlMenu();
        }
      });
    });
    
    // Add click handlers for job items (split click: left=job, right=console)
    menu.querySelectorAll('.job-item').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.background = 'rgba(140, 140, 140, 0.7)';
      });
      item.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.background = 'rgba(160, 160, 160, 0.5)';
      });
      item.addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        if (url) {
          // Calculate click position relative to the element
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const elementWidth = rect.width;
          
          let targetUrl = url;
          
          // If clicked on right half (50%), add /lastBuild/console
          if (clickX > elementWidth / 2) {
            // Remove trailing slash if exists
            const cleanUrl = url.replace(/\/$/, '');
            targetUrl = cleanUrl + '/lastBuild/console';
            console.log('Right half clicked - navigating to console:', targetUrl);
          } else {
            console.log('Left half clicked - navigating to job:', targetUrl);
          }
          
          window.location.href = targetUrl;
          hideUrlMenu();
        }
      });
    });
    
    document.body.appendChild(menu);
    console.log('URL menu displayed');
  }

  // Hide URL menu
  function hideUrlMenu() {
    if (!urlMenuVisible) return;
    
    const menu = document.getElementById('jenkins-url-menu');
    if (menu) {
      menu.remove();
    }
    
    urlMenuVisible = false;
    console.log('URL menu hidden');
  }

  // Check if focus is in an input field
  function isFocusInInput() {
    const activeElement = document.activeElement;
    const tagName = activeElement.tagName.toLowerCase();
    
    // Check if focus is in input, textarea, or contenteditable element
    if (tagName === 'input' || tagName === 'textarea') {
      return true;
    }
    
    if (activeElement.isContentEditable) {
      return true;
    }
    
    // Check if address bar has focus (approximation)
    // When address bar has focus, document.activeElement is usually body or html
    if ((tagName === 'body' || tagName === 'html') && 
        (window.getSelection().toString().length > 0)) {
      return false; // Text is selected on page, not in address bar
    }
    
    return false;
  }

  // Keyboard event handler
  async function handleKeyPress(event) {
    // ESC key: Close URL menu
    if (event.key === 'Escape' && urlMenuVisible) {
      event.preventDefault();
      hideUrlMenu();
      return;
    }
    
    // Don't handle if in input field
    if (isFocusInInput()) {
      return;
    }

    const key = event.key.toUpperCase();

    // A key: Go back to previous page
    if (key === 'A' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }
      
      console.log('Going back to previous page');
      window.history.back();
      return;
    }

    // S key: Go forward to next page
    if (key === 'S' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }
      
      console.log('Going forward to next page');
      window.history.forward();
      return;
    }

    // Q key: Go to parent URL (one level up)
    if (key === 'Q' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }
      
      const currentUrl = window.location.href;
      let parentUrl = currentUrl;
      
      // Remove trailing slash for processing
      parentUrl = parentUrl.replace(/\/$/, '');
      
      // Step 1: Remove /console if present
      if (parentUrl.endsWith('/console') || parentUrl.endsWith('/consoleFull')) {
        parentUrl = parentUrl.replace(/\/(console|consoleFull)$/, '');
      }
      // Step 2: Remove /timestamps or other console-related paths
      else if (parentUrl.includes('/timestamps')) {
        parentUrl = parentUrl.replace(/\/timestamps.*$/, '');
      }
      // Step 3: Remove build number (digits at the end)
      else if (parentUrl.match(/\/\d+$/)) {
        parentUrl = parentUrl.replace(/\/\d+$/, '');
      }
      // Step 4: Remove /job/jobname/ - go to view or parent
      else if (parentUrl.match(/\/job\/[^\/]+$/)) {
        parentUrl = parentUrl.replace(/\/job\/[^\/]+$/, '');
      }
      // Step 5: Remove /view/viewname/ - go to jenkins instance
      else if (parentUrl.match(/\/view\/[^\/]+$/)) {
        parentUrl = parentUrl.replace(/\/view\/[^\/]+$/, '');
      }
      // Step 6: Remove jenkins instance path (like /jenkins03)
      else if (parentUrl.match(/\/[^\/]+$/)) {
        const lastPart = parentUrl.match(/\/([^\/]+)$/)[1];
        // Only remove if it looks like a jenkins instance (contains 'jenkins' or is short)
        if (lastPart.includes('jenkins') || lastPart.length < 15) {
          parentUrl = parentUrl.replace(/\/[^\/]+$/, '');
        }
      }
      
      // Ensure we have a valid URL
      if (!parentUrl || parentUrl === currentUrl || !parentUrl.includes('://')) {
        // If we can't go up, go to domain root
        const urlMatch = currentUrl.match(/^(https?:\/\/[^\/]+)/);
        if (urlMatch) {
          parentUrl = urlMatch[1];
        } else {
          console.log('Cannot determine parent URL');
          return;
        }
      }
      
      console.log('Navigating to parent:', parentUrl);
      window.location.href = parentUrl;
      return;
    }

    // F key: Toggle shortcuts display and URL menu
    if (key === 'F' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }

      // Toggle URL menu
      if (urlMenuVisible) {
        hideUrlMenu();
      } else {
        await showUrlMenu();
      }
      
      // Also toggle shortcuts
      if (shortcutsActive) {
        hideShortcuts();
      } else {
        showShortcuts();
      }
      return;
    }

    // Navigation shortcuts
    if (shortcutsActive) {
      const handled = navigateByShortcut(key);
      if (handled) {
        event.preventDefault();
      }
    }
  }

  // Initialize
  async function init() {
    // Check if on a Jenkins site
    const isJenkins = await isJenkinsSite();
    if (!isJenkins) {
      console.log('Jenkins shortcuts: Not on a Jenkins site');
      return;
    }

    console.log('Jenkins shortcuts: Initialized on', window.location.href);
    console.log('Press F to show/hide keyboard shortcuts');
    console.log('Press A to go back, Q to go to parent URL');

    // Add navigation buttons
    addNavigationButtons();

    // Save current URL on page load
    await saveUrlVisit(window.location.href);

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyPress);
    
    // Monitor URL changes (for SPA navigation)
    let lastUrl = window.location.href;
    
    // Use MutationObserver to detect URL changes
    const observer = new MutationObserver(async () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        console.log('URL changed:', currentUrl);
        lastUrl = currentUrl;
        await saveUrlVisit(currentUrl);
      }
    });
    
    // Observe changes to the document
    observer.observe(document, { subtree: true, childList: true });
    
    // Also listen to popstate event (back/forward buttons)
    window.addEventListener('popstate', async () => {
      console.log('URL changed (popstate):', window.location.href);
      await saveUrlVisit(window.location.href);
    });
  }

  // Add navigation buttons to the page
  function addNavigationButtons() {
    // Wait for the page to be ready
    const checkAndInsert = () => {
      // Find the "Back to Dashboard" link or the breadcrumb area
      const backToDashboard = document.querySelector('a[href*="dashboard"]');
      const sidePanel = document.getElementById('side-panel');
      const breadcrumb = document.querySelector('.jenkins-breadcrumbs');
      
      // Determine insertion point
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
        
        const navButton = document.createElement('span');
        navButton.textContent = 'Q/A/S';
        navButton.className = 'jenkins-shortcut-hint';
        navButton.title = 'Q: Go to parent | A: Go back | S: Go forward';
        navButton.style.marginLeft = '0px';
        navButton.style.marginRight = '0px';
        
        // Handle click based on position (3 sections)
        navButton.onclick = (e) => {
          const rect = navButton.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const elementWidth = rect.width;
          
          if (clickX < elementWidth / 3) {
            // Left third: Q (parent/top)
            const event = new KeyboardEvent('keydown', { key: 'Q' });
            document.dispatchEvent(event);
          } else if (clickX < (elementWidth * 2) / 3) {
            // Middle third: A (back)
            window.history.back();
          } else {
            // Right third: S (forward)
            window.history.forward();
          }
        };
        
        buttonContainer.appendChild(navButton);
        
        // Insert before the insertion point
        if (insertionPoint.parentNode) {
          insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
          console.log('Navigation button added');
        }
      }
    };
    
    // Try to insert immediately
    checkAndInsert();
    
    // Also try after a short delay in case the page is still loading
    setTimeout(checkAndInsert, 500);
    setTimeout(checkAndInsert, 1000);
  }

  // Run initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
