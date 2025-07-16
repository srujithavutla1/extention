// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureFullscreen' || request.action === 'initiateSelection') {
    captureAndInject(request.action, request.area);
  }
  return true; // Keep the message channel open for async response
});

async function captureAndInject(action, area = null) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab) {
    // Inject the content script first to prepare the page for the modal
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    // Send the captured image data and the action to the content script
    chrome.tabs.sendMessage(tab.id, {
      action: action,
      dataUrl: dataUrl,
      area: area
    });
  }
}