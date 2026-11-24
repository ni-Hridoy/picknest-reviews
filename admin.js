/* PickNest Reviews — Admin panel app (vanilla JS, no libraries).
   Static-site panel: reads posts.json / admins.json, publishes through the
   GitHub Contents API (repo ni-Hridoy/picknest-reviews, branch main) using a
   fine-grained token the admin saves in Settings (localStorage pn_gh_token).
   Without a token the panel runs in draft mode: browsing works, publishing
   is disabled. Login state lives in sessionStorage pn_admin (set by /login). */
"use strict";

var SITE = "https://picknest-reviews.vercel.app";
var GH = { owner: "ni-Hridoy", repo: "picknest-reviews", branch: "main" };
var AMAZON_TAG = "picknest053-20";
var PERMS = ["create_posts", "edit_posts", "delete_posts", "manage_admins", "site_settings"];
var PERM_LABELS = { create_posts: "Create posts", edit_posts: "Edit posts", delete_posts: "Delete posts", manage_admins: "Manage admins", site_settings: "Site settings (GitHub token)" };
var CATS = { "Kitchen Appliances": "kitchen-appliances", "Sleep & Mattresses": "sleep-mattresses", "Home Comfort": "home-comfort", "Home Fitness": "home-fitness" };
var CAT_SHORT = { "Kitchen Appliances": "Kitchen", "Sleep & Mattresses": "Sleep", "Home Comfort": "Home Comfort", "Home Fitness": "Home Fitness" };
var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* ---------- session ---------- */
var session = null;
try { session = JSON.parse(sessionStorage.getItem("pn_admin") || "null"); } catch (e) {}
if (!session) { location.replace("/login"); throw new Error("no session"); }
function has(perm) { return session.role === "super" || !!(session.permissions && session.permissions[perm]); }
function token() { return localStorage.getItem("pn_gh_token") || ""; }
function canPublish() { return !!token(); }

/* ---------- state ---------- */
var state = { posts: [], admins: [], editingSlug: null };

/* ---------- utils ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function todayISO() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
function humanDate(iso) { var p = String(iso || "").split("-"); if (p.length !== 3) return iso || ""; return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
function humanDateFull(iso) { var p = String(iso || "").split("-"); if (p.length !== 3) return iso || ""; return MONTHS_FULL[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
function rfc822(d) { return d.toUTCString().replace("GMT", "+0000"); }
function cardTitle(post) { return String(post.title || "").split(" — ")[0]; }
function slugify(t) { return String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function amazonUrl(terms) { return "https://www.amazon.com/s?k=" + encodeURIComponent(String(terms || "").trim()).replace(/%20/g, "+") + "&tag=" + AMAZON_TAG; }
function sha256Hex(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  });
}
function b64encode(str) { var bytes = new TextEncoder().encode(str); var bin = ""; bytes.forEach(function (b) { bin += String.fromCharCode(b); }); return btoa(bin); }
function b64decode(b64) { var bin = atob(String(b64).replace(/\s/g, "")); var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }); return new TextDecoder().decode(bytes); }
function setStatus(id, msg, ok) { var el = $(id); if (!el) return; el.textContent = msg; el.className = "form-status " + (ok ? "ok" : "err"); }

/* ---------- GitHub Contents API ---------- */
function ghUrl(path) { return "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/"); }
function ghHeaders() { return { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; }
function ghGetFile(path) {
  return fetch(ghUrl(path) + "?ref=" + GH.branch, { headers: ghHeaders() }).then(function (r) {
    if (!r.ok) throw new Error("GitHub GET " + path + " failed (" + r.status + ")");
    return r.json();
  }).then(function (j) { return { content: b64decode(j.content || ""), sha: j.sha }; });
}
function ghPutFile(path, content, message) {
  return ghGetFile(path).then(function (cur) { return cur.sha; }, function () { return null; }).then(function (sha) {
    var body = { message: message, content: b64encode(content), branch: GH.branch };
    if (sha) body.sha = sha;
    return fetch(ghUrl(path), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub PUT " + path + " failed (" + r.status + ") " + t.slice(0, 200)); });
      return r.json();
    });
  });
}
function ghPutNewFile(path, content, message) {
  var body = { message: message, content: b64encode(content), branch: GH.branch };
  return fetch(ghUrl(path), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) }).then(function (r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub PUT " + path + " failed (" + r.status + ") " + t.slice(0, 200)); });
    return r.json();
  });
}
function ghDeleteFile(path, message) {
  return ghGetFile(path).then(function (cur) {
    return fetch(ghUrl(path), { method: "DELETE", headers: ghHeaders(), body: JSON.stringify({ message: message, sha: cur.sha, branch: GH.branch }) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub DELETE " + path + " failed (" + r.status + ") " + t.slice(0, 200)); });
      return r.json();
    });
  });
}
function ghUploadImage(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result).split(",")[1];
      var safe = file.name.toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/^-+|-+$/g, "") || "image.jpg";
      var path = "images/" + Date.now() + "-" + safe;
      var body = { message: "Admin panel: upload image " + path, content: b64, branch: GH.branch };
      fetch(ghUrl(path), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { reject(new Error("Image upload failed (" + r.status + ") " + t.slice(0, 160))); });
        resolve(SITE + "/" + path);
      }).catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- data loading ---------- */
function fetchJson(path) {
  if (canPublish()) return ghGetFile(path).then(function (f) { return JSON.parse(f.content); });
  return fetch("/" + path + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("Cannot load " + path); return r.json(); });
}
function normalizeAdmin(a) {
  var perms = {};
  PERMS.forEach(function (p) { perms[p] = a.role === "super" ? true : !!(a.permissions && a.permissions[p]); });
  return { email: String(a.email || "").toLowerCase(), role: a.role || "admin", passwordHash: a.passwordHash || "", permissions: perms };
}
function loadData() {
  return Promise.all([
    fetchJson("posts.json").then(function (j) { state.posts = Array.isArray(j) ? j : (j.posts || []); }),
    fetchJson("admins.json").then(function (j) { return (j.admins || []).map(normalizeAdmin); }).catch(function () { return []; })
  ]).then(function (res) {
    var byEmail = {};
    res[1].forEach(function (a) { byEmail[a.email] = a; });
    try { (JSON.parse(localStorage.getItem("pn_admins_local") || "[]")).forEach(function (a) { var n = normalizeAdmin(a); byEmail[n.email] = n; }); } catch (e) {}
    state.admins = Object.keys(byEmail).map(function (k) { return byEmail[k]; });
    renderAll();
  }).catch(function (err) {
    $("token-banner").className = "token-banner off";
    $("token-banner").innerHTML = "<strong>Could not load site data:</strong> " + esc(err.message);
  });
}

