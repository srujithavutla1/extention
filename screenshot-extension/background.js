let collectedData = {}; // Store data for the current capture session
const attachedDebuggerTabs = new Set();
let currentCollectingTabId = null;

function debuggerEventListener(source, method, params) {
    if (source.tabId === currentCollectingTabId && attachedDebuggerTabs.has(source.tabId)) {
        if (method === 'Network.requestWillBeSent') {
            if (!collectedData.networkCalls) collectedData.networkCalls = [];
            collectedData.networkCalls.push({
                requestId: params.requestId,
                url: params.request.url,
                method: params.request.method,
                timestamp: new Date(params.timestamp * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            });
        } else if (method === 'Network.responseReceived') {
            if (!collectedData.networkCalls) collectedData.networkCalls = [];
            const call = collectedData.networkCalls.find(c => c.requestId === params.requestId);
            if (call) {
                call.statusCode = params.response.status;
                call.statusText = params.response.statusText;
                call.mimeType = params.response.mimeType;
            }
        } else if (method === 'Log.entryAdded') {
            if (!collectedData.consoleLogs)
                collectedData.consoleLogs = [];
            collectedData.consoleLogs.push({
                level: params.entry.level,
                text: params.entry.text,
                timestamp: new Date(params.entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                url: params.entry.url || 'N/A',
                lineNumber: params.entry.lineNumber || 'N/A',
            });
        }
    }
}

if (!chrome.debugger.onEvent.hasListener(debuggerEventListener)) {
    chrome.debugger.onEvent.addListener(debuggerEventListener);
}

// background.js

// ... (existing code) ...

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureFullscreen' || request.action === 'initiateSelection') {
        captureAndInject(request.action, request.area);
    } else if (request.action === 'sendReportData') {
        collectedData = { ...collectedData, ...request.payload };

        const tabIdToDetach = sender.tab.id;

        // Reset currentCollectingTabId as this session is concluding
        currentCollectingTabId = null;

        if (tabIdToDetach && attachedDebuggerTabs.has(tabIdToDetach)) {
            try {
                chrome.debugger.detach({ tabId: tabIdToDetach });
                attachedDebuggerTabs.delete(tabIdToDetach);
                console.log(`Debugger detached from tab ${tabIdToDetach} after data collection.`);
            } catch (e) {
                console.error(`Error detaching debugger from tab ${tabIdToDetach}:`, e);
            }
        }
        // Send back the collectedData to content.js
        sendResponse(collectedData);

    } else if (request.action === 'sendCroppedImageData') { // NEW: Handle cropped image data
        collectedData.screenshotDataUrl = request.dataUrl;
        collectedData.screenshotAction = 'displayCroppedImage'; // Set action appropriately
        // No need to send a response here, content.js will show modal
        // based on this data being available when it requests getReportData
        sendResponse({status: 'ok'}); // Acknowledge receipt
    }
    else if (request.action === 'getReportData') {
        sendResponse(collectedData);
    }
    return true;
});

async function captureAndInject(action, area = null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.id) {
        // Clear previous data for a new capture session
        collectedData = {
            networkCalls: [],
            consoleLogs: [],
            debuggerWarning: "Failed to attach debugger. Network and console logs may be incomplete. Please ensure developer tools are closed and try again, or refresh the page after the prompt."
        };

        currentCollectingTabId = tab.id;

        try {
            if (attachedDebuggerTabs.has(tab.id)) {
                try {
                    await chrome.debugger.detach({ tabId: tab.id });
                    attachedDebuggerTabs.delete(tab.id);
                    console.log(`Detached stale debugger from tab ${tab.id}.`);
                } catch (detachError) {
                    console.warn(`Could not detach existing debugger from tab ${tab.id} before re-attaching:`, detachError);
                }
            }

            await chrome.debugger.attach({ tabId: tab.id }, '1.3');
            attachedDebuggerTabs.add(tab.id);
            console.log(`Debugger attached to tab ${tab.id}`);

            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Log.enable');

            collectedData.debuggerWarning = null;

            // Give a small delay to allow the reload to begin and initial requests to fire
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (e) {
            console.warn("Could not attach debugger API. This is usually due to user declining the prompt or DevTools being open.", e);
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
        });

        // Only capture fullscreen if the action is 'captureFullscreen'.
        // For 'initiateSelection', the content script will handle capture and cropping.
        if (action === 'captureFullscreen') {
            const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
            collectedData.screenshotDataUrl = dataUrl;
            collectedData.screenshotAction = action;
            collectedData.screenshotArea = area;

            chrome.tabs.sendMessage(tab.id, {
                action: action,
                dataUrl: dataUrl,
                area: area,
            });
        } else if (action === 'initiateSelection') {
            // For selection, first capture the full page to allow content script to draw overlay
            // and then crop. We will send the full dataUrl for the content script to work with.
            const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

            // We don't set collectedData.screenshotDataUrl here for selection yet,
            // as it will be set by the content script after cropping.
            // We still send the full dataUrl to content.js for it to display the overlay correctly.
            chrome.tabs.sendMessage(tab.id, {
                action: action, // 'initiateSelection'
                dataUrl: dataUrl, // Full page screenshot for overlay reference
            });
        }
    }
}

// ... (rest of background.js) ...
chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedDebuggerTabs.has(tabId)) {
        try {
            chrome.debugger.detach({ tabId: tabId });
            attachedDebuggerTabs.delete(tabId);
            if (currentCollectingTabId === tabId) {
                currentCollectingTabId = null;
            }
            console.log(`Debugger detached from tab ${tabId} because tab was closed.`);
        } catch (e) {
            console.error(`Error detaching debugger from tab ${tabId} on close:`, e);
        }
    }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0 && attachedDebuggerTabs.has(details.tabId)) {
        try {
            chrome.debugger.detach({ tabId: details.tabId });
            attachedDebuggerTabs.delete(details.tabId);
            if (currentCollectingTabId === details.tabId) {
                currentCollectingTabId = null;
            }
            console.log(`Debugger detached from tab ${details.tabId} due to navigation.`);
        } catch (e) {
            console.error(`Error detaching debugger from tab ${details.tabId} on navigation:`, e);
        }
    }
}, { url: [{ schemes: ["http", "https"] }] });