// api/parse-job.js
//
// Nhận một đoạn mô tả job bằng ngôn ngữ tự nhiên (tiếng Việt) và dùng Claude API
// để trích xuất các trường: client, phone, location, price, startTime,
// timeSlot, customerGroup, note.
//
// Yêu cầu biến môi trường trên Vercel: ANTHROPIC_API_KEY
// (Project Settings → Environment Variables)

// Giữ đồng bộ với CUSTOMER_GROUPS / TIME_SLOTS trong src/App.js
const CUSTOMER_GROUPS = ["Khách lẻ", "Vinschool"];
const TIME_SLOTS = ["Sáng", "Chiều", "Tối", "Sáng + Chiều", "Chiều + Tối", "Cả ngày"];

const MODEL = process.env.ANTHROPIC_PARSE_MODEL || "claude-haiku-4-5-20251001";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function buildSystemPrompt() {
  return `Bạn là bộ trích xuất dữ liệu cho ứng dụng quản lý job chụp ảnh tại Việt Nam.
Người dùng sẽ gửi một đoạn văn bản (có thể là câu mô tả ngắn, hoặc nguyên đoạn tin nhắn/chat trao đổi với khách).
Nhiệm vụ: trích xuất thông tin job và CHỈ trả về một object JSON hợp lệ, không kèm văn bản nào khác, không markdown, không code fence.

Các trường cần trích xuất (chỉ đưa vào JSON nếu xác định được từ văn bản, KHÔNG suy đoán bừa, nếu không có thông tin thì bỏ qua trường đó hoàn toàn, không để chuỗi rỗng hoặc null):
- client: tên khách hàng hoặc nội dung/tên buổi chụp (string)
- phone: số điện thoại hoặc Zalo của khách (string, giữ nguyên định dạng số)
- location: địa điểm chụp (string, ví dụ "Quận 1", "Hồ Tây", "Studio ABC")
- price: giá tiền, CHỈ là số nguyên đơn vị VNĐ không có ký tự khác (ví dụ "1tr2" -> 1200000, "500k" -> 500000, "2 triệu" -> 2000000)
- startTime: giờ bắt đầu, định dạng 24h "HH:MM" (ví dụ "9h sáng" -> "09:00", "2h chiều" -> "14:00", "7h tối" -> "19:00")
- timeSlot: PHẢI là một trong các giá trị chính xác sau: ${JSON.stringify(TIME_SLOTS)} (suy luận theo giờ hoặc theo mô tả buổi sáng/chiều/tối)
- customerGroup: PHẢI là một trong các giá trị chính xác sau: ${JSON.stringify(CUSTOMER_GROUPS)} (nếu văn bản nhắc tới "Vinschool" thì chọn "Vinschool", còn lại mặc định "Khách lẻ" CHỈ khi có job thực sự, nếu không rõ thì bỏ qua trường này)
- note: các thông tin còn lại hữu ích chưa đưa vào trường nào ở trên (ví dụ yêu cầu đặc biệt, số lượng người, loại gói chụp...)

Chỉ trả JSON thuần, ví dụ: {"client":"Chị Lan","price":1200000,"location":"Quận 7","startTime":"09:00"}
Nếu không trích xuất được trường nào cả, trả về {}.`;
}

async function callClaude(text) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === "text");

  if (!textBlock) {
    throw new Error("Không nhận được phản hồi văn bản từ Claude API");
  }

  return textBlock.text;
}

function safeParseJson(raw) {
  const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "");

  return JSON.parse(cleaned);
}

const VALID_KEYS = [
  "client",
  "phone",
  "location",
  "price",
  "startTime",
  "timeSlot",
  "customerGroup",
  "note",
];

function sanitize(parsed) {
  const out = {};

  for (const key of VALID_KEYS) {
    if (parsed[key] === undefined || parsed[key] === null || parsed[key] === "") {
      continue;
    }

    if (key === "timeSlot" && !TIME_SLOTS.includes(parsed[key])) continue;
    if (key === "customerGroup" && !CUSTOMER_GROUPS.includes(parsed[key])) continue;
    if (key === "price") {
      const n = Number(parsed[key]);
      if (!Number.isFinite(n) || n < 0) continue;
      out.price = String(Math.round(n));
      continue;
    }

    out[key] = String(parsed[key]);
  }

  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 500, { ok: false, error: "Missing ANTHROPIC_API_KEY" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = (body && body.text ? String(body.text) : "").trim();

    if (!text) {
      return json(res, 400, { ok: false, error: "Thiếu nội dung mô tả job" });
    }

    const raw = await callClaude(text);
    const parsed = safeParseJson(raw);
    const fields = sanitize(parsed);

    return json(res, 200, { ok: true, fields });
  } catch (error) {
    console.error("parse-job error:", error);
    return json(res, 500, { ok: false, error: error.message });
  }
};
