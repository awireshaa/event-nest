// Sends the organizer a "we received your event" email through Resend (https://resend.com).
// Turns itself off (with one log line) if RESEND_API_KEY or MAIL_FROM is missing.
const KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "";          // e.g.  Event Nest <hello@yourdomain.com>
const REPLY_TO = process.env.CONTACT_EMAIL || "";  // replies go to the site owner
const SITE = process.env.SITE_NAME || "Event Nest";

const enabled = !!(KEY && FROM);
console.log(enabled ? "[mail] Confirmation emails ON, sending as " + FROM : "[mail] Confirmation emails are OFF (set RESEND_API_KEY and MAIL_FROM to turn them on).");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function prettyDate(d, t) {
  const x = new Date(d + "T" + t + ":00Z");
  if (isNaN(x)) return d + " " + t;
  return x.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) +
    " at " + x.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

async function sendConfirmation(ev) {
  if (!enabled) return false;
  const when = prettyDate(ev.date, ev.time);
  const text =
    "Hello,\n\nYour event is now live on " + SITE + ".\n\n" +
    ev.title + "\n" + when + "\n" + ev.venue + ", " + ev.area + "\nCategory: " + ev.cat + "\n\n" +
    "People who are interested will message you on WhatsApp (" + ev.wa + ").\n" +
    "To take the event down, open the site on the same phone or browser you posted from and tap \"Remove my event\".\n\n" +
    "Thank you,\n" + SITE;
  const html =
    "<div style=\"font-family:Arial,sans-serif;color:#1F2A44;line-height:1.5;max-width:520px\">" +
    "<p>Hello,</p><p>Your event is now live on <b>" + esc(SITE) + "</b>.</p>" +
    "<div style=\"border:1px solid #DBDAE3;border-radius:8px;padding:12px 16px;margin:16px 0\">" +
    "<div style=\"font-size:18px;font-weight:bold\">" + esc(ev.title) + "</div>" +
    "<div>" + esc(when) + "</div><div>" + esc(ev.venue) + ", " + esc(ev.area) + "</div>" +
    "<div style=\"color:#585163\">Category: " + esc(ev.cat) + "</div></div>" +
    "<p>People who are interested will message you on WhatsApp (" + esc(ev.wa) + ").</p>" +
    "<p>To take the event down, open the site on the same phone or browser you posted from and tap <b>Remove my event</b>.</p>" +
    "<p>Thank you,<br>" + esc(SITE) + "</p></div>";

  const body = { from: FROM, to: [ev.email], subject: "Your event is live on " + SITE + ": " + ev.title.slice(0, 60), text, html };
  if (REPLY_TO) body.reply_to = REPLY_TO;
  const r = await fetch(process.env.RESEND_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let m = ""; try { m = (await r.json()).message; } catch (e) {}
    throw new Error("Resend " + r.status + (m ? ": " + m : ""));
  }
  return true;
}

module.exports = { enabled, sendConfirmation };
