(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var summary = [];
  var selected = {};
  function selIds() { return Object.keys(selected).filter(function (k) { return selected[k]; }); }
  function updateSel() {
    var n = selIds().length, b = $("delSel");
    b.hidden = n === 0; b.textContent = "Delete selected (" + n + ")";
    var all = document.getElementById("selAll"); if (all) { var boxes = document.querySelectorAll("#list tbody input[type=checkbox]"); all.checked = boxes.length > 0 && n === boxes.length; }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "x-admin": "1" }, opts.headers || {});
    return fetch("/admin/api" + path, opts).then(function (r) {
      if (r.status === 401) { showLogin(); throw new Error("login"); }
      return r;
    });
  }
  function showLogin() { $("loginBox").hidden = false; $("app").hidden = true; $("logout").hidden = true; $("who").hidden = true; $("pw").value = ""; }
  function showApp() { $("loginBox").hidden = true; $("app").hidden = false; $("logout").hidden = false; $("who").hidden = false; }

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("loginBtn"), err = $("loginErr");
    err.textContent = ""; b.disabled = true;
    fetch("/admin/api/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-admin": "1" }, body: JSON.stringify({ password: $("pw").value }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err.textContent = res.j.error || "Could not log in."; return; }
        showApp(); return start();
      })
      .catch(function () { err.textContent = "Could not reach the server."; })
      .then(function () { b.disabled = false; });
  });

  $("logout").addEventListener("click", function () {
    fetch("/admin/api/logout", { method: "POST", credentials: "same-origin", headers: { "x-admin": "1" } }).then(showLogin, showLogin);
  });

  function years() {
    var s = {};
    summary.forEach(function (r) { s[r.ym.slice(0, 4)] = (s[r.ym.slice(0, 4)] || 0) + r.n; });
    return Object.keys(s).sort().map(function (y) { return { y: y, n: s[y] }; });
  }
  function fillYears(sel) {
    var ys = years(), el = $("year");
    el.innerHTML = "";
    var all = document.createElement("option"); all.value = ""; all.textContent = "All years"; el.appendChild(all);
    ys.forEach(function (o) { var x = document.createElement("option"); x.value = o.y; x.textContent = o.y + " (" + o.n + ")"; el.appendChild(x); });
    el.value = sel;
  }
  function fillMonths(sel) {
    var y = $("year").value, el = $("month");
    el.innerHTML = "";
    var whole = document.createElement("option"); whole.value = ""; whole.textContent = y ? "Whole year" : "All months"; el.appendChild(whole);
    el.disabled = !y;
    if (y) {
      var counts = {};
      summary.forEach(function (r) { if (r.ym.slice(0, 4) === y) counts[r.ym.slice(5, 7)] = r.n; });
      MONTHS.forEach(function (name, i) {
        var mm = ("0" + (i + 1)).slice(-2);
        var o = document.createElement("option"); o.value = mm;
        o.textContent = name + (counts[mm] ? " (" + counts[mm] + ")" : "");
        el.appendChild(o);
      });
    }
    el.value = y ? sel : "";
  }

  function query() {
    var y = $("year").value, m = $("month").value;
    var q = [];
    if (y) q.push("year=" + y);
    if (y && m) q.push("month=" + m);
    return q.length ? "?" + q.join("&") : "";
  }

  function fmtDate(d, t) {
    var x = new Date(d + "T12:00:00Z");
    if (isNaN(x)) return d + " " + t;
    return x.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) + ", " + t;
  }
  function fmtPosted(ms) {
    return new Date(ms).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function waHref(n) {
    var x = String(n || "").replace(/\D/g, "");
    if (x.length < 10) return "";
    if (x.charAt(0) === "0") x = "234" + x.slice(1);
    return "https://wa.me/" + x;
  }
  function cell(tr, label, content, cls) {
    var td = document.createElement("td");
    if (label) td.setAttribute("data-label", label);
    if (cls) td.className = cls;
    if (typeof content === "string") td.textContent = content; else if (content) td.appendChild(content);
    tr.appendChild(td);
    return td;
  }

  function render(rows) {
    var list = $("list"), y = $("year").value, m = $("month").value;
    var what = y ? (m ? MONTHS[+m - 1] + " " + y : y) : "all dates";
    $("count").textContent = rows.length + (rows.length === 1 ? " event" : " events") + " for " + what;
    $("dl").href = "/admin/api/export.csv" + query();
    $("dl").hidden = rows.length === 0;
    list.innerHTML = ""; selected = {}; updateSel();
    if (!rows.length) { var e = document.createElement("div"); e.className = "empty"; e.textContent = "No events for this choice."; list.appendChild(e); return; }

    var table = document.createElement("table");
    var thead = document.createElement("thead"), hr = document.createElement("tr");
    var th0 = document.createElement("th"), all = document.createElement("input");
    all.type = "checkbox"; all.id = "selAll"; all.setAttribute("aria-label", "Select all events shown");
    all.addEventListener("change", function () {
      selected = {};
      document.querySelectorAll("#list tbody input[type=checkbox]").forEach(function (c) { c.checked = all.checked; if (all.checked) selected[c.getAttribute("data-id")] = true; });
      updateSel();
    });
    th0.appendChild(all); hr.appendChild(th0);
    ["Event date", "Title", "Venue", "Category", "WhatsApp", "Email", "Posted", ""].forEach(function (h) { var th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = document.createElement("tbody");
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.setAttribute("data-id", r.id); cb.setAttribute("aria-label", "Select " + r.title);
      cb.addEventListener("change", function () { selected[r.id] = cb.checked; updateSel(); });
      cell(tr, "", cb);
      cell(tr, "", fmtDate(r.date, r.time), "when");
      var t = cell(tr, "", r.title); t.style.fontWeight = "600";
      cell(tr, "Venue", r.venue + ", " + r.area);
      cell(tr, "Category", r.cat);
      var wa = document.createElement("span"), h = waHref(r.wa);
      if (h) { var a = document.createElement("a"); a.href = h; a.target = "_blank"; a.rel = "noopener"; a.textContent = r.wa; wa.appendChild(a); } else wa.textContent = r.wa;
      cell(tr, "WhatsApp", wa, "nw");
      var em = document.createElement("span");
      if (/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/.test(r.email || "")) { var ma = document.createElement("a"); ma.href = "mailto:" + r.email; ma.textContent = r.email; em.appendChild(ma); } else em.textContent = r.email || "none";
      cell(tr, "Email", em);
      cell(tr, "Posted", fmtPosted(r.created_at));
      var del = document.createElement("button");
      del.type = "button"; del.className = "btn btn-danger"; del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!confirm('Delete "' + r.title + '"? This cannot be undone.')) return;
        del.disabled = true;
        api("/events/" + encodeURIComponent(r.id), { method: "DELETE" })
          .then(function (res) { if (!res.ok) throw 0; return refresh(); })
          .catch(function (e) { if (e && e.message === "login") return; del.disabled = false; alert("Could not delete. Try again."); });
      });
      cell(tr, "", del, "nw");
      tb.appendChild(tr);
    });
    table.appendChild(tb); list.appendChild(table);
  }

  function loadList() {
    return api("/events" + query()).then(function (r) { return r.json(); }).then(render);
  }
  function refresh() {
    var y = $("year").value, m = $("month").value;
    return api("/summary").then(function (r) { return r.json(); }).then(function (s) {
      summary = s;
      var has = years().some(function (o) { return o.y === y; });
      fillYears(has ? y : ""); fillMonths(has ? m : "");
      return loadList();
    });
  }

  function start() {
    return api("/summary").then(function (r) { return r.json(); }).then(function (s) {
      summary = s;
      var now = new Date(Date.now() + 3600e3).toISOString(), cy = now.slice(0, 4), cm = now.slice(5, 7);
      var ys = years().map(function (o) { return o.y; });
      var y = ys.indexOf(cy) >= 0 ? cy : (ys.length ? ys[ys.length - 1] : "");
      var hasMonth = summary.some(function (r) { return r.ym === y + "-" + cm; });
      fillYears(y); fillMonths(y && hasMonth ? cm : "");
      return loadList();
    });
  }

  $("delSel").addEventListener("click", function () {
    var ids = selIds();
    if (!ids.length || !confirm("Delete " + ids.length + (ids.length === 1 ? " event" : " events") + "? This cannot be undone.")) return;
    var b = $("delSel"); b.disabled = true;
    api("/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids }) })
      .then(function (res) { if (!res.ok) throw 0; return refresh(); })
      .catch(function (e) { if (e && e.message === "login") return; alert("Could not delete. Try again."); })
      .then(function () { b.disabled = false; });
  });

  $("year").addEventListener("change", function () { fillMonths(""); loadList(); });
  $("month").addEventListener("change", loadList);

  // Already logged in (cookie still valid)? Go straight in.
  api("/summary").then(function () { showApp(); return start(); }).catch(function () {});
})();
