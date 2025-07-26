// background.js

let recordingState = {
  isRecording: false,
  isPaused: false,
  tabId: null,
  chunks: []
};

let browserLogs = [];
let userActions = [];

let networkCalls = {
  requests: {}, // To store in-flight requests by requestId (detailed objects)
  networkLogs: [], // This will now store the final, formatted entries for the table
};

// Map to store timing information
let requestTimings = {};

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "CAPTURE_FULL") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!isValidUrl(tabs[0].url)) {
        await sendInvalidUrlAlert(tabs[0], "screenshot");
        return;
      }
      
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            files: ["content.js"],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.warn("⚠️ Script injection failed:", chrome.runtime.lastError.message);
              return;
            }
            chrome.tabs.sendMessage(tabs[0].id, {
              type: "SHOW_PREVIEW",
              dataUrl,
              filename: "fullpage.png",
            });
          }
        );
      });
    });
  } else if (msg.type === "CAPTURE_AREA") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!isValidUrl(tabs[0].url)) {
        await sendInvalidUrlAlert(tabs[0], "area screenshot");
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          files: ["content.js"],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ Script injection failed:", chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.sendMessage(tabs[0].id, { type: "START_AREA_SELECTION" });
        }
      );
    });
  } else if (msg.type === "CAPTURE_SELECTION") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "CROP_IMAGE",
        dataUrl,
        crop: {
          x: msg.x,
          y: msg.y,
          width: msg.width,
          height: msg.height,
        },
      });
    });
  } else if (msg.type === "USER_ACTIVITY_LOG") {
    userActions.push(msg.logEntry);
  }
});

// ✅ Add handler for broadcasting to active tab (for offscreen compatibility)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "broadcastToActiveTab") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && isValidUrl(tabs[0].url)) {
        chrome.tabs.sendMessage(tabs[0].id, msg.payload, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ Failed to broadcast to active tab:", chrome.runtime.lastError.message);
          } else {
            console.log("📨 Delivered action to tab:", msg.payload);
          }
        });
      } else {
        await sendInvalidUrlAlert(tabs[0], "recording control");
      }
    });
    return;
  }
});

