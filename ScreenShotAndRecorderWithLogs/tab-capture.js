(async () => {
  try {
    let recorder = null;
    let stream = null;
    let chunks = [];

    chrome.tabCapture.capture({ audio: true, video: true }, (capturedStream) => {
      if (!capturedStream) {
        chrome.runtime.sendMessage({
          from: "tab-capture",
          action: "error",
          error: "Tab capture failed"
        });
        window.close();
        return;
      }

      stream = capturedStream;
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          chrome.runtime.sendMessage({
            from: "tab-capture",
            action: "videoReady",
            data: reader.result
          });
          stream.getTracks().forEach(t => t.stop());
          window.close();
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      console.log("✅ Tab capture recording started");

      // ✅ Send message to show recording controller
      chrome.runtime.sendMessage({
        action: "broadcastToActiveTab",
        payload: { action: "showRecordingController" }
      });

      // ✅ Enhanced message listener with pause/resume support
      chrome.runtime.onMessage.addListener((msg) => {
        // Only handle messages directed to tab-capture
        if (msg.to !== "tab-capture") return;

        console.log(`📨 Tab-capture received message:`, msg.action);

        switch (msg.action) {
          case "pause":
            if (recorder && recorder.state === "recording") {
              recorder.pause();
              console.log("⏸ Paused in tab-capture");
            } else {
              console.warn("⚠️ Cannot pause - recorder not in recording state:", recorder?.state);
            }
            break;

          case "resume":
            if (recorder && recorder.state === "paused") {
              recorder.resume();
              console.log("▶️ Resumed in tab-capture");
            } else {
              console.warn("⚠️ Cannot resume - recorder not in paused state:", recorder?.state);
            }
            break;

          case "stopCapture":
            if (recorder && recorder.state !== "inactive") {
              recorder.stop();
              console.log("⏹ Stop requested in tab-capture");
            } else {
              console.warn("⚠️ Recorder already inactive");
            }
            break;

          default:
            console.log("🔍 Unknown action in tab-capture:", msg.action);
            break;
        }
      });

      // ✅ Handle stream ending (e.g., user stops sharing)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log("📺 Screen sharing ended by user");
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      });

    });
  } catch (err) {
    console.error("❌ Tab capture error:", err);
    chrome.runtime.sendMessage({
      from: "tab-capture",
      action: "error",
      error: err.message
    });
    window.close();
  }
})();
