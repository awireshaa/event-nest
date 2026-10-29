// Event Nest: receives each new event from the website and adds a row to this sheet.
// Paste this whole file into Extensions > Apps Script in your Google Sheet (see README).

// 1. Put a long random text here, and the SAME text in the website's APPS_SCRIPT_SECRET setting.
//    It stops strangers who find the web address from adding rows.
var SECRET = "CHANGE_ME";

// 2. Your sheet's ID: the long code in the sheet's address, between /d/ and /edit.
//    Needed when you made this script at script.google.com. If you opened the editor from
//    inside the sheet (Extensions > Apps Script), you can leave it as is or set it to "".
var SHEET_ID = "1soxQ6swaG7rAPFNOIPFyVf_ifVPEL4lO-pZu_h37tG4";

// 3. The name of the tab at the bottom of your sheet.
var TAB_NAME = "event";

var HEADER = ["Submitted (Lagos time)", "Event ID", "Title", "Date", "Time", "Venue", "Area", "Category", "Description", "WhatsApp", "Email"];

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (SECRET === "CHANGE_ME" || d.secret !== SECRET) return reply({ ok: false, error: "Wrong or missing secret." });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000); // one submission at a time, so rows never overwrite each other
    try {
      var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) return reply({ ok: false, error: "Could not open the sheet. Check SHEET_ID." });
      var sheet = ss.getSheetByName(TAB_NAME);
      if (!sheet) return reply({ ok: false, error: "No tab named '" + TAB_NAME + "'." });

      if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);

      // The website retries if it did not hear back, so skip an Event ID that is already there.
      var id = String(d.id || "");
      if (id && sheet.getLastRow() > 1) {
        var hit = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
        if (hit) return reply({ ok: true, duplicate: true });
      }

      var row = [d.submitted, d.id, d.title, d.date, d.time, d.venue, d.area, d.cat, d.desc, d.wa, d.email]
        .map(function (v) { return v == null ? "" : String(v); });

      // Plain text format first, so nothing a visitor types can turn into a formula or a date.
      var target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADER.length);
      target.setNumberFormat("@");
      target.setValues([row]);
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

// Opening the web address in a browser shows this, which is a quick way to check it is live.
function doGet() {
  return reply({ ok: true, service: "Event Nest sheet logger" });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