/* ---------- tabs / chrome ---------- */
function showTab(name) {
  document.querySelectorAll(".admin-sidebar button[data-tab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
  document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.toggle("active", p.id === "tab-" + name); });
}
function updateBanner() {
  var b = $("token-banner");
  if (canPublish()) { b.className = "token-banner on"; b.innerHTML = "<strong>Publishing enabled.</strong> A GitHub token is saved in this browser — Add / Edit / Delete will commit to <code>ni-Hridoy/picknest-reviews</code> (main) and Vercel will redeploy automatically."; }
  else { b.className = "token-banner off"; b.innerHTML = "<strong>Draft mode — publishing is disabled.</strong> No GitHub token is saved in this browser, so Add / Edit / Delete cannot publish. Add one under <strong>Settings → GitHub publishing token</strong>."; }
  var dis = !canPublish();
  ["add-publish", "edit-save", "raw-save"].forEach(function (id) { var el = $(id); if (el) el.disabled = dis; });
  document.querySelectorAll("[data-publish-btn]").forEach(function (el) { el.disabled = dis; });
}

/* ---------- rendering ---------- */
function renderDashboard() {
  $("stat-total").textContent = state.posts.length;
  var counts = { "Kitchen Appliances": 0, "Sleep & Mattresses": 0, "Home Comfort": 0, "Home Fitness": 0 };
  state.posts.forEach(function (p) { if (counts[p.category] != null) counts[p.category]++; });
  $("stat-kitchen").textContent = counts["Kitchen Appliances"];
  $("stat-sleep").textContent = counts["Sleep & Mattresses"];
  $("stat-comfort").textContent = counts["Home Comfort"];
  $("stat-fitness").textContent = counts["Home Fitness"];
  $("stat-admins").textContent = state.admins.length;
  $("dash-latest").innerHTML = state.posts.slice(0, 5).map(function (p) {
    return "<tr><td><img class='tbl-thumb' src='" + esc(p.image) + "' alt=''></td><td><a href='" + esc(p.url) + "' target='_blank' rel='noopener'>" + esc(p.title) + "</a></td><td>" + esc(p.category) + "</td><td>" + esc(humanDate(p.date)) + "</td></tr>";
  }).join("");
}
function renderPosts() {
  $("posts-tbody").innerHTML = state.posts.map(function (p) {
    var editBtn = has("edit_posts") ? "<button class='btn btn-small' data-publish-btn data-edit='" + esc(p.slug) + "'>Edit</button>" : "";
    var delBtn = has("delete_posts") ? "<button class='btn btn-small btn-danger' data-publish-btn data-del='" + esc(p.slug) + "'>Delete</button>" : "";
    return "<tr><td><img class='tbl-thumb' src='" + esc(p.image) + "' alt=''></td><td><strong>" + esc(p.title) + "</strong><br><span class='small'>" + esc(p.url) + "</span></td><td>" + esc(p.category) + "</td><td>" + esc(humanDate(p.date)) + "</td><td><div class='row-actions'><a class='btn btn-small btn-ghost' href='" + esc(p.url) + "' target='_blank' rel='noopener'>View</a>" + editBtn + delBtn + "</div></td></tr>";
  }).join("");
  document.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openEdit(b.getAttribute("data-edit")); }); });
  document.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { deletePost(b.getAttribute("data-del")); }); });
  updateBanner();
}
function renderAll() { renderDashboard(); renderPosts(); renderAdmins(); updateBanner(); }

/* ---------- card helpers (index.html / reviews.html / category hubs) ---------- */
function buildCard(p) {
  var t = cardTitle(p);
  return "<article class=\"card review-card\">\n" +
    "        <a class=\"card-media\" href=\"/reviews/" + p.slug + "\" tabindex=\"-1\" aria-hidden=\"true\"><img src=\"" + esc(p.image) + "\" alt=\"" + esc(t) + "\" width=\"640\" height=\"400\" loading=\"lazy\" decoding=\"async\"></a>\n" +
    "        <p class=\"card-tag\">" + esc(CAT_SHORT[p.category] || p.category) + "</p>\n" +
    "        <h3><a href=\"/reviews/" + p.slug + "\">" + esc(t) + "</a></h3>\n" +
    "        <p>" + esc(p.excerpt) + "</p>\n" +
    "        <p class=\"card-meta\">Updated " + humanDate(p.date) + " · 8 min read</p>\n" +
    "        <a class=\"btn btn-small\" href=\"/reviews/" + p.slug + "\">Read Review</a>\n" +
    "      </article>";
}
function insertAfterGridOpen(html, fromIdx) {
  var g = html.indexOf("<div class=\"grid grid-3\"", fromIdx);
  if (g === -1) return null;
  var close = html.indexOf(">", g);
  if (close === -1) return null;
  return { at: close + 1 };
}
function insertLatestCard(html, card) {
  var h = html.indexOf("Latest Reviews");
  if (h === -1) return null;
  var pos = insertAfterGridOpen(html, h);
  if (!pos) return null;
  return html.slice(0, pos.at) + "\n" + card + html.slice(pos.at);
}
function insertArchiveCard(html, catSlug, card) {
  var h = html.indexOf("href=\"/categories/" + catSlug + "\"");
  if (h === -1) return null;
  var pos = insertAfterGridOpen(html, h);
  if (!pos) return null;
  return html.slice(0, pos.at) + "\n" + card + html.slice(pos.at);
}
function insertHubCard(html, card) {
  var pos = insertAfterGridOpen(html, 0);
  if (!pos) return null;
  return html.slice(0, pos.at) + "\n" + card + html.slice(pos.at);
}
function findCardBlock(html, slug) {
  var marker = "href=\"/reviews/" + slug + "\"";
  var idx = html.indexOf(marker);
  if (idx === -1) return null;
  var start = html.lastIndexOf("<article", idx);
  var end = html.indexOf("</article>", idx);
  if (start === -1 || end === -1) return null;
  return { start: start, end: end + "</article>".length };
}
function removeCard(html, slug) {
  var changed = false, block;
  while ((block = findCardBlock(html, slug))) {
    var end = block.end;
    if (html[end] === "\n") end++;
    html = html.slice(0, block.start) + html.slice(end);
    changed = true;
  }
  return { html: html, changed: changed };
}
function updateCardInPlace(html, p) {
  var block = findCardBlock(html, p.slug);
  if (!block) return { html: html, changed: false };
  var seg = html.slice(block.start, block.end);
  var t = cardTitle(p);
  seg = seg.replace(/(<img src=")[^"]*(")/, "$1" + p.image + "$2");
  seg = seg.replace(/(<h3><a href="\/reviews\/[^"]*">)[\s\S]*?(<\/a><\/h3>)/, "$1" + esc(t) + "$2");
  seg = seg.replace(/(<\/h3>\s*<p>)[\s\S]*?(<\/p>)/, "$1" + esc(p.excerpt) + "$2");
  return { html: html.slice(0, block.start) + seg + html.slice(block.end), changed: true };
}
function commitFileIfChanged(path, newContent, oldContent, message) {
  if (newContent === oldContent) return Promise.resolve(false);
  return ghPutFile(path, newContent, message).then(function () { return true; });
}

/* ---------- edit post ---------- */
function openEdit(slug) {
  var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
  if (!p) return;
  state.editingSlug = slug;
  $("edit-wrap").classList.remove("hidden");
  $("edit-slug-label").textContent = "/reviews/" + slug;
  $("raw-slug-label").textContent = "reviews/" + slug + ".html";
  $("edit-title").value = p.title;
  $("edit-category").value = p.category;
  $("edit-excerpt").value = p.excerpt;
  $("edit-image").value = p.image;
  $("edit-image-preview").src = p.image;
  $("edit-raw").value = "";
  setStatus("edit-status", "", true); setStatus("raw-status", "", true);
  $("edit-wrap").scrollIntoView({ behavior: "smooth" });
}
function closeEdit() { state.editingSlug = null; $("edit-wrap").classList.add("hidden"); }

function applyStructuredEdit(html, oldP, newP) {
  var today = todayISO();
  html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>" + esc(newP.title) + "</title>");
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, "$1" + esc(newP.excerpt) + "$2");
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, "$1" + esc(newP.title) + "$2");
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, "$1" + esc(newP.excerpt) + "$2");
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, "$1" + esc(newP.title) + "$2");
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, "$1" + esc(newP.excerpt) + "$2");
  if (oldP.image && newP.image !== oldP.image) html = html.split(oldP.image).join(newP.image); // og/twitter/schema/hero all share the URL
  html = html.replace(/(<meta property="article:modified_time" content=")[^"]*(")/, "$1" + today + "T00:00:00Z$2");
  html = html.replace(/"headline":\s*"(?:[^"\\]|\\.)*"/, "\"headline\":" + JSON.stringify(newP.title));
  html = html.replace(/"dateModified":\s*"[^"]*"/, "\"dateModified\":\"" + today + "\"");
  html = html.replace(/("position":3,"name":")(?:[^"\\]|\\.)*(")/, "$1" + cardTitle(newP).replace(/"/g, "") + "$2");
  html = html.replace(/<h1>[\s\S]*?<\/h1>/, "<h1>" + esc(newP.title) + "</h1>");
  return html;
}

