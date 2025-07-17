(() => {
    if (window.__screenshot_injected) return;
    window.__screenshot_injected = true;

    let selectionDiv = null;
    let startX, startY;
    const userActions = [];

    const recordAction = (type, details = {}) => {
        const timestamp = new Date();
        const timeString = timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        userActions.push({
            type: type,
            timestamp: timeString,
            details: details
        });
    };

    document.addEventListener('keydown', (e) => {
        recordAction('Keyboard Event', { key: e.key, code: e.code });
    });

    document.addEventListener('click', (e) => {
        let elementDetails = {};
        if (e.target) {
            elementDetails.tagName = e.target.tagName;
            if (e.target.id) elementDetails.id = e.target.id;
            if (e.target.className) elementDetails.className = e.target.className.split(' ')[0];
            if (e.target.innerText) elementDetails.text = e.target.innerText.substring(0, 50) + (e.target.innerText.length > 50 ? '...' : '');
            elementDetails.x = e.clientX;
            elementDetails.y = e.clientY;
        }
        recordAction('Click', elementDetails);
    });

    document.addEventListener('scroll', (e) => {
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            recordAction('Scroll', {
                x: window.scrollX,
                y: window.scrollY,
                target: e.target.tagName
            });
        }, 300);
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'initiateSelection') {
            // For initiateSelection, we use the provided fullPageDataUrl to draw the overlay
            // and then perform the cropping. The modal will be shown AFTER cropping.
            initiateSelection(request.dataUrl);
        } else if (request.action === 'captureFullscreen') {
            // For fullscreen capture, just show the modal immediately
            showModal(request.dataUrl);
            sendClientSideInfo(); // Send info after modal is displayed
        }
        // No need for sendResponse here as it's handled by callbacks
    });

    function initiateSelection(fullPageDataUrl) {
        // Remove any existing overlay to prevent multiple instances
        const existingOverlay = document.getElementById('selection-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'selection-overlay'; // Add an ID for easier removal
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.cursor = 'crosshair';
        overlay.style.zIndex = '99999999';

        // Add an instruction message to the overlay
        const instructionDiv = document.createElement('div');
        instructionDiv.style.position = 'absolute';
        instructionDiv.style.top = '50%';
        instructionDiv.style.left = '50%';
        instructionDiv.style.transform = 'translate(-50%, -50%)';
        instructionDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        instructionDiv.style.color = 'white';
        instructionDiv.style.padding = '10px 20px';
        instructionDiv.style.borderRadius = '5px';
        instructionDiv.style.whiteSpace = 'nowrap';
        instructionDiv.style.pointerEvents = 'none'; // Ensure it doesn't interfere with mouse events
        instructionDiv.textContent = 'Drag to select an area';
        overlay.appendChild(instructionDiv);


        const handleMouseDown = (e) => {
            e.preventDefault(); // Prevent default browser drag behavior
            startX = e.clientX;
            startY = e.clientY;

            // Remove previous selection div if it exists
            if (selectionDiv && document.body.contains(selectionDiv)) {
                document.body.removeChild(selectionDiv);
            }

            selectionDiv = document.createElement('div');
            selectionDiv.style.position = 'fixed';
            selectionDiv.style.border = '2px dashed #fff';
            selectionDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            selectionDiv.style.left = `${startX}px`;
            selectionDiv.style.top = `${startY}px`;
            selectionDiv.style.zIndex = '100000000';
            document.body.appendChild(selectionDiv);

            // Hide instructions once dragging starts
            instructionDiv.style.display = 'none';

            const onMouseMove = (moveEvent) => {
                const width = moveEvent.clientX - startX;
                const height = moveEvent.clientY - startY;
                selectionDiv.style.width = `${Math.abs(width)}px`;
                selectionDiv.style.height = `${Math.abs(height)}px`;
                selectionDiv.style.left = `${width > 0 ? startX : moveEvent.clientX}px`;
                selectionDiv.style.top = `${height > 0 ? startY : moveEvent.clientY}px`;
            };

            const onMouseUp = (upEvent) => {
                overlay.removeEventListener('mousemove', onMouseMove);
                overlay.removeEventListener('mouseup', onMouseUp);
                
                // Always remove overlay and selectionDiv after mouse up
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                if (document.body.contains(selectionDiv)) document.body.removeChild(selectionDiv);

                const x = Math.min(startX, upEvent.clientX);
                const y = Math.min(startY, upEvent.clientY);
                const width = Math.abs(startX - upEvent.clientX);
                const height = Math.abs(startY - upEvent.clientY);

                if (width > 10 && height > 10) { // Ensure a meaningful selection
                    cropImage(fullPageDataUrl, { x, y, width, height });
                } else {
                    // If no valid selection was made, close modal or do nothing
                    console.log("Selection too small or invalid.");
                    // You might want to show a message or just close the overlay without a modal
                }
            };

            overlay.addEventListener('mousemove', onMouseMove);
            overlay.addEventListener('mouseup', onMouseUp, { once: true });
        };

        overlay.addEventListener('mousedown', handleMouseDown);
        document.body.appendChild(overlay);
    }

    function cropImage(dataUrl, area) {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const devicePixelRatio = window.devicePixelRatio || 1;

            canvas.width = area.width * devicePixelRatio;
            canvas.height = area.height * devicePixelRatio;

            ctx.drawImage(
                image,
                area.x * devicePixelRatio,
                area.y * devicePixelRatio,
                area.width * devicePixelRatio,
                area.height * devicePixelRatio,
                0,
                0,
                area.width * devicePixelRatio,
                area.height * devicePixelRatio
            );

            const croppedDataUrl = canvas.toDataURL('image/png');

            // NEW: Send the cropped image data back to the background script
            chrome.runtime.sendMessage({
                action: 'sendCroppedImageData',
                dataUrl: croppedDataUrl,
                area: area // Optional, but good to include for completeness
            }, (response) => {
                if (response && response.status === 'ok') {
                    // Once background script has the cropped image, then show the modal
                    showModal(croppedDataUrl);
                    // And send client-side info
                    sendClientSideInfo();
                } else {
                    console.error("Failed to send cropped image data to background script.");
                    // Fallback: Show modal with cropped image anyway, but report might be incomplete
                    showModal(croppedDataUrl);
                    sendClientSideInfo();
                }
            });
        };
        image.src = dataUrl;
    }

    // ... (rest of showModal, sendClientSideInfo, populateModalWithReportData, downloadReport, showNetworkPrompt functions are the same) ...

    function showModal(dataUrl) {
        const existingModal = document.getElementById('screenshot-modal-container');
        if (existingModal) {
            existingModal.remove();
        }

        const modalContainer = document.createElement('div');
        modalContainer.id = 'screenshot-modal-container';
        modalContainer.style.position = 'fixed';
        modalContainer.style.top = '0';
        modalContainer.style.left = '0';
        modalContainer.style.width = '100vw';
        modalContainer.style.height = '100vh';
        modalContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        modalContainer.style.display = 'flex';
        modalContainer.style.alignItems = 'center';
        modalContainer.style.justifyContent = 'center';
        modalContainer.style.zIndex = '100000001';
        modalContainer.style.fontFamily = 'sans-serif';
        modalContainer.style.color = '#e2e8f0';

        modalContainer.innerHTML = `
            <div style="background-color: #1e293b; border-radius: 0.5rem; padding: 1.5rem; width: 90%; max-width: 1200px; max-height: 95vh; display: flex; flex-direction: column; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                <h2 style="font-size: 1.8rem; font-weight: bold; margin-bottom: 1rem; color: white; text-align: center;">Screenshot & Bug Report</h2>
                <div style="display: flex; flex-grow: 1; gap: 1.5rem; overflow: hidden;">
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #0f172a; border-radius: 0.5rem; padding: 1rem;">
                        <img id="screenshot-image" src="${dataUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 0.25rem; border: 1px solid #475569;" />
                    </div>

                    <div style="flex: 1; display: flex; flex-direction: column; background-color: #0f172a; border-radius: 0.5rem; padding: 1rem;">
                        <div style="display: flex; justify-content: space-around; margin-bottom: 1rem; border-bottom: 1px solid #475569;">
                            <button class="tab-button" data-tab="info" style="padding: 0.75rem 1rem; background-color: transparent; border: none; color: #94a3b8; cursor: pointer; font-weight: bold; border-bottom: 2px solid transparent; transition: all 0.2s ease;">Info</button>
                            <button class="tab-button" data-tab="console" style="padding: 0.75rem 1rem; background-color: transparent; border: none; color: #94a3b8; cursor: pointer; font-weight: bold; border-bottom: 2px solid transparent; transition: all 0.2s ease;">Console Logs</button>
                            <button class="tab-button" data-tab="network" style="padding: 0.75rem 1rem; background-color: transparent; border: none; color: #94a3b8; cursor: pointer; font-weight: bold; border-bottom: 2px solid transparent; transition: all 0.2s ease;">Network Calls</button>
                            <button class="tab-button" data-tab="actions" style="padding: 0.75rem 1rem; background-color: transparent; border: none; color: #94a3b8; cursor: pointer; font-weight: bold; border-bottom: 2px solid transparent; transition: all 0.2s ease;">User Actions</button>
                        </div>

                        <div id="report-content" style="flex-grow: 1; overflow-y: auto; padding-right: 0.5rem;">
                            <div id="info-tab" class="tab-content">
                                <p><strong style="color: #cbd5e1;">URL:</strong> <span id="info-url"></span></p>
                                <p><strong style="color: #cbd5e1;">Timestamp:</strong> <span id="info-timestamp"></span></p>
                                <p><strong style="color: #cbd5e1;">OS:</strong> <span id="info-os"></span></p>
                                <p><strong style="color: #cbd5e1;">Browser:</strong> <span id="info-browser"></span></p>
                                <p><strong style="color: #cbd5e1;">Window Size:</strong> <span id="info-window-size"></span></p>
                                <p><strong style="color: #cbd5e1;">Country:</strong> <span id="info-country"></span></p>
                                <p id="debugger-warning" style="color: #f87171; font-weight: bold; margin-top: 10px;"></p>
                            </div>
                            <div id="console-tab" class="tab-content" style="display:none;">
                                <div id="console-logs" class="log-output"></div>
                            </div>
                            <div id="network-tab" class="tab-content" style="display:none;">
                                <div id="network-calls" class="log-output"></div>
                            </div>
                            <div id="actions-tab" class="tab-content" style="display:none;">
                                <div id="user-actions" class="log-output"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button id="close-modal-btn" style="padding: 0.6rem 1.2rem; background-color: #4b5563; color: white; border-radius: 0.25rem; cursor: pointer; border: none; font-weight: bold; transition: background-color 0.2s ease;">Close</button>
                    <button id="download-report-btn" style="padding: 0.6rem 1.2rem; background-color: #2563eb; color: white; border-radius: 0.25rem; cursor: pointer; border: none; font-weight: bold; transition: background-color 0.2s ease;">Download Report</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalContainer);

        const style = document.createElement('style');
        style.innerHTML = `
            .tab-button.active {
                color: #2563eb !important;
                border-bottom: 2px solid #2563eb !important;
            }
            .log-output > div {
                background-color: #1e293b;
                border: 1px solid #475569;
                padding: 10px;
                margin-bottom: 8px;
                border-radius: 4px;
                word-wrap: break-word;
                white-space: pre-wrap;
                font-size: 0.85em; /* Slightly smaller font for logs */
            }
            .log-output strong {
                color: #cbd5e1;
            }
            /* Scrollbar styling for dark theme */
            #report-content::-webkit-scrollbar,
            .log-output::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            #report-content::-webkit-scrollbar-track,
            .log-output::-webkit-scrollbar-track {
                background: #1e293b;
                border-radius: 10px;
            }
            #report-content::-webkit-scrollbar-thumb,
            .log-output::-webkit-scrollbar-thumb {
                background: #475569;
                border-radius: 10px;
            }
            #report-content::-webkit-scrollbar-thumb:hover,
            .log-output::-webkit-scrollbar-thumb:hover {
                background: #64748b;
            }
        `;
        document.head.appendChild(style);


        const tabButtons = modalContainer.querySelectorAll('.tab-button');
        const tabContents = modalContainer.querySelectorAll('.tab-content');

        const activateTab = (tabName) => {
            tabButtons.forEach(button => {
                if (button.dataset.tab === tabName) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });

            tabContents.forEach(content => {
                if (content.id === `${tabName}-tab`) {
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
                }
            });
        };

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                activateTab(button.dataset.tab);
            });
        });

        // Activate the 'Info' tab by default
        activateTab('info');


        document.getElementById('close-modal-btn').addEventListener('click', () => {
            modalContainer.remove();
            if (document.head.contains(style)) {
                document.head.removeChild(style);
            }
        });

        document.getElementById('download-report-btn').addEventListener('click', () => {
            downloadReport(dataUrl);
        });

        document.addEventListener('keydown', function close(e) {
            if (e.key === 'Escape') {
                modalContainer.remove();
                if (document.head.contains(style)) {
                    document.head.removeChild(style);
                }
                document.removeEventListener('keydown', close);
            }
        });
    }

    function sendClientSideInfo() {
        const info = {
            url: window.location.href,
            timestamp: new Date().toLocaleString(),
            os: navigator.platform,
            browser: navigator.userAgent,
            windowSize: `${window.innerWidth}x${window.innerHeight}`,
            country: "N/A"
        };

        chrome.runtime.sendMessage({
            action: 'sendReportData',
            payload: {
                info: info,
                actions: userActions
            }
        }, (response) => {
            if (response) {
                populateModalWithReportData(response);
            }
        });
    }

    function populateModalWithReportData(data) {
        // Ensure the screenshot image in the modal is updated if it was a cropped image
        const screenshotImageElement = document.getElementById('screenshot-image');
        if (screenshotImageElement && data.screenshotDataUrl) {
            screenshotImageElement.src = data.screenshotDataUrl;
        }

        // Populate Info Tab
        if (data.info) {
            document.getElementById('info-url').textContent = data.info.url || 'N/A';
            document.getElementById('info-timestamp').textContent = data.info.timestamp || 'N/A';
            document.getElementById('info-os').textContent = data.info.os || 'N/A';
            document.getElementById('info-browser').textContent = data.info.browser || 'N/A';
            document.getElementById('info-window-size').textContent = data.info.windowSize || 'N/A';
            document.getElementById('info-country').textContent = data.info.country || 'N/A';
        }
        const debuggerWarningElement = document.getElementById('debugger-warning');
        if (data.debuggerWarning) {
            debuggerWarningElement.textContent = data.debuggerWarning;
            debuggerWarningElement.style.display = 'block'; // Show the warning
        } else {
            debuggerWarningElement.textContent = '';
            debuggerWarningElement.style.display = 'none'; // Hide if no warning
        }


        // Populate Console Logs
        const consoleLogsDiv = document.getElementById('console-logs');
        consoleLogsDiv.innerHTML = ''; // Clear previous
        if (data.consoleLogs && data.consoleLogs.length > 0) {
            data.consoleLogs.forEach(log => {
                const logEntry = document.createElement('div');
                const sourceInfo = (log.url && log.url !== 'N/A' && log.lineNumber !== 'N/A') ?
                                    ` (Source: ${log.url.split('/').pop()}:${log.lineNumber})` : '';
                logEntry.innerHTML = `<strong>[${log.level ? log.level.toUpperCase() : 'UNKNOWN'}] ${log.timestamp || 'N/A'}</strong>: ${log.text || 'N/A'}${sourceInfo}`;
                consoleLogsDiv.appendChild(logEntry);
            });
        } else {
            consoleLogsDiv.textContent = 'No console logs captured (or debugger API not enabled/attached).';
        }

        // Populate Network Calls
        const networkCallsDiv = document.getElementById('network-calls');
        networkCallsDiv.innerHTML = ''; // Clear previous
        if (data.networkCalls && data.networkCalls.length > 0) {
            data.networkCalls.forEach(call => {
                const callEntry = document.createElement('div');
                const status = call.statusCode ? `[${call.statusCode}]` : '';
                const mime = call.mimeType ? `(${call.mimeType})` : '';
                const urlDisplay = call.url ? call.url.split('?')[0] : 'N/A'; // Show URL without query params
                callEntry.innerHTML = `<strong>[${call.method || 'N/A'}] ${status} ${call.timestamp || 'N/A'}</strong>: ${urlDisplay} ${mime}`;
                networkCallsDiv.appendChild(callEntry);
            });
        } else {
            networkCallsDiv.textContent = 'No network calls captured (or debugger API not enabled/attached).';
        }

        // Populate User Actions
        const userActionsDiv = document.getElementById('user-actions');
        userActionsDiv.innerHTML = ''; // Clear previous
        if (data.actions && data.actions.length > 0) {
            data.actions.forEach(action => {
                const actionEntry = document.createElement('div');
                actionEntry.innerHTML = `<strong>[${action.type || 'N/A'}] ${action.timestamp || 'N/A'}</strong>: ${JSON.stringify(action.details || {})}`;
                userActionsDiv.appendChild(actionEntry);
            });
        } else {
            userActionsDiv.textContent = 'No user actions recorded.';
        }

        if (data.debuggerWarning && data.debuggerWarning.includes("Failed to attach debugger")) {
             showNetworkPrompt();
        }
    }

    function downloadReport(screenshotDataUrl) {
        chrome.runtime.sendMessage({ action: 'getReportData' }, (response) => {
            if (response) {
                const reportContent = {
                    // Use the screenshotDataUrl from the response, which should be the cropped one
                    screenshotDataUrl: response.screenshotDataUrl || screenshotDataUrl,
                    info: response.info || {},
                    consoleLogs: response.consoleLogs || [],
                    networkCalls: response.networkCalls || [],
                    userActions: response.actions || [],
                    debuggerWarning: response.debuggerWarning || null
                };

                const reportJson = JSON.stringify(reportContent, null, 2);
                const blob = new Blob([reportJson], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = 'bug_report.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        });
    }

    function showNetworkPrompt() {
        const existingPrompt = document.getElementById('network-capture-prompt');
        if (existingPrompt) {
            return;
        }

        const promptDiv = document.createElement('div');
        promptDiv.id = 'network-capture-prompt';
        promptDiv.style.position = 'fixed';
        promptDiv.style.bottom = '20px';
        promptDiv.style.left = '50%';
        promptDiv.style.transform = 'translateX(-50%)';
        promptDiv.style.backgroundColor = '#f8d7da';
        promptDiv.style.color = '#721c24';
        promptDiv.style.padding = '15px 20px';
        promptDiv.style.borderRadius = '8px';
        promptDiv.style.border = '1px solid #f5c6cb';
        promptDiv.style.zIndex = '100000002';
        promptDiv.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
        promptDiv.style.fontSize = '1em';
        promptDiv.style.display = 'flex';
        promptDiv.style.alignItems = 'center';
        promptDiv.style.gap = '15px';


        promptDiv.innerHTML = `
            <span>⚠️ Network calls might not be fully captured. Please refresh the page (F5) to get all network requests.</span>
            <button id="close-network-prompt" style="
                background-color: #dc3545;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            ">Dismiss</button>
        `;

        document.body.appendChild(promptDiv);

        document.getElementById('close-network-prompt').addEventListener('click', () => {
            promptDiv.remove();
        });

        setTimeout(() => {
            if (document.body.contains(promptDiv)) {
                promptDiv.remove();
            }
        }, 15000);
    }
})();