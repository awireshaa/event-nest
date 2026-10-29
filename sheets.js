// Logs every submitted event to a Google Sheet using a service account.
// Disabled automatically (with one log line) if the settings below are missing.
const fs = require("fs");
const { GoogleAuth } = require("google-auth-library");

const SHEET_ID = process.env.SHEET_ID || "";
const SHEET_TAB = process.env.SHEET_TAB || "event";
const HEADER = ["Submitted (Lagos time)", "Event ID", "Title", "Date", "Time", "Venue", "Area", "Category", "Description", "WhatsApp", "Email"];

function readCredentials() {
  try {
    let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_FILE) raw = fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8");
    if (!raw) return null;
    raw = raw.trim();
    if (raw[0] !== "{") raw = Buffer.from(raw, "base64").toString("utf8"); // allow base64-encoded JSON
    const c = JSON.parse(raw);
    if (!c.client_email || !c.private_key) throw new Error("missing client_email or private_key");
    return c;
  } catch (e) {
    console.error("[sheets] Could not read service account credentials:", e.message);
    return null;
  }
}

// Two ways to reach the sheet. The Apps Script web app needs no Google key (see README);
// if APPS_SCRIPT_URL is set it is used, otherwise the service account method is used.
const APPS_URL = (process.env.APPS_SCRIPT_URL || "").trim();
const APPS_SECRET = process.env.APPS_SCRIPT_SECRET || "";
// Third way: a Make.com (or Zapier) webhook that adds the row. If WEBHOOK_URL is set it wins.
// Treat the address as a password: anyone who has it can add rows.
const HOOK_URL = (process.env.WEBHOOK_URL || "").trim();
const useHook = !!HOOK_URL;
const useScript = !useHook && !!APPS_URL;

const creds = !useHook && !useScript && SHEET_ID ? readCredentials() : null;
const enabled = useHook ? true : useScript ? !!APPS_SECRET : !!(SHEET_ID && creds);
let auth = null;
let headerChecked = false;

if (useHook) {
  console.log("[sheets] Logging submissions through the webhook (Make/Zapier).");
} else if (useScript && !APPS_SECRET) {
  console.error("[sheets] APPS_SCRIPT_URL is set but APPS_SCRIPT_SECRET is missing, so sheet logging is OFF.");
} else if (useScript) {
  console.log("[sheets] Logging submissions through the Apps Script web app.");
} else if (enabled) {
  auth = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  console.log("[sheets] Logging submissions to Google Sheet tab '" + SHEET_TAB + "' as " + creds.client_email);
} else {
  console.log("[sheets] Sheet logging is OFF (set SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON or _FILE to turn it on).");
}

const base = () => "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(SHEET_ID) + "/values/";
const range = (a) => encodeURIComponent("'" + SHEET_TAB.replace(/'/g, "''") + "'!" + a);

async function ensureHeader() {
  if (headerChecked) return;
  const r = await auth.request({ url: base() + range("A1:K1"), method: "GET" });
  if (!r.data.values || !r.data.values.length || r.data.values[0].length < HEADER.length) {
    await auth.request({ url: base() + range("A1:K1") + "?valueInputOption=RAW", method: "PUT", data: { values: [HEADER] } });
  }
  headerChecked = true;
}

const stamp = (ms) => new Date(ms + 3600e3).toISOString().replace("T", " ").slice(0, 19);

// Resolves true when the row is in the sheet, false/throws otherwise.
async function logViaHook(ev) {
  const r = await fetch(HOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      submitted: stamp(ev.created_at), id: ev.id, title: ev.title, date: ev.date, time: ev.time,
      venue: ev.venue, area: ev.area, cat: ev.cat, desc: ev.descr || "", wa: ev.wa, email: ev.email || "",
    }),
  });
  if (!r.ok) throw new Error("Webhook replied " + r.status + " (is the Make scenario switched ON?)");
  return true;
}

async function logViaScript(ev) {
  const r = await fetch(APPS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "follow", // Apps Script answers through a redirect
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      secret: APPS_SECRET,
      submitted: stamp(ev.created_at), id: ev.id, title: ev.title, date: ev.date, time: ev.time,
      venue: ev.venue, area: ev.area, cat: ev.cat, desc: ev.descr || "", wa: ev.wa, email: ev.email || "",
    }),
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j || !j.ok) throw new Error("Apps Script replied " + r.status + (j && j.error ? ": " + j.error : " with something unexpected (is the deployment set to Anyone, and is the URL the /exec one?)"));
  return true;
}

async function logEvent(ev) {
  if (!enabled) return false;
  if (useHook) return logViaHook(ev);
  if (useScript) return logViaScript(ev);
  await ensureHeader();
  // RAW means Sheets stores text exactly as sent, so nothing a visitor types can run as a formula.
  const row = [stamp(ev.created_at), ev.id, ev.title, ev.date, ev.time, ev.venue, ev.area, ev.cat, ev.descr || "", ev.wa, ev.email || ""];
  await auth.request({
    url: base() + range("A:K") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    method: "POST",
    data: { values: [row] },
  });
  return true;
}

module.exports = { enabled, logEvent };