// ✅ Enhanced object properties handler for deep expansion
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getObjectProperties') {

    chrome.debugger.sendCommand(
      { tabId: recordingState.tabId },
      'Runtime.getProperties',
      {
        objectId: msg.objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true
      },
      (result) => {
        if (chrome.runtime.lastError) {
          console.warn('getObjectProperties failed:', chrome.runtime.lastError.message);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ properties: result.result || [] });
        }
      }
    );
    return true; // Indicates async response
  }
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  // ✅ Handle stop message from content.js first (without tab validation)
  if (msg.action === "stop") {
    recordingState.isRecording = false;
    recordingState.isPaused = false;
    
    const currentTab = await getActiveTab();
    sendSafeMessage(currentTab.id, { type: "RECORDER_STOP" });
    
    try {
      chrome.debugger.detach({ tabId: recordingState.tabId });
    } catch (e) {
      console.warn("⚠️ Debugger detach on stop failed:", e.message);
    }

    const stopMetadata = await getMetadata(currentTab);
    await chrome.storage.local.set({
      recordingState,
      browserLogs,
      partialMetadata: stopMetadata,
      userActions,
      networkCalls
    });

    chrome.runtime.sendMessage({ to: "offscreen", action: "stop" });

    const { tabCaptureTabId } = await chrome.storage.local.get("tabCaptureTabId");
    if (tabCaptureTabId) {
      sendSafeMessage(tabCaptureTabId, { to: "tab-capture", action: "stopCapture" });
    }

    if (recordingState?.tabId) {
      sendSafeMessage(recordingState.tabId, { action: "removeStopButton" });
    }
    
    console.log("🔴 Recording stopped from content script");
    return;
  }

  const tab = await getActiveTab();
  
  // ✅ Check if we can work with this tab (for other actions)
  if (!isValidUrl(tab.url)) {
    await sendInvalidUrlAlert(tab, "recording");
    return;
  }

  switch (msg.action) {
    case "start":
      recordingState = {
        isRecording: true,
        isPaused: false,
        tabId: tab.id,
        chunks: [],
      };
      userActions = [];
      browserLogs = [];
      networkCalls = {
        requests: {}, // Reset requests
        networkLogs: [], // Reset network logs
      };
      requestTimings = {}; // Reset timings

      await chrome.storage.local.set({ recordingState });
      await startOffscreen();
      chrome.runtime.sendMessage({ to: "offscreen", action: "start" });

      // ✅ Enhanced debugger setup with comprehensive error capturing
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        
        chrome.debugger.attach({ tabId: tab.id }, "1.3", () => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ Debugger attach failed:", chrome.runtime.lastError.message);
          } else {
            // ✅ Enable all necessary domains for comprehensive logging
            chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable", {}, () => {
              console.log("✅ Runtime domain enabled for console logging");
            });
            
            chrome.debugger.sendCommand({ tabId: tab.id }, "Log.enable", {}, () => {
              console.log("✅ Log domain enabled");
            });
            
            chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable", {}, () => {
              console.log("✅ Network domain enabled");
            });

            // ✅ Enable Security domain to catch security errors
            chrome.debugger.sendCommand({ tabId: tab.id }, "Security.enable", {}, () => {
              console.log("✅ Security domain enabled for CORS errors");
            });

            // ✅ Enable Page domain to catch additional errors
            chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable", {}, () => {
              console.log("✅ Page domain enabled");
            });

            // ✅ Set up enhanced console monitoring
            chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.setAsyncCallStackDepth", { maxDepth: 32 });
            
            // ✅ Enable all console levels explicitly
            chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.setConsoleMessage", {
              level: "verbose"
            });
          }
        });
        
        sendSafeMessage(tab.id, { type: "RECORDER_START" });
        sendSafeMessage(tab.id, { action: "showStopButton" });
      } catch (e) {
        console.warn("⚠️ Script injection failed:", e.message);
      }
      
      console.log("🟢 Recording started and controls shown on page");
      break;

    case "pause":
      recordingState.isPaused = true;
      const pauseMetadata = await getMetadata(tab);
      await chrome.storage.local.set({
        recordingState,
        browserLogs,
        partialMetadata: pauseMetadata,
        userActions,
        networkCalls
      });

      chrome.runtime.sendMessage({ to: "offscreen", action: "pause" });
      
      const { tabCaptureTabId: pauseTabId } = await chrome.storage.local.get("tabCaptureTabId");
      if (pauseTabId) {
        sendSafeMessage(pauseTabId, { to: "tab-capture", action: "pause" });
      }

      sendSafeMessage(tab.id, { type: "RECORDER_STOP" });
      
      try {
        chrome.debugger.detach({ tabId: recordingState.tabId });
      } catch (e) {
        console.warn("⚠️ Debugger detach failed:", e.message);
      }
      break;

    case "resume":
      recordingState.isPaused = false;
      await chrome.storage.local.set({ recordingState });

      chrome.runtime.sendMessage({ to: "offscreen", action: "resume" });
      
      const { tabCaptureTabId: resumeTabId } = await chrome.storage.local.get("tabCaptureTabId");
      if (resumeTabId) {
        sendSafeMessage(resumeTabId, { to: "tab-capture", action: "resume" });
      }

      // ✅ Re-enable all debugger domains on resume with enhanced error capturing
      chrome.debugger.attach({ tabId: tab.id }, "1.3", () => {
        if (chrome.runtime.lastError) {
          console.warn("⚠️ Resume debugger attach failed:", chrome.runtime.lastError.message);
        } else {
          chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable");
          chrome.debugger.sendCommand({ tabId: tab.id }, "Log.enable");
          chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable");
          chrome.debugger.sendCommand({ tabId: tab.id }, "Security.enable");
          chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");
          chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.setAsyncCallStackDepth", { maxDepth: 32 });
        }
      });
      chrome.tabs.sendMessage(tab.id, { type: "RECORDER_START" });
      break;
      
    case "tabRecord": {
      const tab = await getActiveTab();
      
      // ✅ Additional check for tab recording
      if (!isValidUrl(tab.url)) {
        await sendInvalidUrlAlert(tab, "tab recording");
        return;
      }

      recordingState = {
        isRecording: true,
        isPaused: false,
        tabId: tab.id,
        chunks: []
      };
      userActions = [];
      browserLogs = [];
      networkCalls = {
        requests: {}, // Reset requests
        networkLogs: [], // Reset network logs
      };
      requestTimings = {}; // Reset timings
        
      chrome.windows.create({
        url: chrome.runtime.getURL("tab-capture.html"),
        type: "popup",
        focused: false,
        width: 10,
        height: 10
      }, async (win) => {
        await chrome.storage.local.set({ recordingState });

        if (win.tabs && win.tabs[0]) {
          await chrome.storage.local.set({ tabCaptureTabId: win.tabs[0].id });
        } else {
          const tabs = await chrome.tabs.query({ windowId: win.id });
          if (tabs.length > 0) {
            await chrome.storage.local.set({ tabCaptureTabId: tabs[0].id });
          }
        }
        console.log("🟢 Tab Recording window created");
      });

      // ✅ Enhanced debugger setup for tab recording with all domains
      try {
        chrome.debugger.attach({ tabId: tab.id }, "1.3", () => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ Tab record debugger attach failed:", chrome.runtime.lastError.message);
          } else {
            chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable", {}, () => {
              console.log("✅ Tab recording: Runtime domain enabled");
            });
            chrome.debugger.sendCommand({ tabId: tab.id }, "Log.enable", {}, () => {
              console.log("✅ Tab recording: Log domain enabled");
            });
            chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable", {}, () => {
              console.log("✅ Tab recording: Network domain enabled");
            });
            chrome.debugger.sendCommand({ tabId: tab.id }, "Security.enable", {}, () => {
              console.log("✅ Tab recording: Security domain enabled");
            });
            chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable", {}, () => {
              console.log("✅ Tab recording: Page domain enabled");
            });
            chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.setAsyncCallStackDepth", { maxDepth: 32 });
          }
        });
      } catch (e) {
        console.warn("⚠️ Tab record debugger error:", e.message);
      }

      sendSafeMessage(tab.id, { type: "RECORDER_START" });
      sendSafeMessage(tab.id, { action: "showStopButton" });
      sendSafeMessage(tab.id, { action: "showRecordingController" });
      
      console.log("🟢 Tab Recording started and controls shown on page");
      break;
    }
  }
});