function saveStructuredEdit(ev) {
  ev.preventDefault();
  if (!canPublish()) { setStatus("edit-status", "Draft mode: add a GitHub token in Settings to publish.", false); return; }
  var slug = state.editingSlug; if (!slug) return;
  var idx = state.posts.findIndex(function (x) { return x.slug === slug; });
  var oldP = state.posts[idx];
  var newP = { slug: slug, title: $("edit-title").value.trim(), category: $("edit-category").value, categorySlug: CATS[$("edit-category").value], date: oldP.date, excerpt: $("edit-excerpt").value.trim(), image: $("edit-image").value.trim(), url: oldP.url };
  if (!newP.title || !newP.excerpt || !newP.image) { setStatus("edit-status", "Title, excerpt and featured image are all required.", false); return; }
  setStatus("edit-status", "Publishing… fetching the post file from GitHub.", true);
  var path = "reviews/" + slug + ".html";
  ghGetFile(path).then(function (f) {
    var updated = applyStructuredEdit(f.content, oldP, newP);
    return ghPutFile(path, updated, "Admin panel: edit post " + slug);
  }).then(function () {
    state.posts[idx] = newP;
    return ghPutFile("posts.json", JSON.stringify(state.posts, null, 2) + "\n", "Admin panel: update posts.json (" + slug + ")");
  }).then(function () {
    // Refresh cards that display this post
    var jobs = [];
    jobs.push(ghGetFile("index.html").then(function (f) { var r = updateCardInPlace(f.content, newP); return commitFileIfChanged("index.html", r.html, f.content, "Admin panel: refresh card " + slug); }).catch(function () { return false; }));
    if (newP.categorySlug !== oldP.categorySlug) {
      jobs.push(ghGetFile("reviews.html").then(function (f) { var r1 = removeCard(f.content, slug); var r2 = insertArchiveCard(r1.html, newP.categorySlug, buildCard(newP)); return commitFileIfChanged("reviews.html", r2 || r1.html, f.content, "Admin panel: move card " + slug); }).catch(function () { return false; }));
      jobs.push(ghGetFile("categories/" + oldP.categorySlug + ".html").then(function (f) { var r = removeCard(f.content, slug); return commitFileIfChanged("categories/" + oldP.categorySlug + ".html", r.html, f.content, "Admin panel: remove card " + slug); }).catch(function () { return false; }));
      jobs.push(ghGetFile("categories/" + newP.categorySlug + ".html").then(function (f) { var r = insertHubCard(f.content, buildCard(newP)); return r ? commitFileIfChanged("categories/" + newP.categorySlug + ".html", r, f.content, "Admin panel: add card " + slug) : false; }).catch(function () { return false; }));
    } else {
      jobs.push(ghGetFile("reviews.html").then(function (f) { var r = updateCardInPlace(f.content, newP); return commitFileIfChanged("reviews.html", r.html, f.content, "Admin panel: refresh card " + slug); }).catch(function () { return false; }));
      jobs.push(ghGetFile("categories/" + newP.categorySlug + ".html").then(function (f) { var r = updateCardInPlace(f.content, newP); return commitFileIfChanged("categories/" + newP.categorySlug + ".html", r.html, f.content, "Admin panel: refresh card " + slug); }).catch(function () { return false; }));
    }
    return Promise.all(jobs);
  }).then(function () {
    renderAll();
    setStatus("edit-status", "Saved and published. Vercel will redeploy within about a minute.", true);
  }).catch(function (err) { setStatus("edit-status", "Failed: " + err.message, false); });
}

function loadRaw() {
  var slug = state.editingSlug; if (!slug) return;
  setStatus("raw-status", "Loading…", true);
  var src = canPublish() ? ghGetFile("reviews/" + slug + ".html").then(function (f) { return f.content; })
    : fetch("/reviews/" + slug + ".html?v=" + Date.now()).then(function (r) { return r.text(); });
  src.then(function (html) { $("edit-raw").value = html; setStatus("raw-status", "Loaded. Edit carefully, then save.", true); })
     .catch(function (err) { setStatus("raw-status", "Failed: " + err.message, false); });
}
function saveRaw() {
  if (!canPublish()) { setStatus("raw-status", "Draft mode: add a GitHub token in Settings to publish.", false); return; }
  var slug = state.editingSlug; if (!slug) return;
  var html = $("edit-raw").value;
  if (html.indexOf("<html") === -1) { setStatus("raw-status", "That does not look like a full HTML page — not saved.", false); return; }
  setStatus("raw-status", "Publishing raw HTML…", true);
  ghPutFile("reviews/" + slug + ".html", html, "Admin panel: raw HTML edit " + slug)
    .then(function () { setStatus("raw-status", "Raw HTML saved and published.", true); })
    .catch(function (err) { setStatus("raw-status", "Failed: " + err.message, false); });
}

