// popup.js

document.addEventListener("DOMContentLoaded", () => {
  // Initialize popup state
  initializePopup();
  
  // Listen for storage changes to update button states
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.recordingState) {
      updateButtons(changes.recordingState.newValue);
    }
  });

  // Button event listeners
  document.getElementById("startBtn").onclick = () => sendCommand("start");
  document.getElementById("pauseBtn").onclick = () => sendCommand("pause");
  document.getElementById("resumeBtn").onclick = () => sendCommand("resume");
  document.getElementById("stopBtn").onclick = () => sendCommand("stop");
  document.getElementById("tabRecordBtn").onclick = () => sendCommand("tabRecord");

  // Screenshot buttons
  document.getElementById("fullPageBtn").onclick = () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_FULL" });
  };

  document.getElementById("areaBtn").onclick = () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_AREA" });
  };
});

// Initialize popup state and check current tab validity
async function initializePopup() {
  try {
    // Get recording state
    const { recordingState } = await chrome.storage.local.get("recordingState");
    updateButtons(recordingState || {});
    
    // Check current tab validity and show warning if needed
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    checkTabValidity(tab);
  } catch (e) {
    console.warn("Failed to initialize popup:", e.message);
  }
}

// Check if current tab is valid and show warning if not
function checkTabValidity(tab) {
  if (!isValidUrl(tab.url)) {
    showTabWarning(tab);
    disableAllButtons();
  } else {
    hideTabWarning();
    // Re-enable buttons based on recording state
    chrome.storage.local.get("recordingState", ({ recordingState }) => {
      updateButtons(recordingState || {});
    });
  }
}

// Check if URL is valid for extension operations
function isValidUrl(url) {
  if (!url) return false;
  
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'edge:', 'about:'];
  const restrictedUrls = ['chrome://newtab/', 'edge://newtab/', 'about:newtab'];
  
  if (restrictedProtocols.some(protocol => url.startsWith(protocol))) {
    return false;
  }
  
  if (restrictedUrls.some(restrictedUrl => url === restrictedUrl)) {
    return false;
  }
  
  return true;
}

// Get URL type for display
function getUrlType(url) {
  if (!url) return "unknown";
  if (url.startsWith('chrome:')) return "Chrome internal";
  if (url.startsWith('chrome-extension:')) return "extension";
  if (url.startsWith('edge:')) return "Edge internal";
  if (url.startsWith('about:')) return "browser internal";
  if (url.startsWith('moz-extension:')) return "Firefox extension";
  return "restricted";
}

// Show warning for invalid tabs
function showTabWarning(tab) {
  const urlType = getUrlType(tab.url);
  
  // Create or update warning element
  let warning = document.getElementById('tab-warning');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'tab-warning';
    warning.style.cssText = `
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      color: #856404;
      padding: 10px;
      margin-bottom: 15px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.4;
    `;
    document.body.insertBefore(warning, document.body.firstChild);
  }
  
  warning.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 5px;">Extension Not Available</div>
    <div>This extension cannot work on <strong>${urlType}</strong> pages.</div>
    <div style="margin-top: 5px; font-size: 11px; opacity: 0.8;">
      Please navigate to a regular website (http:// or https://) to use recording and screenshot features.
    </div>
  `;
}

// Hide tab warning
function hideTabWarning() {
  const warning = document.getElementById('tab-warning');
  if (warning) {
    warning.remove();
  }
}

// Disable all action buttons when on invalid tab
function disableAllButtons() {
  const buttons = ['startBtn', 'pauseBtn', 'resumeBtn', 'stopBtn', 'tabRecordBtn', 'fullPageBtn', 'areaBtn'];
  buttons.forEach(buttonId => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = true;
      button.style.opacity = '0.5';
    }
  });
}

// Update button states based on recording status
function updateButtons(state) {
  const buttons = {
    startBtn: !state.isRecording,
    pauseBtn: state.isRecording && !state.isPaused,
    resumeBtn: state.isPaused,
    stopBtn: state.isRecording,
    tabRecordBtn: !state.isRecording,
    fullPageBtn: !state.isRecording,
    areaBtn: !state.isRecording
  };
  
  Object.entries(buttons).forEach(([buttonId, enabled]) => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = !enabled;
      button.style.opacity = enabled ? '1' : '0.5';
    }
  });
}

// Send command to background script
function sendCommand(action) {
  chrome.runtime.sendMessage({ action });
  if (action !== 'pause' && action !== 'resume') {
    window.close();
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "showAlert") {
    showAlert(msg.alertData);
  }
});

// Show alert in popup
function showAlert(alertData) {
  // Remove any existing alerts
  const existingAlerts = document.querySelectorAll('.popup-alert');
  existingAlerts.forEach(alert => alert.remove());
  
  // Create alert element
  const alert = document.createElement('div');
  alert.className = 'popup-alert';
  alert.style.cssText = `
    background: #f8d7da;
    border: 1px solid #f5c6cb;
    color: #721c24;
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 15px;
    font-size: 12px;
    line-height: 1.4;
    position: relative;
  `;

  alert.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 5px;">${alertData.title}</div>
    <div>${alertData.message}</div>
    <div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">
      Current page: ${alertData.urlType} page
    </div>
    <button onclick="this.parentElement.remove()" style="
      position: absolute;
      top: 5px;
      right: 8px;
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      color: #721c24;
      padding: 0;
      line-height: 1;
    ">×</button>
  `;

  // Insert at the top of the popup
  document.body.insertBefore(alert, document.body.firstChild);

  // Auto-remove after 8 seconds
  setTimeout(() => {
    if (alert.parentElement) {
      alert.remove();
    }
  }, 8000);
}

// Listen for tab changes to update popup state
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    checkTabValidity(tab);
  } catch (e) {
    console.warn("Failed to check new active tab:", e.message);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    try {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab && currentTab.id === tabId) {
        checkTabValidity(currentTab);
      }
    } catch (e) {
      console.warn("Failed to check updated tab:", e.message);
    }
  }
});