// ✅ CONSOLIDATED VIDEO READY HANDLER
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if ((msg.from === "offscreen" || msg.from === "tab-capture") && msg.action === "videoReady") {
    console.log(`💾 Received video from ${msg.from}`);
    
    await chrome.storage.local.set({ recordedVideo: msg.data });
    console.log("✅ saved video to storage");

    const { recordingState } = await chrome.storage.local.get("recordingState");
    const tabId = recordingState?.tabId;
    if (!tabId) return;

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isValidUrl(tab.url)) {
        await sendInvalidUrlAlert(tab, "preview");
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      
      sendSafeMessage(tabId, { action: "showPreview" });
      await chrome.tabs.update(tabId, { active: true });
    } catch (e) {
      console.error(`❌ Video ready handling failed for tab ${tabId}:`, e.message);
    }

    await chrome.storage.local.set({
      recordingState: {
        isRecording: false,
        isPaused: false,
        tabId: null,
        chunks: []
      }
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    const { recordingState } = await chrome.storage.local.get("recordingState");
    if (recordingState?.isRecording && recordingState?.tabId === tabId) {
      
      if (!isValidUrl(tab.url)) {
        await sendInvalidUrlAlert(tab, "recording continuation");
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        
        sendSafeMessage(tabId, { type: "RECORDER_START" });
        sendSafeMessage(tabId, { action: "showStopButton" });
        sendSafeMessage(tabId, { action: "showRecordingController" });
        
        console.log("🔁 Page refreshed - controls re-injected");
      } catch (e) {
        console.warn("⚠️ Re-injection after refresh failed:", e.message);
      }
    }
  }
});

