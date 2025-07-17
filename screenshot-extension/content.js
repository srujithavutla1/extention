// content.js
(() => {
    if (window.__screenshot_injected) return;
    window.__screenshot_injected = true;

    let selectionDiv = null;
    let startX, startY;
    const userActions = [];

    const recordAction = (type, details = {}) => {
        userActions.push({
            type: type,
            timestamp: new Date().toLocaleString(),
            details: details
        });
    };

    document.addEventListener('keydown', (e) => {
        recordAction('Keyboard Event', { key: e.key, code: e.code });
    });

    // Capture clicks for user actions
    document.addEventListener('click', (e) => {
        recordAction('Click', {
            target: e.target.tagName,
            id: e.target.id,
            className: e.target.className,
            text: e.target.innerText ? e.target.innerText.substring(0, 50) + '...' : '' // Capture some text
        });
    });

    document.addEventListener('scroll', (e) => {
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            recordAction('Scroll', {
                x: window.scrollX,
                y: window.scrollY,
                target: e.target.tagName
            });
        }, 100);
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'initiateSelection') {
            initiateSelection(request.dataUrl);
        } else if (request.action === 'captureFullscreen' || request.action === 'displayCroppedImage') {
            showModal(request.dataUrl);
        }

        if (request.requestClientInfo) {
            sendClientSideInfo(request.dataUrl, request.area);

            // Removed setTimeout here, as the debuggerWarning should be present by now
            chrome.runtime.sendMessage({ action: 'getReportData' }, (response) => {
                if (response && response.debuggerWarning) {
                    showNetworkPrompt();
                }
            });
        }
    });

    function initiateSelection(fullPageDataUrl) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.cursor = 'crosshair';
        overlay.style.zIndex = '99999999';

        const handleMouseDown = (e) => {
            startX = e.clientX;
            startY = e.clientY;

            overlay.removeEventListener('mousedown', handleMouseDown);

            selectionDiv = document.createElement('div');
            selectionDiv.style.position = 'fixed';
            selectionDiv.style.border = '2px dashed #fff';
            selectionDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            selectionDiv.style.left = `${startX}px`;
            selectionDiv.style.top = `${startY}px`;
            selectionDiv.style.zIndex = '100000000';
            document.body.appendChild(selectionDiv);

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
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                if (document.body.contains(selectionDiv)) document.body.removeChild(selectionDiv);

                const x = Math.min(startX, upEvent.clientX);
                const y = Math.min(startY, upEvent.clientY);
                const width = Math.abs(startX - upEvent.clientX);
                const height = Math.abs(startY - upEvent.clientY);

                if (width > 10 && height > 10) {
                    cropImage(fullPageDataUrl, { x, y, width, height });
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

            showModal(canvas.toDataURL('image/png'));
            // Send client-side info after cropping and showing modal
            sendClientSideInfo(canvas.toDataURL('image/png'), area);
        };
        image.src = dataUrl;
    }

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

        modalContainer.innerHTML = `
            <div style="background-color: #1e293b; border-radius: 0.5rem; padding: 1.5rem; width: 50%; max-height: 90vh; display: flex; flex-direction: column;">
                <h2 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem; color: white;">Screenshot Captured</h2>
                <div style="flex-grow: 1; overflow: auto; margin-bottom: 1rem; border: 1px solid #475569; border-radius: 0.25rem;">
                    <img id="screenshot-image" src="${dataUrl}" style="width: 100%; height: auto;" />
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem;">
                    <button id="close-modal-btn" style="padding: 0.5rem 1rem; background-color: #4b5563; color: white; border-radius: 0.25rem; cursor: pointer;">Close</button>
                    <a id="download-btn" href="${dataUrl}" download="screenshot.png" style="padding: 0.5rem 1rem; background-color: #2563eb; color: white; border-radius: 0.25rem; text-decoration: none;">Download</a>
                </div>
            </div>
        `;

        document.body.appendChild(modalContainer);

        document.getElementById('close-modal-btn').addEventListener('click', () => {
            modalContainer.remove();
        });

        document.addEventListener('keydown', function close(e) {
            if (e.key === 'Escape') {
                modalContainer.remove();
                document.removeEventListener('keydown', close);
            }
        });
    }

    // New function to send client-side information
    function sendClientSideInfo(screenshotDataUrl, area) {
        const info = {
            url: window.location.href,
            timestamp: new Date().toLocaleString(),
            os: navigator.platform,
            browser: navigator.userAgent, // More detailed parsing would be needed for cleaner browser version
            windowSize: `${window.innerWidth}x${window.innerHeight}`,
            country: "N/A" // Geolocation is generally not allowed without user prompt from content script
                            // For country, you'd typically need a separate service or IP-based lookup
        };

        chrome.runtime.sendMessage({
            action: 'sendReportData',
            payload: {
                info: info,
                actions: userActions // Send collected actions
            }
        });
    }

    function showNetworkPrompt() {
        const existingPrompt = document.getElementById('network-capture-prompt');
        if (existingPrompt) {
            return; // Only show one prompt
        }

        const promptDiv = document.createElement('div');
        promptDiv.id = 'network-capture-prompt';
        promptDiv.style.position = 'fixed';
        promptDiv.style.bottom = '20px';
        promptDiv.style.left = '50%';
        promptDiv.style.transform = 'translateX(-50%)';
        promptDiv.style.backgroundColor = '#f8d7da'; // Light red background for warning
        promptDiv.style.color = '#721c24'; // Dark red text
        promptDiv.style.padding = '15px 20px';
        promptDiv.style.borderRadius = '8px';
        promptDiv.style.border = '1px solid #f5c6cb';
        promptDiv.style.zIndex = '100000002'; // Above modal if still open
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

        // Automatically dismiss after some time (optional)
        setTimeout(() => {
            if (document.body.contains(promptDiv)) {
                promptDiv.remove();
            }
        }, 15000); // Remove after 15 seconds
    }
})();