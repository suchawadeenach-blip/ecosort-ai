const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ROOT = __dirname;
const MAX_BODY = 12 * 1024 * 1024;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("ไฟล์ใหญ่เกิน 10 MB"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("ข้อมูลภาพไม่ถูกต้อง")); }
    });
    req.on("error", reject);
  });
}

async function classify(req, res) {
  if (!API_KEY) return send(res, 503, {
    error: "เว็บไซต์ยังไม่ได้ตั้งค่า Gemini API Key ที่เซิร์ฟเวอร์"
  });

  try {
    const body = await readBody(req);
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image || "");
    if (!match) return send(res, 400, { error: "กรุณาเลือกภาพ JPG, PNG หรือ WEBP" });

    const mimeType = match[1];
    const base64Data = match[2];

    const prompt = `คุณเป็นผู้ช่วยคัดแยกขยะสำหรับประเทศไทย วิเคราะห์ภาพที่แนบมา
ตอบเป็น JSON เท่านั้น ห้ามใส่ Markdown โดยใช้ schema นี้:
{
 "is_waste": true,
 "item": "ชื่อสิ่งของที่เห็น",
 "category": "รีไซเคิล|อินทรีย์|ทั่วไป|อันตราย|ไม่แน่ใจ",
 "confidence": 0,
 "bin": "สี/ชื่อถังที่เหมาะสม",
 "advice": "คำแนะนำการจัดการสั้นๆ",
 "reason": "เหตุผลสั้นๆ",
 "safety_note": "ข้อควรระวัง หรือเว้นว่าง"
}
กติกา:
- จำแนกตามวัสดุและสภาพจริงในภาพ ไม่เดาชนิดวัสดุที่มองไม่เห็น
- รีไซเคิล: กระดาษ พลาสติก แก้ว โลหะที่รีไซเคิลได้และควรทำความสะอาด
- อินทรีย์: เศษอาหาร ใบไม้ และวัสดุย่อยสลายได้
- ทั่วไป: วัสดุปนเปื้อนหรือขยะที่รีไซเคิล/ทำปุ๋ยไม่ได้
- อันตราย: ถ่านไฟฉาย แบตเตอรี่ หลอดไฟ สารเคมี กระป๋องสเปรย์ และขยะอันตราย
- หากภาพไม่ชัด มีหลายชิ้นปะปน หรือแยกประเภทไม่ได้ ให้ category เป็น "ไม่แน่ใจ" และ confidence ต่ำ
- confidence เป็นตัวเลข 0 ถึง 100 ตามความมั่นใจจริง ไม่ใช่ความแม่นยำที่รับประกัน
- หากเป็นขยะอันตราย ให้เตือนว่าอย่าแกะ บีบ หรือเทสารออก และแยกส่งจุดรับทิ้งเฉพาะ
- คำแนะนำต้องสั้น ชัดเจน และเหมาะกับบริบทประเทศไทย`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.message || "เรียกใช้บริการ AI ไม่สำเร็จ";
      return send(res, 502, { error: message });
    }

    const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
    if (!text) return send(res, 502, { error: "AI ไม่ส่งผลวิเคราะห์กลับมา กรุณาลองใหม่" });

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return send(res, 502, { error: "รูปแบบผลลัพธ์จาก AI ไม่ถูกต้อง กรุณาลองใหม่" }); }

    const allowed = ["รีไซเคิล", "อินทรีย์", "ทั่วไป", "อันตราย", "ไม่แน่ใจ"];
    if (!allowed.includes(parsed.category)) parsed.category = "ไม่แน่ใจ";
    parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    send(res, 200, parsed);
  } catch (err) {
    send(res, 400, { error: err.message || "เกิดข้อผิดพลาดในการวิเคราะห์ภาพ" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname === "/api/classify") return classify(req, res);
  if (req.method === "GET" && url.pathname === "/api/status") {
    return send(res, 200, { ready: Boolean(API_KEY), model: MODEL });
  }

  let pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, data, mime[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(PORT, () => console.log(`EcoSort AI running on port ${PORT}`));