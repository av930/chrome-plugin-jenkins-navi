// Jenkins Shortcuts - Content Script
// Provides keyboard shortcuts for Jenkins menu navigation

(function() {
  'use strict';

  // State management
  let shortcutsActive = false;
  let config = null;
  let currentPageType = null; // 'job' or 'build'

  // Shortcut mappings for different page types
  const SHORTCUTS = {
    job: [
      { key: 'B', text: ['Build with Parameters', 'Build Now', '빌드 실행'], selector: 'a[href*="build?"]' },
      { key: 'C', text: ['구성', 'Configure'], selector: 'a[href$="/configure"]' },
      { key: 'H', text: ['Job Config History'], selector: 'a[href*="jobConfigHistory"]', isSpecial: true },
      { key: 'R', text: ['이름 바꾸기', 'Rename'], selector: 'a[href$="/confirm-rename"]' }
    ],
    build: [
      { key: 'D', text: ['Delete build', '빌드 삭제'], selector: 'a[href*="doDelete"]' },
      { key: 'C/T', text: ['Console Output', '콘솔 출력'], selector: 'a[href*="/console"]', isSpecial: true },
      { key: 'E', text: ['Job Config History'], selector: 'a[href*="jobConfigHistory"]', isSpecial: true },
      { key: 'R', text: ['Retry'], selector: 'a[href*="retry"]' },
      { key: 'B', text: ['Rebuild', '다시 빌드'], selector: 'a[href*="rebuild"]' },
      { key: 'G', text: ['Retrigger'], selector: 'a[href*="retrigger"]' },
      { key: 'P', text: ['Parameters'], selector: 'a[href*="parameters"]' }
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
    
    // Job page pattern: /job/jobname/
    if (/\/job\/[^\/]+\/?$/.test(url) || /\/job\/[^\/]+\/#/.test(url)) {
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
      // Special handling for Job Config History - always show if on job/build page
      if (shortcut.key === 'H' || (shortcut.key === 'E' && pageType === 'build')) {
        // Create a virtual link for Job Config History
        const currentUrl = window.location.href;
        const jobUrl = currentUrl.match(/^(.*?\/job\/[^\/]+)\//);
        if (jobUrl) {
          foundLinks.push({
            key: shortcut.key,
            link: { href: jobUrl[1] + '/jobConfigHistory', click: function() { window.location.href = this.href; } },
            text: shortcut.text,
            isVirtual: true
          });
        }
        return;
      }

      // Try to find by selector first
      let link = document.querySelector(shortcut.selector);
      
      // If not found by selector, try to find by text content
      if (!link) {
        const allLinks = document.querySelectorAll('#side-panel a, .task a');
        for (const a of allLinks) {
          const text = a.textContent.trim();
          if (shortcut.text.some(t => text.includes(t))) {
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
      
      // For virtual links (like Job Config History), create a visual indicator
      if (item.isVirtual) {
        // Find the side panel to add hint
        const sidePanel = document.querySelector('#side-panel, #tasks');
        if (sidePanel) {
          const hintDiv = document.createElement('div');
          hintDiv.className = 'jenkins-shortcut-virtual';
          hintDiv.innerHTML = `<span class="jenkins-shortcut-hint">${item.key}</span> Job Config History`;
          hintDiv.dataset.shortcutKey = item.key;
          hintDiv.dataset.url = link.href;
          hintDiv.style.cssText = 'padding: 4px 8px; cursor: pointer; margin: 2px 0;';
          hintDiv.onclick = () => { window.location.href = link.href; };
          sidePanel.appendChild(hintDiv);
        }
        return;
      }
      
      // Skip if already has a hint
      if (link.querySelector && link.querySelector('.jenkins-shortcut-hint')) return;

      // Create hint element
      const hint = document.createElement('span');
      hint.className = 'jenkins-shortcut-hint';
      hint.textContent = item.key;
      hint.title = `Press ${item.key} to navigate`;

      // Insert hint at the beginning of the link
      if (link.insertBefore && link.firstChild) {
        link.insertBefore(hint, link.firstChild);
      }
    });

    console.log(`Shortcuts activated for ${currentPageType} page:`, links.map(l => l.key).join(', '));
  }

  // Hide keyboard shortcuts hints
  function hideShortcuts() {
    if (!shortcutsActive) return;

    const hints = document.querySelectorAll('.jenkins-shortcut-hint');
    hints.forEach(hint => hint.remove());
    
    const virtualHints = document.querySelectorAll('.jenkins-shortcut-virtual');
    virtualHints.forEach(hint => hint.remove());

    shortcutsActive = false;
    console.log('Shortcuts deactivated');
  }

  // Navigate to menu by shortcut key
  function navigateByShortcut(key) {
    if (!shortcutsActive) return false;

    const pageType = currentPageType;
    if (!pageType) return false;

    const keyUpper = key.toUpperCase();

    // Special handling for H - Job Config History
    if (keyUpper === 'H' || (keyUpper === 'E' && pageType === 'build')) {
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
    
    if (!shortcut) return false;

    // Special handling for Build shortcut on job page
    if (pageType === 'job' && shortcut.key === 'B') {
      // Try "Build with Parameters" first
      let link = document.querySelector('a[href*="build?"]');
      
      // If not found, try "Build Now"
      if (!link) {
        const allLinks = document.querySelectorAll('#side-panel a, .task a');
        for (const a of allLinks) {
          const text = a.textContent.trim();
          if (text.includes('Build Now') || text.includes('빌드 실행') || text.includes('Build with Parameters')) {
            link = a;
            break;
          }
        }
      }

      if (link) {
        console.log('Navigating to:', link.href);
        link.click();
        hideShortcuts();
        return true;
      }
    }

    // Find the link by selector first
    let link = document.querySelector(shortcut.selector);
    
    // If not found by selector, try to find by text content
    if (!link) {
      const allLinks = document.querySelectorAll('#side-panel a, .task a');
      for (const a of allLinks) {
        const text = a.textContent.trim();
        if (shortcut.text.some(t => text.includes(t))) {
          link = a;
          break;
        }
      }
    }

    if (link) {
      console.log('Navigating to:', link.href);
      link.click();
      hideShortcuts();
      return true;
    }

    console.log('Link not found for shortcut:', key);
    return false;
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
    // Don't handle if in input field
    if (isFocusInInput()) {
      return;
    }

    const key = event.key.toUpperCase();

    // F key: Toggle shortcuts display
    if (key === 'F' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      
      // Check if on a Jenkins site
      const isJenkins = await isJenkinsSite();
      if (!isJenkins) {
        console.log('Not on a configured Jenkins site');
        return;
      }

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

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyPress);
  }

  // Run initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