// ✅ Helper Functions
function isValidUrl(url) {
  if (!url) return false;
  
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'edge:', 'about:'];
  const restrictedUrls = ['chrome://newtab/', 'edge://newtab/', 'about:newtab'];
  
  // Check if URL starts with restricted protocols
  if (restrictedProtocols.some(protocol => url.startsWith(protocol))) {
    return false;
  }
  
  // Check specific restricted URLs
  if (restrictedUrls.some(restrictedUrl => url === restrictedUrl)) {
    return false;
  }
  
  return true;
}

// ✅ Improved error handling for sendInvalidUrlAlert
async function sendInvalidUrlAlert(tab, action) {
  const urlType = getUrlType(tab.url);
  const message = `Cannot perform ${action} on ${urlType} pages. Please navigate to a regular website (http:// or https://) and try again.`;
  
  // Only try to send message if we're sure we can
  try {
    // Check if we can send runtime messages
    const extensionId = chrome.runtime.id;
    if (!extensionId) {
      console.warn(`🚫 ${action} blocked on ${urlType}: ${tab.url} (extension context invalid)`);
      return;
    }

    // Use a promise-based approach with timeout
    await Promise.race([
      chrome.runtime.sendMessage({
        action: "showAlert",
        alertData: {
          type: "error",
          title: "Invalid Page",
          message: message,
          url: tab.url,
          urlType: urlType,
          actionAttempted: action
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), 100)
      )
    ]);
  } catch (e) {
    // Silently handle the error - popup might not be open
    console.warn(`🚫 ${action} blocked on ${urlType}: ${tab.url} (alert not delivered)`);
  }
}

function getUrlType(url) {
  if (!url) return "unknown";
  if (url.startsWith('chrome:')) return "Chrome internal";
  if (url.startsWith('chrome-extension:')) return "extension";
  if (url.startsWith('edge:')) return "Edge internal";
  if (url.startsWith('about:')) return "browser internal";
  if (url.startsWith('moz-extension:')) return "Firefox extension";
  return "restricted";
}

function sendSafeMessage(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`⚠️ Message failed to tab ${tabId}:`, chrome.runtime.lastError.message);
    }
  });
}

async function getMetadata(tab) {
  const url = tab.url;
  let country = "Unknown";
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    country = data.country_name || "Unknown";
  } catch (err) {
    console.warn("Failed to fetch geo info:", err.message);
  }
  return { url, country };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Record current tab screen",
    });
  }
}

// Helper to get domain from a URL
function getDomain(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (e) {
    return "N/A";
  }
}

// Helper to get file name from a URL
function getFileName(url) {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const parts = pathname.split('/');
    let filename = parts[parts.length - 1];
    if (filename === '') { // If URL ends with /, use hostname
        filename = parsedUrl.hostname;
    }
    // Remove query parameters from filename
    const queryIndex = filename.indexOf('?');
    if (queryIndex !== -1) {
      filename = filename.substring(0, queryIndex);
    }
    return filename || parsedUrl.hostname; // Fallback to hostname if no specific file name
  } catch (e) {
    return url; // Return full URL if parsing fails
  }
}

// Function to format bytes into human-readable format
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Function to create synthetic CORS error log entries
function createCORSErrorLogEntry(url, origin, timestamp) {
  return {
    type: 'error',
    timestamp: timestamp || Date.now() / 1000,
    time: new Date(timestamp ? timestamp * 1000 : Date.now()).toLocaleTimeString(),
    args: [{
      type: 'string',
      value: `Access to resource at '${url}' from origin '${origin}' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.`,
      isExpandable: false
    }],
    stackTrace: null,
    source: 'CORS_SYNTHETIC',
    isSynthetic: true
  };
}

