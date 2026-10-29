# Event Nest

Simple shared events board. Organizers post events, visitors browse and tap
"I'm interested" to message the organizer on WhatsApp. No payments, no tickets.
Every submitted event is also logged to a Google Sheet, so the owner can review
submissions without an admin panel. The organizer gets a confirmation email.

## Run locally
    npm install
    npm start          # http://localhost:3000

## Settings (environment variables)
| Name | Required | What it does |
|------|----------|--------------|
| PORT | no | default 3000 |
| DB_FILE | no | path to the SQLite file, default ./events.db |
| ADMIN_PASSWORD | for the admin page | password for `/admin`, at least 10 characters. `ADMIN_KEY` works as the same setting. |
| ADMIN_KEY | no | same as ADMIN_PASSWORD, and also lets you remove an event with the curl line below |
| CONTACT_EMAIL | no | shows a small email icon in the footer corner that opens a mailto link. Leave it unset and the icon stays hidden. |
| CONTACT_WHATSAPP | no | number for the small WhatsApp icon in the footer, digits only with country code. Default 2348112050470. |
| RESEND_API_KEY | for confirmation emails | API key from resend.com |
| MAIL_FROM | for confirmation emails | sender, e.g. `Event Nest <hello@yourdomain.com>`. Must be an address on a domain you have verified in Resend. |
| WEBHOOK_URL | for the Make/Zapier option | the webhook address Make gives you. Treat it like a password. Takes priority over the options below. |
| APPS_SCRIPT_URL | for the no-key sheet option | the web app address you get in step 4 below (ends in `/exec`) |
| APPS_SCRIPT_SECRET | with APPS_SCRIPT_URL | the same secret text you put in the script |
| SHEET_ID | for the service account option | the long ID in your Google Sheet's URL |
| GOOGLE_SERVICE_ACCOUNT_JSON | for sheet logging | the service account key (the whole JSON, or the JSON base64-encoded) |
| GOOGLE_SERVICE_ACCOUNT_FILE | alternative | path to the key file instead of pasting the JSON |
| SHEET_TAB | no | name of the tab to write to, default `event` |

Remove any event as admin:

    curl -X DELETE https://YOURSITE/api/events/EVENT_ID -H "x-token: YOUR_ADMIN_KEY"

## Admin page: see, download and delete events
Go to `yoursite/admin` and log in with `ADMIN_PASSWORD`. It is switched off until you set that.

- Pick a **year**, then a **month** or **Whole year**. Events are grouped by the date they take place,
  so an event posted in October for 25 December appears under December. Past events stay listed.
- Each event shows its date, title, venue, category, WhatsApp, email and when it was posted.
- **Download for Google Sheets** saves what you are looking at as a CSV file. In Google Sheets choose
  File, Import, Upload and pick the file. Phone numbers keep their leading zero.
- **Delete** removes one event. Tick several (or the top box for all) and use **Delete selected**.
  Deleting cannot be undone, and it does not remove rows already sent to a Google Sheet.
- Log in sessions last 12 hours. Eight wrong passwords from one place lock login for 15 minutes.
- Choose a long password that is not used anywhere else. Anyone who has it can see every organizer's
  email and phone number.

## Optional: also log every event to a Google Sheet automatically
The admin page above is enough on its own. Pick ONE of the three ways below only if you want rows to appear in a sheet as events are posted.

### Make.com webhook
The website sends each new event to a Make scenario, and Make adds the row to your sheet.
No script and no Google key. Make's free plan is enough to start.

1. In Make, create a scenario. Add **Webhooks > Custom webhook** as the first module, click **Add**, name it
   `Event Nest` and save. Copy the webhook address (it starts with `https://hook.`).
2. Tell Make what the data looks like: in the webhook box click **Add** next to "Data structure", then
   **Generator**, and paste this sample, then save:

       {"submitted":"2026-10-27 23:34:08","id":"test-1","title":"Test Mixer","date":"2026-10-30","time":"18:00","venue":"Landmark Centre","area":"Lekki","cat":"Business","desc":"Test event","wa":"08012345678","email":"test@example.com"}

3. Add a second module: **Google Sheets > Add a Row**. Connect your Google account, pick the spreadsheet,
   pick the tab `event`, and set **Value input option** to **Raw** (this keeps phone numbers such as 0801...
   intact and stops anything typed on the site from becoming a formula). Map the columns:

   | Column | Header | Put in it |
   |--------|--------|-----------|
   | A | Submitted | submitted |
   | B | Event ID | id |
   | C | Title | title |
   | D | Date | date |
   | E | Time | time |
   | F | Venue | venue |
   | G | Area | area |
   | H | Category | cat |
   | I | Description | desc |
   | J | WhatsApp | wa |
   | K | Email | email |

4. Switch the scenario **ON** (the toggle at the bottom left) with scheduling set to **Immediately**.
   A scenario that is switched off does not receive anything.
5. On your host set `WEBHOOK_URL` to the webhook address and restart. The log prints
   `[sheets] Logging submissions through the webhook (Make/Zapier).`

If Make is off or unreachable the event is still posted, and the site retries every 5 minutes.
Anyone who has the webhook address can add rows, so keep it out of anything public. If it leaks,
create a new webhook in Make and change `WEBHOOK_URL`.

### Apps Script (about 5 minutes, no Google key)
A small script lives inside your own Google Sheet and adds a row whenever the website sends it one.
Use this or the service account option below, not both. If `APPS_SCRIPT_URL` is set, this one is used.

