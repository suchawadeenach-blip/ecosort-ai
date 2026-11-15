const $ = id => document.getElementById(id);
let imageData = null;
let stream = null;

async function checkStatus() {
  const status = $("status");
  try {
    const r = await fetch("/api/status");
    const data = await r.json();
    if (data.ready) {
      status.textContent = "AI พร้อมใช้งาน";
      status.className = "status ok";
    } else {
      status.textContent = "รอตั้งค่า API Key";
      status.className = "status bad";
    }
  } catch {
    status.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    status.className = "status bad";
  }
}
function showImage(dataUrl) {
  imageData = dataUrl;
  $("photo").src = dataUrl;
  $("photo").hidden = false;
  $("preview").querySelector(".placeholder").hidden = true;
  $("analyzeBtn").disabled = false;
  $("resultPanel").hidden = true;
}
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1280, scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", .86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดไฟล์ภาพไม่ได้")); };
    img.src = url;
  });
}
$("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { showImage(await resizeImage(file)); }
  catch (err) { alert(err.message); }
});
$("cameraBtn").addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    $("video").srcObject = stream;
    $("cameraArea").hidden = false;
  } catch {
    alert("เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง และเปิดเว็บไซต์ผ่าน HTTPS");
  }
});
function closeCamera() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $("cameraArea").hidden = true;
}
$("closeCameraBtn").addEventListener("click", closeCamera);
$("captureBtn").addEventListener("click", () => {
  const video = $("video");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  showImage(canvas.toDataURL("image/jpeg", .88));
  closeCamera();
});
const icons = { "รีไซเคิล": "♻️", "อินทรีย์": "🍃", "ทั่วไป": "🗑️", "อันตราย": "☣️", "ไม่แน่ใจ": "❔" };
$("analyzeBtn").addEventListener("click", async () => {
  if (!imageData) return;
  const btn = $("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "กำลังวิเคราะห์ภาพ…";
  $("resultPanel").hidden = true;
  try {
    const response = await fetch("/api/classify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "วิเคราะห์ไม่สำเร็จ");
    $("categoryIcon").textContent = icons[data.category] || "❔";
    $("category").textContent = data.category || "ไม่แน่ใจ";
    $("itemName").textContent = data.item || "";
    $("confidence").textContent = `${data.confidence ?? 0}%`;
    $("bin").textContent = data.bin || "ตรวจสอบกับหน่วยงานท้องถิ่น";
    $("advice").textContent = data.advice || "โปรดตรวจสอบวัสดุก่อนทิ้ง";
    $("reason").textContent = data.reason || "";
    $("safety").textContent = data.safety_note || "";
    $("safety").hidden = !data.safety_note;
    $("resultPanel").hidden = false;
    $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ วิเคราะห์ด้วย AI";
  }
});
checkStatus();