// ✅ Enhanced Console Log Processing with CORS error synthesis
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!recordingState?.isRecording || recordingState.tabId !== source.tabId)
    return;
  
  // Ensure the request exists in our tracking object
  let requestData = networkCalls.requests[params.requestId];

  if (method === "Runtime.consoleAPICalled") {
    const { type, args = [], timestamp, executionContextId, stackTrace } = params;
    
    // Format timestamp
    const logTime = new Date(timestamp * 1000).toLocaleTimeString();
    
    console.log(`📝 Capturing console.${type}() with ${args.length} arguments`);
    
    // ✅ Enhanced argument processing with better error handling
    const processedArgs = await Promise.all(args.map(async (arg, index) => {
      try {
        if (arg.type === 'object' && arg.objectId) {
          // Get full object properties using Runtime.getProperties
          try {
            const propertiesResult = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Timeout getting object properties'));
              }, 2000); // 2 second timeout
              
              chrome.debugger.sendCommand(
                { tabId: source.tabId },
                'Runtime.getProperties',
                { 
                  objectId: arg.objectId,
                  ownProperties: true,
                  accessorPropertiesOnly: false,
                  generatePreview: true
                },
                (result) => {
                  clearTimeout(timeout);
                  if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                  } else {
                    resolve(result);
                  }
                }
              );
            });

            return {
              type: 'object',
              className: arg.className || 'Object',
              description: arg.description || '',
              preview: arg.preview,
              objectId: arg.objectId,
              properties: propertiesResult.result || [], // Full properties
              isExpandable: true
            };
          } catch (error) {
            console.warn(`Failed to get object properties for arg ${index}:`, error);
            // Fallback to preview-only object
            return {
              type: 'object',
              className: arg.className || 'Object',
              description: arg.description || '',
              preview: arg.preview,
              objectId: arg.objectId,
              isExpandable: true
            };
          }
        } else if (arg.type === 'function') {
          return {
            type: 'function', 
            description: arg.description || 'function()',
            isExpandable: false
          };
        } else if (arg.type === 'string') {
          return {
            type: 'string',
            value: arg.value || '',
            isExpandable: false
          };
        } else if (arg.type === 'number' || arg.type === 'boolean') {
          return {
            type: arg.type,
            value: arg.value,
            isExpandable: false
          };
        } else if (arg.type === 'undefined') {
          return {
            type: 'undefined',
            value: 'undefined',
            isExpandable: false
          };
        } else if (arg.type === 'symbol') {
          return {
            type: 'symbol',
            value: arg.description || 'Symbol()',
            isExpandable: false
          };
        } else {
          // Fallback for other types
          return {
            type: arg.type || 'unknown',
            value: arg.value || arg.description || '[Unknown]',
            description: arg.description,
            isExpandable: !!arg.objectId
          };
        }
      } catch (error) {
        console.warn(`Error processing console argument ${index}:`, error);
        return {
          type: 'error',
          value: `[Error processing argument: ${error.message}]`,
          isExpandable: false
        };
      }
    }));

    // Create log entry
    const logEntry = {
      type: type, // log, warn, error, info, debug, etc.
      timestamp: timestamp,
      time: logTime,
      args: processedArgs,
      stackTrace: stackTrace,
      executionContextId
    };

    // Add to browser logs
    browserLogs.push(logEntry);
    
    console.log(`✅ Console ${type} captured:`, { 
      timestamp: logTime, 
      argsCount: args.length,
      processedArgsCount: processedArgs.length 
    });
  }

  // ✅ Enhanced error handling for Log.entryAdded
  if (method === "Log.entryAdded") {
    const { entry } = params;
    if (entry) {
      console.log(`📝 Log entry captured: ${entry.level} - ${entry.text}`);
      
      // Create a log entry for Log.entryAdded
      const logEntry = {
        type: entry.level, // error, warning, info, log, debug
        timestamp: entry.timestamp / 1000, // Convert to seconds
        time: new Date(entry.timestamp).toLocaleTimeString(),
        args: [{
          type: 'string',
          value: entry.text || '',
          isExpandable: false
        }],
        stackTrace: entry.stackTrace,
        source: 'Log.entryAdded'
      };

      browserLogs.push(logEntry);
    }
  }

  // ✅ NEW: Security error capturing for CORS
  if (method === "Security.securityStateChanged") {
    const { securityState, explanations } = params;
    if (explanations && explanations.length > 0) {
      explanations.forEach(explanation => {
        if (explanation.description && explanation.description.includes('CORS')) {
          const logEntry = {
            type: 'error',
            timestamp: Date.now() / 1000,
            time: new Date().toLocaleTimeString(),
            args: [{
              type: 'string',
              value: `Security Error: ${explanation.description}`,
              isExpandable: false
            }],
            stackTrace: null,
            source: 'Security.securityStateChanged'
          };
          browserLogs.push(logEntry);
          console.log('🔒 Security CORS error captured:', explanation.description);
        }
      });
    }
  }

  // ✅ NEW: Page error capturing for additional errors
  if (method === "Page.javascriptDialogOpening") {
    const { type, message } = params;
    if (message && message.includes('CORS')) {
      const logEntry = {
        type: 'error',
        timestamp: Date.now() / 1000,
        time: new Date().toLocaleTimeString(),
        args: [{
          type: 'string',
          value: `Page Dialog Error: ${message}`,
          isExpandable: false
        }],
        stackTrace: null,
        source: 'Page.javascriptDialogOpening'
      };
      browserLogs.push(logEntry);
      console.log('📄 Page CORS error captured:', message);
    }
  }

  if (method === "Network.requestWillBeSent") {
    const { requestId, request, timestamp, type, initiator, redirectResponse } = params;

    // Initialize request data if not present (handles redirects and initial requests)
    if (!networkCalls.requests[requestId]) {
      networkCalls.requests[requestId] = {
        id: requestId,
        name: getFileName(request.url),
        url: request.url,
        method: request.method,
        status: request.method === 'OPTIONS' ? "Preflight..." : "Pending...", // ✅ Better initial status
        domain: getDomain(request.url),
        type: type || "Other", // Mime type or general type
        frame: initiator?.url || "", // Can be used for frame info
        size: 0, // Will be filled later
        time: 0, // Will be filled later (total time)
        waterfallStart: timestamp * 1000, // Unix milliseconds for waterfall calculation
        waterfallEnd: 0, // Will be filled later
        // Additional properties for enhanced logging
        requestHeaders: sanitizeHeaders(request.headers),
        responseHeaders: {}, // Will be filled later
        corsError: false,
        isPreflight: request.method === "OPTIONS" && !!request.headers['access-control-request-method'],
        originalRequestUrl: request.url, // Useful for tracking redirects
      };
      // Store initial timestamp for waterfall calculation
      requestTimings[requestId] = {
        requestWillBeSent: timestamp * 1000
      };
    } else {
        // This is a redirect, update the URL and name if it's new
        networkCalls.requests[requestId].url = request.url;
        networkCalls.requests[requestId].name = getFileName(request.url);
        networkCalls.requests[requestId].method = request.method;
        networkCalls.requests[requestId].domain = getDomain(request.url);
    }
  }

  if (method === "Network.responseReceived") {
    const { requestId, response, timestamp, type } = params;
    requestData = networkCalls.requests[requestId]; // Re-fetch in case it was created by requestWillBeSent just now

    if (requestData) {
      // ✅ Enhanced fix: Handle all edge cases for status
      let status = response.status;
      let statusText = response.statusText;
      
      // Handle undefined/null status
      if (status === undefined || status === null) {
        // For OPTIONS requests, check if CORS headers are present (indicates success)
        if (requestData.method === 'OPTIONS' && response.headers && 
            (response.headers['access-control-allow-origin'] || 
             response.headers['Access-Control-Allow-Origin'])) {
          status = 200;
          statusText = 'OK (Preflight)';
        } else {
          status = 0;
          statusText = 'Unknown';
        }
      }
      
      // Handle undefined statusText
      if (statusText === undefined || statusText === null) {
        statusText = '';
      }
      
      // Set the final status string
      requestData.status = statusText ? `${status} ${statusText}` : `${status}`;
      
      requestData.responseHeaders = sanitizeHeaders(response.headers);
      requestData.type = type || requestData.type; // Update type if more specific
      
      // Check for CORS errors
      if (status === 0 && statusText !== 'OK (Preflight)') {
          requestData.corsError = true;
          requestData.status = "CORS ERROR";
      }
      
      // Store response received timestamp for waterfall
      if (requestTimings[requestId]) {
        requestTimings[requestId].responseReceived = timestamp * 1000;
      }
    }
  }

  if (method === "Network.dataReceived") {
      const { requestId, encodedDataLength } = params;
      requestData = networkCalls.requests[requestId];
      if (requestData) {
          requestData.size += encodedDataLength; // Accumulate size
      }
  }

  if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    const { requestId, timestamp, encodedDataLength, errorText } = params;
    requestData = networkCalls.requests[requestId];

    if (requestData) {
      // Set the final end time for waterfall and total time
      requestData.waterfallEnd = timestamp * 1000;
      requestData.time = parseFloat(((requestData.waterfallEnd - requestData.waterfallStart) / 1000).toFixed(3)); // Time in seconds

      if (method === "Network.loadingFinished") {
        if (requestData.status === "Pending..." || requestData.status === "Preflight...") { // If status was never set by responseReceived (e.g., cached)
            requestData.status = "200 OK (Cached)"; // Provide a default for cached or otherwise completed requests
        } else if (!requestData.status.includes("CORS ERROR") && requestData.status.startsWith("0")) {
             // Handle cases where response.status was 0 but not a CORS error (e.g., local file)
             requestData.status = "Completed (Local/Other)";
        }
        requestData.size = encodedDataLength || requestData.size; // Final size if provided
      } else { // Network.loadingFailed
        requestData.status = `Failed (${errorText})`;
        
        // ✅ Enhanced CORS error detection and synthetic log creation
        if (params.blockedReason === "cors" || (errorText && errorText.includes("CORS")) || 
            (errorText && errorText.includes("net::ERR_FAILED") && requestData.method === "OPTIONS")) {
          requestData.corsError = true;
          requestData.status = `CORS ERROR (${errorText})`;
          
          // ✅ Create synthetic console log entry for CORS error
          try {
            const currentTab = await chrome.tabs.get(source.tabId);
            const origin = new URL(currentTab.url).origin;
            const corsLogEntry = createCORSErrorLogEntry(requestData.url, origin, timestamp);
            browserLogs.push(corsLogEntry);
            console.log('🚫 Synthetic CORS error log created for:', requestData.url);
          } catch (e) {
            console.warn('Failed to create synthetic CORS log:', e.message);
          }
        } else if (errorText && errorText.includes("net::ERR_ABORTED")) {
            requestData.status = `Aborted`; // More specific status
        }
      }
      
      // Format the size for display
      requestData.displaySize = formatBytes(requestData.size);
      requestData.displayTime = requestData.time > 0 ? `${(requestData.time * 1000).toFixed(0)} ms` : "(Cached)";
      if (requestData.displayTime === "0 ms" && !requestData.status.includes("Failed") && !requestData.status.includes("CORS ERROR") && !requestData.status.includes("Aborted")) {
          requestData.displayTime = "(Cached)"; // Ensure cached is explicitly set if time is 0 for successful requests
      }

      // Determine the "Type" more accurately for display
      if (requestData.type === 'Other' && requestData.method === 'OPTIONS') {
          requestData.type = requestData.isPreflight ? 'preflight' : 'Other';
      }
      
      // Push the *finalized* request data to networkLogs
      networkCalls.networkLogs.push(requestData);
      
      // Clean up the in-flight request and timings
      delete networkCalls.requests[requestId];
      delete requestTimings[requestId];
    }
  }
});
 
function sanitizeHeaders(headers) {
  const sanitized = {};
  const keysToRemove = ["cookie", "authorization", "set-cookie"];
  for (const key in headers) {
    if (!keysToRemove.includes(key.toLowerCase())) {
      sanitized[key] = headers[key];
    }
  }
  return sanitized;
}
 
function formatHeadersForLog(headers) {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `         ${key}: ${value}`)
    .join("\n");
}
