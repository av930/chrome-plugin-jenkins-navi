// Default config.list content
const DEFAULT_CONFIG = {
  "sites": {
    "V1": "http://vjenkins.lge.com/jenkins01",
    "V2": "http://vjenkins.lge.com/jenkins02",
    "V3": "http://vjenkins.lge.com/jenkins03",
    "V4": "http://vjenkins.lge.com/jenkins04",
    "L1": "http://lamp-ci.lge.com",
    "E1": "http://10.218.144.200:8300",
    "C1": "http://myjenkins.lge.com"
  },
  "menus": {
    "node": "computer",
    "trigger": "gerrit-trigger",
    "manage-role": "role-strategy/manage-roles",
    "assign-role": "role-strategy/assign-roles",
    "credentials": "credentials",
    "config": "configure",
    "toolconfig": "configureTools",
    "systemInfo": "systemInfo"
  },
  "job": {
    "textlog": "lastBuild/timestamps/?time=HH:mm:ss&timeZone=GMT+9&appendLog",
    "conslog": "lastBuild/consoleFull",
    "env-var": "lastBuild/injectedEnvVars",
    "rebuild": "lastBuild/rebuild/parameterized"
  },
  "custom": {
    "vgit_na": "https://vgit.lge.com/na",
    "vgit_eu": "https://vgit.lge.com/eu",
    "vgit_as": "https://vgit.lge.com/as",
    "collab": "https://collab.lge.com",
    "jira": "https://jira.lge.com",
    "custom": "http://your.custom.com"
  }
};

// Load configuration from storage or default
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['userConfigText']);
    let configText;

    if (result.userConfigText) {
      configText = result.userConfigText;
      console.log('Loaded user config from storage');
    } else {
      // Load from config.list file if no user config exists
      const response = await fetch('config.list');
      configText = await response.text();
      console.log('Loaded default config from file');
    }

    return configText;
  } catch (error) {
    console.error('Failed to load config:', error);
    return JSON.stringify(DEFAULT_CONFIG, null, 2);
  }
}

// Save configuration to storage (as text to preserve order)
async function saveConfig(configText) {
  try {
    // Validate JSON first
    JSON.parse(configText);
    await chrome.storage.local.set({ userConfigText: configText });
    console.log('Config saved to storage');
    return true;
  } catch (error) {
    console.error('Failed to save config:', error);
    return false;
  }
}

// Show status message
function showStatus(message, isError = false) {
  const statusDiv = document.getElementById('statusMessage');
  statusDiv.textContent = message;
  statusDiv.className = 'status-message ' + (isError ? 'error' : 'success');
  statusDiv.style.display = 'block';

  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
  const configEditor = document.getElementById('configEditor');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const uploadInput = document.getElementById('uploadInput');
  const defaultConfigPre = document.getElementById('defaultConfig');

  // Load and display current config
  const currentConfigText = await loadConfig();
  configEditor.value = currentConfigText;

  // Display default config
  defaultConfigPre.textContent = JSON.stringify(DEFAULT_CONFIG, null, 2);

  // Save button handler
  saveBtn.addEventListener('click', async () => {
    try {
      const configText = configEditor.value;

      // Validate JSON format
      const config = JSON.parse(configText);

      // Validate config structure
      if (!config.sites || !config.menus) {
        throw new Error('Invalid config: must contain "sites" and "menus" sections');
      }

      const success = await saveConfig(configText);
      if (success) {
        showStatus('Configuration saved successfully!');
      } else {
        showStatus('Failed to save configuration', true);
      }
    } catch (error) {
      showStatus('Invalid JSON format: ' + error.message, true);
    }
  });

  // Reset button handler
  resetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset to default configuration?')) {
      const defaultConfigText = JSON.stringify(DEFAULT_CONFIG, null, 2);
      configEditor.value = defaultConfigText;
      const success = await saveConfig(defaultConfigText);
      if (success) {
        showStatus('Configuration reset to default!');
      } else {
        showStatus('Failed to reset configuration', true);
      }
    }
  });

  // Download button handler
  downloadBtn.addEventListener('click', () => {
    const configText = configEditor.value;
    const blob = new Blob([configText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.list';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Configuration downloaded!');
  });

  // Upload button handler
  uploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const config = JSON.parse(e.target.result);
          configEditor.value = JSON.stringify(config, null, 2);
          showStatus('Configuration file loaded! Click "Save" to apply.');
        } catch (error) {
          showStatus('Invalid JSON file: ' + error.message, true);
        }
      };
      reader.readAsText(file);
    }
  });
});
