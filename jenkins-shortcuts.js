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
        return;
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
      return window.location.href.includes('jenkins');
    }
  }

  // Detect current page type (job or build)
  function detectPageType() {
    const url = window.location.href;
    
    // Build page pattern: /job/jobname/buildnumber/ (supports nested jobs like /job/folder/job/name/123/)
    if (/\/job\/[^\/]+(\/job\/[^\/]+)*\/\d+\/?/.test(url)) {
      return 'build';
    }
    
    // Job page pattern: /job/jobname/ or /job/folder/job/jobname/ (supports nested folders)
    // Matches ending with / or #hash or buildTimeTrend, changes, builds
    if (/\/job\/[^\/]+(\/job\/[^\/]+)*\/?($|#|buildTimeTrend|changes|builds)/.test(url)) {
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
      // Try to find by selector first (skip if selector is null)
      let link = null;
      if (shortcut.selector) {
        link = document.querySelector(shortcut.selector);
      }
      
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
      return;
    }

    shortcutsActive = true;
    
    // Show z-report button if on job page
    const reportButton = document.getElementById('jenkins-report-button');
    if (reportButton) {
      reportButton.style.display = 'inline-block';
    }

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
  }



  // Hide keyboard shortcuts hints
  function hideShortcuts() {
    if (!shortcutsActive) return;

    const hints = document.querySelectorAll('.jenkins-shortcut-hint');
    hints.forEach(hint => {
      // Don't remove hints that are inside URL menu or navigation buttons
      if (!hint.closest('#jenkins-url-menu') && !hint.closest('#jenkins-nav-buttons')) {
        hint.remove();
      }
    });
    
    // Hide z-report button
    const reportButton = document.getElementById('jenkins-report-button');
    if (reportButton) {
      reportButton.style.display = 'none';
    }

    shortcutsActive = false;
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
      const jobUrl = currentUrl.match(/^(.*?\/job\/[^\/]+(\/job\/[^\/]+)*)\//);
      if (jobUrl) {
        const targetUrl = jobUrl[1] + '/jobConfigHistory';
        window.location.href = targetUrl;
        hideShortcuts();
        return true;
      }
    }

    // Special handling for C and T on build page
    if (pageType === 'build' && (keyUpper === 'C' || keyUpper === 'T')) {
      const currentUrl = window.location.href;
      const buildUrl = currentUrl.match(/^(.*?\/job\/[^\/]+(\/job\/[^\/]+)*\/\d+)\/?/);
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

    // Find the link by selector first (skip if selector is null)
    let link = null;
    if (shortcut.selector) {
      link = document.querySelector(shortcut.selector);
      console.log(`Selector result for ${keyUpper}:`, link);
    }
    
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
          // Ignore onclick errors
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

  // Fetch and display statistics report
  async function showStatisticsReport() {
    try {
      // Get current job URL from page (supports nested jobs like /job/folder/job/name/)
      const currentUrl = window.location.href;
      const jobMatch = currentUrl.match(/^(.*?\/job\/[^\/]+(\/job\/[^\/]+)*)/);
      
      if (!jobMatch) {
        alert('Cannot determine job URL. Please navigate to a Jenkins job page.');
        return;
      }
      
      const jobBaseUrl = jobMatch[1];
      const apiUrl = jobBaseUrl + '/api/json?tree=fullDisplayName,url,buildable,queueItem,allBuilds[number,building,timestamp,duration,result,url,displayName,description]';
      
      
      // Fetch data from Jenkins API
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Open new tab with statistics report
      const reportWindow = window.open('', '_blank');
      
      if (!reportWindow) {
        alert('Please allow popups to view the statistics report.');
        return;
      }
      
      // Generate report HTML
      const html = generateStatisticsReportHtml(data, jobBaseUrl);
      
      // Use Blob URL to avoid CSP issues
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      reportWindow.location.href = url;
      
    } catch (error) {
      console.error('Failed to generate statistics report:', error);
      alert(`Failed to generate statistics report: ${error.message}`);
    }
  }

  // Generate statistics report HTML
  function generateStatisticsReportHtml(data, jobBaseUrl) {
    const allBuilds = data.allBuilds || [];
    
    // Calculate statistics
    const totalBuilds = allBuilds.length;
    const successBuilds = allBuilds.filter(b => b.result === 'SUCCESS').length;
    const failureBuilds = allBuilds.filter(b => b.result === 'FAILURE').length;
    const abortedBuilds = allBuilds.filter(b => b.result === 'ABORTED').length;
    
    const successRate = totalBuilds > 0 ? ((successBuilds / totalBuilds) * 100).toFixed(2) : '0.00';
    const failureRate = totalBuilds > 0 ? ((failureBuilds / totalBuilds) * 100).toFixed(2) : '0.00';
    const abortRate = totalBuilds > 0 ? ((abortedBuilds / totalBuilds) * 100).toFixed(2) : '0.00';
    
    // Build range
    const buildNumbers = allBuilds.map(b => b.number).filter(n => n);
    const minBuild = buildNumbers.length > 0 ? Math.min(...buildNumbers) : 0;
    const maxBuild = buildNumbers.length > 0 ? Math.max(...buildNumbers) : 0;
    const buildRange = `${minBuild}~${maxBuild} (${totalBuilds})`;
    
    // Calculate average durations (all based on SUCCESS builds only)
    const successfulDurations = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 0)
      .map(b => b.duration);
    
    const avgDuration = successfulDurations.length > 0
      ? successfulDurations.reduce((a, b) => a + b, 0) / successfulDurations.length
      : 0;
    
    // Success and <= 20 minutes (1200000ms)
    const under20min = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 0 && b.duration <= 1200000)
      .map(b => b.duration);
    const avgUnder20 = under20min.length > 0
      ? under20min.reduce((a, b) => a + b, 0) / under20min.length
      : 0;
    
    // Success and 20min~3hours (1200000~10800000ms)
    const between20minAnd3h = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 1200000 && b.duration <= 10800000)
      .map(b => b.duration);
    const avgBetween = between20minAnd3h.length > 0
      ? between20minAnd3h.reduce((a, b) => a + b, 0) / between20minAnd3h.length
      : 0;
    
    // Success and >= 3 hours (10800000ms)
    const over3h = allBuilds
      .filter(b => b.result === 'SUCCESS' && b.duration > 10800000)
      .map(b => b.duration);
    const avgOver3h = over3h.length > 0
      ? over3h.reduce((a, b) => a + b, 0) / over3h.length
      : 0;
    
    // Format duration as HH:MM:SS
    const formatDuration = (ms) => {
      if (!ms || ms === 0) return '-';
      const seconds = Math.floor(ms / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    // Format timestamp
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
    
    // Get result color
    const getResultColor = (result) => {
      switch(result) {
        case 'SUCCESS': return '#4CAF50';
        case 'FAILURE': return '#f44336';
        case 'ABORTED': return '#9E9E9E';
        case 'UNSTABLE': return '#FF9800';
        default: return '#2196F3';
      }
    };
    
    // Generate table rows
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
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      background-color: #f5f5f5;
    }
    .header {
      background-color: #1976D2;
      color: white;
      padding: 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .header-info {
      font-size: 14px;
      margin: 5px 0;
    }
    .stats-container {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .stat-card {
      flex: 1;
      min-width: 140px;
      background-color: white;
      padding: 12px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-card h3 {
      margin: 0 0 8px 0;
      font-size: 12px;
      color: #666;
      white-space: nowrap;
    }
    .stat-card .value {
      font-size: 24px;
      font-weight: bold;
      color: #1976D2;
    }
    .stat-card .sub-text {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    .table-container {
      background-color: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background-color: #1976D2;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: bold;
      position: sticky;
      top: 0;
      cursor: pointer;
      user-select: none;
    }
    th:hover {
      background-color: #1565C0;
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #ddd;
    }
    tr:hover {
      background-color: #f5f5f5;
    }
    @keyframes blink {
      0%, 50%, 100% { opacity: 1; }
      25%, 75% { opacity: 0.3; }
    }
    .building-blink {
      animation: blink 2s infinite;
    }
    .delete-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .delete-container input {
      width: 70px;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 3px;
      font-size: 14px;
      text-align: center;
    }
    /* Remove spinner buttons from number inputs */
    .delete-container input[type=number]::-webkit-inner-spin-button,
    .delete-container input[type=number]::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .delete-container input[type=number] {
      -moz-appearance: textfield;
    }
    .delete-container button {
      background-color: #f44336;
      color: white;
      border: none;
      padding: 6px 16px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    }
    .delete-container button:hover {
      background-color: #d32f2f;
    }
    .delete-container button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
    }
    #deleteStatus {
      font-size: 12px;
      color: #666;
      margin-left: 5px;
    }
    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 15px;
    }
    .table-header h2 {
      margin: 0;
    }
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
    <div class="stat-card">
      <h3>Success Rate</h3>
      <div class="value">${successRate}%</div>
      <div class="sub-text">${successBuilds} / ${totalBuilds}</div>
    </div>
    <div class="stat-card">
      <h3>Failure Rate</h3>
      <div class="value">${failureRate}%</div>
      <div class="sub-text">${failureBuilds} / ${totalBuilds}</div>
    </div>
    <div class="stat-card">
      <h3>Abort Rate</h3>
      <div class="value">${abortRate}%</div>
      <div class="sub-text">${abortedBuilds} / ${totalBuilds}</div>
    </div>
    <div class="stat-card">
      <h3>Avg (Success)</h3>
      <div class="value" style="font-size: 18px;">${formatDuration(avgDuration)}</div>
      <div class="sub-text">${successfulDurations.length} builds</div>
    </div>
    <div class="stat-card">
      <h3>Avg (≤20min)</h3>
      <div class="value" style="font-size: 18px;">${formatDuration(avgUnder20)}</div>
      <div class="sub-text">${under20min.length} builds</div>
    </div>
    <div class="stat-card">
      <h3>Avg (20m~3h)</h3>
      <div class="value" style="font-size: 18px;">${formatDuration(avgBetween)}</div>
      <div class="sub-text">${between20minAnd3h.length} builds</div>
    </div>
    <div class="stat-card">
      <h3>Avg (≥3h)</h3>
      <div class="value" style="font-size: 18px;">${formatDuration(avgOver3h)}</div>
      <div class="sub-text">${over3h.length} builds</div>
    </div>
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
    let sortDirections = [1, 1, 1, 1, 1, 1]; // 1 for ascending, -1 for descending
    
    // Delete builds in range using window.opener postMessage
    async function deleteBuildsInRange() {
      const startBuild = parseInt(document.getElementById('deleteStartBuild').value);
      const endBuild = parseInt(document.getElementById('deleteEndBuild').value);
      const statusEl = document.getElementById('deleteStatus');
      const deleteBtn = document.getElementById('deleteBuildBtn');
      
      if (isNaN(startBuild) || isNaN(endBuild)) {
        alert('Please enter valid build numbers');
        return;
      }
      
      if (startBuild > endBuild) {
        alert('Start build number must be less than or equal to end build number');
        return;
      }
      
      if (!window.opener) {
        alert('Cannot communicate with parent window. Please open z-report from Jenkins page.');
        return;
      }
      
      const count = endBuild - startBuild + 1;
      if (!confirm(\`Are you sure you want to delete \${count} builds from #\${startBuild} to #\${endBuild}?\nAfter deleting this, you have to renew the report manually to refresh.\`)) {
        return;
      }
      
      deleteBtn.disabled = true;
      statusEl.textContent = 'Preparing...';
      statusEl.style.color = '#666';
      
      let successCount = 0;
      let failCount = 0;
      let errors = [];
      
      // Delete builds one by one
      for (let buildNum = startBuild; buildNum <= endBuild; buildNum++) {
        const deleteUrl = \`\${JOB_BASE_URL}/\${buildNum}/doDelete\`;
        statusEl.textContent = \`Deleting #\${buildNum} (\${buildNum - startBuild + 1}/\${count})...\`;
        
        try {
          // Send delete request to opener via postMessage
          const result = await new Promise((resolve, reject) => {
            const messageId = 'delete_' + Date.now() + '_' + Math.random();
            
            const messageHandler = (event) => {
              if (event.data && event.data.type === 'deleteResponse' && event.data.messageId === messageId) {
                window.removeEventListener('message', messageHandler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', messageHandler);
            
            // Send message to opener
            window.opener.postMessage({
              type: 'deleteRequest',
              messageId: messageId,
              deleteUrl: deleteUrl
            }, '*');
            
            // Timeout after 15 seconds
            setTimeout(() => {
              window.removeEventListener('message', messageHandler);
              reject(new Error('Timeout'));
            }, 15000);
          });
          
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            const errorMsg = \`#\${buildNum}: \${result.error || result.statusText || 'HTTP ' + result.status || 'Unknown error'}\`;
            errors.push(errorMsg);
            console.error('Delete failed:', errorMsg, result);
          }
        } catch (error) {
          failCount++;
          const errorMsg = \`#\${buildNum}: \${error.message}\`;
          errors.push(errorMsg);
          console.error('Error deleting build:', error);
        }
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      deleteBtn.disabled = false;
      statusEl.textContent = \`Done: \${successCount} deleted, \${failCount} failed\`;
      statusEl.style.color = failCount > 0 ? '#f44336' : '#4CAF50';
      
      if (errors.length > 0 && errors.length <= 5) {
        console.error('Delete errors:', errors);
      }
      
      if (failCount === count) {
        alert('All deletions failed. Check console for details.');
      }
    }
    
    function sortTable(columnIndex) {
      const table = document.getElementById('buildsTable');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      
      // Toggle sort direction
      sortDirections[columnIndex] *= -1;
      const direction = sortDirections[columnIndex];
      
      rows.sort((a, b) => {
        let aValue = a.cells[columnIndex].textContent.trim();
        let bValue = b.cells[columnIndex].textContent.trim();
        
        // Special handling for Number column (extract number from #123)
        if (columnIndex === 0) {
          aValue = parseInt(aValue.replace('#', '')) || 0;
          bValue = parseInt(bValue.replace('#', '')) || 0;
          return direction * (aValue - bValue);
        }
        
        // Special handling for Duration column (convert HH:MM:SS to seconds)
        if (columnIndex === 3) {
          const aSeconds = timeToSeconds(aValue);
          const bSeconds = timeToSeconds(bValue);
          return direction * (aSeconds - bSeconds);
        }
        
        // Special handling for Timestamp column
        if (columnIndex === 2) {
          const aDate = new Date(aValue).getTime() || 0;
          const bDate = new Date(bValue).getTime() || 0;
          return direction * (aDate - bDate);
        }
        
        // String comparison for other columns
        return direction * aValue.localeCompare(bValue);
      });
      
      // Clear and re-append sorted rows
      tbody.innerHTML = '';
      rows.forEach(row => tbody.appendChild(row));
      
      // Update sort indicators
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
    
    // Add event listeners to table headers
    document.addEventListener('DOMContentLoaded', function() {
      const headers = document.querySelectorAll('#buildsTable th');
      headers.forEach((th, index) => {
        th.addEventListener('click', function() {
          sortTable(index);
        });
      });
    });
  </script>
</body>
</html>
    `;
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

    // Z key: Show build statistics report (only on job pages and when shortcuts are active)
    if (key === 'Z' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if shortcuts are active
      if (!shortcutsActive) {
        console.log('Shortcuts are not active. Press F to activate.');
        return;
      }
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }
      
      // Check if on a job page
      const pageType = detectPageType();
      if (pageType === 'job') {
        await showStatisticsReport();
      }
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
      return;
    }

    // Add navigation buttons
    addNavigationButtons();

    // Save current URL on page load
    await saveUrlVisit(window.location.href);

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyPress);
    
    // Listen for delete requests from z-report window
    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'deleteRequest') {
        const { messageId, deleteUrl } = event.data;
        
        try {
          // Get Jenkins Crumb first
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
          
          // Perform delete request via background script
          const response = await chrome.runtime.sendMessage({
            type: 'deleteBuild',
            url: deleteUrl,
            crumbField: crumb ? crumb.field : null,
            crumbValue: crumb ? crumb.value : null
          });
          
          // Send result back to z-report
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
          // Send error back to z-report
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
    
    // Use MutationObserver to detect URL changes
    const observer = new MutationObserver(async () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
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
        navButton.textContent = 'Q/A/S/F';
        navButton.className = 'jenkins-shortcut-hint';
        navButton.title = 'Q: Go to parent | A: Go back | S: Go forward | F: Toggle shortcuts';
        navButton.style.marginLeft = '0px';
        navButton.style.marginRight = '0px';
        
        // Handle click based on position (4 sections)
        navButton.onclick = (e) => {
          const rect = navButton.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const elementWidth = rect.width;
          
          if (clickX < elementWidth / 4) {
            // First quarter: Q (parent/top)
            const event = new KeyboardEvent('keydown', { key: 'Q' });
            document.dispatchEvent(event);
          } else if (clickX < elementWidth / 2) {
            // Second quarter: A (back)
            window.history.back();
          } else if (clickX < (elementWidth * 3) / 4) {
            // Third quarter: S (forward)
            window.history.forward();
          } else {
            // Fourth quarter: F (toggle shortcuts)
            const event = new KeyboardEvent('keydown', { key: 'F' });
            document.dispatchEvent(event);
          }
        };
        
        buttonContainer.appendChild(navButton);
        
        // Add Z-report button only on job pages (hidden initially)
        const pageType = detectPageType();
        if (pageType === 'job') {
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
        
        // Insert before the insertion point
        if (insertionPoint.parentNode) {

        const toggleButton = document.createElement('span');
        toggleButton.textContent = 'F';
        toggleButton.className = 'jenkins-shortcut-hint';
        toggleButton.title = 'F: Toggle shortcuts and URL menu';
        toggleButton.style.marginLeft = '8px';
        toggleButton.onclick = () => {
          const event = new KeyboardEvent('keydown', { key: 'F' });
          document.dispatchEvent(event);
        };

        buttonContainer.appendChild(toggleButton);
          insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
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
