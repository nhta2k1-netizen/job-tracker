import { useState, useEffect, useRef } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { db, auth } from "./firebase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Constants ────────────────────────────────────────────────────────────────
const MONTHS = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

const DAYS_HEADER = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const TIME_SLOTS = [
  "Sáng",
  "Chiều",
  "Tối",
  "Sáng + Chiều",
  "Chiều + Tối",
  "Cả ngày",
];

const CUSTOMER_GROUPS = ["Khách lẻ", "Vinschool"];

const STATUS_CFG = {
  CHƯA: { bg: "#ef4444", light: "#fee2e2", text: "#fff", dot: "#ef4444" },
  XONG: { bg: "#22c55e", light: "#dcfce7", text: "#fff", dot: "#22c55e" },
  HỦY: { bg: "#64748b", light: "#f1f5f9", text: "#fff", dot: "#64748b" },
};

const TABS = ["📅 Lịch", "📊 Thống kê", "🔍 Tìm kiếm"];

const EMPTY_FORM = {
  client: "",
  phone: "",
  customerGroup: "Khách lẻ",
  location: "",
  price: "",
  startTime: "",
  timeSlot: "Sáng",
  status: "CHƯA",
  note: "",
  driveLink: "",
  reminderDays: "1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

const firstWeekday = (y, m) => {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1;
};

const fmt = (n) => (n ? Number(n).toLocaleString("vi-VN") + "đ" : "—");

const fmtVND = (n) => (n ? Number(n).toLocaleString("vi-VN") + " VNĐ" : "—");

const moneyReport = (n) => Number(n || 0).toLocaleString("vi-VN");

const dateKey = (y, m, d) => `${y}-${m}-${d}`;

const getCustomerGroup = (job) => job.customerGroup || "Khách lẻ";

const onlyDigits = (value) => (value || "").toString().replace(/\D/g, "");

const formatMoneyInput = (value) => {
  const digits = onlyDigits(value);

  return digits ? Number(digits).toLocaleString("vi-VN") : "";
};

const getMoneyNumber = (value) => Number(onlyDigits(value)) || 0;

const getPriceNumber = (job) => getMoneyNumber(job.price);

const maskCreator = (value = "") => {
  const text = String(value || "");
  const raw = text.includes("@") ? text.split("@")[0] : text;

  if (!raw) return "******";
  if (raw.length <= 5) return "*****" + raw;

  return "*****" + raw.slice(-5);
};

const reportDateTime = () =>
  new Date().toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const getJobColor = (job) => {
  if (job.status === "XONG" && job.paymentStatus === "UNPAID") {
    return { bg: "#facc15", text: "#713f12" };
  }

  return STATUS_CFG[job.status] || STATUS_CFG["CHƯA"];
};

function upcomingReminders(jobs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const alerts = [];

  Object.entries(jobs).forEach(([key, list]) => {
    const [y, m, d] = key.split("-").map(Number);
    const jobDate = new Date(y, m, d);
    jobDate.setHours(0, 0, 0, 0);

    list.forEach((job) => {
      if (job.status === "HỦY") return;

      const remind = parseInt(job.reminderDays || "1");
      const diff = Math.round((jobDate - today) / 86400000);

      if (diff >= 0 && diff <= 7) {
        alerts.push({
          ...job,
          jobDate,
          diff,
          dateLabel: `${d}/${m + 1}`,
        });
      }
    });
  });

  return alerts.sort((a, b) => a.diff - b.diff);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const today = new Date();

  const [tab, setTab] = useState(0);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [jobs, setJobs] = useState({});
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [editKey, setEditKey] = useState(null);
  const [selDate, setSelDate] = useState(null);
  const [viewJob, setViewJob] = useState(null);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [revenueGroup, setRevenueGroup] = useState("ALL");
  const [showReport, setShowReport] = useState(false);

  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const toastRef = useRef();

  const [confetti, setConfetti] = useState(false);
  const confettiRef = useRef();

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function register() {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast("Tạo tài khoản thành công");
    } catch (error) {
      console.error("Lỗi tạo tài khoản:", error);
      showToast("Không tạo được tài khoản", "#ef4444");
    }
  }

  async function login() {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Đăng nhập thành công");
    } catch (error) {
      console.error("Lỗi đăng nhập:", error);
      showToast("Sai email hoặc mật khẩu", "#ef4444");
    }
  }

  async function logout() {
    await signOut(auth);
    setJobs({});
  }

  function launchConfetti() {
    setConfetti(true);
    clearTimeout(confettiRef.current);
    confettiRef.current = setTimeout(() => setConfetti(false), 2600);
  }

  useEffect(() => {
    async function loadJobs() {
      if (authLoading) return;

      if (!user) {
        setJobs({});
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setJobs(snap.data().jobs || {});
        } else {
          setJobs({});
        }
      } catch (error) {
        console.error("Lỗi tải Firebase:", error);
        showToast("Không tải được dữ liệu Firebase", "#ef4444");
      } finally {
        setLoading(false);
      }
    }

    loadJobs();
  }, [user, authLoading]);

  async function saveJobs(nj) {
    if (!user) {
      showToast("Bạn cần đăng nhập trước", "#ef4444");
      return;
    }

    setJobs(nj);

    try {
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, {
        jobs: nj,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Lỗi lưu Firebase:", error);
      showToast("Không lưu được vào Firebase", "#ef4444");
    }
  }

  function showToast(msg, color = "#22c55e") {
    setToast({ msg, color });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2500);
  }

  async function handleAIFill() {
    const text = aiText.trim();

    if (!text) {
      showToast("Hãy nhập mô tả job trước", "#ef4444");
      return;
    }

    setAiLoading(true);

    try {
      const res = await fetch("/api/parse-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Lỗi không xác định");
      }

      const fields = data.fields || {};

      if (Object.keys(fields).length === 0) {
        showToast("AI không trích xuất được thông tin nào", "#f59e0b");
        return;
      }

      setForm((p) => ({
        ...p,
        ...(fields.client ? { client: fields.client } : {}),
        ...(fields.phone ? { phone: fields.phone } : {}),
        ...(fields.location ? { location: fields.location } : {}),
        ...(fields.price ? { price: formatMoneyInput(fields.price) } : {}),
        ...(fields.startTime ? { startTime: fields.startTime } : {}),
        ...(fields.timeSlot ? { timeSlot: fields.timeSlot } : {}),
        ...(fields.customerGroup ? { customerGroup: fields.customerGroup } : {}),
        ...(fields.note ? { note: fields.note } : {}),
      }));

      showToast("✨ AI đã điền giúp bạn, kiểm tra lại trước khi lưu");
    } catch (error) {
      console.error("Lỗi AI điền job:", error);
      showToast("AI điền lỗi: " + error.message, "#ef4444");
    } finally {
      setAiLoading(false);
    }
  }


  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  function openAdd(day) {
    setSelDate(day);
    setForm(EMPTY_FORM);
    setEditId(null);
    setEditKey(null);
    setAiText("");
    setModal("add");
  }

  function openQuickAdd() {
    const now = new Date();

    setTab(0);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelDate(now.getDate());
    setForm(EMPTY_FORM);
    setEditId(null);
    setEditKey(null);
    setAiText("");
    setModal("add");
  }

  function openEdit(job) {
    const key = job._key || null;
    const dayFromKey = key ? Number(key.split("-")[2]) : job._day;

    setSelDate(dayFromKey);
    setEditKey(key);

    setForm({
      client: job.client || "",
      phone: job.phone || "",
      customerGroup: job.customerGroup || "Khách lẻ",
      location: job.location || "",
      price: formatMoneyInput(job.price),
      startTime: job.startTime || "",
      timeSlot: job.timeSlot || "Sáng",
      status: job.status || "CHƯA",
      note: job.note || "",
      driveLink: job.driveLink || "",
      reminderDays: job.reminderDays || "1",
    });

    setEditId(job.id);
    setViewJob(null);
    setAiText("");
    setModal("edit");
  }

  function handleSave() {
    if (!form.client.trim()) {
      showToast("Nhập tên khách hàng!", "#ef4444");
      return;
    }

    const key = editId && editKey ? editKey : dateKey(year, month, selDate);
    const nj = { ...jobs };

    if (!nj[key]) nj[key] = [];

    if (editId) {
      nj[key] = nj[key].map((j) =>
        j.id === editId
          ? {
              ...j,
              ...form,
              _day: selDate,
              status: j.status || form.status || "CHƯA",
            }
          : j
      );

      showToast("Đã lưu thay đổi ✓");
    } else {
      nj[key] = [
        ...nj[key],
        {
          id: Date.now().toString(),
          ...form,
          status: "CHƯA",
          _day: selDate,
        },
      ];

      showToast("Đã thêm job ✓");
    }

    saveJobs(nj);
    setModal(null);
  }

  function handleDelete(key, id) {
    const nj = { ...jobs };

    nj[key] = nj[key].filter((j) => j.id !== id);

    if (!nj[key].length) delete nj[key];

    saveJobs(nj);
    setModal(null);
    setViewJob(null);
    showToast("Đã xóa job", "#ef4444");
  }

  async function updateViewJob(changes, successText, options = {}) {
    if (!viewJob?._key) return;

    const nj = { ...jobs };

    nj[viewJob._key] = (nj[viewJob._key] || []).map((j) =>
      j.id === viewJob.id ? { ...j, ...changes } : j
    );

    await saveJobs(nj);
    setViewJob((p) => ({ ...p, ...changes }));
    showToast(successText);

    if (options.confetti) {
      launchConfetti();
    }

    if (options.close) {
      setModal(null);
      setViewJob(null);
    }
  }

  const dim = daysInMonth(year, month);
  const fd = firstWeekday(year, month);
  const cells = Math.ceil((fd + dim) / 7) * 7;

  const monthPrefix = `${year}-${month}-`;

  const monthJobs = Object.entries(jobs)
    .filter(([k]) => k.startsWith(monthPrefix))
    .flatMap(([, v]) => v);

  const doneJobs = monthJobs.filter((j) => j.status === "XONG");

  const revenueJobs = monthJobs.filter((j) => {
    const matchGroup =
      revenueGroup === "ALL" || getCustomerGroup(j) === revenueGroup;

    return j.status === "XONG" && matchGroup;
  });

  const revenue = revenueJobs.reduce((s, j) => s + getPriceNumber(j), 0);

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, month - 5 + i, 1);
    const y2 = d.getFullYear();
    const m2 = d.getMonth();
    const prefix2 = `${y2}-${m2}-`;

    const rev = Object.entries(jobs)
      .filter(([k]) => k.startsWith(prefix2))
      .flatMap(([, v]) => v)
      .filter(
        (j) =>
          j.status === "XONG" &&
          (revenueGroup === "ALL" || getCustomerGroup(j) === revenueGroup)
      )
      .reduce((s, j) => s + getPriceNumber(j), 0);

    return { name: `T${m2 + 1}`, rev, month: m2, year: y2 };
  });

  const allJobs = Object.entries(jobs).flatMap(([key, list]) =>
    list.map((j) => ({ ...j, _key: key }))
  );

  const searched = allJobs
    .filter((j) => {
      const q = search.toLowerCase();

      const matchQ =
        !q ||
        j.client?.toLowerCase().includes(q) ||
        j.phone?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q) ||
        j.note?.toLowerCase().includes(q) ||
        j.startTime?.toLowerCase().includes(q) ||
        getCustomerGroup(j).toLowerCase().includes(q);

      const matchStatus = filterStatus === "ALL" || j.status === filterStatus;

      return matchQ && matchStatus;
    })
    .sort((a, b) => b.id - a.id);

  const reminders = upcomingReminders(jobs);

  const S = {
    wrap: {
      minHeight: "100vh",
      background: "#f1f5f9",
      fontFamily: "'Inter','Segoe UI',sans-serif",
      color: "#1e293b",
      paddingBottom: 80,
    },
    card: { background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0" },
    label: {
      fontSize: 11,
      fontWeight: 700,
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4,
      display: "block",
    },
    input: {
      width: "100%",
      padding: "10px 12px",
      border: "1px solid #e2e8f0",
      borderRadius: 9,
      fontSize: 14,
      outline: "none",
      boxSizing: "border-box",
      background: "#f8fafc",
      fontFamily: "inherit",
    },
    btn: (bg, c = "#fff") => ({
      background: bg,
      color: c,
      border: "none",
      borderRadius: 10,
      padding: "11px 18px",
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "inherit",
    }),
  };

  if (authLoading) {
    return <div style={{ padding: 24 }}>Đang kiểm tra đăng nhập...</div>;
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "Inter,sans-serif",
          fontSize: 15,
          color: "#94a3b8",
        }}
      >
        Đang tải...
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{
          maxWidth: 420,
          margin: "80px auto",
          padding: 24,
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h1>Đăng nhập Job Tracker</h1>
        <p>Vui lòng đăng nhập trước khi vào trang chính.</p>

        <input
          style={{
            width: "100%",
            padding: 12,
            marginBottom: 12,
            borderRadius: 8,
            border: "1px solid #d1d5db",
          }}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          style={{
            width: "100%",
            padding: 12,
            marginBottom: 12,
            borderRadius: 8,
            border: "1px solid #d1d5db",
          }}
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button onClick={login} style={{ padding: 12, marginRight: 8 }}>
          Đăng nhập
        </button>

        <button onClick={register} style={{ padding: 12 }}>
          Tạo tài khoản
        </button>
      </div>
    );
  }

  if (showReport) {
    const reportJobs = Object.entries(jobs)
      .filter(([k]) => k.startsWith(monthPrefix))
      .flatMap(([key, list]) =>
        (list || [])
          .filter(
            (j) =>
              j.status === "XONG" &&
              (revenueGroup === "ALL" || getCustomerGroup(j) === revenueGroup)
          )
          .map((j) => ({ ...j, _key: key }))
      )
      .sort((a, b) => {
        const [ay, am, ad] = a._key.split("-").map(Number);
        const [by, bm, bd] = b._key.split("-").map(Number);

        return new Date(ay, am, ad).getTime() - new Date(by, bm, bd).getTime();
      });

    const reportRows = reportJobs.map((job) => {
      const [, rm, rd] = job._key.split("-").map(Number);

      return {
        date: `${String(rd).padStart(2, "0")}/${String(rm + 1).padStart(
          2,
          "0"
        )}`,
        startTime: job.startTime || "—",
        client: job.client || "—",
        phone: job.phone || "—",
        location: job.location || "—",
        customerGroup: getCustomerGroup(job),
        total: getPriceNumber(job),
      };
    });

    const totalAll = reportRows.reduce((s, r) => s + r.total, 0);

    return (
      <div
        className="report-page"
        style={{
          minHeight: "100vh",
          background: "#f1f5f9",
          padding: 26,
          fontFamily: "'Inter','Segoe UI',Arial,sans-serif",
          color: "#202124",
        }}
      >
        <style>
          {`
            @media print {
              @page {
                size: A4 portrait;
                margin: 12mm;
              }

              body {
                background: #fff !important;
              }

              .no-print {
                display: none !important;
              }

              .report-page {
                padding: 0 !important;
                background: #fff !important;
              }

              .report-card {
                box-shadow: none !important;
                border-radius: 0 !important;
                padding: 0 !important;
                max-width: none !important;
              }
            }
          `}
        </style>

        <div
          className="report-card"
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            background: "#fff",
            borderRadius: 22,
            padding: "70px 80px 64px",
            boxShadow: "0 12px 40px rgba(15,23,42,0.08)",
          }}
        >
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              marginBottom: 36,
            }}
          >
            <button
              onClick={() => setShowReport(false)}
              style={{
                border: "none",
                background: "#e5e7eb",
                color: "#4b5563",
                borderRadius: 14,
                padding: "18px 34px",
                fontSize: 22,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ← Trở về
            </button>

            <button
              onClick={() => window.print()}
              style={{
                border: "none",
                background: "#0b77ff",
                color: "#fff",
                borderRadius: 14,
                padding: "18px 34px",
                fontSize: 22,
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 8px 18px rgba(11,119,255,0.25)",
              }}
            >
              🖨️ In / Lưu PDF
            </button>
          </div>

          <div className="no-print" style={{ marginBottom: 34 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 900,
                color: "#4b5563",
                marginBottom: 12,
              }}
            >
              Lọc doanh thu
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["ALL", ...CUSTOMER_GROUPS].map((g) => (
                <button
                  key={g}
                  onClick={() => setRevenueGroup(g)}
                  style={{
                    border: "none",
                    borderRadius: 12,
                    padding: "13px 22px",
                    fontSize: 16,
                    fontWeight: 900,
                    cursor: "pointer",
                    background: revenueGroup === g ? "#0b77ff" : "#eef2f7",
                    color: revenueGroup === g ? "#fff" : "#64748b",
                  }}
                >
                  {g === "ALL" ? "Tất cả" : g}
                </button>
              ))}
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <h1
              style={{
                fontSize: 42,
                lineHeight: 1.15,
                margin: 0,
                fontWeight: 950,
                letterSpacing: -1,
                color: "#202124",
              }}
            >
              BÁO CÁO DOANH THU THÁNG {month + 1}/{year}
            </h1>

            <div
              style={{
                marginTop: 18,
                fontSize: 24,
                color: "#6b7280",
                fontWeight: 700,
                lineHeight: 1.35,
              }}
            >
              <div>Người tạo: {maskCreator(user?.email)}</div>
              <div>Ngày xuất: {reportDateTime()}</div>
              <div>
                Tệp khách: {revenueGroup === "ALL" ? "Tất cả" : revenueGroup}
              </div>
            </div>
          </div>

          <div
            style={{
              height: 4,
              background: "#e5e7eb",
              margin: "40px 0 56px",
            }}
          />

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 20,
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "NGÀY",
                  "GIỜ",
                  "KHÁCH HÀNG",
                  "SĐT",
                  "ĐỊA ĐIỂM",
                  "TỆP KHÁCH",
                  "DOANH THU",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign:
                        h === "KHÁCH HÀNG" ||
                        h === "ĐỊA ĐIỂM" ||
                        h === "TỆP KHÁCH"
                          ? "left"
                          : "right",
                      padding: "18px 18px",
                      color: "#4b5563",
                      fontSize: 16,
                      fontWeight: 900,
                      borderBottom: "4px solid #d9dee5",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {reportRows.map((r, idx) => (
                <tr key={idx}>
                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.date}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.startTime}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      fontWeight: 650,
                    }}
                  >
                    {r.client}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      textAlign: "right",
                    }}
                  >
                    {r.phone}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      fontWeight: 650,
                    }}
                  >
                    {r.location}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      fontWeight: 650,
                    }}
                  >
                    {r.customerGroup}
                  </td>

                  <td
                    style={{
                      padding: "20px 18px",
                      borderBottom: "3px solid #e5e7eb",
                      textAlign: "right",
                      fontWeight: 900,
                    }}
                  >
                    {moneyReport(r.total)}
                  </td>
                </tr>
              ))}

              {!reportRows.length && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "40px 22px",
                      textAlign: "center",
                      color: "#9ca3af",
                      borderBottom: "3px solid #e5e7eb",
                    }}
                  >
                    Chưa có job đã hoàn thành trong tháng này
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr style={{ background: "#f8fafc" }}>
                <td
                  colSpan={6}
                  style={{
                    padding: "24px 18px",
                    color: "#0b77ff",
                    fontSize: 24,
                    fontWeight: 950,
                  }}
                >
                  TỔNG CỘNG
                </td>

                <td
                  style={{
                    padding: "24px 18px",
                    textAlign: "right",
                    color: "#0b77ff",
                    fontSize: 24,
                    fontWeight: 950,
                  }}
                >
                  {moneyReport(totalAll)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div
            style={{
              textAlign: "center",
              marginTop: 60,
              color: "#9ca3af",
              fontSize: 21,
              fontWeight: 650,
            }}
          >
            Thống kê được xuất từ hệ thống quản lý lịch làm việc.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <style>
        {`
          @keyframes jt-confetti-fall {
            0% {
              transform: translate3d(0, -40px, 0) rotate(0deg);
              opacity: 1;
            }
            100% {
              transform: translate3d(var(--dx), 105vh, 0) rotate(760deg);
              opacity: 0;
            }
          }

          @keyframes jt-congrats-pop {
            0% {
              transform: translate(-50%, -50%) scale(0.6);
              opacity: 0;
            }
            15% {
              transform: translate(-50%, -50%) scale(1.06);
              opacity: 1;
            }
            80% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            100% {
              transform: translate(-50%, -50%) scale(0.95);
              opacity: 0;
            }
          }
        `}
      </style>

      {confetti && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 9998,
          }}
        >
          {Array.from({ length: 90 }).map((_, i) => {
            const colors = [
              "#22c55e",
              "#facc15",
              "#0ea5e9",
              "#ef4444",
              "#a855f7",
              "#ff7a12",
            ];

            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${(i * 37) % 100}%`,
                  top: -20,
                  width: 7 + (i % 5),
                  height: 10 + (i % 8),
                  borderRadius: 2,
                  background: colors[i % colors.length],
                  "--dx": `${((i % 11) - 5) * 24}px`,
                  animation: `jt-confetti-fall ${
                    1.35 + (i % 9) * 0.12
                  }s ease-out forwards`,
                  animationDelay: `${(i % 12) * 0.025}s`,
                }}
              />
            );
          })}

          <div
            style={{
              position: "fixed",
              left: "50%",
              top: "46%",
              transform: "translate(-50%, -50%)",
              background: "#16a34a",
              color: "#fff",
              padding: "18px 28px",
              borderRadius: 18,
              fontSize: 22,
              fontWeight: 900,
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              animation: "jt-congrats-pop 2.4s ease-out forwards",
              whiteSpace: "nowrap",
            }}
          >
            🎉 Chúc mừng! Job đã hoàn thành
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.color,
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 30,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 9999,
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            whiteSpace: "nowrap",
          }}
        >
          {toast.msg}
        </div>
      )}

      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "14px 16px",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#0f172a",
                  letterSpacing: -0.5,
                }}
              >
                📷 Job Tracker
              </div>

              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                Lịch công việc chụp ảnh
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <div
                title={user?.email || ""}
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  maxWidth: 140,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user?.email}
              </div>

              <button
                onClick={openQuickAdd}
                style={{
                  ...S.btn("#7c3aed"),
                  fontSize: 12,
                  padding: "8px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                ✨ AI tạo job
              </button>

              <button
                onClick={() => setShowReport(true)}
                style={{
                  ...S.btn("#0b77ff"),
                  fontSize: 12,
                  padding: "8px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                🖨️ Báo cáo PDF
              </button>

              <button
                onClick={logout}
                style={{
                  ...S.btn("#f1f5f9", "#ef4444"),
                  fontSize: 12,
                  padding: "8px 14px",
                }}
              >
                Đăng xuất
              </button>
            </div>
          </div>

          {reminders.length > 0 && (
            <div
              style={{
                background: "#fef3c7",
                border: "1px solid #fcd34d",
                borderRadius: 10,
                padding: "8px 12px",
                marginBottom: 10,
                fontSize: 12,
              }}
            >
              🔔 <b>Job sắp tới:</b>{" "}
              {reminders
                .slice(0, 3)
                .map(
                  (r) =>
                    `${r.client} (${r.dateLabel}${
                      r.diff === 0
                        ? " - Hôm nay"
                        : r.diff === 1
                        ? " - Ngày mai"
                        : ` - ${r.diff} ngày nữa`
                    })`
                )
                .join(" · ")}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            {["ALL", ...CUSTOMER_GROUPS].map((g) => (
              <button
                key={g}
                onClick={() => setRevenueGroup(g)}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "7px 13px",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  background: revenueGroup === g ? "#6366f1" : "#f1f5f9",
                  color: revenueGroup === g ? "#fff" : "#64748b",
                }}
              >
                {g === "ALL" ? "Tất cả doanh thu" : g}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 8,
            }}
          >
            {[
              { label: "Tổng job", value: monthJobs.length, color: "#6366f1" },
              { label: "Đã xong", value: doneJobs.length, color: "#22c55e" },
              {
                label: "Chờ làm",
                value: monthJobs.filter((j) => j.status === "CHƯA").length,
                color: "#f59e0b",
              },
              {
                label:
                  revenueGroup === "ALL"
                    ? "Doanh thu"
                    : `Doanh thu ${revenueGroup}`,
                value: revenue ? revenue.toLocaleString("vi-VN") + "đ" : "—",
                color: "#0ea5e9",
              },
            ].map((s) => (
              <div key={s.label} style={{ ...S.card, padding: "8px 10px" }}>
                <div
                  style={{ fontSize: 10, color: "#94a3b8", marginBottom: 1 }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: s.color }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "0 16px",
        }}
      >
        <div
          style={{ maxWidth: 860, margin: "0 auto", display: "flex", gap: 0 }}
        >
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              style={{
                background: "none",
                border: "none",
                borderBottom:
                  tab === i ? "2.5px solid #6366f1" : "2.5px solid transparent",
                padding: "12px 16px",
                fontSize: 13,
                fontWeight: tab === i ? 700 : 500,
                color: tab === i ? "#6366f1" : "#64748b",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 12px" }}>
        {tab === 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <button
                onClick={prevMonth}
                style={{
                  ...S.btn("#f1f5f9", "#475569"),
                  padding: "8px 14px",
                  fontSize: 16,
                }}
              >
                ‹
              </button>

              <span
                style={{
                  fontWeight: 800,
                  fontSize: 16,
                  minWidth: 150,
                  textAlign: "center",
                }}
              >
                {MONTHS[month]} {year}
              </span>

              <button
                onClick={nextMonth}
                style={{
                  ...S.btn("#f1f5f9", "#475569"),
                  padding: "8px 14px",
                  fontSize: 16,
                }}
              >
                ›
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                gap: 3,
                marginBottom: 3,
              }}
            >
              {DAYS_HEADER.map((d, i) => (
                <div
                  key={d}
                  style={{
                    minWidth: 0,
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: i === 6 ? "#ef4444" : "#64748b",
                    padding: "5px 0",
                    background: "#fff",
                    borderRadius: 6,
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                gap: 3,
              }}
            >
              {Array.from({ length: cells }).map((_, idx) => {
                const day = idx - fd + 1;
                const valid = day >= 1 && day <= dim;
                const isToday =
                  valid &&
                  day === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear();
                const isSun = idx % 7 === 6;
                const key = dateKey(year, month, day);
                const dayJobs = valid ? jobs[key] || [] : [];

                return (
                  <div
                    key={idx}
                    onClick={() => valid && openAdd(day)}
                    style={{
                      minWidth: 0,
                      minHeight: 78,
                      background: valid ? "#fff" : "#f8fafc",
                      border: isToday
                        ? "2px solid #6366f1"
                        : "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "5px 4px",
                      cursor: valid ? "pointer" : "default",
                      transition: "box-shadow .12s",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      if (valid) {
                        e.currentTarget.style.boxShadow =
                          "0 2px 10px rgba(0,0,0,0.09)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {valid && (
                      <>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: isToday ? 800 : 600,
                            color: isToday
                              ? "#6366f1"
                              : isSun
                              ? "#ef4444"
                              : "#374151",
                            marginBottom: 2,
                          }}
                        >
                          {day}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            minWidth: 0,
                          }}
                        >
                          {dayJobs.map((job) => {
                            const cfg = getJobColor(job);

                            return (
                              <div
                                key={job.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewJob({ ...job, _key: key });
                                  setModal("view");
                                }}
                                style={{
                                  background: cfg.bg,
                                  color: cfg.text,
                                  borderRadius: 4,
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: "2px 4px",
                                  cursor: "pointer",
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  maxWidth: "100%",
                                  minWidth: 0,
                                  display: "block",
                                }}
                                title={job.client}
                              >
                                {job.status === "XONG" ? "✓ " : ""}
                                {job.startTime ? `${job.startTime} · ` : ""}
                                {job.client || "Job"}
                              </div>
                            );
                          })}
                        </div>

                        {!dayJobs.length && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: 4,
                              right: 5,
                              fontSize: 13,
                              color: "#e2e8f0",
                              pointerEvents: "none",
                            }}
                          >
                            +
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                gap: 14,
                justifyContent: "center",
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              {Object.entries(STATUS_CFG).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    color: "#64748b",
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: v.bg,
                    }}
                  />
                  {k}
                </div>
              ))}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "#64748b",
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "#facc15",
                  }}
                />
                XONG chưa thanh toán
              </div>
            </div>
          </>
        )}

        {tab === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...S.card, padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
                Lọc doanh thu theo tệp khách
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["ALL", ...CUSTOMER_GROUPS].map((g) => (
                  <button
                    key={g}
                    onClick={() => setRevenueGroup(g)}
                    style={{
                      ...S.btn(
                        revenueGroup === g ? "#6366f1" : "#f1f5f9",
                        revenueGroup === g ? "#fff" : "#64748b"
                      ),
                      padding: "8px 14px",
                      fontSize: 13,
                    }}
                  >
                    {g === "ALL" ? "Tất cả" : g}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...S.card, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                Doanh thu 6 tháng gần nhất
              </div>

              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
                Đang xem:{" "}
                <b>{revenueGroup === "ALL" ? "Tất cả" : revenueGroup}</b>
              </div>

              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barSize={28}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(0)}M`
                        : v >= 1000
                        ? `${(v / 1000).toFixed(0)}K`
                        : v
                    }
                  />
                  <Tooltip
                    formatter={(v) => [
                      Number(v).toLocaleString("vi-VN") + "đ",
                      "Doanh thu",
                    ]}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="rev" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.month === month && entry.year === year
                            ? "#6366f1"
                            : "#c7d2fe"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...S.card, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>
                Doanh thu theo tệp khách — {MONTHS[month]}
              </div>

              {CUSTOMER_GROUPS.map((group) => {
                const groupJobs = monthJobs.filter(
                  (j) => j.status === "XONG" && getCustomerGroup(j) === group
                );

                const groupRevenue = groupJobs.reduce(
                  (s, j) => s + getPriceNumber(j),
                  0
                );

                return (
                  <div key={group} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        marginBottom: 3,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{group}</span>
                      <span style={{ color: "#0ea5e9", fontWeight: 800 }}>
                        {groupRevenue
                          ? groupRevenue.toLocaleString("vi-VN") + "đ"
                          : "—"}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {groupJobs.length} job đã xong
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Tìm tên khách, SĐT, giờ, địa điểm, ghi chú, tệp khách..."
              style={{ ...S.input, fontSize: 14, padding: "12px 14px" }}
            />

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ ...S.input }}
            >
              <option value="ALL">Tất cả trạng thái</option>
              {Object.keys(STATUS_CFG).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {searched.length} kết quả
            </div>

            {searched.map((job) => {
              const cfg = getJobColor(job);
              const [y2, m2, d2] = job._key.split("-");

              return (
                <div
                  key={job.id}
                  onClick={() => {
                    setViewJob({ ...job });
                    setModal("view");
                  }}
                  style={{
                    ...S.card,
                    padding: "12px 14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}
                    >
                      {job.client}
                    </div>

                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {getCustomerGroup(job)} ·{" "}
                      {`${d2}/${Number(m2) + 1}/${y2}`} ·{" "}
                      {job.startTime ? `${job.startTime} · ` : ""}
                      {job.timeSlot}
                    </div>

                    {job.location && (
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        📍 {job.location}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        background: cfg.bg,
                        color: cfg.text,
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "3px 8px",
                        marginBottom: 4,
                      }}
                    >
                      {job.status}
                      {job.paymentStatus === "UNPAID" ? " / CHƯA TT" : ""}
                    </div>

                    {getPriceNumber(job) > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#6366f1",
                        }}
                      >
                        {fmt(getPriceNumber(job))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {!searched.length && (
              <div
                style={{
                  textAlign: "center",
                  color: "#94a3b8",
                  padding: "40px 0",
                  fontSize: 14,
                }}
              >
                Không tìm thấy job nào
              </div>
            )}
          </div>
        )}
      </div>

      {(modal === "add" || modal === "edit") && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "20px 20px 0 0",
              padding: "22px 18px 30px",
              width: "100%",
              maxWidth: 500,
              maxHeight: "92vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {modal === "edit"
                  ? "✏️ Sửa job"
                  : `➕ Thêm job — ${selDate}/${month + 1}`}
              </div>

              <button
                onClick={() => setModal(null)}
                style={{
                  ...S.btn("#f1f5f9", "#64748b"),
                  padding: "6px 10px",
                  fontSize: 15,
                }}
              >
                ✕
              </button>
            </div>

            {modal === "add" && (
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Ngày thực hiện *</label>
                <input
                  type="date"
                  value={
                    selDate
                      ? `${year}-${String(month + 1).padStart(2, "0")}-${String(
                          selDate
                        ).padStart(2, "0")}`
                      : ""
                  }
                  onChange={(e) => {
                    const [nextYear, nextMonth, nextDay] = e.target.value
                      .split("-")
                      .map(Number);

                    if (nextYear && nextMonth && nextDay) {
                      setYear(nextYear);
                      setMonth(nextMonth - 1);
                      setSelDate(nextDay);
                    }
                  }}
                  style={S.input}
                />
              </div>
            )}

            <div
              style={{
                background: "#f5f3ff",
                border: "1.5px solid #ddd6fe",
                borderRadius: 14,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <label style={{ ...S.label, color: "#6d28d9" }}>
                ✨ Dán mô tả job, AI tự điền
              </label>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="VD: Chị Lan 0912345678, khách Vinschool, chụp ở Quận 7, 9h sáng, giá 1tr2..."
                rows={3}
                style={{
                  ...S.input,
                  resize: "vertical",
                  fontFamily: "inherit",
                  marginBottom: 8,
                }}
              />
              <button
                onClick={handleAIFill}
                disabled={aiLoading}
                style={{
                  ...S.btn("#7c3aed"),
                  width: "100%",
                  padding: "10px",
                  fontSize: 14,
                  opacity: aiLoading ? 0.6 : 1,
                  cursor: aiLoading ? "wait" : "pointer",
                }}
              >
                {aiLoading ? "⏳ Đang phân tích..." : "✨ AI điền tự động"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={S.label}>Tên khách hàng *</label>
                <input
                  value={form.client}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, client: e.target.value }))
                  }
                  placeholder="Nguyễn Văn A"
                  style={S.input}
                />
              </div>

              <div>
                <label style={S.label}>SĐT / Zalo</label>
                <input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, phone: e.target.value }))
                  }
                  placeholder="0912 345 678"
                  style={S.input}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={S.label}>Địa điểm</label>
                <input
                  value={form.location}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, location: e.target.value }))
                  }
                  placeholder="Hà Nội"
                  style={S.input}
                />
              </div>

              <div>
                <label style={S.label}>Giá tiền (đ)</label>
                <input
                  value={form.price}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      price: formatMoneyInput(e.target.value),
                    }))
                  }
                  placeholder="500.000"
                  style={S.input}
                  type="text"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={S.label}>Giờ bắt đầu công việc</label>
                <input
                  value={form.startTime}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, startTime: e.target.value }))
                  }
                  type="time"
                  style={S.input}
                />
              </div>

              <div>
                <label style={S.label}>🔔 Nhắc trước (ngày)</label>
                <input
                  value={form.reminderDays}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, reminderDays: e.target.value }))
                  }
                  type="number"
                  min="0"
                  max="30"
                  style={S.input}
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>🔗 Link folder ảnh (Drive/Dropbox)</label>
              <input
                value={form.driveLink}
                onChange={(e) =>
                  setForm((p) => ({ ...p, driveLink: e.target.value }))
                }
                placeholder="https://drive.google.com/..."
                style={S.input}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Phân loại khách</label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CUSTOMER_GROUPS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setForm((p) => ({ ...p, customerGroup: g }))}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: "1.5px solid",
                      borderColor:
                        form.customerGroup === g ? "#16a34a" : "#e2e8f0",
                      background: form.customerGroup === g ? "#16a34a" : "#fff",
                      color: form.customerGroup === g ? "#fff" : "#64748b",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Thời gian chụp</label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TIME_SLOTS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm((p) => ({ ...p, timeSlot: t }))}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: "1.5px solid",
                      borderColor: form.timeSlot === t ? "#0ea5e9" : "#e2e8f0",
                      background: form.timeSlot === t ? "#0ea5e9" : "#fff",
                      color: form.timeSlot === t ? "#fff" : "#64748b",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Ghi chú</label>
              <input
                value={form.note}
                onChange={(e) =>
                  setForm((p) => ({ ...p, note: e.target.value }))
                }
                placeholder="Lưu ý thêm..."
                style={S.input}
              />
            </div>

            <button
              onClick={handleSave}
              style={{
                ...S.btn("#6366f1"),
                width: "100%",
                padding: "13px",
                fontSize: 15,
              }}
            >
              {modal === "edit" ? "💾 Lưu thay đổi" : "✅ Thêm job"}
            </button>
          </div>
        </div>
      )}

      {modal === "view" && viewJob && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "28px 28px 0 0",
              padding: "18px 28px 28px",
              width: "100%",
              maxWidth: 980,
              minHeight: 420,
              boxShadow: "0 -10px 30px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 48,
                height: 6,
                borderRadius: 99,
                background: "#555",
                margin: "0 auto 18px",
              }}
            />

            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 900,
                  color: "#d4a017",
                  lineHeight: 1.1,
                }}
              >
                Chi Tiết Lịch
              </div>

              <div
                style={{
                  marginTop: 6,
                  fontSize: 15,
                  color: "#8b8b8b",
                  fontWeight: 700,
                }}
              >
                {(() => {
                  const [vy, vm, vd] = (viewJob._key || "")
                    .split("-")
                    .map(Number);

                  return `Ngày ${vd || viewJob._day || ""} tháng ${
                    Number.isFinite(vm) ? vm + 1 : month + 1
                  }`;
                })()}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "26px 90px",
                marginBottom: 34,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Buổi
                </div>
                <div
                  style={{ fontSize: 22, color: "#202124", fontWeight: 500 }}
                >
                  {viewJob.timeSlot || "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Giờ bắt đầu
                </div>
                <div
                  style={{ fontSize: 22, color: "#202124", fontWeight: 600 }}
                >
                  {viewJob.startTime || "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Trạng thái
                </div>
                <div
                  style={{
                    fontSize: 22,
                    color:
                      viewJob.status === "XONG" &&
                      viewJob.paymentStatus === "UNPAID"
                        ? "#ff7a12"
                        : viewJob.status === "XONG"
                        ? "#16a34a"
                        : viewJob.status === "HỦY"
                        ? "#ef4444"
                        : "#f59e0b",
                    fontWeight: 700,
                  }}
                >
                  {viewJob.status || "CHƯA"}
                  {viewJob.paymentStatus === "UNPAID"
                    ? " - Chưa thanh toán"
                    : ""}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Nội dung/Tên khách
                </div>
                <div
                  style={{ fontSize: 22, color: "#202124", fontWeight: 600 }}
                >
                  {viewJob.client || "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Địa điểm
                </div>
                <div
                  style={{ fontSize: 22, color: "#202124", fontWeight: 600 }}
                >
                  {viewJob.location || "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  SĐT Khách
                </div>

                {viewJob.phone ? (
                  <a
                    href={`tel:${viewJob.phone}`}
                    style={{
                      fontSize: 22,
                      color: "#0b77ff",
                      fontWeight: 600,
                      textDecoration: "underline",
                    }}
                  >
                    {viewJob.phone}
                  </a>
                ) : (
                  <div style={{ fontSize: 22, color: "#202124" }}>—</div>
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Tệp khách
                </div>
                <div
                  style={{ fontSize: 22, color: "#202124", fontWeight: 600 }}
                >
                  {getCustomerGroup(viewJob)}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#8b8b8b",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Giá tiền
                </div>
                <div
                  style={{ fontSize: 22, color: "#16a34a", fontWeight: 600 }}
                >
                  {fmtVND(getPriceNumber(viewJob))}
                </div>
              </div>

              {viewJob.note && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div
                    style={{
                      fontSize: 14,
                      color: "#8b8b8b",
                      fontWeight: 800,
                      marginBottom: 6,
                    }}
                  >
                    Ghi chú
                  </div>
                  <div
                    style={{ fontSize: 18, color: "#202124", fontWeight: 500 }}
                  >
                    {viewJob.note}
                  </div>
                </div>
              )}

              {viewJob.driveLink && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <a
                    href={viewJob.driveLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      color: "#16a34a",
                      fontWeight: 800,
                      fontSize: 16,
                      textDecoration: "none",
                    }}
                  >
                    🔗 Mở folder ảnh
                  </a>
                </div>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
              }}
            >
              <button
                onClick={() =>
                  updateViewJob(
                    { status: "XONG", paymentStatus: "PAID" },
                    "Đã hoàn thành và đã thanh toán",
                    { close: true, confetti: true }
                  )
                }
                style={{
                  border: "none",
                  borderRadius: 12,
                  background: "#16a34a",
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  padding: "22px 10px",
                  cursor: "pointer",
                }}
              >
                HOÀN THÀNH
              </button>

              <button
                onClick={() =>
                  updateViewJob(
                    { status: "XONG", paymentStatus: "UNPAID" },
                    "Đã đánh dấu xong nhưng chưa thanh toán",
                    { close: true }
                  )
                }
                style={{
                  border: "none",
                  borderRadius: 12,
                  background: "#ff7a12",
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  padding: "18px 10px",
                  cursor: "pointer",
                  lineHeight: 1.1,
                }}
              >
                XONG (Chưa thanh toán)
              </button>

              <button
                onClick={() => openEdit(viewJob)}
                style={{
                  border: "none",
                  borderRadius: 12,
                  background: "#0b7cff",
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  padding: "22px 10px",
                  cursor: "pointer",
                }}
              >
                CHỈNH SỬA
              </button>

              <button
                onClick={() => handleDelete(viewJob._key, viewJob.id)}
                style={{
                  border: "none",
                  borderRadius: 12,
                  background: "#dc3545",
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  padding: "22px 10px",
                  cursor: "pointer",
                }}
              >
                XÓA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
