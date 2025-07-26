let mediaRecorder;
let chunks = [];
let stream = null;

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.to !== "offscreen") return;

  switch (msg.action) {
    case "start":
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Assign to named function instead of async arrow
      mediaRecorder.onstop = handleRecordingStop;

      mediaRecorder.start();
      
      // ✅ Trigger recording controller after starting recording
      chrome.runtime.sendMessage({
        action: "broadcastToActiveTab",
        payload: { action: "showRecordingController" }
      });
      
      console.log("✅ start in offscreen");
      break;

    case "pause":
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        console.log("⏸ paused in offscreen");
      }
      break;

    case "resume":
      if (mediaRecorder && mediaRecorder.state === "paused") {
        mediaRecorder.resume();
        console.log("▶️ resumed in offscreen");
      }
      break;

    case "stop":
      if (mediaRecorder?.state !== "inactive") {
        mediaRecorder.stop();
        console.log("⏹ stop requested in offscreen");
      }
      break;
  }
});

// ✅ Reusable stop handler (safe context)
async function handleRecordingStop() {
  try {
    const blob = new Blob(chunks, { type: "video/webm" });
    const base64Url = await blobToBase64(blob);

    // Notify to show preview
    chrome.runtime.sendMessage({
        from: "offscreen",
        action: "videoReady",
        data: base64Url,
      });

    // Cleanup
    stream?.getTracks()?.forEach((t) => t.stop());
    stream = null;
    chunks = [];
  } catch (err) {
    console.error("❌ Error in handleRecordingStop:", err);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
