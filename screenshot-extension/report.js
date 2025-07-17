// report.js
document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ action: 'getReportData' }, (response) => {
        if (response) {
            // Display Screenshot
            const screenshotImg = document.getElementById('report-screenshot');
            const downloadBtn = document.getElementById('download-screenshot-btn');
            if (response.screenshotDataUrl) {
                screenshotImg.src = response.screenshotDataUrl;
                downloadBtn.href = response.screenshotDataUrl;
            } else {
                screenshotImg.alt = "No screenshot captured.";
                downloadBtn.style.display = 'none';
            }

            // Display Info
            if (response.info) {
                document.getElementById('info-url').textContent = response.info.url || 'N/A';
                document.getElementById('info-timestamp').textContent = response.info.timestamp || 'N/A';
                document.getElementById('info-os').textContent = response.info.os || 'N/A';
                document.getElementById('info-browser').textContent = response.info.browser || 'N/A';
                document.getElementById('info-window-size').textContent = response.info.windowSize || 'N/A';
                document.getElementById('info-country').textContent = response.info.country || 'N/A';
            }

            if (response.debuggerWarning) {
                document.getElementById('debugger-warning').textContent = response.debuggerWarning;
            }

            // Display Console Logs
            const consoleLogsDiv = document.getElementById('console-logs');
            if (response.consoleLogs && response.consoleLogs.length > 0) {
                response.consoleLogs.forEach(log => {
                    const logEntry = document.createElement('div');
                    logEntry.innerHTML = `<strong>[${log.level.toUpperCase()}] ${log.timestamp}</strong>: ${log.text} (Source: ${log.url}:${log.lineNumber})`;
                    consoleLogsDiv.appendChild(logEntry);
                });
            } else {
                consoleLogsDiv.textContent = 'No console logs captured (or debugger API not enabled/attached).';
            }

            // Display Network Calls
            const networkCallsDiv = document.getElementById('network-calls');
            if (response.networkCalls && response.networkCalls.length > 0) {
                response.networkCalls.forEach(call => {
                    const callEntry = document.createElement('div');
                    callEntry.innerHTML = `<strong>[${call.method}] ${call.timestamp}</strong>: ${call.url}`;
                    networkCallsDiv.appendChild(callEntry);
                });
            } else {
                networkCallsDiv.textContent = 'No network calls captured (or debugger API not enabled/attached).';
            }

            // Display User Actions
            const userActionsDiv = document.getElementById('user-actions');
            if (response.actions && response.actions.length > 0) {
                response.actions.forEach(action => {
                    const actionEntry = document.createElement('div');
                    actionEntry.innerHTML = `<strong>[${action.type}] ${action.timestamp}</strong>: ${JSON.stringify(action.details)}`;
                    userActionsDiv.appendChild(actionEntry);
                });
            } else {
                userActionsDiv.textContent = 'No user actions recorded.';
            }
        } else {
            document.querySelector('.container').innerHTML = '<h1>Error: Could not retrieve report data.</h1>';
        }
    });
});