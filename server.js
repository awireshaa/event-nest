const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "events.db");
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // set this to be able to remove any event

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    venue TEXT NOT NULL,
    area TEXT NOT NULL,
    cat TEXT NOT NULL,
    descr TEXT NOT NULL DEFAULT '',
    wa TEXT NOT NULL,
    img TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
`);

// Add the "logged to sheet" flag on databases created before this feature existed.
if (!db.prepare("PRAGMA table_info(events)").all().some((c) => c.name === "sheet_logged")) {
  db.exec("ALTER TABLE events ADD COLUMN sheet_logged INTEGER NOT NULL DEFAULT 0");
  // Events that existed before logging was added are not back-filled.
  db.exec("UPDATE events SET sheet_logged = 1");
}

// Organizer email + "confirmation sent" flag, added after launch.
{
  const cols = db.prepare("PRAGMA table_info(events)").all().map((c) => c.name);
  if (!cols.includes("email")) db.exec("ALTER TABLE events ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("email_sent")) {
    db.exec("ALTER TABLE events ADD COLUMN email_sent INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE events SET email_sent = 1"); // older events have no email to send to
  }
}

const sheets = require("./sheets");
const mailer = require("./mailer");
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "").trim();
const CONTACT_WHATSAPP = (process.env.CONTACT_WHATSAPP || "2348112050470").replace(/\D/g, "");

async function logToSheet(id) {
  const row = db.prepare("SELECT * FROM events WHERE id = ? AND sheet_logged = 0").get(id);
  if (!row) return;
  try {
    if (await sheets.logEvent(row)) db.prepare("UPDATE events SET sheet_logged = 1 WHERE id = ?").run(id);
  } catch (e) {
    const msg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    console.error("[sheets] Could not log event " + id + " (will retry):", msg);
  }
}
async function sendMail(id) {
  const row = db.prepare("SELECT * FROM events WHERE id = ? AND email_sent = 0 AND email != ''").get(id);
  if (!row) return;
  try {
    if (await mailer.sendConfirmation(row)) db.prepare("UPDATE events SET email_sent = 1 WHERE id = ?").run(id);
  } catch (e) {
    console.error("[mail] Could not email event " + id + " (will retry):", e.message);
  }
}
// Anything that failed (internet blip, wrong sharing, etc.) is retried every 5 minutes.
let retrying = false;
async function retryUnlogged() {
  if (retrying) return;
  retrying = true;
  try {
    if (sheets.enabled) {
      const ids = db.prepare("SELECT id FROM events WHERE sheet_logged = 0 ORDER BY created_at LIMIT 20").all();
      for (const r of ids) await logToSheet(r.id);
    }
    if (mailer.enabled) {
      const ids = db.prepare("SELECT id FROM events WHERE email_sent = 0 AND email != '' ORDER BY created_at LIMIT 20").all();
      for (const r of ids) await sendMail(r.id);
    }
  } finally { retrying = false; }
}
if (sheets.enabled || mailer.enabled) { setInterval(retryUnlogged, 5 * 60e3).unref(); setTimeout(retryUnlogged, 5e3).unref(); }

const AREAS = ["Ikeja","Victoria Island","Lekki","Ikoyi","Yaba","Surulere","Oshodi","Ikorodu","Ajah","Online"];
const CATS = ["Music","Business","Tech","Faith","Food & Drink","Arts & Culture","Education","Community","Party","Other"];
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const today = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // Lagos is UTC+1

// very small per-IP rate limit: 5 posts per hour
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (arr.length >= 5) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

app.get("/api/events", (req, res) => {
  const rows = db
    .prepare("SELECT id,title,date,time,venue,area,cat,descr AS desc,wa,img FROM events WHERE date >= ? ORDER BY date, time LIMIT 500")
    .all(today());
  res.json(rows);
});

app.post("/api/events", (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "Too many posts. Try again in an hour." });
  const b = req.body || {};
  const s = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const e = {
    title: s(b.title, 80), date: s(b.date, 10), time: s(b.time, 5), venue: s(b.venue, 80),
    area: s(b.area, 40), cat: s(b.cat, 40), desc: s(b.desc, 400), wa: s(b.wa, 20), email: s(b.email, 120).toLowerCase(), img: s(b.img, 1600000),
  };
  if (!e.title || !e.venue) return res.status(400).json({ error: "Name and venue are required." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < today()) return res.status(400).json({ error: "Enter a valid future date." });
  if (!/^\d{2}:\d{2}$/.test(e.time)) return res.status(400).json({ error: "Enter a valid start time." });
  if (!AREAS.includes(e.area) || !CATS.includes(e.cat)) return res.status(400).json({ error: "Pick an area and category." });
  if (e.wa.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Enter a valid WhatsApp number." });
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/.test(e.email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (e.img && !IMG_RE.test(e.img)) return res.status(400).json({ error: "Image must be a JPG, PNG or WebP." });

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO events (id,title,date,time,venue,area,cat,descr,wa,email,img,token_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, e.title, e.date, e.time, e.venue, e.area, e.cat, e.desc, e.wa, e.email, e.img, sha(token), Date.now());
  res.status(201).json({ id, token });
  sendMail(id);
  logToSheet(id); // after replying, so a slow or failing sheet never holds up the organizer
});

app.get("/api/config", (req, res) => res.json({ contactEmail: CONTACT_EMAIL, contactWhatsapp: CONTACT_WHATSAPP }));

// Organizer removes their own event with the token saved in their browser; admin can use ADMIN_KEY.
app.delete("/api/events/:id", (req, res) => {
  const key = req.get("x-token") || "";
  const row = db.prepare("SELECT token_hash FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const isAdmin = ADMIN_KEY && key === ADMIN_KEY;
  if (!isAdmin && sha(key) !== row.token_hash) return res.status(403).json({ error: "Not allowed." });
  db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

require("./admin")(app, db);
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Image is too large." });
  if (!(err && (err.status === 400 || err.type))) console.error("[server] unexpected error:", err && err.stack || err);
  res.status(400).json({ error: "Bad request." });
});

app.listen(PORT, () => console.log("Event Nest running on http://localhost:" + PORT));