/* ---------- add post: repeaters ---------- */
var pickCount = 0, faqCount = 0, sourceCount = 0;
function addPickRepeater() {
  if (pickCount >= 5) return;
  pickCount++;
  var n = pickCount;
  var div = document.createElement("div");
  div.className = "repeater"; div.id = "pick-" + n;
  div.innerHTML = "<div class='repeater-head'><strong>Pick " + n + (n === 1 ? " (top pick)" : "") + "</strong><button class='btn btn-small btn-ghost' type='button' data-remove-pick='" + n + "'>Remove</button></div>" +
    "<div class='field'><label>Product name</label><input type='text' class='pick-name'></div>" +
    "<div class='field'><label>Image</label><div class='img-row'><input type='url' class='pick-image' placeholder='https://…'><input type='file' class='pick-image-file' accept='image/*'></div></div>" +
    "<div class='field'><label>Short review</label><textarea class='pick-review' rows='3'></textarea></div>" +
    "<div class='field'><label>Pros <span class='hint'>— one per line</span></label><textarea class='pick-pros' rows='3'></textarea></div>" +
    "<div class='field'><label>Cons <span class='hint'>— one per line</span></label><textarea class='pick-cons' rows='3'></textarea></div>" +
    "<div class='field'><label>Amazon search terms</label><input type='text' class='pick-terms' placeholder='e.g. breville barista express'></div>";
  $("picks-wrap").appendChild(div);
  div.querySelector("[data-remove-pick]").addEventListener("click", function () { div.remove(); });
  wireImageUpload(div.querySelector(".pick-image-file"), div.querySelector(".pick-image"), null);
}
function addFaqRepeater() {
  faqCount++;
  var div = document.createElement("div");
  div.className = "repeater";
  div.innerHTML = "<div class='repeater-head'><strong>Question " + faqCount + "</strong><button class='btn btn-small btn-ghost' type='button'>Remove</button></div>" +
    "<div class='field'><label>Question</label><input type='text' class='faq-q'></div>" +
    "<div class='field'><label>Answer</label><textarea class='faq-a' rows='3'></textarea></div>";
  $("faq-wrap").appendChild(div);
  div.querySelector("button").addEventListener("click", function () { div.remove(); });
}
function addSourceRepeater() {
  sourceCount++;
  var div = document.createElement("div");
  div.className = "repeater";
  div.innerHTML = "<div class='repeater-head'><strong>Source " + sourceCount + "</strong><button class='btn btn-small btn-ghost' type='button'>Remove</button></div>" +
    "<div class='field'><label>Title</label><input type='text' class='src-title'></div>" +
    "<div class='field'><label>URL</label><input type='url' class='src-url' placeholder='https://…'></div>";
  $("sources-wrap").appendChild(div);
  div.querySelector("button").addEventListener("click", function () { div.remove(); });
}
function wireImageUpload(fileInput, urlInput, previewImg) {
  if (!fileInput) return;
  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!canPublish()) { alert("Image upload needs a GitHub token — add one in Settings first. (You can still paste an image URL instead.)"); fileInput.value = ""; return; }
    var old = urlInput.placeholder; urlInput.placeholder = "Uploading…";
    ghUploadImage(file).then(function (url) {
      urlInput.value = url; urlInput.placeholder = old;
      if (previewImg) previewImg.src = url;
    }).catch(function (err) { urlInput.placeholder = old; alert("Upload failed: " + err.message); });
  });
  if (urlInput && previewImg) urlInput.addEventListener("input", function () { previewImg.src = urlInput.value; });
}
function linesOf(text) { return String(text || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }

/* ---------- add post: HTML generation (follows POST_TEMPLATE.html) ---------- */
var LOGO_SVG = "<svg class=\"logo-mark\" width=\"34\" height=\"34\" viewBox=\"0 0 48 48\" fill=\"none\" aria-hidden=\"true\" focusable=\"false\"><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"#0f766e\"/><path d=\"M17 24.5 22.5 30 32 18.5\" stroke=\"#ffffff\" stroke-width=\"4.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10 31c3.2 5.4 8.2 8 14 8s10.8-2.6 14-8\" stroke=\"#ffffff\" stroke-width=\"3.4\" stroke-linecap=\"round\"/><path d=\"M14.5 35.5c2.6 2.9 5.9 4.3 9.5 4.3s6.9-1.4 9.5-4.3\" stroke=\"#5eead4\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>";
function generatePostHtml(d) {
  var url = SITE + "/reviews/" + d.slug;
  var shortTitle = d.title.split(" — ")[0];
  var keywords = shortTitle.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ") + ", " + d.category.toLowerCase() + " reviews, buying guide";
  var words = (d.intro.join(" ") + " " + d.picks.map(function (p) { return p.review; }).join(" ")).split(/\s+/).filter(Boolean).length;
  var readTime = Math.max(3, Math.round(words / 200) + 4);
  var faqSchema = "";
  if (d.faqs.length) {
    faqSchema = "<script type=\"application/ld+json\">\n" + JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": d.faqs.map(function (f) { return { "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } }; }) }, null, 0) + "\n</script>\n";
  }
  var articleSchema = { "@context": "https://schema.org", "@type": "Article", "headline": d.title, "description": d.excerpt, "image": d.image, "author": { "@type": "Organization", "name": "PickNest Reviews Team", "url": SITE + "/about" }, "publisher": { "@type": "Organization", "name": "PickNest Reviews", "url": SITE + "/", "logo": { "@type": "ImageObject", "url": SITE + "/logo.svg" } }, "datePublished": d.date, "dateModified": d.date, "mainEntityOfPage": url, "inLanguage": "en" };
  var crumbSchema = { "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [ { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/" }, { "@type": "ListItem", "position": 2, "name": d.category, "item": SITE + "/categories/" + d.categorySlug }, { "@type": "ListItem", "position": 3, "name": shortTitle, "item": url } ] };
  var rows = d.picks.map(function (p) {
    return "      <tr><td><span class=\"prod-cell\"><img class=\"prod-thumb\" src=\"" + esc(p.image) + "\" alt=\"" + esc(p.name) + "\" width=\"72\" height=\"72\" loading=\"lazy\" decoding=\"async\"><strong>" + esc(p.name) + "</strong></span></td><td>" + esc(p.review) + "</td><td><a class=\"btn btn-amazon btn-small\" href=\"" + amazonUrl(p.terms || p.name) + "\" rel=\"nofollow sponsored noopener\" target=\"_blank\">Check Price on Amazon</a></td></tr>";
  }).join("\n");
  var pickSections = d.picks.map(function (p, i) {
    var pc = "";
    if (p.pros.length || p.cons.length) {
      pc = "<div class=\"pros-cons\"><div class=\"pros\"><h3>Pros</h3><ul>" + p.pros.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
           "<div class=\"cons\"><h3>Cons</h3><ul>" + p.cons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div></div>";
    }
    return "  <h3>" + (i + 1) + ". " + esc(p.name) + "</h3>\n  <p>" + esc(p.review) + "</p>\n  " + pc + "\n  <p style=\"text-align:center;margin:20px 0\"><a class=\"btn btn-amazon\" href=\"" + amazonUrl(p.terms || p.name) + "\" rel=\"nofollow sponsored noopener\" target=\"_blank\">Check Price on Amazon</a></p>";
  }).join("\n");
  var faqHtml = d.faqs.map(function (f) {
    return "  <div class=\"faq-item\"><button class=\"faq-q\">" + esc(f.q) + "</button><div class=\"faq-a\"><p>" + esc(f.a) + "</p></div></div>";
  }).join("\n");
  var related = state.posts.filter(function (p) { return p.categorySlug === d.categorySlug && p.slug !== d.slug; }).slice(0, 3);
  var relatedHtml = related.length ? "  <section class=\"related\">\n    <h2>Related Reviews</h2>\n    <div class=\"grid grid-3\">\n" + related.map(function (p) { return buildCard(p); }).join("\n") + "\n    </div>\n  </section>\n" : "";
  var sourcesHtml = d.sources.length ? "  <section class=\"sources\">\n    <h2>Sources &amp; Further Reading</h2>\n    <ul>\n" + d.sources.map(function (s) { return "      <li><a href=\"" + esc(s.url) + "\" rel=\"noopener\" target=\"_blank\">" + esc(s.title) + "</a></li>"; }).join("\n") + "\n    </ul>\n  </section>\n" : "";
  var topTerms = (d.picks[0] && (d.picks[0].terms || d.picks[0].name)) || d.ctaTerms;
  var mainCta = d.ctaTerms || topTerms;

  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n" +
  "<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
  "<title>" + esc(d.title) + "</title>\n" +
  "<meta name=\"description\" content=\"" + esc(d.excerpt) + "\">\n" +
  "<meta name=\"keywords\" content=\"" + esc(keywords) + "\">\n" +
  "<meta name=\"robots\" content=\"index, follow, max-image-preview:large, max-snippet:-1\">\n" +
  "<meta name=\"author\" content=\"PickNest Reviews Team\">\n" +
  "<link rel=\"canonical\" href=\"" + url + "\">\n" +
  "<meta name=\"theme-color\" content=\"#0f766e\">\n" +
  "<meta property=\"og:type\" content=\"article\">\n<meta property=\"og:site_name\" content=\"PickNest Reviews\">\n" +
  "<meta property=\"og:title\" content=\"" + esc(d.title) + "\">\n<meta property=\"og:description\" content=\"" + esc(d.excerpt) + "\">\n" +
  "<meta property=\"og:url\" content=\"" + url + "\">\n<meta property=\"og:image\" content=\"" + esc(d.image) + "\">\n" +
  "<meta property=\"article:published_time\" content=\"" + d.date + "T00:00:00Z\">\n<meta property=\"article:modified_time\" content=\"" + d.date + "T00:00:00Z\">\n" +
  "<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" content=\"" + esc(d.title) + "\">\n<meta name=\"twitter:description\" content=\"" + esc(d.excerpt) + "\">\n<meta name=\"twitter:image\" content=\"" + esc(d.image) + "\">\n" +
  "<link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/styles.css\">\n" +
  "<script defer src=\"/_vercel/insights/script.js\"></script>\n" +
  "<script type=\"application/ld+json\">\n" + JSON.stringify(articleSchema) + "\n</script>\n" + faqSchema +
  "<script type=\"application/ld+json\">\n" + JSON.stringify(crumbSchema) + "\n</script>\n" +
  "<script async src=\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9249284551065984\" crossorigin=\"anonymous\"></script>\n</head>\n<body>\n" +
  "<header class=\"site-header\"><div class=\"container header-inner\">\n<a class=\"logo\" href=\"/\">" + LOGO_SVG + "<span class=\"logo-text\">PickNest <span>Reviews</span></span></a>\n" +
  "<button class=\"nav-toggle\" aria-label=\"Toggle navigation\" aria-expanded=\"false\">☰</button>\n" +
  "<nav class=\"main-nav\" aria-label=\"Main navigation\"><a href=\"/\">Home</a><a href=\"/#categories\">Categories</a><a href=\"/reviews\">Reviews</a><a href=\"/about\">About</a><a href=\"/contact\">Contact</a></nav>\n</div></header>\n" +
  "<main class=\"container article\">\n" +
  "  <nav class=\"breadcrumb\" aria-label=\"Breadcrumb\"><a href=\"/\">Home</a> › <a href=\"/categories/" + d.categorySlug + "\">" + esc(d.category) + "</a> › " + esc(shortTitle) + "</nav>\n" +
  "  <h1>" + esc(d.title) + "</h1>\n" +
  "  <p class=\"meta\">By <strong>PickNest Reviews Team</strong> · Published " + humanDateFull(d.date) + " · Updated " + humanDateFull(d.date) + " · " + readTime + " min read</p>\n" +
  "  <figure class=\"post-hero\"><img src=\"" + esc(d.image) + "\" alt=\"" + esc(d.picks[0] ? d.picks[0].name : d.title) + " — " + esc(shortTitle) + "\" width=\"1200\" height=\"800\" fetchpriority=\"high\" decoding=\"async\"><figcaption>Our top pick: " + esc(d.picks[0] ? d.picks[0].name : "") + "</figcaption></figure>\n" +
  "  <div class=\"disclosure-box\"><strong>Affiliate Disclosure:</strong> This post contains affiliate links. If you buy through them, we may earn a small commission at no extra cost to you. <a href=\"/disclosure\">Full disclosure →</a></div>\n" +
  "  <div class=\"verdict-box\"><strong>⚡ Quick Verdict:</strong> " + esc(d.verdict || d.excerpt) + "</div>\n" +
  "  <h2>Top Picks at a Glance</h2>\n  <div class=\"table-wrap\"><table>\n    <thead><tr><th>Product</th><th>Overview</th><th></th></tr></thead>\n    <tbody>\n" + rows + "\n    </tbody>\n  </table></div>\n" +
  d.intro.map(function (para) { return "  <p>" + esc(para) + "</p>"; }).join("\n") + "\n" +
  "  <h2>Detailed Reviews</h2>\n" + pickSections + "\n" +
  "  <p style=\"text-align:center;margin:20px 0\"><a class=\"btn btn-amazon\" href=\"" + amazonUrl(mainCta) + "\" rel=\"nofollow sponsored noopener\" target=\"_blank\">Check Price on Amazon</a></p>\n" +
  (d.faqs.length ? "  <h2>Frequently Asked Questions</h2>\n" + faqHtml + "\n" : "") +
  "  <h2>Final Verdict</h2><p>" + esc(d.verdict || d.excerpt) + "</p>\n" +
  "  <p style=\"text-align:center;margin:20px 0\"><a class=\"btn btn-amazon\" href=\"" + amazonUrl(mainCta) + "\" rel=\"nofollow sponsored noopener\" target=\"_blank\">Check Price on Amazon</a></p>\n" +
  relatedHtml + sourcesHtml +
  "</main>\n" +
  "<footer class=\"site-footer\"><div class=\"container footer-inner\">\n" +
  "<p><strong>PickNest Reviews</strong> — Honest reviews &amp; buying guides.</p>\n" +
  "<nav aria-label=\"Footer\"><a href=\"/about\">About</a> · <a href=\"/contact\">Contact</a> · <a href=\"/privacy\">Privacy Policy</a> · <a href=\"/terms\">Terms</a> · <a href=\"/editorial-policy\">Editorial Policy</a> · <a href=\"/corrections-policy\">Corrections Policy</a> · <a href=\"/disclosure\">Affiliate Disclosure</a></nav>\n" +
  "<p class=\"small\">As an Amazon Associate, PickNest Reviews may earn from qualifying purchases — at no extra cost to you.</p>\n" +
  "<p class=\"small\">© <span id=\"year\">2026</span> PickNest Reviews. All rights reserved.</p>\n" +
  "</div></footer>\n<script src=\"/script.js\" defer></script>\n</body>\n</html>\n";
}

