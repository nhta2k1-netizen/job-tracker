// api/parse-job.js
//
// Nhận mô tả job bằng tiếng Việt và dùng OpenAI để trích xuất các trường:
// client, phone, location, price, startTime, timeSlot, customerGroup, note.
//
// Biến môi trường bắt buộc trên Vercel: OPENAI_API_KEY
// Biến tùy chọn: OPENAI_PARSE_MODEL (mặc định: gpt-5.4-mini)

const CUSTOMER_GROUPS = ["Khách lẻ", "Vinschool"];
const TIME_SLOTS = ["Sáng", "Chiều", "Tối", "Sáng + Chiều", "Chiều + Tối", "Cả ngày"];

const MODEL = process.env.OPENAI_PARSE_MODEL || "gpt-5.4-mini";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function buildSystemPrompt() {
  return `Bạn là bộ trích xuất dữ liệu cho ứng dụng quản lý job chụp ảnh tại Việt Nam.
Người dùng sẽ gửi một đoạn văn bản, có thể là mô tả ngắn hoặc tin nhắn trao đổi với khách.

Chỉ trích xuất thông tin có trong nội dung, không suy đoán bừa:
- client: tên khách hàng hoặc nội dung/tên buổi chụp
- phone: số điện thoại hoặc Zalo, giữ nguyên định dạng
- location: địa điểm chụp
- price: giá tiền dạng số nguyên VNĐ; ví dụ 1tr2 = 1200000, 500k = 500000
- startTime: giờ bắt đầu định dạng 24 giờ HH:MM
- timeSlot: một trong ${JSON.stringify(TIME_SLOTS)}
- customerGroup: một trong ${JSON.stringify(CUSTOMER_GROUPS)}; nếu nhắc Vinschool thì chọn Vinschool
- note: thông tin hữu ích còn lại chưa nằm trong các trường trên

Nếu không xác định được trường nào, để tất cả giá trị là null.`;
}

const JOB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    client: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    price: { type: ["integer", "null"], minimum: 0 },
    startTime: {
      type: ["string", "null"],
      pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
    },
    timeSlot: {
      anyOf: [{ type: "string", enum: TIME_SLOTS }, { type: "null" }],
    },
    customerGroup: {
      anyOf: [{ type: "string", enum: CUSTOMER_GROUPS }, { type: "null" }],
    },
    note: { type: ["string", "null"] },
  },
  required: [
    "client",
    "phone",
    "location",
    "price",
    "startTime",
    "timeSlot",
    "customerGroup",
    "note",
  ],
};

async function callOpenAI(text) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "job_fields",
          strict: true,
          schema: JOB_SCHEMA,
        },
      },
      max_completion_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;

  if (message?.refusal) {
    throw new Error(`OpenAI từ chối xử lý: ${message.refusal}`);
  }

  if (!message?.content) {
    throw new Error("Không nhận được phản hồi từ OpenAI API");
  }

  return JSON.parse(message.content);
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

  if (!process.env.OPENAI_API_KEY) {
    return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = (body?.text ? String(body.text) : "").trim();

    if (!text) {
      return json(res, 400, { ok: false, error: "Thiếu nội dung mô tả job" });
    }

    const parsed = await callOpenAI(text);
    const fields = sanitize(parsed);

    return json(res, 200, { ok: true, fields });
  } catch (error) {
    console.error("parse-job error:", error);
    return json(res, 500, { ok: false, error: error.message });
  }
};
