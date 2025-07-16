// popup.js
document.getElementById('fullscreen-btn').addEventListener('click', () => {
  // Send a message to the background script to start the capture
  chrome.runtime.sendMessage({ action: 'captureFullscreen' });
  window.close(); // Close the popup
});

document.getElementById('select-area-btn').addEventListener('click', () => {
  // Send a message to the background script to inject the selection UI
  chrome.runtime.sendMessage({ action: 'initiateSelection' });
  window.close(); // Close the popup
});