/* ---------- add post: publish ---------- */
function collectAddForm() {
  var picks = [];
  document.querySelectorAll("#picks-wrap .repeater").forEach(function (div) {
    var name = div.querySelector(".pick-name").value.trim();
    if (!name) return;
    picks.push({ name: name, image: div.querySelector(".pick-image").value.trim(), review: div.querySelector(".pick-review").value.trim(), pros: linesOf(div.querySelector(".pick-pros").value), cons: linesOf(div.querySelector(".pick-cons").value), terms: div.querySelector(".pick-terms").value.trim() });
  });
  var faqs = [];
  document.querySelectorAll("#faq-wrap .repeater").forEach(function (div) {
    var q = div.querySelector(".faq-q").value.trim(), a = div.querySelector(".faq-a").value.trim();
    if (q && a) faqs.push({ q: q, a: a });
  });
  var sources = [];
  document.querySelectorAll("#sources-wrap .repeater").forEach(function (div) {
    var t = div.querySelector(".src-title").value.trim(), u = div.querySelector(".src-url").value.trim();
    if (t && u) sources.push({ title: t, url: u });
  });
  var category = $("add-category").value;
  return { title: $("add-title").value.trim(), slug: $("add-slug").value.trim(), category: category, categorySlug: CATS[category], excerpt: $("add-excerpt").value.trim(), image: $("add-image").value.trim(), ctaTerms: $("add-cta-terms").value.trim(), intro: linesOf($("add-intro").value), verdict: $("add-verdict").value.trim(), picks: picks, faqs: faqs, sources: sources, date: todayISO() };
}
function publishNewPost(ev) {
  ev.preventDefault();
  if (!canPublish()) { setStatus("add-status", "Draft mode: add a GitHub token in Settings to publish.", false); return; }
  var d = collectAddForm();
  if (!d.title || !d.slug || !d.excerpt || !d.image) { setStatus("add-status", "Title, slug, excerpt and a featured image are required.", false); return; }
  if (!d.picks.length) { setStatus("add-status", "Add at least one pick (the first pick is the top pick and provides the hero image alt text).", false); return; }
  if (state.posts.some(function (p) { return p.slug === d.slug; })) { setStatus("add-status", "A post with slug “" + d.slug + "” already exists in posts.json.", false); return; }
  var entry = { slug: d.slug, title: d.title, category: d.category, categorySlug: d.categorySlug, date: d.date, excerpt: d.excerpt, image: d.image, url: "/reviews/" + d.slug };
  var card = buildCard(entry);
  var warnings = [];
  setStatus("add-status", "Publishing 1/7: creating reviews/" + d.slug + ".html …", true);
  ghPutNewFile("reviews/" + d.slug + ".html", generatePostHtml(d), "Admin panel: new post " + d.slug)
  .then(function () {
    state.posts.unshift(entry);
    setStatus("add-status", "Publishing 2/7: updating posts.json …", true);
    return ghPutFile("posts.json", JSON.stringify(state.posts, null, 2) + "\n", "Admin panel: add " + d.slug + " to posts.json");
  }).then(function () {
    setStatus("add-status", "Publishing 3/7: homepage card …", true);
    return ghGetFile("index.html").then(function (f) { var r = insertLatestCard(f.content, card); if (!r) { warnings.push("homepage anchor not found"); return false; } return commitFileIfChanged("index.html", r, f.content, "Admin panel: homepage card " + d.slug); });
  }).then(function () {
    setStatus("add-status", "Publishing 4/7: archive card …", true);
    return ghGetFile("reviews.html").then(function (f) { var r = insertArchiveCard(f.content, d.categorySlug, card); if (!r) { warnings.push("archive anchor not found"); return false; } return commitFileIfChanged("reviews.html", r, f.content, "Admin panel: archive card " + d.slug); });
  }).then(function () {
    setStatus("add-status", "Publishing 5/7: category hub card …", true);
    return ghGetFile("categories/" + d.categorySlug + ".html").then(function (f) { var r = insertHubCard(f.content, card); if (!r) { warnings.push("hub anchor not found"); return false; } return commitFileIfChanged("categories/" + d.categorySlug + ".html", r, f.content, "Admin panel: hub card " + d.slug); });
  }).then(function () {
    setStatus("add-status", "Publishing 6/7: sitemap …", true);
    return ghGetFile("sitemap.xml").then(function (f) {
      if (f.content.indexOf("/reviews/" + d.slug + "<") !== -1) return false;
      var line = "  <url><loc>" + SITE + "/reviews/" + d.slug + "</loc><lastmod>" + d.date + "</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>\n";
      return commitFileIfChanged("sitemap.xml", f.content.replace("</urlset>", line + "</urlset>"), f.content, "Admin panel: sitemap add " + d.slug);
    });
  }).then(function () {
    setStatus("add-status", "Publishing 7/7: RSS feed …", true);
    return ghGetFile("feed.xml").then(function (f) {
      var item = "    <item>\n      <title>" + esc(d.title) + "</title>\n      <link>" + SITE + "/reviews/" + d.slug + "</link>\n      <guid isPermaLink=\"true\">" + SITE + "/reviews/" + d.slug + "</guid>\n      <description>" + esc(d.excerpt) + "</description>\n      <pubDate>" + rfc822(new Date()) + "</pubDate>\n      <category>" + esc(d.category) + "</category>\n    </item>\n";
      var out = f.content.replace(/<lastBuildDate>[\s\S]*?<\/lastBuildDate>/, "<lastBuildDate>" + rfc822(new Date()) + "</lastBuildDate>");
      var at = out.indexOf("    <item>");
      if (at === -1) { warnings.push("feed anchor not found"); return false; }
      out = out.slice(0, at) + item + out.slice(at);
      return commitFileIfChanged("feed.xml", out, f.content, "Admin panel: feed add " + d.slug);
    });
  }).then(function () {
    renderAll();
    setStatus("add-status", "Published: " + SITE + "/reviews/" + d.slug + " — live within about a minute." + (warnings.length ? " Warnings: " + warnings.join("; ") + "." : ""), true);
    $("add-form").reset();
  }).catch(function (err) { setStatus("add-status", "Failed partway: " + err.message + " — check GitHub; some steps may already be committed.", false); });
}

