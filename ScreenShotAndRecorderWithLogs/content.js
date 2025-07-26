// content.js

// -------------------------
// RECORDING PREVIEW HANDLER
// -------------------------
// Helper function to extract filename from URL or path
function getFileName(url) {

    if (!url) return 'N/A';
    try {
        // Remove query parameters and hash
        const cleanUrl = url.split('?')[0].split('#')[0];
        // Extract filename from path
        const parts = cleanUrl.split('/');
        const filename = parts[parts.length - 1];
        // Return filename or 'N/A' if empty
        return filename || 'N/A';
    } catch (error) {
        return 'N/A';
    }
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "showPreview") {
        chrome.storage.local.get(
            [
                "recordedVideo",
                "recordingState",
                "browserLogs",
                "partialMetadata",
                "userActions",
                "networkCalls",
            ],
            ({
                recordedVideo,
                recordingState,
                browserLogs,
                partialMetadata,
                userActions,
                networkCalls,
            }) => {
                console.log(browserLogs);
                if (
                    !recordedVideo ||
                    document.getElementById("recording-preview-modal")
                )
                    return;

                // ⬇️ Grab local metadata from browser context
                const getLocalMetadata = () => {
                    const ua = navigator.userAgent;
                    const osMatch = ua.match(/\(([^)]+)\)/);
                    const os = osMatch ? osMatch[1] : ua;

                    const browserMatch = ua.match(/Chrome\/([\d.]+)/);
                    const browser = browserMatch
                        ? `Chrome ${browserMatch[1]}`
                        : "Unknown";

                    const windowSize = `${window.innerWidth}x${window.innerHeight}`;
                    const timestamp = new Date().toISOString();

                    return { os, browser, windowSize, timestamp };
                };

                const localMeta = getLocalMetadata();
                const metadata = {
                    ...partialMetadata,
                    ...localMeta,
                };

                const metaText = `
URL: ${metadata.url}
Timestamp: ${metadata.timestamp}
OS: ${metadata.os}
Browser: ${metadata.browser}
Window Size: ${metadata.windowSize}
Country: ${metadata.country}
                `.trim();

                // 🎥 Modal Elements
                const overlay = document.createElement("div");
                overlay.id = "recording-preview-modal";
                overlay.style = `
                    position:fixed;
                    top:0; left:0;
                    width:100vw; height:100vh;
                    background:rgba(0,0,0,0.6);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    z-index:99999;
                `;

                const modal = document.createElement("div");
                modal.style = `
                    background:#fff;
                    padding:20px;
                    border-radius:8px;
                    position:relative;
                    max-width:90vw;
                    max-height:90vh;
                    overflow:auto;
                    width:900px;
                    font-family:sans-serif;
                    margin:20px;
                `;

                const closeBtn = document.createElement("button");
                closeBtn.innerText = "❌ Close";
                closeBtn.style =
                    "position:absolute; top:10px; right:10px; cursor: pointer; background: #f44336; color: white; border: none; padding: 8px 12px; border-radius: 4px;";
                closeBtn.onclick = () => overlay.remove();

                const stopBtn = document.createElement("button");
                stopBtn.innerText = "⏹ Stop Recording";
                stopBtn.style = "margin-top: 12px; cursor:pointer; background: #ef5350; color: white; border: none; padding: 8px 12px; border-radius: 4px; margin-right: 10px;";
                stopBtn.onclick = () => {
                    chrome.runtime.sendMessage({ action: "stop" });
                    overlay.remove();
                };

                const video = document.createElement("video");
                video.controls = true;
                video.src = recordedVideo;
                video.style = "width:100%; max-height:50vh; border-radius: 8px; background-color: #000; display: block; margin-bottom: 20px;";
                video.autoplay = false;

                // 🧾 Metadata Section
                const metadataLabel = document.createElement("h4");
                metadataLabel.innerText = "🧾 Session Metadata:";
                metadataLabel.style = "margin-top: 20px;";

                const metaBox = document.createElement("div");
                metaBox.style = `
                    background: #fefce8;
                    border: 1px solid #e5e7eb;
                    border-radius: 5px;
                    padding: 10px;
                    font-family: monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                    max-height: 180px;
                    overflow-y: auto;
                    margin-bottom: 8px;
                `;
                metaBox.textContent = metaText;

                // 📋 Console Logs Section (ENHANCED WITH EXPANDABLE OBJECTS)
                const consoleLogsLabel = document.createElement("h4");
                consoleLogsLabel.innerText = "📋 Console Logs during Recording:";
                consoleLogsLabel.style = "margin-top: 20px; margin-bottom: 6px;";

                const logsContainer = document.createElement("div");
                logsContainer.style = `
                    background-color: #1e1e1e;
                    border: 1px solid #333;
                    border-radius: 6px;
                    padding: 15px;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 12px;
                    max-height: 400px;
                    overflow-y: auto;
                    color: #fff;
                `;

                // Enhanced helper function to create expandable console log entries
                function createConsoleLogEntry(logEntry) {
                    const logDiv = document.createElement('div');
                    logDiv.style = `
                        margin-bottom: 8px;
                        padding: 6px 8px;
                        border-left: 3px solid ${getConsoleTypeColor(logEntry.type)};
                        background-color: ${getConsoleTypeBgColor(logEntry.type)};
                        border-radius: 3px;
                    `;

                    const logHeader = document.createElement('div');
                    logHeader.style = `
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 4px;
                    `;

                    const typeIcon = document.createElement('span');
                    typeIcon.textContent = getConsoleTypeIcon(logEntry.type);
                    typeIcon.style = `color: ${getConsoleTypeColor(logEntry.type)}; font-weight: bold;`;

                    const timeStamp = document.createElement('span');
                    timeStamp.textContent = logEntry.time;
                    timeStamp.style = 'color: #888; font-size: 10px;';

                    logHeader.appendChild(typeIcon);
                    logHeader.appendChild(timeStamp);

                    const logContent = document.createElement('div');
                    logContent.style = 'margin-left: 20px;';

                    // Process each argument
                    logEntry.args.forEach((arg, index) => {
                        const argElement = createArgumentElement(arg, index, 0);
                        logContent.appendChild(argElement);
                        
                        if (index < logEntry.args.length - 1) {
                            const separator = document.createElement('span');
                            separator.textContent = ' ';
                            separator.style = 'margin-right: 8px;';
                            logContent.appendChild(separator);
                        }
                    });

                    logDiv.appendChild(logHeader);
                    logDiv.appendChild(logContent);

                    return logDiv;
                }

                // Enhanced helper function to create argument elements with deep expansion
                function createArgumentElement(arg, index, depth = 0) {
                    const argDiv = document.createElement('div');
                    argDiv.style = 'display: inline-block; margin-right: 8px; vertical-align: top;';

                    if (arg.isExpandable && arg.type === 'object') {
                        // Create expandable object
                        const objectContainer = document.createElement('div');
                        objectContainer.style = 'display: inline-block;';

                        const toggleButton = document.createElement('span');
                        toggleButton.innerHTML = '▶';
                        toggleButton.style = `
                            cursor: pointer;
                            margin-right: 4px;
                            user-select: none;
                            font-size: 10px;
                            color: #888;
                        `;

                        const objectHeader = document.createElement('span');
                        objectHeader.style = 'color: #9cdcfe;';
                        
                        // Enhanced object header with more info
                        const propertyCount = arg.properties ? arg.properties.length : (arg.preview?.properties?.length || 0);
                        objectHeader.textContent = `${arg.className || 'Object'} {${propertyCount}}`;

                        const objectDetails = document.createElement('div');
                        objectDetails.style = `
                            display: none;
                            margin-left: ${16 + (depth * 8)}px;
                            margin-top: 4px;
                            border-left: 1px solid #333;
                            padding-left: 8px;
                            max-height: 300px;
                            overflow-y: auto;
                        `;

                        // Enhanced property display with full object data
                        if (arg.properties && arg.properties.length > 0) {
                            // Use full properties data
                            arg.properties.forEach(prop => {
                                const propDiv = createPropertyElement(prop, depth + 1);
                                objectDetails.appendChild(propDiv);
                            });
                        } else if (arg.preview && arg.preview.properties) {
                            // Fallback to preview data
                            arg.preview.properties.forEach(prop => {
                                const propDiv = document.createElement('div');
                                propDiv.style = 'margin: 2px 0;';
                                
                                const propName = document.createElement('span');
                                propName.textContent = prop.name + ': ';
                                propName.style = 'color: #9cdcfe;';
                                
                                const propValue = document.createElement('span');
                                propValue.textContent = formatPropertyValue(prop);
                                propValue.style = `color: ${getValueColor(prop.type)};`;
                                
                                propDiv.appendChild(propName);
                                propDiv.appendChild(propValue);
                                objectDetails.appendChild(propDiv);
                            });
                        }

                        // Toggle functionality
                        let isExpanded = false;
                        toggleButton.onclick = () => {
                            isExpanded = !isExpanded;
                            toggleButton.innerHTML = isExpanded ? '▼' : '▶';
                            objectDetails.style.display = isExpanded ? 'block' : 'none';
                        };

                        objectContainer.appendChild(toggleButton);
                        objectContainer.appendChild(objectHeader);
                        objectContainer.appendChild(objectDetails);
                        argDiv.appendChild(objectContainer);

                    } else {
                        // Non-expandable arguments
                        const valueSpan = document.createElement('span');
                        valueSpan.style = `color: ${getValueColor(arg.type)};`;
                        
                        if (arg.type === 'string') {
                            valueSpan.textContent = `"${arg.value}"`;
                        } else {
                            valueSpan.textContent = arg.value || arg.description || '[Unknown]';
                        }
                        
                        argDiv.appendChild(valueSpan);
                    }

                    return argDiv;
                }

                // New function to create property elements with nested object support
                function createPropertyElement(prop, depth = 0) {
                    const propDiv = document.createElement('div');
                    propDiv.style = 'margin: 2px 0;';
                    
                    const propName = document.createElement('span');
                    propName.textContent = prop.name + ': ';
                    propName.style = 'color: #9cdcfe;';
                    
                    propDiv.appendChild(propName);
                    
                    if (prop.value && prop.value.type === 'object' && prop.value.objectId) {
                        // This is a nested object - make it expandable
                        const nestedObjectContainer = document.createElement('span');
                        
                        const toggleButton = document.createElement('span');
                        toggleButton.innerHTML = '▶';
                        toggleButton.style = `
                            cursor: pointer;
                            margin-right: 4px;
                            user-select: none;
                            font-size: 10px;
                            color: #888;
                        `;
                        
                        const objectHeader = document.createElement('span');
                        objectHeader.style = 'color: #9cdcfe;';
                        objectHeader.textContent = `${prop.value.className || 'Object'} {…}`;
                        
                        const nestedDetails = document.createElement('div');
                        nestedDetails.style = `
                            display: none;
                            margin-left: ${16 + (depth * 8)}px;
                            margin-top: 4px;
                            border-left: 1px solid #333;
                            padding-left: 8px;
                        `;
                        
                        let isExpanded = false;
                        let propertiesLoaded = false;
                        
                        toggleButton.onclick = async () => {
                            isExpanded = !isExpanded;
                            toggleButton.innerHTML = isExpanded ? '▼' : '▶';
                            nestedDetails.style.display = isExpanded ? 'block' : 'none';
                            
                            // Load properties on first expansion
                            if (isExpanded && !propertiesLoaded) {
                                nestedDetails.innerHTML = '<div style="color: #888;">Loading...</div>';
                                
                                try {
                                    // Request nested object properties from background script
                                    const response = await chrome.runtime.sendMessage({
                                        action: 'getObjectProperties',
                                        objectId: prop.value.objectId
                                    });
                                    
                                    nestedDetails.innerHTML = '';
                                    if (response && response.properties) {
                                        response.properties.forEach(nestedProp => {
                                            const nestedPropElement = createPropertyElement(nestedProp, depth + 1);
                                            nestedDetails.appendChild(nestedPropElement);
                                        });
                                    }
                                    propertiesLoaded = true;
                                } catch (error) {
                                    nestedDetails.innerHTML = '<div style="color: #ff6b6b;">Error loading properties</div>';
                                }
                            }
                        };
                        
                        nestedObjectContainer.appendChild(toggleButton);
                        nestedObjectContainer.appendChild(objectHeader);
                        propDiv.appendChild(nestedObjectContainer);
                        propDiv.appendChild(nestedDetails);
                        
                    } else {
                        // Regular property value
                        const propValue = document.createElement('span');
                        propValue.textContent = formatEnhancedPropertyValue(prop);
                        propValue.style = `color: ${getValueColor(prop.value ? prop.value.type : prop.type)};`;
                        propDiv.appendChild(propValue);
                    }
                    
                    return propDiv;
                }

                // Enhanced property value formatter
                function formatEnhancedPropertyValue(prop) {
                    if (prop.value) {
                        const val = prop.value;
                        if (val.type === 'string') {
                            return `"${val.value}"`;
                        } else if (val.type === 'number' || val.type === 'boolean') {
                            return String(val.value);
                        } else if (val.type === 'function') {
                            return val.description || 'function()';
                        } else if (val.type === 'object') {
                            if (val.subtype === 'array') {
                                return `Array(${val.description?.match(/\((\d+)\)/)?.[1] || '?'})`;
                            } else if (val.subtype === 'null') {
                                return 'null';
                            } else {
                                return val.className || 'Object';
                            }
                        } else if (val.type === 'undefined') {
                            return 'undefined';
                        } else {
                            return val.description || val.value || '[Unknown]';
                        }
                    } else {
                        // Fallback to old format
                        return formatPropertyValue(prop);
                    }
                }

                // Helper functions for styling
                function getConsoleTypeColor(type) {
                    switch (type) {
                        case 'error': return '#ff6b6b';
                        case 'warn': return '#ffd93d';
                        case 'info': return '#74b9ff';
                        case 'debug': return '#a29bfe';
                        default: return '#ffffff';
                    }
                }

                function getConsoleTypeBgColor(type) {
                    switch (type) {
                        case 'error': return 'rgba(255, 107, 107, 0.1)';
                        case 'warn': return 'rgba(255, 217, 61, 0.1)';
                        case 'info': return 'rgba(116, 185, 255, 0.1)';
                        case 'debug': return 'rgba(162, 155, 254, 0.1)';
                        default: return 'rgba(255, 255, 255, 0.05)';
                    }
                }

                function getConsoleTypeIcon(type) {
                    switch (type) {
                        case 'error': return '❌';
                        case 'warn': return '⚠️';
                        case 'info': return 'ℹ️';
                        case 'debug': return '🐛';
                        default: return '📝';
                    }
                }

                function getValueColor(type) {
                    switch (type) {
                        case 'string': return '#ce9178';
                        case 'number': return '#b5cea8';
                        case 'boolean': return '#569cd6';
                        case 'function': return '#dcdcaa';
                        case 'object': return '#9cdcfe';
                        case 'undefined': return '#808080';
                        default: return '#d4d4d4';
                    }
                }

                function formatPropertyValue(prop) {
                    if (prop.type === 'string') {
                        return `"${prop.value}"`;
                    } else if (prop.type === 'object' && prop.subtype) {
                        return `${prop.subtype} {…}`;
                    } else if (prop.value !== undefined) {
                        return String(prop.value);
                    } else {
                        return prop.type || '[Unknown]';
                    }
                }

                // Build the console logs display
                if (browserLogs && browserLogs.length > 0) {
                    browserLogs.forEach(logEntry => {
                        const logElement = createConsoleLogEntry(logEntry);
                        logsContainer.appendChild(logElement);
                    });
                } else {
                    logsContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No console logs captured.</div>';
                }

                // 📋 User Actions Section
                const userActionsLabel = document.createElement("h4");
                userActionsLabel.innerText = "📋 User Actions during Recording:";
                userActionsLabel.style = "margin-top: 20px; margin-bottom: 6px;";

                const userActionContainer = document.createElement("div");
                userActionContainer.style = `
                    background-color: #f3f4f6;
                    border: 1px solid #ccc;
                    border-radius: 6px;
                    padding: 10px;
                    font-family: monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                    max-height: 200px;
                    overflow-y: auto;
                `;
                const userActionLogs =
                    userActions && userActions.length > 0
                        ? userActions.join("\n")
                        : "No user actions captured.";
                userActionContainer.textContent = userActionLogs;

                // 📋 Network Calls Section (MODIFIED FOR TABLE)
                const networkCallsLabel = document.createElement("h4");
                networkCallsLabel.innerText = "🌐 Network Calls during Recording:";
                networkCallsLabel.style = "margin-top: 20px; margin-bottom: 6px;";

                const networkCallsContainer = document.createElement("div");
                networkCallsContainer.style = `
                    background-color: #fff;
                    border: 1px solid #e0e0e0;
                    border-radius: 6px;
                    overflow: auto;
                    max-height: 300px;
                `;

                // --- BUILD NETWORK TABLE ---
                if (networkCalls && networkCalls.networkLogs && networkCalls.networkLogs.length > 0) {
                    const table = document.createElement('table');
                    table.style = `
                        width: 100%;
                        border-collapse: collapse;
                        font-family: sans-serif;
                        font-size: 12px;
                    `;

                    const thead = document.createElement('thead');
                    thead.style = `
                        background-color: #e0e0e0;
                        position: sticky;
                        top: 0;
                        z-index: 1;
                    `;
                    thead.innerHTML = `
                        <tr>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Name</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Method</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Status</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Domain</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Type</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Frame</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Size</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Time</th>
                            <th style="padding: 8px; text-align: center; border: 1px solid #ddd; width: 80px;">Waterfall</th>
                        </tr>
                    `;
                    table.appendChild(thead);

                    const tbody = document.createElement('tbody');
                    networkCalls.networkLogs.forEach(request => {
                        const tr = document.createElement('tr');
                        tr.style = 'border-bottom: 1px solid #eee; cursor: pointer;';
                        tr.dataset.requestId = request.id;

                        // Apply color for failed requests
                        if (request.status.includes('Failed') || request.status.includes('CORS ERROR') || request.status.includes('Aborted')) {
                            tr.style.backgroundColor = '#ffe0e0';
                        } else if (request.isPreflight) {
                             tr.style.backgroundColor = '#e3f2fd';
                        } else if (request.displayTime === '(Cached)') {
                             tr.style.backgroundColor = '#e8f5e9';
                        }

                        tr.innerHTML = `
                            <td style="padding: 8px; border: 1px solid #eee; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${request.name}</td>
                            <td style="padding: 8px; border: 1px solid #eee;">${request.method}</td>
                            <td style="padding: 8px; border: 1px solid #eee;">${request.status}</td>
                            <td style="padding: 8px; border: 1px solid #eee; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${request.domain}</td>
                            <td style="padding: 8px; border: 1px solid #eee;">${request.type}</td>
                            <td style="padding: 8px; border: 1px solid #eee; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${request.frame ? getFileName(request.frame) : 'N/A'}</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #eee;">${request.displaySize}</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #eee;">${request.displayTime}</td>
                            <td style="padding: 8px; border: 1px solid #eee; text-align: center;">
                                <div style="height: 8px; background-color: #42a5f5; width: ${Math.min(request.time * 50, 100)}%; border-radius: 2px;"></div>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                    table.appendChild(tbody);
                    networkCallsContainer.appendChild(table);

                    // --- Click handler for table rows ---
                    tbody.addEventListener('click', (event) => {
                        const clickedRow = event.target.closest('tr');
                        if (clickedRow && clickedRow.dataset.requestId) {
                            const requestId = clickedRow.dataset.requestId;
                            const selectedRequest = networkCalls.networkLogs.find(req => req.id === requestId);
                            if (selectedRequest) {
                                showNetworkRequestDetails(selectedRequest);
                            }
                        }
                    });

                } else {
                    networkCallsContainer.textContent = "No network calls captured.";
                }

                // --- Network Request Details Modal ---
                const detailModalOverlay = document.createElement('div');
                detailModalOverlay.id = 'network-detail-modal-overlay';
                detailModalOverlay.style = `
                    position: fixed;
                    top: 0; left: 0;
                    width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.7);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    z-index: 100000001;
                `;
                document.body.appendChild(detailModalOverlay);

                const detailModal = document.createElement('div');
                detailModal.id = 'network-detail-modal';
                detailModal.style = `
                    background: #fff;
                    padding: 25px;
                    border-radius: 8px;
                    max-width: 800px;
                    max-height: 80vh;
                    overflow: auto;
                    position: relative;
                    font-family: sans-serif;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.5);
                `;
                detailModalOverlay.appendChild(detailModal);

                const detailCloseBtn = document.createElement('button');
                detailCloseBtn.innerText = '❌ Close';
                detailCloseBtn.style = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: #f44336;
                    color: white;
                    border: none;
                    padding: 6px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                `;
                detailCloseBtn.onclick = () => detailModalOverlay.style.display = 'none';
                detailModal.appendChild(detailCloseBtn);

                const detailContent = document.createElement('div');
                detailContent.id = 'network-detail-content';
                detailModal.appendChild(detailContent);

                // Function to show details
                function showNetworkRequestDetails(request) {
                    detailContent.innerHTML = `
                        <h3>Network Request Details</h3>
                        <p><strong>URL:</strong> ${request.url}</p>
                        <p><strong>Method:</strong> ${request.method}</p>
                        <p><strong>Status:</strong> ${request.status}</p>
                        <p><strong>Type:</strong> ${request.type}</p>
                        <p><strong>Size:</strong> ${request.displaySize}</p>
                        <p><strong>Time:</strong> ${request.displayTime}</p>
                        <p><strong>Preflight:</strong> ${request.isPreflight ? 'Yes' : 'No'}</p>
                        <p><strong>CORS Error:</strong> ${request.corsError ? 'Yes' : 'No'}</p>

                        <h4>Request Headers:</h4>
                        <pre style="background:#f0f0f0; padding:10px; border-radius:4px; max-height: 200px; overflow-y: auto;">${formatHeadersForHtml(request.requestHeaders)}</pre>

                        <h4>Response Headers:</h4>
                        <pre style="background:#f0f0f0; padding:10px; border-radius:4px; max-height: 200px; overflow-y: auto;">${formatHeadersForHtml(request.responseHeaders)}</pre>
                    `;
                    detailModalOverlay.style.display = 'flex';
                }
                
                // Helper to format headers for HTML
                function formatHeadersForHtml(headers) {
                    if (!headers || Object.keys(headers).length === 0) {
                        return 'No headers.';
                    }
                    return Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\n');
                }

                const downloadAllBtn = document.createElement("button");
                downloadAllBtn.innerText = "⬇️ Download All (Video + Logs)";
                downloadAllBtn.style = `
                    background: #2563eb;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    margin-top: 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                    display: block;
                    width: fit-content;
                    margin-left: auto;
                    margin-right: auto;
                `;

                // 🧾💾 Enhanced Download Handler with deep object support
                downloadAllBtn.onclick = () => {
                    // Format console logs for text file download with enhanced object support
                    let consoleLogsText = "No console logs recorded.";
                    if (browserLogs && browserLogs.length > 0) {
                        consoleLogsText = browserLogs.map(logEntry => {
                            let entry = `[${logEntry.time}] ${logEntry.type.toUpperCase()}: `;
                            
                            const argStrings = logEntry.args.map(arg => {
                                if (arg.type === 'object') {
                                    let objStr = `${arg.className || 'Object'} { `;
                                    
                                    // Use full properties if available, otherwise fall back to preview
                                    const props = arg.properties || arg.preview?.properties || [];
                                    if (props.length > 0) {
                                        const propStrings = props.slice(0, 5).map(prop => { // Limit to first 5 props for text export
                                            return `${prop.name}: ${formatEnhancedPropertyValue(prop)}`;
                                        });
                                        objStr += propStrings.join(', ');
                                        if (props.length > 5) objStr += `, ... (${props.length - 5} more)`;
                                    }
                                    objStr += ' }';
                                    return objStr;
                                } else if (arg.type === 'string') {
                                    return `"${arg.value}"`;
                                } else {
                                    return arg.value || arg.description || '[Unknown]';
                                }
                            });
                            
                            entry += argStrings.join(' ');
                            return entry;
                        }).join('\n');
                    }
                    
                    const userActionsText = (userActions || []).join("\n");
                    
                    // Format network logs for text file download
                    let networkLogsText = "No network activity recorded.";
                    if (networkCalls?.networkLogs && networkCalls.networkLogs.length > 0) {
                        networkLogsText = networkCalls.networkLogs.map(request => {
                            let entry = `
Name: ${request.name}
Method: ${request.method}
Status: ${request.status}
Domain: ${request.domain}
Type: ${request.type}
Frame: ${request.frame ? getFileName(request.frame) : 'N/A'}
Size: ${request.displaySize}
Time: ${request.displayTime}`;
                            if (request.isPreflight) entry += '\nPreflight Request: Yes';
                            if (request.corsError) entry += '\nCORS Error: Yes';
                            if (Object.keys(request.requestHeaders).length > 0) {
                                entry += '\nRequest Headers:\n' + Object.entries(request.requestHeaders).map(([key, value]) => `  ${key}: ${value}`).join('\n');
                            }
                            if (Object.keys(request.responseHeaders).length > 0) {
                                entry += '\nResponse Headers:\n' + Object.entries(request.responseHeaders).map(([key, value]) => `  ${key}: ${value}`).join('\n');
                            }
                            return `--------------------------------------${entry}\n--------------------------------------`;
                        }).join("\n\n");
                    }

                    const fullText = `
=== Session Metadata ===
${metaText}

=== User Actions ===
${userActionsText || "No user actions recorded."}

=== Network Logs ===
${networkLogsText}

=== Console Logs ===
${consoleLogsText}
                    `.trim();

                    const textBlob = new Blob([fullText], { type: "text/plain" });
                    const textURL = URL.createObjectURL(textBlob);

                    const txtA = document.createElement("a");
                    txtA.href = textURL;
                    txtA.download = "recording-details.txt";
                    txtA.click();
                    URL.revokeObjectURL(textURL);

                    const videoA = document.createElement("a");
                    videoA.href = recordedVideo;
                    videoA.download = "recording.webm";
                    videoA.click();
                };

                // 🧩 Final Modal Assembly
                modal.appendChild(closeBtn);
                modal.appendChild(video);
                if (recordingState?.isRecording) modal.appendChild(stopBtn);
                modal.appendChild(metadataLabel);
                modal.appendChild(metaBox);
                modal.appendChild(consoleLogsLabel);
                modal.appendChild(logsContainer);
                modal.appendChild(userActionsLabel);
                modal.appendChild(userActionContainer);
                modal.appendChild(networkCallsLabel);
                modal.appendChild(networkCallsContainer);
                modal.appendChild(downloadAllBtn);

                overlay.appendChild(modal);
                document.body.appendChild(overlay);
            }
        );
    }
});

