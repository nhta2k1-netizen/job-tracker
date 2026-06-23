// api/parse-job.js
// Tự động điền job miễn phí: không gọi AI/API bên ngoài, không cần API key.

const CUSTOMER_GROUPS = ["Khách lẻ", "Vinschool"];
const TIME_SLOTS = ["Sáng", "Chiều", "Tối", "Sáng + Chiều", "Chiều + Tối", "Cả ngày"];

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function tidy(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .trim();
}

function parsePhone(text) {
  const match = text.match(/(?:\+?84|0)(?:[\s.-]*\d){8,10}/);
  return match ? tidy(match[0]) : undefined;
}

function parsePrice(text) {
  const compact = text.toLowerCase().replace(/\s+/g, " ");

  // 1tr2, 1tr5, 2 triệu 5 -> 1.200.000, 1.500.000, 2.500.000
  let match = compact.match(/\b(\d+)\s*(?:tr|triệu)\s*(\d{1,3})?\b/);
  if (match) {
    const millions = Number(match[1]) * 1_000_000;
    const tail = match[2] ? Number(match[2]) * (match[2].length <= 2 ? 100_000 : 1_000) : 0;
    return millions + tail;
  }

  match = compact.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|nghìn|ngàn)\b/);
  if (match) return Math.round(Number(match[1].replace(",", ".")) * 1_000);

  match = compact.match(/(?:giá|phí|tiền|tổng)\s*[:=-]?\s*([\d.,]{4,})\s*(?:đ|vnd)?\b/);
  if (match) {
    const value = Number(match[1].replace(/[^\d]/g, ""));
    return Number.isFinite(value) ? value : undefined;
  }

  match = compact.match(/\b([1-9]\d{3,})\s*(?:đ|vnd)\b/);
  if (match) return Number(match[1]);

  return undefined;
}

function parseTime(text) {
  const lower = text.toLowerCase();
  const match = lower.match(/\b(\d{1,2})(?:\s*(?:h|giờ|:)(\d{1,2})?)\s*(sáng|chiều|tối)?\b/);
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3];

  if (hour > 23 || minute > 59) return undefined;
  if ((period === "chiều" || period === "tối") && hour < 12) hour += 12;
  if (period === "sáng" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeSlot(text, startTime) {
  const lower = text.toLowerCase();
  if (/cả ngày|nguyên ngày/.test(lower)) return "Cả ngày";
  if (/sáng\s*(?:\+|và|,|đến)\s*chiều/.test(lower)) return "Sáng + Chiều";
  if (/chiều\s*(?:\+|và|,|đến)\s*tối/.test(lower)) return "Chiều + Tối";
  if (/buổi tối|\btối\b/.test(lower)) return "Tối";
  if (/buổi chiều|\bchiều\b/.test(lower)) return "Chiều";
  if (/buổi sáng|\bsáng\b/.test(lower)) return "Sáng";

  if (startTime) {
    const hour = Number(startTime.slice(0, 2));
    if (hour < 12) return "Sáng";
    if (hour < 18) return "Chiều";
    return "Tối";
  }

  return undefined;
}

function parseLocation(text) {
  const match = text.match(
    /(?:tại|ở|địa\s*điểm\s*[:=-]?)\s+(.+?)(?=\s+(?:lúc|vào lúc|giá|phí|tiền|liên hệ|sđt|zalo)(?:\s|:|$)|\s+\d{1,2}\s*(?:h|giờ|:)|[,;\n]|$)/i
  );
  return match ? tidy(match[1]) : undefined;
}

function parseClient(text) {
  let value = text.split(/[\n;]/)[0];
  value = value.split(/\s+(?:tại|ở|lúc|vào lúc|giá|phí|tiền|liên hệ|sđt|zalo)(?:\s|:|$)/i)[0];
  value = value
    .replace(/(?:\+?84|0)(?:[\s.-]*\d){8,10}/g, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:tr|triệu|k|nghìn|ngàn|đ|vnd)\b/gi, "");
  value = tidy(value);

  if (!value || /^(thêm|tạo|đặt|job|công việc)$/i.test(value)) return undefined;
  return value;
}

function parseNote(text) {
  const match = text.match(/(?:ghi\s*chú|lưu\s*ý|note)\s*[:=-]\s*(.+)$/i);
  return match ? tidy(match[1]) : undefined;
}

function parseJob(text) {
  const startTime = parseTime(text);
  const fields = {
    client: parseClient(text),
    phone: parsePhone(text),
    location: parseLocation(text),
    price: parsePrice(text),
    startTime,
    timeSlot: parseTimeSlot(text, startTime),
    customerGroup: /vinschool/i.test(text) ? "Vinschool" : "Khách lẻ",
    note: parseNote(text),
  };

  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, key === "price" ? String(value) : String(value)])
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = tidy(body?.text);

    if (!text) {
      return json(res, 400, { ok: false, error: "Thiếu nội dung mô tả job" });
    }

    const fields = parseJob(text);
    return json(res, 200, { ok: true, fields });
  } catch (error) {
    console.error("parse-job error:", error);
    return json(res, 500, { ok: false, error: "Không thể phân tích mô tả job" });
  }
};

// Chỉ dùng cho kiểm thử cục bộ; không ảnh hưởng Vercel.
module.exports.parseJob = parseJob;
module.exports.CUSTOMER_GROUPS = CUSTOMER_GROUPS;
module.exports.TIME_SLOTS = TIME_SLOTS;
