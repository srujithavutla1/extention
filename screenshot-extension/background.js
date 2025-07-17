let collectedData = {}; // Store data for the current capture session
// Keep track of tabs where debugger is attached for cleaner detachment
const attachedDebuggerTabs = new Set();
// A simple way to track which tab's debugger events we are currently collecting for the report
let currentCollectingTabId = null;

// Global debugger event listener to avoid re-adding it multiple times
// This function will collect network and console logs into `collectedData`
// but only if the event source matches `currentCollectingTabId`.
function debuggerEventListener(source, method, params) {
    // Only process events if this event comes from the tab we are currently debugging for the report
    if (source.tabId === currentCollectingTabId && attachedDebuggerTabs.has(source.tabId)) {
        if (method === 'Network.requestWillBeSent') {
            if (!collectedData.networkCalls) collectedData.networkCalls = [];
            collectedData.networkCalls.push({
                requestId: params.requestId,
                url: params.request.url,
                method: params.request.method,
                timestamp: new Date(params.timestamp * 1000).toLocaleString(), // Convert to milliseconds
                // You can add more details here if needed, e.g., headers, body, etc.
                // headers: params.request.headers // Example
            });
        } else if (method === 'Network.responseReceived') {
            // Optional: Capture response details
            if (!collectedData.networkCalls) collectedData.networkCalls = [];
            const call = collectedData.networkCalls.find(c => c.requestId === params.requestId);
            if (call) {
                call.statusCode = params.response.status;
                call.statusText = params.response.statusText;
                call.mimeType = params.response.mimeType;
            }
        }
        else if (method === 'Log.entryAdded') {
            if (!collectedData.consoleLogs)
                collectedData.consoleLogs = [];
            collectedData.consoleLogs.push({
                level: params.entry.level,
                text: params.entry.text,
                timestamp: new Date(params.entry.timestamp).toLocaleString(),
                url: params.entry.url || 'N/A',
                lineNumber: params.entry.lineNumber || 'N/A',
            });
        }
    }
}

// Add the debugger event listener once when the service worker starts
if (!chrome.debugger.onEvent.hasListener(debuggerEventListener)) {
    chrome.debugger.onEvent.addListener(debuggerEventListener);
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureFullscreen' || request.action === 'initiateSelection') {
        captureAndInject(request.action, request.area);
    } else if (request.action === 'sendReportData') {
        // This message would come from content.js after it gathers client-side info
        collectedData = { ...collectedData, ...request.payload };

        // --- IMPORTANT: Detach debugger AFTER collecting all data and BEFORE opening report ---
        const tabIdToDetach = sender.tab.id;

        // Reset currentCollectingTabId as this session is concluding
        currentCollectingTabId = null;

        if (tabIdToDetach && attachedDebuggerTabs.has(tabIdToDetach)) {
            try {
                chrome.debugger.detach({ tabId: tabIdToDetach });
                attachedDebuggerTabs.delete(tabIdToDetach); // Remove from our tracking set
                console.log(`Debugger detached from tab ${tabIdToDetach} after data collection.`);
            } catch (e) {
                console.error(`Error detaching debugger from tab ${tabIdToDetach}:`, e);
            }
        }
        // Now, open a new tab to display the report
        chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });

    } else if (request.action === 'getReportData') {
        // Message from report.js to get the data to display
        sendResponse(collectedData);
    }
    return true; // Keep the message channel open for async response
});

async function captureAndInject(action, area = null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.id) { // Ensure tab and tab.id exist
        // Clear previous data for a new capture session
        collectedData = {
            networkCalls: [], // Initialize explicitly
            consoleLogs: [],  // Initialize explicitly
            debuggerWarning: "Failed to attach debugger. Network and console logs may be incomplete." // Default warning
        };

        currentCollectingTabId = tab.id; // Set the tab ID we are currently collecting data for

        // Attempt to attach debugger API for network/console logs
        // THIS REQUIRES "debugger" permission and user acceptance of the warning
        try {
            // Detach any existing debugger connection from this tab (if left over from a previous session)
            if (attachedDebuggerTabs.has(tab.id)) {
                try {
                    await chrome.debugger.detach({ tabId: tab.id });
                    attachedDebuggerTabs.delete(tab.id);
                    console.log(`Detached stale debugger from tab ${tab.id}.`);
                } catch (detachError) {
                    console.warn(`Could not detach existing debugger from tab ${tab.id} before re-attaching:`, detachError);
                }
            }

            await chrome.debugger.attach({ tabId: tab.id }, '1.3'); // Use latest protocol version
            attachedDebuggerTabs.add(tab.id); // Mark this tab as having an attached debugger
            console.log(`Debugger attached to tab ${tab.id}`);

            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Log.enable'); // Enable Log domain for console messages

            // Clear the warning if attachment was successful
            collectedData.debuggerWarning = null;

            // --- IMPORTANT CHANGE: Force a reload to capture network requests from page load ---
            console.log(`Reloading tab ${tab.id} to capture network events...`);
            await chrome.tabs.reload(tab.id, { bypassCache: true }); // bypassCache ensures fresh requests

            // Give a small delay to allow the reload to begin and initial requests to fire
            // This is crucial to let the debugger capture initial requests.
            await new Promise(resolve => setTimeout(resolve, 1500)); // Increased delay to 1.5 seconds

        } catch (e) {
            console.warn("Could not attach debugger API. This is usually due to user declining the prompt or DevTools being open.", e);
            // debuggerWarning is already set as default, no need to re-set.
        }

        // Inject the content script first to prepare the page for the modal and gather client-side info
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
        });

        // Capture the visible tab AFTER debugger is attached and reload has happened.
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

        // Store the screenshot data temporarily
        collectedData.screenshotDataUrl = dataUrl;
        collectedData.screenshotAction = action;
        collectedData.screenshotArea = area;

        // Send a message to content.js to initiate the screenshot processing
        // and then to gather client-side data.
        // content.js will then send a 'sendReportData' message back to background.js
        // once it has all its info, which will trigger the report tab.
        chrome.tabs.sendMessage(tab.id, {
            action: action,
            dataUrl: dataUrl,
            area: area,
            // Request content.js to send client-side info after screenshot processing
            requestClientInfo: true
        });
    }
}


chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedDebuggerTabs.has(tabId)) {
        try {
            chrome.debugger.detach({ tabId: tabId });
            attachedDebuggerTabs.delete(tabId);
            if (currentCollectingTabId === tabId) {
                currentCollectingTabId = null; // Clear if the closed tab was the one we were collecting for
            }
            console.log(`Debugger detached from tab ${tabId} because tab was closed.`);
        } catch (e) {
            console.error(`Error detaching debugger from tab ${tabId} on close:`, e);
        }
    }
});

// Detach debugger when the tab navigates to a new page (main frame only)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    // Only detach if this specific tab has an attached debugger from our extension
    // and it's the main frame navigation (frameId === 0)
    if (details.frameId === 0 && attachedDebuggerTabs.has(details.tabId)) {
        try {
            chrome.debugger.detach({ tabId: details.tabId });
            attachedDebuggerTabs.delete(details.tabId);
            if (currentCollectingTabId === details.tabId) {
                currentCollectingTabId = null; // Clear if the navigating tab was the one we were collecting for
            }
            console.log(`Debugger detached from tab ${details.tabId} due to navigation.`);
        } catch (e) {
            console.error(`Error detaching debugger from tab ${details.tabId} on navigation:`, e);
        }
    }
}, { url: [{ schemes: ["http", "https"] }] }); // Listen for navigations on HTTP/HTTPS pages