/* ---------- delete post ---------- */
function deletePost(slug) {
  if (!canPublish()) { alert("Draft mode: add a GitHub token in Settings to publish deletions."); return; }
  var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
  if (!p) return;
  if (!confirm("Delete this post permanently?\n\n" + p.title + "\n/reviews/" + slug + "\n\nThis removes the post file, its posts.json entry and its cards/links from the homepage, archive, category hub, sitemap and feed (all as Git commits — history stays in GitHub).")) return;
  var warnings = [];
  ghDeleteFile("reviews/" + slug + ".html", "Admin panel: delete post " + slug)
  .then(function () {
    state.posts = state.posts.filter(function (x) { return x.slug !== slug; });
    return ghPutFile("posts.json", JSON.stringify(state.posts, null, 2) + "\n", "Admin panel: remove " + slug + " from posts.json");
  }).then(function () {
    var jobs = [
      ghGetFile("index.html").then(function (f) { var r = removeCard(f.content, slug); return commitFileIfChanged("index.html", r.html, f.content, "Admin panel: remove card " + slug); }).catch(function () { warnings.push("index.html"); return false; }),
      ghGetFile("reviews.html").then(function (f) { var r = removeCard(f.content, slug); return commitFileIfChanged("reviews.html", r.html, f.content, "Admin panel: remove card " + slug); }).catch(function () { warnings.push("reviews.html"); return false; }),
      ghGetFile("categories/" + p.categorySlug + ".html").then(function (f) { var r = removeCard(f.content, slug); return commitFileIfChanged("categories/" + p.categorySlug + ".html", r.html, f.content, "Admin panel: remove card " + slug); }).catch(function () { warnings.push("hub"); return false; }),
      ghGetFile("sitemap.xml").then(function (f) {
        var re = new RegExp(" *<url><loc>[^<]*/reviews/" + slug + "</loc>[\\s\\S]*?</url>\\n?");
        return commitFileIfChanged("sitemap.xml", f.content.replace(re, ""), f.content, "Admin panel: sitemap remove " + slug);
      }).catch(function () { warnings.push("sitemap.xml"); return false; }),
      ghGetFile("feed.xml").then(function (f) {
        var re = new RegExp(" *<item>(?:(?!</item>)[\\s\\S])*?/reviews/" + slug + "(?:(?!</item>)[\\s\\S])*?</item>\\n?");
        return commitFileIfChanged("feed.xml", f.content.replace(re, ""), f.content, "Admin panel: feed remove " + slug);
      }).catch(function () { warnings.push("feed.xml"); return false; })
    ];
    return Promise.all(jobs);
  }).then(function () {
    if (state.editingSlug === slug) closeEdit();
    renderAll();
    alert("Post deleted: /reviews/" + slug + (warnings.length ? "\nNote: could not update: " + warnings.join(", ") + " — remove any leftover links there manually." : ""));
  }).catch(function (err) { alert("Delete failed partway: " + err.message); });
}