// -------------------------
// SCREENSHOT TOOL HANDLERS
// -------------------------

if (!window.screenshotToolsAttached) {
    window.screenshotToolsAttached = true;

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "START_AREA_SELECTION") {
            startAreaSelection();
        } else if (msg.type === "SHOW_PREVIEW") {
            showPreviewScreenshot(msg.dataUrl, msg.filename);
        } else if (msg.type === "CROP_IMAGE") {
            cropImage(msg.dataUrl, msg.crop, "selected-area.png");
        }
    });

    function startAreaSelection() {
        const existing = document.getElementById("screenshot-selector");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "screenshot-selector";
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background-color: rgba(0,0,0,0.2);
            cursor: crosshair;
            z-index: 9999999;
        `;
        document.body.appendChild(overlay);

        let startX = 0,
            startY = 0,
            box = null;

        const onMouseDown = (e) => {
            e.preventDefault();

            startX = e.clientX;
            startY = e.clientY;

            box = document.createElement("div");
            box.style.cssText = `
                position: fixed;
                border: 2px dashed #000;
                background-color: rgba(255,255,255,0.3);
                z-index: 10000000;
                pointer-events: none;
            `;
            document.body.appendChild(box);

            const onMouseMove = (ev) => {
                const currentX = ev.clientX;
                const currentY = ev.clientY;

                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(currentX - startX);
                const height = Math.abs(currentY - startY);

                box.style.left = `${left}px`;
                box.style.top = `${top}px`;
                box.style.width = `${width}px`;
                box.style.height = `${height}px`;
            };

            const onMouseUp = (ev) => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                overlay.remove();
                if (box) box.remove();

                const endX = ev.clientX;
                const endY = ev.clientY;

                const left = Math.min(startX, endX);
                const top = Math.min(startY, endY);
                const width = Math.abs(endX - startX);
                const height = Math.abs(endY - startY);

                if (width > 4 && height > 4) {
                    const scale = window.devicePixelRatio || 1;
                    chrome.runtime.sendMessage({
                        type: "CAPTURE_SELECTION",
                        x: (left + window.scrollX) * scale,
                        y: (top + window.scrollY) * scale,
                        width: width * scale,
                        height: height * scale,
                    });
                } else {
                    chrome.runtime.sendMessage({ type: "ENABLE_POPUP_BUTTONS" });
                }
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };

        overlay.addEventListener("mousedown", onMouseDown);
    }

    function cropImage(dataUrl, crop, filename) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = crop.width;
            canvas.height = crop.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(
                img,
                crop.x,
                crop.y,
                crop.width,
                crop.height,
                0,
                0,
                crop.width,
                crop.height
            );
            const croppedUrl = canvas.toDataURL("image/png");
            showPreviewScreenshot(croppedUrl, filename);
        };
        img.onerror = () => {
            console.error("Error loading image for cropping");
            chrome.runtime.sendMessage({ type: "ENABLE_POPUP_BUTTONS" });
        };
        img.src = dataUrl;
    }

    function showPreviewScreenshot(dataUrl, filename) {
        const existing = document.getElementById("screenshot-preview-container");
        if (existing) existing.remove();

        const container = document.createElement("div");
        container.id = "screenshot-preview-container";
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90vw;
            max-height: 90vh;
            overflow: auto;
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 0 10px rgba(0,0,0,0.3);
            z-index: 99999999;
            font-family: sans-serif;
            text-align: center;
        `;

        const img = document.createElement("img");
        img.src = dataUrl;
        img.style.cssText = `
            max-width: 100%;
            max-height: 70vh;
            object-fit: contain;
            border-radius: 6px;
            margin-bottom: 10px;
            background-color: #f9fafb;
            display: block;
            margin-left: auto;
            margin-right: auto;
        `;
        container.appendChild(img);

        const downloadBtn = document.createElement("button");
        downloadBtn.textContent = "Download";
        downloadBtn.style.cssText = `
            background: #10b981;
            color: white;
            border: none;
            padding: 6px 12px;
            margin-right: 10px;
            border-radius: 44px;
            cursor: pointer;
        `;
        downloadBtn.onclick = () => {
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = filename || "screenshot.png";
            a.click();
            container.remove();
            chrome.runtime.sendMessage({ type: "ENABLE_POPUP_BUTTONS" });
        };
        container.appendChild(downloadBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = `
            background: #ef4444;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.onclick = () => {
            container.remove();
            chrome.runtime.sendMessage({ type: "ENABLE_POPUP_BUTTONS" });
        };
        container.appendChild(cancelBtn);

        document.body.appendChild(container);
    }
}

// ✅ RECORDING CONTROLLER WITH TIMER AND PAUSE/RESUME
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "showRecordingController") {
        showRecordingController();
    }
});

function showRecordingController() {
    // Remove any existing controller
    const old = document.getElementById("recording-controller-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "recording-controller-popup";
    popup.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(90deg, #42a5f5 60%, #00796b 100%);
        color: white;
        box-shadow: 0 4px 24px rgba(33,33,33,0.13);
        border-radius: 24px;
        padding: 10px 24px 10px 18px;
        display: flex;
        align-items: center;
        gap: 16px;
        font-family: 'Segoe UI',sans-serif;
        font-size: 17px;
        z-index: 100000000 !important;
        min-width: 240px;
        max-width: 99vw;
        user-select: none;
    `;

    // ✅ Recording Status Indicator
    const statusIndicator = document.createElement("div");
    statusIndicator.id = "recording-status-indicator";
    statusIndicator.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #ff4444;
        animation: pulse 1.5s infinite;
    `;
    popup.appendChild(statusIndicator);

    // Timer Display
    const timerDisplay = document.createElement("span");
    timerDisplay.id = "recording-timer-display";
    timerDisplay.innerText = "00:00";
    timerDisplay.style.fontWeight = "600";
    popup.appendChild(timerDisplay);

    // Pause/Resume Button
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "recording-pause-btn";
    pauseBtn.innerText = "⏸ Pause";
    pauseBtn.style.cssText = `
        background: #ffd600;
        color: #24292f;
        border: none;
        border-radius: 6px;
        padding: 5px 15px;
        font-size: 15px;
        cursor: pointer;
        font-weight: bold;
        transition: background 0.2s;
        margin: 0 4px;
    `;
    popup.appendChild(pauseBtn);

    // Stop Button
    const stopBtn = document.createElement("button");
    stopBtn.id = "recording-stop-btn";
    stopBtn.innerText = "⏹ Stop";
    stopBtn.style.cssText = `
        background: #ef5350;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 5px 15px;
        font-size: 15px;
        cursor: pointer;
        font-weight: bold;
        transition: background 0.2s;
        margin: 0 4px;
    `;
    popup.appendChild(stopBtn);

    // Append to body
    document.body.appendChild(popup);

    // ✅ Timer Logic with Pause/Resume Support
    let elapsed = 0;
    let timerInterval = null;
    let paused = false;
    let startTime = Date.now();
    let pausedTime = 0;

    function updateTimer() {
        if (!paused) {
            const now = Date.now();
            elapsed = Math.floor((now - startTime - pausedTime) / 1000);
            const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
            const sec = String(elapsed % 60).padStart(2, "0");
            timerDisplay.innerText = `${min}:${sec}`;
        }
    }

    // Start timer
    timerInterval = setInterval(updateTimer, 1000);

    // ✅ Pause/Resume Handler
    pauseBtn.onclick = () => {
        if (!paused) {
            // Pause recording
            paused = true;
            const pauseStartTime = Date.now();

            pauseBtn.innerText = "▶️ Resume";
            pauseBtn.style.background = "#1de9b6";
            pauseBtn.disabled = true;

            // Update status indicator
            statusIndicator.style.background = "#ffa726";
            statusIndicator.style.animation = "none";

            chrome.runtime.sendMessage({ action: "pause" }, () => {
                pauseBtn.disabled = false;
            });

            // Track when pause started
            window.recordingPauseStart = pauseStartTime;
        } else {
            // Resume recording
            paused = false;

            // Calculate total paused time
            const pauseEndTime = Date.now();
            if (window.recordingPauseStart) {
                pausedTime += pauseEndTime - window.recordingPauseStart;
            }

            pauseBtn.innerText = "⏸ Pause";
            pauseBtn.style.background = "#ffd600";
            pauseBtn.disabled = true;

            // Update status indicator
            statusIndicator.style.background = "#ff4444";
            statusIndicator.style.animation = "pulse 1.5s infinite";

            chrome.runtime.sendMessage({ action: "resume" }, () => {
                pauseBtn.disabled = false;
            });
        }
    };

    // ✅ Stop Handler
    stopBtn.onclick = () => {
        clearInterval(timerInterval);
        popup.remove();
        chrome.runtime.sendMessage({ action: "stop" });
        console.log("🔴 Recording stopped");
    };

    // ✅ Add CSS for pulsing animation
    if (!document.querySelector("#recording-pulse-style")) {
        const style = document.createElement("style");
        style.id = "recording-pulse-style";
        style.innerHTML = `
            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.7; transform: scale(1.1); }
                100% { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    console.log("🎬 Recording controller shown");
}

// ✅ REMOVE RECORDING CONTROLLER
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "removeRecordingController") {
        const controller = document.getElementById("recording-controller-popup");
        if (controller) {
            controller.remove();
            console.log("🎬 Recording controller removed");
        }
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "removeStopButton") {
        const btn = document.getElementById("floating-stop-btn");
        if (btn) btn.remove();
    }
});

