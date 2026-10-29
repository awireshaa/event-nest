// Private admin area at /admin: log in, browse events by the month or year they take place,
// download them as a CSV for Google Sheets, or delete any event.
// Switched off unless ADMIN_PASSWORD (or ADMIN_KEY) is set, at least 10 characters.
const crypto = require("crypto");
const path = require("path");

module.exports = function mountAdmin(app, db) {
  const PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || "";
  const enabled = PASSWORD.length >= 10;
  if (!enabled) {
    console.log(PASSWORD ? "[admin] ADMIN_PASSWORD is shorter than 10 characters, so the admin page is OFF." : "[admin] Admin page is OFF (set ADMIN_PASSWORD, at least 10 characters, to turn it on).");
    return;
  }
  console.log("[admin] Admin page is ON at /admin");

  const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
  const PW_HASH = sha(PASSWORD);
  const SESSION_MS = 12 * 3600e3;
  const sessions = new Map(); // token -> expiry (lost on restart, you just log in again)
  const fails = new Map();    // ip -> timestamps of failed logins

  const cookieOf = (req, name) => {
    const m = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
    return m ? m.slice(name.length + 1) : "";
  };
  const authed = (req) => {
    const t = cookieOf(req, "nest_admin");
    const exp = t && sessions.get(t);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(t); return false; }
    return true;
  };
  const noStore = (res) => res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

  function requireAuth(req, res, next) {
    noStore(res);
    if (!authed(req)) return res.status(401).json({ error: "Please log in." });
    // Changes need a custom header, which other websites cannot add to a request they send.
    if (req.method !== "GET" && req.get("x-admin") !== "1") return res.status(403).json({ error: "Not allowed." });
    next();
  }

  const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
  const page = (file, type) => (req, res) => {
    noStore(res);
    res.set({ "Content-Security-Policy": CSP, "Content-Type": type });
    res.sendFile(path.join(__dirname, "admin", file), (err) => {
      if (err && !res.headersSent) { console.error("[admin] could not send " + file + ":", err.message); res.status(500).send("Admin page missing."); }
    });
  };
  app.get(["/admin", "/admin/"], page("admin.html", "text/html; charset=utf-8"));
  app.get("/admin/app.js", page("admin.js", "text/javascript; charset=utf-8"));

  app.post("/admin/api/login", (req, res) => {
    noStore(res);
    const now = Date.now();
    const recent = (fails.get(req.ip) || []).filter((t) => now - t < 15 * 60e3);
    if (recent.length >= 8) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
    const given = sha((req.body && req.body.password) || "");
    if (!crypto.timingSafeEqual(given, PW_HASH)) {
      recent.push(now); fails.set(req.ip, recent);
      return setTimeout(() => res.status(401).json({ error: "Wrong password." }), 600);
    }
    fails.delete(req.ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, now + SESSION_MS);
    res.set("Set-Cookie", "nest_admin=" + token + "; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=" + SESSION_MS / 1000 + (req.secure ? "; Secure" : ""));
    res.json({ ok: true });
  });

  app.post("/admin/api/logout", (req, res) => {
    noStore(res);
    sessions.delete(cookieOf(req, "nest_admin"));
    res.set("Set-Cookie", "nest_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0");
    res.json({ ok: true });
  });

  // "2026-12-" for a month, "2026-" for a whole year, "" for everything. Digits only, so it is safe in SQL.
  const prefix = (q) => {
    const y = /^\d{4}$/.test(q.year || "") ? q.year : "";
    const m = /^(0[1-9]|1[0-2])$/.test(q.month || "") ? q.month : "";
    return y && m ? y + "-" + m + "-" : y ? y + "-" : "";
  };
  const COLS = "id,title,date,time,venue,area,cat,descr,wa,email,created_at";

  app.get("/admin/api/summary", requireAuth, (req, res) => {
    res.json(db.prepare("SELECT substr(date,1,7) AS ym, COUNT(*) AS n FROM events GROUP BY ym ORDER BY ym").all());
  });

  app.get("/admin/api/events", requireAuth, (req, res) => {
    const rows = db.prepare("SELECT " + COLS + " FROM events WHERE date LIKE ? ORDER BY date, time LIMIT 5000").all(prefix(req.query) + "%");
    res.json(rows);
  });

  const stamp = (ms) => new Date(ms + 3600e3).toISOString().replace("T", " ").slice(0, 19); // Lagos time
  // A cell that starts with = @ + - could run as a formula in a spreadsheet, so mark it as text.
  const safe = (v) => {
    let s = String(v == null ? "" : v);
    if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?\d[\d\s-]*$/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // 0801... would lose its leading zero in a spreadsheet. ="0801..." keeps it as text. Digits only, so safe.
  const phone = (v) => { const d = String(v || "").replace(/[^\d+]/g, ""); return /^\+?\d{6,20}$/.test(d) ? '"=""' + d + '"""' : safe(v); };
  app.get("/admin/api/export.csv", requireAuth, (req, res) => {
    const p = prefix(req.query);
    const rows = db.prepare("SELECT " + COLS + " FROM events WHERE date LIKE ? ORDER BY date, time LIMIT 20000").all(p + "%");
    const head = ["Posted (Lagos time)", "Event ID", "Title", "Date", "Time", "Venue", "Area", "Category", "Description", "WhatsApp", "Email"];
    const lines = [head.map(safe).join(",")].concat(rows.map((r) =>
      [stamp(r.created_at), r.id, r.title, r.date, r.time, r.venue, r.area, r.cat, r.descr, null, r.email].map((v, i) => i === 9 ? phone(r.wa) : safe(v)).join(",")));
    const label = p ? p.replace(/-$/, "") : "all";
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="event-nest-' + label + '.csv"' });
    res.send("﻿" + lines.join("\r\n") + "\r\n"); // the BOM makes Excel and Sheets read accents correctly
  });

  app.post("/admin/api/delete", requireAuth, (req, res) => {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter((x) => typeof x === "string").slice(0, 500) : [];
    if (!ids.length) return res.status(400).json({ error: "Nothing selected." });
    const del = db.prepare("DELETE FROM events WHERE id = ?");
    let n = 0;
    db.transaction(() => { for (const id of ids) n += del.run(id).changes; })();
    res.json({ ok: true, deleted: n });
  });

  app.delete("/admin/api/events/:id", requireAuth, (req, res) => {
    const r = db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: "Not found." });
    res.json({ ok: true });
  });
};
