let settings = {
  apiKey: '',
  useDefault: true,
  sensitivity: 5,
  autoHighlight: true,
  showTooltips: true,
  collectStats: true
};

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['slopDetectSettings', 'geminiApiKey']);
    if (result.slopDetectSettings) {
      settings = { ...settings, ...result.slopDetectSettings };
    }
    if (result.geminiApiKey) {
      settings.apiKey = result.geminiApiKey;
    }
    updateUI();
  } catch (error) {
    console.error('Error loading settings:', error);
    showNotification('Error loading settings', 'error');
  }
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({ 
      slopDetectSettings: settings,
      geminiApiKey: settings.apiKey 
    });
    showNotification('Settings saved successfully', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showNotification('Error saving settings', 'error');
  }
}

function updateUI() {
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('useDefault').checked = settings.useDefault;
  document.getElementById('sensitivity').value = settings.sensitivity;
  document.getElementById('autoHighlight').checked = settings.autoHighlight;
  document.getElementById('showTooltips').checked = settings.showTooltips;
  document.getElementById('collectStats').checked = settings.collectStats;
}

function collectFormData() {
  settings.apiKey = document.getElementById('apiKey').value.trim();
  settings.useDefault = document.getElementById('useDefault').checked;
  settings.sensitivity = parseInt(document.getElementById('sensitivity').value);
  settings.autoHighlight = document.getElementById('autoHighlight').checked;
  settings.showTooltips = document.getElementById('showTooltips').checked;
  settings.collectStats = document.getElementById('collectStats').checked;
}

function resetToDefaults() {
  if (confirm('Are you sure you want to reset all settings to their default values?')) {
    settings = {
      apiKey: '',
      useDefault: true,
      sensitivity: 5,
      autoHighlight: true,
      showTooltips: true,
      collectStats: true
    };
    updateUI();
    showNotification('Settings reset to defaults', 'info');
  }
}

async function clearAllData() {
  if (confirm('Are you sure you want to clear ALL data? This will remove:\n\n• API keys\n• Settings\n• Usage statistics\n• All stored data\n\nThis action cannot be undone.')) {
    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      
      settings = {
        apiKey: '',
        useDefault: true,
        sensitivity: 5,
        autoHighlight: true,
        showTooltips: true,
        collectStats: true
      };
      updateUI();
      showNotification('All data cleared successfully', 'success');
    } catch (error) {
      console.error('Error clearing data:', error);
      showNotification('Error clearing data', 'error');
    }
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('apiKey');
  const icon = document.getElementById('eyeIcon');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = `<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>`;
  } else {
    input.type = 'password';
    icon.innerHTML = `<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`;
  }
}

function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  const text = document.getElementById('notificationText');
  
  text.textContent = message;
  notification.className = `notification ${type}`;
  
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 3000);
}

function hideNotification() {
  document.getElementById('notification').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  document.getElementById('toggleVisibility').addEventListener('click', togglePasswordVisibility);
  document.getElementById('saveSettings').addEventListener('click', () => {
    collectFormData();
    saveSettings();
  });
  document.getElementById('resetSettings').addEventListener('click', resetToDefaults);
  document.getElementById('clearAllData').addEventListener('click', clearAllData);
  document.getElementById('closeNotification').addEventListener('click', hideNotification);
  
  document.getElementById('apiKey').addEventListener('input', () => {
    const saveBtn = document.getElementById('saveSettings');
    saveBtn.style.background = 'linear-gradient(135deg, rgb(245, 158, 11), rgb(217, 119, 6))';
    saveBtn.textContent = 'Save Changes';
  });
  
  document.querySelectorAll('input[type="checkbox"], input[type="range"]').forEach(input => {
    input.addEventListener('change', () => {
      const saveBtn = document.getElementById('saveSettings');
      saveBtn.style.background = 'linear-gradient(135deg, rgb(245, 158, 11), rgb(217, 119, 6))';
      saveBtn.textContent = 'Save Changes';
    });
  });
});