1. Open your Google Sheet. Make sure the tab at the bottom is named `event` (or change `TAB_NAME` in the script).
   Row 1 can hold your headings. If the tab is empty, the script writes them.
2. Click **Extensions > Apps Script**. (If that menu will not open, go to script.google.com and click
   **New project** instead. The script already contains your sheet's ID, so it works either way.)
   Delete anything in the editor and paste in the whole of `apps-script/Code.gs` from this project.
   Make sure you are signed in as the Google account that owns the sheet, and only that account.
3. Near the top, replace `CHANGE_ME` with a long random text of your own, for example 30 letters and numbers.
   Keep a copy, because you need the same text on the website. Click the **Save** icon.
4. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose **Web app**. Then set:
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy**. Google asks you to authorize: choose your account, click **Advanced**, then
   **Go to (your project name) (unsafe)**, then **Allow**. This is your own script, so that warning is normal.
   Copy the **Web app URL**. It ends in `/exec`.
5. On your host, set `APPS_SCRIPT_URL` to that URL and `APPS_SCRIPT_SECRET` to your secret text. Restart the app.
   The log prints `[sheets] Logging submissions through the Apps Script web app.`
6. Check it: open the Web app URL in a browser. You should see `{"ok":true,"service":"Event Nest sheet logger"}`.
   Then post a test event on the site and look for the new row.

**If you change the script later,** use **Deploy > Manage deployments > the pencil > Version: New version > Deploy**.
The URL stays the same. Saving alone does not update the live version.

**Good to know**
- Anyone can open the web address, but nothing is added without your secret. Do not share the secret or post it publicly.
- Everything is stored as plain text, so nothing a visitor types can run as a formula.
- If the same event is sent twice (the site retries when it gets no answer), only one row is added.
- Same limits as below: rows are never removed, and events posted before logging was on are not back-filled.

### Service account (about 10 minutes, one time)
Use this only if you prefer it to Apps Script. It needs a Google account and credentials only you can create.

1. **Create the Sheet.** Go to sheets.google.com, make a new blank spreadsheet, and
   name the first tab (bottom left) `event`. (Or use any other name and set `SHEET_TAB` to it.)
   Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/THIS_PART/edit`.
2. **Create a Google Cloud project.** Go to console.cloud.google.com, click the project
   picker at the top, then New Project. Any name works.
3. **Turn on the Sheets API.** In that project: APIs & Services > Library > search
   "Google Sheets API" > Enable.
4. **Create a service account.** APIs & Services > Credentials > Create credentials >
   Service account. Give it a name, then Done. No roles are needed.
5. **Download its key.** Open the service account > Keys tab > Add key > Create new key >
   JSON. A `.json` file downloads. Keep it private; anyone with it can edit your Sheet.
6. **Share the Sheet with the service account.** Open the JSON file, copy the
   `client_email` value (looks like `name@project.iam.gserviceaccount.com`). In your Sheet
   click Share, paste that email, give it **Editor** access, and untick "Notify people".
7. **Set the environment variables** on your host: `SHEET_ID`, and either
   `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the file's whole contents) or
   `GOOGLE_SERVICE_ACCOUNT_FILE` (path to the uploaded file). Restart the app.

On start-up the server prints `[sheets] Logging submissions to ...` when it is on, or
`Sheet logging is OFF` if a setting is missing.

**What gets logged:** one row per submission, with columns Submitted (Lagos time), Event ID,
Title, Date, Time, Venue, Area, Category, Description, WhatsApp, Email. The header row is created
automatically on the first submission.

**Good to know**
- Rows are only added, never removed. If an organizer deletes their event from the site,
  the Sheet keeps the record.
- If Google is unreachable or the Sheet isn't shared correctly, posting still works. The
  server keeps trying every 5 minutes and the error appears in the server log.
- Values are written as plain text, so nothing a visitor types can run as a spreadsheet formula.
- Events posted before you turned logging on are not back-filled.
- Photos are not logged, only the text details.

## Confirmation emails (about 10 minutes, one time)
Each organizer enters their email when posting. Right after, the server emails them a
short "your event is live" message (replies go to CONTACT_EMAIL). The email address is
never shown on the site, only stored and written to your Sheet.

1. Create a free account at resend.com.
2. Domains > Add domain, then add the DNS records Resend shows you at your domain registrar,
   and wait for it to say Verified. (Without a verified domain Resend only delivers to your own
   address, so real organizers would not receive anything.)
3. API Keys > Create API key. Copy it.
4. On your host set `RESEND_API_KEY` and `MAIL_FROM` (an address on that domain), then restart.
   The log prints `[mail] Confirmation emails ON` when it works.

If sending fails the event is still posted and the server retries every 5 minutes.
Events posted before this feature are not emailed.

## Hosting
Needs a host that runs Node and keeps a disk (Railway, Render with a disk, a VPS).
Point DB_FILE at the persistent disk, otherwise events vanish on each redeploy.
Netlify/Vercel static hosting will NOT work (the site needs the server).

## Notes
- Organizers can remove their own events from the browser they posted from.
- Posting is limited to 5 events per hour per visitor.
- The site name "Event Nest" appears in public/index.html (title, logo).
- The logo is public/logo.png (shown in the header).
- Colours are the variables at the top of public/index.html: navy and gold, taken from the logo.