/* ---------- admins ---------- */
function permSummary(a) {
  if (a.role === "super") return "All permissions (super admin)";
  var on = PERMS.filter(function (p) { return a.permissions[p]; }).map(function (p) { return PERM_LABELS[p]; });
  return on.length ? on.join(", ") : "No permissions";
}
function renderAdmins() {
  var tb = $("admins-tbody");
  if (!tb) return;
  tb.innerHTML = state.admins.map(function (a) {
    var actions = "";
    if (a.role !== "super" && has("manage_admins")) {
      actions = "<button class='btn btn-small' data-admin-edit='" + esc(a.email) + "'>Edit</button> <button class='btn btn-small btn-danger' data-admin-del='" + esc(a.email) + "'>Delete</button>";
    } else if (a.role === "super") { actions = "<span class='small'>Protected</span>"; }
    return "<tr><td><strong>" + esc(a.email) + "</strong></td><td>" + esc(a.role) + "</td><td class='perm-tags'>" + esc(permSummary(a)) + "</td><td><div class='row-actions'>" + actions + "</div></td></tr>";
  }).join("");
  document.querySelectorAll("[data-admin-edit]").forEach(function (b) { b.addEventListener("click", function () { startEditAdmin(b.getAttribute("data-admin-edit")); }); });
  document.querySelectorAll("[data-admin-del]").forEach(function (b) { b.addEventListener("click", function () { deleteAdmin(b.getAttribute("data-admin-del")); }); });
}
function buildPermChecks() {
  $("admin-perms").innerHTML = PERMS.map(function (p) {
    return "<label><input type='checkbox' class='perm-check' value='" + p + "'> " + PERM_LABELS[p] + "</label>";
  }).join("");
}
function readPermChecks() {
  var perms = {};
  document.querySelectorAll(".perm-check").forEach(function (c) { perms[c.value] = c.checked; });
  return perms;
}
function setPermChecks(perms) {
  document.querySelectorAll(".perm-check").forEach(function (c) { c.checked = !!perms[c.value]; });
}
function persistAdmins(message) {
  try { localStorage.setItem("pn_admins_local", JSON.stringify(state.admins)); } catch (e) {}
  if (!canPublish()) return Promise.resolve(false);
  return ghPutFile("admins.json", JSON.stringify({ admins: state.admins }, null, 2) + "\n", message || "Admin panel: update admins.json").then(function () { return true; });
}
function startEditAdmin(email) {
  var a = state.admins.filter(function (x) { return x.email === email; })[0];
  if (!a || a.role === "super") return;
  $("admin-form-title").textContent = "Edit admin — " + a.email;
  $("admin-editing").value = a.email;
  $("admin-email").value = a.email;
  $("admin-password").value = "";
  $("admin-password-hint").textContent = "— leave blank to keep the current password";
  setPermChecks(a.permissions);
  $("admin-cancel-edit").classList.remove("hidden");
  $("admin-form").scrollIntoView({ behavior: "smooth" });
}
function cancelEditAdmin() {
  $("admin-form-title").textContent = "Add an admin";
  $("admin-editing").value = "";
  $("admin-email").value = ""; $("admin-password").value = "";
  $("admin-password-hint").textContent = "— required for a new admin; stored only as a SHA-256 hash";
  setPermChecks({});
  $("admin-cancel-edit").classList.add("hidden");
}
function saveAdmin(ev) {
  ev.preventDefault();
  if (!has("manage_admins")) { setStatus("admin-status", "You do not have the manage_admins permission.", false); return; }
  var editing = $("admin-editing").value;
  var email = $("admin-email").value.trim().toLowerCase();
  var password = $("admin-password").value;
  var perms = readPermChecks();
  if (!email) { setStatus("admin-status", "Email is required.", false); return; }
  var existing = state.admins.filter(function (x) { return x.email === (editing || email); })[0];
  if (!editing && state.admins.some(function (x) { return x.email === email; })) { setStatus("admin-status", "An admin with that email already exists — edit it instead.", false); return; }
  if (existing && existing.role === "super") { setStatus("admin-status", "The super admin cannot be edited or demoted.", false); return; }
  if (!editing && !password) { setStatus("admin-status", "Set a password for the new admin.", false); return; }
  var finish = function (hash) {
    var record = { email: email, role: "admin", passwordHash: hash || (existing ? existing.passwordHash : ""), permissions: perms };
    if (editing) { state.admins = state.admins.map(function (x) { return x.email === editing ? record : x; }); }
    else state.admins.push(record);
    persistAdmins(editing ? "Admin panel: edit admin " + email : "Admin panel: add admin " + email).then(function (published) {
      renderAdmins(); cancelEditAdmin();
      setStatus("admin-status", "Admin saved." + (published ? " admins.json published to GitHub." : " Stored in this browser only (no GitHub token — add one in Settings to publish admins.json)."), true);
    }).catch(function (err) { setStatus("admin-status", "Saved locally, but publishing admins.json failed: " + err.message, false); renderAdmins(); });
  };
  if (password) sha256Hex(password).then(finish).catch(function () { setStatus("admin-status", "Could not hash the password in this browser.", false); });
  else finish(null);
}
function deleteAdmin(email) {
  var a = state.admins.filter(function (x) { return x.email === email; })[0];
  if (!a || a.role === "super") return;
  if (email === session.email) { alert("You cannot delete your own admin account."); return; }
  if (!confirm("Remove admin " + email + "? They will no longer be able to sign in from browsers where admins.json is published/updated.")) return;
  state.admins = state.admins.filter(function (x) { return x.email !== email; });
  persistAdmins("Admin panel: remove admin " + email).then(function () { renderAdmins(); renderDashboard(); setStatus("admin-status", "Admin removed.", true); })
    .catch(function (err) { setStatus("admin-status", "Removed locally; publishing failed: " + err.message, false); renderAdmins(); });
}

