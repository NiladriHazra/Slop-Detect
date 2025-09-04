let stats = {
  totalAnalyses: 0,
  aiDetected: 0,
  totalScore: 0
};

async function loadStats() {
  try {
    const result = await chrome.storage.local.get(['slopDetectStats']);
    if (result.slopDetectStats) {
      stats = { ...stats, ...result.slopDetectStats };
    }
    updateStatsDisplay();
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function updateStatsDisplay() {
  document.getElementById('totalAnalyses').textContent = stats.totalAnalyses;
  document.getElementById('aiDetected').textContent = stats.aiDetected;
  
  const avgScore = stats.totalAnalyses > 0 ? Math.round(stats.totalScore / stats.totalAnalyses) : 0;
  document.getElementById('avgScore').textContent = `${avgScore}%`;
}

async function saveStats() {
  try {
    await chrome.storage.local.set({ slopDetectStats: stats });
  } catch (error) {
    console.error('Error saving stats:', error);
  }
}

async function clearData() {
  if (confirm('Are you sure you want to clear all statistics? This action cannot be undone.')) {
    stats = {
      totalAnalyses: 0,
      aiDetected: 0,
      totalScore: 0
    };
    await saveStats();
    updateStatsDisplay();
  }
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('refreshStats').addEventListener('click', loadStats);
  document.getElementById('clearData').addEventListener('click', clearData);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.slopDetectStats) {
    stats = { ...stats, ...changes.slopDetectStats.newValue };
    updateStatsDisplay();
  }
});
