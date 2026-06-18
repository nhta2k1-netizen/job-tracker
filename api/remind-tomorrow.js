const admin = require("firebase-admin");

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const CANCELLED_STATUS = "HỦY";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getVietnamDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getTomorrowInfo(date = new Date()) {
  const today = getVietnamDateParts(date);
  const tomorrow = new Date(
    Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + 1)
  );
  const parts = getVietnamDateParts(tomorrow);
  const year = Number(parts.year);
  const month = Number(parts.month) - 1;
  const day = Number(parts.day);

  return {
    key: `${year}-${month}-${day}`,
    label: `${String(day).padStart(2, "0")}/${String(month + 1).padStart(
      2,
      "0"
    )}/${year}`,
  };
}

function getAdminApp() {
  if (admin.apps.length) return admin.app();

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !privateKey
  ) {
    throw new Error("Missing Firebase Admin environment variables");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

function formatJobLine(job, index) {
  const time = job.startTime ? `${job.startTime} - ` : "";
  const place = job.location ? ` tại ${job.location}` : "";
  const group = job.customerGroup ? ` (${job.customerGroup})` : "";

  return `${index + 1}. ${time}${job.client || "Job"}${place}${group}`;
}

function buildEmail({ jobs, dateLabel, email }) {
  const hasJobs = jobs.length > 0;
  const subject = hasJobs
    ? `Nhắc lịch job ngày mai (${dateLabel})`
    : `Ngày mai không có job (${dateLabel})`;

  const intro = hasJobs
    ? `Ngày mai (${dateLabel}) bạn có ${jobs.length} job:`
    : `Ngày mai (${dateLabel}) bạn không có job nào.`;

  const wish = hasJobs
    ? "Chúc bạn chuẩn bị thật gọn gàng, làm việc thuận lợi và có một ngày nhiều năng lượng."
    : "Chúc bạn có một buổi tối thư thái và một ngày mai nhẹ nhàng.";

  const lines = jobs.map(formatJobLine).join("\n");
  const text = `${intro}\n\n${lines ? `${lines}\n\n` : ""}${wish}\n\nJob Tracker`;
  const htmlLines = jobs
    .map(
      (job, index) =>
        `<li><strong>${index + 1}. ${job.client || "Job"}</strong>${
          job.startTime ? ` - ${job.startTime}` : ""
        }${job.location ? ` - ${job.location}` : ""}${
          job.customerGroup ? ` - ${job.customerGroup}` : ""
        }</li>`
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <p>Xin chào ${email},</p>
      <p>${intro}</p>
      ${htmlLines ? `<ul>${htmlLines}</ul>` : ""}
      <p>${wish}</p>
      <p style="color:#64748b">Job Tracker</p>
    </div>
  `;

  return { subject, text, html };
}

async function sendEmail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const from = process.env.REMINDER_FROM_EMAIL || "Job Tracker <onboarding@resend.dev>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!response.ok) {
    throw new Error(`Resend error: ${response.status} ${await response.text()}`);
  }
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return req.headers["user-agent"] === "vercel-cron/1.0";
  }

  return req.headers.authorization === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  try {
    getAdminApp();

    const { key, label } = getTomorrowInfo();
    const usersSnap = await admin.firestore().collection("users").get();
    const results = [];

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userRecord = await admin.auth().getUser(uid).catch(() => null);
      const email = userRecord?.email;

      if (!email) {
        results.push({ uid, skipped: true, reason: "missing_email" });
        continue;
      }

      const jobs = (userDoc.data().jobs?.[key] || []).filter(
        (job) => job.status !== CANCELLED_STATUS
      );
      const emailPayload = buildEmail({ jobs, dateLabel: label, email });

      await sendEmail({ to: email, ...emailPayload });
      results.push({ uid, email, jobCount: jobs.length });
    }

    return json(res, 200, {
      ok: true,
      date: label,
      userCount: usersSnap.size,
      results,
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: error.message });
  }
};