/* ---------- settings ---------- */
function saveToken() {
  var v = $("gh-token").value.trim();
  if (!v) { setStatus("token-status", "Paste a token first (or use Remove token).", false); return; }
  localStorage.setItem("pn_gh_token", v);
  $("gh-token").value = "";
  setStatus("token-status", "Token saved in this browser. Reloading data via the GitHub API…", true);
  updateBanner();
  loadData().then(function () { setStatus("token-status", "Token saved and data reloaded from GitHub.", true); });
}
function clearToken() {
  localStorage.removeItem("pn_gh_token");
  setStatus("token-status", "Token removed. The panel is back in draft mode.", true);
  updateBanner(); loadData();
}

/* ---------- init ---------- */
function init() {
  $("who-email").textContent = session.email;
  $("who-role").textContent = session.role === "super" ? "Super admin" : "Admin";
  $("session-info").textContent = "Signed in as " + session.email + " (" + session.role + "). Permissions: " + PERMS.filter(function (p) { return has(p); }).map(function (p) { return PERM_LABELS[p]; }).join(", ") + ".";
  $("logout-link").addEventListener("click", function (ev) { ev.preventDefault(); sessionStorage.removeItem("pn_admin"); location.replace("/login"); });
  document.querySelectorAll(".admin-sidebar button[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
  });
  if (!has("manage_admins")) $("nav-admins").classList.add("hidden");
  if (!has("create_posts")) $("nav-add").classList.add("hidden");
  if (!has("site_settings")) $("nav-settings").classList.add("hidden");
  if ($("gh-token")) { /* token field stays empty; token is never echoed back */ }

  // Posts / edit
  $("edit-form").addEventListener("submit", saveStructuredEdit);
  $("edit-cancel").addEventListener("click", closeEdit);
  $("raw-load").addEventListener("click", loadRaw);
  $("raw-save").addEventListener("click", saveRaw);
  wireImageUpload($("edit-image-file"), $("edit-image"), $("edit-image-preview"));
  $("edit-image").addEventListener("input", function () { $("edit-image-preview").src = $("edit-image").value; });

  // Add post
  addPickRepeater(); addFaqRepeater(); addSourceRepeater();
  $("pick-add").addEventListener("click", addPickRepeater);
  $("faq-add").addEventListener("click", addFaqRepeater);
  $("source-add").addEventListener("click", addSourceRepeater);
  wireImageUpload($("add-image-file"), $("add-image"), $("add-image-preview"));
  var slugTouched = false;
  $("add-slug").addEventListener("input", function () { slugTouched = true; });
  $("add-title").addEventListener("input", function () { if (!slugTouched) $("add-slug").value = slugify($("add-title").value); });
  $("add-form").addEventListener("submit", publishNewPost);

  // Admins
  buildPermChecks();
  $("admin-form").addEventListener("submit", saveAdmin);
  $("admin-cancel-edit").addEventListener("click", cancelEditAdmin);

  // Settings
  $("token-save").addEventListener("click", saveToken);
  $("token-clear").addEventListener("click", clearToken);
  $("reload-data").addEventListener("click", function () { setStatus("reload-status", "Reloading…", true); loadData().then(function () { setStatus("reload-status", "Reloaded.", true); }); });

  updateBanner();
  loadData();
}
document.addEventListener("DOMContentLoaded", init);
