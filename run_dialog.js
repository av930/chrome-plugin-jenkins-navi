// Default parameters text
const DEFAULT_PARAMS = `ACTION=remove_history
PARAM1=http://vjenkins.rge.com/job/11.automigration_downSrcMig/
PARAM2=0-11`;

// Get URL parameters from window
const urlParams = new URLSearchParams(window.location.search);
let baseUrl = decodeURIComponent(urlParams.get('url') || '');
const runButton = urlParams.get('button'); // run button name (e.g., 'remove-his', 'copy_job')

// Convert https to http (force http)
if (baseUrl && baseUrl.startsWith('https://')) {
  baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
}

console.log('Base URL after conversion:', baseUrl);

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

// Initialize textarea with saved or default text
document.addEventListener('DOMContentLoaded', async () => {
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

    // Open URL directly in a background tab
    console.log('Creating tab with URL:', finalUrl);
    chrome.tabs.create({ url: finalUrl, active: false });

    // Close this dialog after a short delay
    setTimeout(() => {
      window.close();
    }, 500);
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
});