// User Actions
if (!window.recorderGlobalsInitialized) {
    window.recorderGlobalsInitialized = true;

    let isLoggingUserActivity = false;

    let typingBuffer = "";
    let typingTimer = null;
    const TYPING_FLUSH_DELAY = 2000;

    function downloadTextFile(text, filename) {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function sendUserActivityLog(message) {
        if (!isLoggingUserActivity) return;
        const time = new Date().toISOString();
        chrome.runtime.sendMessage({
            type: "USER_ACTIVITY_LOG",
            logEntry: `[${time}] ${message}`,
        });
    }

    function flushTypingBuffer() {
        if (typingBuffer.length > 0) {
            sendUserActivityLog(`Typed: "${typingBuffer}"`);
            typingBuffer = "";
        }
        clearTimeout(typingTimer);
        typingTimer = null;
    }

    // Enhanced handlers to include more detail and send to background
    const handlers = {
        click: (e) => {
            const el = e.target;
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : "";
            const className = el.className ? `.${el.className.split(" ")[0]}` : "";
            const textContent = el.textContent
                ? ` (text: "${el.textContent.trim().substring(0, 50)}...")`
                : "";
            sendUserActivityLog(
                `Clicked <${tag}${id}${className}> at (${e.clientX}, ${e.clientY})${textContent}`
            );
        },
        keydown: (e) => {
            const key = e.key;
            if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                typingBuffer += key;
                if (typingTimer) clearTimeout(typingTimer);
                typingTimer = setTimeout(flushTypingBuffer, TYPING_FLUSH_DELAY);
            } else {
                flushTypingBuffer();
                sendUserActivityLog(`Key Down: ${key}`);
            }
        },
        keyup: (e) => {
            // Can be used for logging key releases if needed
        },
        input: (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
                if (e.target.type === "password") return;
                const name = e.target.name || e.target.id || "unnamed";
            }
        },
    };
    const allEventTypes = Object.keys(handlers);

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "RECORDER_START") {
            if (!isLoggingUserActivity) {
                isLoggingUserActivity = true;
                allEventTypes.forEach((event) =>
                    document.addEventListener(event, handlers[event], true)
                );
                sendUserActivityLog("User activity logging started on this page.");
                console.log("User activity logging started ");
            }
        }

        if (msg.type === "RECORDER_STOP") {
            if (isLoggingUserActivity) {
                isLoggingUserActivity = false;
                flushTypingBuffer();
                allEventTypes.forEach((event) =>
                    document.removeEventListener(event, handlers[event], true)
                );
                sendUserActivityLog("User activity logging stopped on this page.");
                console.log("User activity logging stopped ");
            }
        }

        if (msg.type === "DOWNLOAD_LOGS") {
            console.log(" received logs for download.");
            let finalLogContent = [];

            finalLogContent.push("===== USER ACTIVITY =====");
            if (msg.userActivityLogs && msg.userActivityLogs.length > 0) {
                finalLogContent.push(msg.userActivityLogs.join("\n"));
            } else {
                finalLogContent.push("NO USER ACTIVITY RECORDED.");
            }

            finalLogContent.push("\n\n===== NETWORK LOGS =====");
            if (msg.networkLogs && msg.networkLogs.length > 0) {
                finalLogContent.push(msg.networkLogs);
            } else {
                finalLogContent.push("NO NETWORK ACTIVITY RECORDED.");
            }

            finalLogContent.push("\n\n===== CONSOLE LOGS =====");
            if (msg.consoleLogs && msg.consoleLogs.length > 0) {
                finalLogContent.push(msg.consoleLogs);
            } else {
                finalLogContent.push("NO CONSOLE LOGS RECORDED.");
            }

            console.log("Downloading file...");
            downloadTextFile(
                finalLogContent.join("\n"),
                `user-activity-and-network-logs-${Date.now()}.txt`
            );
            window.recorderInjected = false;
        }
        sendResponse({ status: "acknowledged" });
    });

    // Handle page navigation within the content script context
    let lastURL = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastURL) {
            sendUserActivityLog(`Navigation: From ${lastURL} to ${location.href}`);
            lastURL = location.href;
        }
    });
    observer.observe(document, { childList: true, subtree: true });
}
