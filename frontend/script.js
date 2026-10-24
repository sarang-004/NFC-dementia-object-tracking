// =====================================================
// CARETRACK - CAREGIVER PORTAL
// ESP32 + PN532 -> FastAPI -> SQLite -> this frontend
// =====================================================
"use strict";

// ---------------- CONFIGURATION ----------------
const API_BASE = "http://127.0.0.1:8000";
const POLL_MS = 10000;

// ---------------- STATE ----------------
let objects = [];            // normalized objects (see fromEntry)
let currentPage = "dashboard";
let findUid = null;          // object currently shown on Find Object
let findTerm = "";
let findCoords = null;
let voiceUid = null;         // object currently shown on Voice Interaction
let locData = null;          // last /locations/hierarchy response
let backendOnline = null;
let needsReload = false;
let lastDetId = null;
let polling = false;
let recognizing = false;
let activeRec = null;
let maps = {};

const $ = s => document.querySelector(s);

// ---------------- GENERIC HELPERS ----------------
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setText(id, v) {
  const e = document.getElementById(id);
  if (e) e.textContent = v;
}

function toast(message, isError = false) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = (isError ? "⚠ " : "✓ ") + message;
  t.style.display = "block";
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { t.style.display = "none"; }, 3200);
}

const ICONS = [
  [["key"], "🔑"], [["glass", "spectacle"], "👓"], [["medicine", "tablet", "pill"], "💊"],
  [["wallet", "purse"], "👛"], [["phone", "mobile"], "📱"], [["watch"], "⌚"],
  [["remote"], "🎮"], [["bottle"], "🍼"], [["bag"], "👜"],
];
function getObjectIcon(name) {
  const n = (name || "").toLowerCase();
  for (const [words, icon] of ICONS) if (words.some(w => n.includes(w))) return icon;
  return "🏷️";
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function spokenTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "an unknown time";
  return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} on ` +
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function isToday(ts) {
  const d = new Date(ts), n = new Date();
  return !isNaN(d.getTime()) && d.toDateString() === n.toDateString();
}

// "2" -> "Floor 2"; "Floor 2" stays as-is
function pre(prefix, v) {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? `${prefix} ${s}` : s;
}

function locParts(l) {
  if (!l) return [];
  return [l.building, l.floor && pre("Floor", l.floor), l.room && pre("Room", l.room)]
    .filter(Boolean);
}

// Returns [lat, lng] only when both are present and in range
function coordsOf(l) {
  if (!l || l.latitude == null || l.longitude == null || l.latitude === "" || l.longitude === "") return null;
  const la = Number(l.latitude), lo = Number(l.longitude);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return [la, lo];
}

const osmUrl = (c, z = 18) =>
  `https://www.openstreetmap.org/?mlat=${c[0]}&mlon=${c[1]}#map=${z}/${c[0]}/${c[1]}`;

const osmLink = c =>
  `<a href="${osmUrl(c)}" target="_blank" rel="noopener">Open in OpenStreetMap</a>`;

const rid = id => String(id).replace(/[^A-Za-z0-9_-]/g, "_");

const errBox = m => `<p class="errbox">${esc(m)}</p>`;
const loadingBox = m => `<p style="color:#718096;font-size:10px">${esc(m)}</p>`;

// ---------------- BACKEND ----------------
function errMsg(data, status) {
  if (data) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map(e => (typeof e === "string" ? e : e.msg || JSON.stringify(e))).join(", ");
    }
    if (typeof data.message === "string") return data.message;
  }
  return `Request failed (${status})`;
}

function setOnline(ok) {
  if (backendOnline === ok) return;
  if (ok && backendOnline === false) needsReload = true;
  backendOnline = ok;
  const live = $("#liveStatus");
  if (live) {
    live.textContent = ok ? "● Live monitoring" : "● Backend offline";
    live.classList.toggle("offline", !ok);
  }
  setText("sysStatus", ok ? "System online" : "Backend unreachable");
  setText("sysDetail", ok ? "Connected to the CareTrack API" : `Cannot reach ${API_BASE}`);
  if (!ok) toast("Cannot reach the backend", true);
}

async function api(path, opts) {
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    setOnline(false);
    throw new Error("Cannot reach the backend. Is it running?");
  }
  setOnline(true);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(errMsg(data, res.status));
  if (!data || typeof data !== "object") throw new Error("Unexpected response from the backend.");
  return data;
}

// entry = { object, latest_detection, location }  (same shape as GET /object/{uid})
function fromEntry(e) {
  const o = (e && e.object) || {};
  return {
    id: o.nfc_uid,
    name: o.name || "Unnamed Object",
    icon: getObjectIcon(o.name),
    registeredAt: o.registered_at,
    detection: e.latest_detection || null,
    location: e.location || null,
  };
}

async function refreshObjects(showError = true) {
  try {
    const data = await api("/objects/status");
    if (!Array.isArray(data.objects)) throw new Error("Unexpected response from the backend.");
    objects = data.objects.map(fromEntry);
  } catch (e) {
    console.error("Object loading error:", e);
    if (showError) toast(e.message, true);
  }
  updateAlertBadge();
  return objects;
}

function updateAlertBadge() {
  const b = $("#alertBadge");
  if (!b) return;
  const n = objects.filter(o => !o.detection).length;
  b.textContent = n;
  b.style.display = n ? "" : "none";
}

async function fetchObject(uid) {
  return fromEntry(await api(`/object/${encodeURIComponent(uid)}`));
}

async function registerObject(name, uid) {
  return api("/objects/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nfc_uid: uid, name }),
  });
}

// ---------------- MAPS (Leaflet / OpenStreetMap) ----------------
function destroyMaps() {
  Object.values(maps).forEach(m => { try { m.remove(); } catch { /* ignore */ } });
  maps = {};
}

function initMap(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (typeof L === "undefined") {
    el.innerHTML = '<div class="map-empty">Map library could not be loaded.</div>';
    return null;
  }
  if (maps[id]) return maps[id];
  const m = L.map(id).setView([20, 0], 2);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(m);
  let warned = false;
  tiles.on("tileerror", () => {
    if (!warned) { warned = true; toast("Map tiles failed to load", true); }
  });
  m.markerLayer = L.layerGroup().addTo(m);
  maps[id] = m;
  setTimeout(() => m.invalidateSize(), 60);
  return m;
}

function objectPopup(o) {
  const d = o.detection, l = o.location;
  return `<b>${esc(o.icon)} ${esc(o.name)}</b><br>Reader ${esc(d.reader_id)}<br>` +
    `${esc(locParts(l).join(" • ") || "Location details not configured")}<br>` +
    `${esc(fmtTime(d.timestamp))}<br><small>Marker shows the reader's configured location.</small>`;
}

// Plots the object's last reader on a map. Returns true if a marker was drawn.
function plotObject(mapId, o) {
  const m = initMap(mapId);
  if (!m) return false;
  m.markerLayer.clearLayers();
  const c = o.detection ? coordsOf(o.location) : null;
  if (!c) { m.setView([20, 0], 2); return false; }
  m.setView(c, 17);
  L.circleMarker(c, { radius: 10, color: "#1b3f60", fillColor: "#2a9d8f", fillOpacity: 0.9, weight: 2 })
    .addTo(m.markerLayer).bindPopup(objectPopup(o)).openPopup();
  setTimeout(() => m.invalidateSize(), 60);
  return true;
}

// ---------------- NAVIGATION ----------------
const TITLES = {
  dashboard: "Dashboard", find: "Find Object", voice: "Voice Interaction",
  objects: "Tagged Objects", history: "Activity History", locations: "Locations", alerts: "Alerts",
};

async function nav(page) {
  currentPage = page;
  document.querySelectorAll(".nav").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page));
  setText("pageTitle", TITLES[page] || "Dashboard");
  await refreshObjects(false);
  render();
}

document.querySelectorAll(".nav").forEach(b => { b.onclick = () => nav(b.dataset.page); });
const bell = $("#bell");
if (bell) bell.onclick = () => toast("No new notifications");

function render() {
  const c = $("#content");
  if (!c) return;
  destroyMaps();
  const pages = {
    dashboard, find: findPage, voice: voicePage, objects: objectsPage,
    history: historyPage, locations: locationsPage, alerts: alertsPage,
  };
  if (!pages[currentPage]) currentPage = "dashboard";
  const banner = backendOnline === false
    ? `<div class="banner">⚠ Cannot reach the backend at ${esc(API_BASE)}. Data below may be missing or out of date.</div>` : "";
  c.innerHTML = banner + pages[currentPage]();
  bind();
  hydrateCurrentPage();
}

function hydrateCurrentPage() {
  switch (currentPage) {
    case "dashboard": return loadDashboardExtras();
    case "find":
      initMap("findMap");
      if (findUid) return showFind(findUid);
      return;
    case "voice":
      if (voiceUid) fetchObject(voiceUid).then(o => showVoiceResult(o, false)).catch(() => {});
      return;
    case "history": return loadInitialHistory();
    case "locations": return loadLocationsPageData();
  }
}

// ---------------- DASHBOARD ----------------
function stat(icon, title, value, sub, id = "") {
  return `<div class="stat"><div class="ico">${icon}</div><div><span>${title}</span>
    <strong ${id ? `id="${id}"` : ""}>${value}</strong><small>${sub}</small></div></div>`;
}

function dashboard() {
  const detected = objects.filter(o => o.detection);
  const today = detected.filter(o => isToday(o.detection.timestamp)).length;
  const attention = objects.length - detected.length;
  const recent = [...detected].sort((a, b) => b.detection.id - a.detection.id);

  return `
  <section class="welcome"><div><h2>Good evening, Caregiver 👋</h2>
    <p>Find a tagged object and see its last known location.</p></div>
    <button class="primary" onclick="nav('find')">🔎 Find an object</button></section>

  <section class="stats">
    ${stat("🏷️", "Tagged Objects", objects.length, "Registered NFC objects")}
    ${stat("✓", "Detected Today", today, "Objects last seen today")}
    ${stat("⌖", "Locations", "—", "Configured readers", "statLocations")}
    ${stat("⚠", "Attention Needed", attention, "Objects never detected")}
  </section>

  <div class="grid2">
    <section class="panel">
      <div class="panel-head"><div><h3>Recently detected</h3><p>Latest NFC event per object</p></div>
        <button class="text" onclick="nav('history')">View history →</button></div>
      <div class="activity">
        ${recent.length === 0
          ? `<div style="padding:20px;text-align:center;color:#718096">No NFC detections recorded yet.</div>`
          : recent.map(o => `
            <div class="row"><div class="objicon">${o.icon}</div>
              <div class="grow"><b>${esc(o.name)}</b>
                <small>Reader ${esc(o.detection.reader_id)} • ${esc(o.id)}</small></div>
              <time>${esc(fmtTime(o.detection.timestamp))}</time></div>`).join("")}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h3>Quick find</h3><p>Select an object to locate it</p></div></div>
      <div class="quick">
        ${objects.length === 0
          ? `<div style="padding:20px;color:#718096">No registered objects.</div>`
          : objects.slice(0, 5).map(o => `
            <button data-object="${esc(o.id)}"><span class="objicon">${o.icon}</span>
              <span class="grow"><b>${esc(o.name)}</b>
                <small>${o.location ? esc(pre("Room", o.location.room)) : `NFC: ${esc(o.id)}`}</small></span>→</button>`).join("")}
      </div>
      <button class="secondary full" id="scan">↻ Refresh detections</button>
    </section>
  </div>

  <section class="workflow">
    <div class="step"><div class="stepnum">01</div><b>NFC Tag</b><small>Object identity</small></div><div class="arrow">→</div>
    <div class="step"><div class="stepnum">02</div><b>PN532</b><small>Reads tag</small></div><div class="arrow">→</div>
    <div class="step"><div class="stepnum">03</div><b>ESP32</b><small>Sends data</small></div><div class="arrow">→</div>
    <div class="step"><div class="stepnum">04</div><b>Backend</b><small>Stores event</small></div><div class="arrow">→</div>
    <div class="step"><div class="stepnum">05</div><b>Web App</b><small>Caregiver view</small></div>
  </section>`;
}

async function loadDashboardExtras() {
  try {
    const d = await api("/readers");
    setText("statLocations", Array.isArray(d.readers) ? d.readers.length : "—");
  } catch { /* offline banner already handled */ }
}

// ---------------- FIND OBJECT ----------------
function findPage() {
  return `
  <div class="find-grid">
    <section>
      <div class="search"><span>⌕</span>
        <input id="search" placeholder="Enter NFC UID or object name..." value="${esc(findTerm)}"></div>
      <div class="panel" style="margin-top:12px;padding:15px">
        <div class="panel-head"><div><h3>NFC Object Lookup</h3>
          <p>Enter an NFC UID or object name to find its last known location.</p></div></div>
        <button class="primary full" id="lookupNFC">🔎 Find Object</button>
        <div id="lookupResult" style="margin-top:15px"></div>
        <div style="margin-top:18px">
          <p style="font-size:9px;font-weight:700;color:#718096;margin-bottom:8px">REGISTERED OBJECTS</p>
          ${objects.length === 0 ? "<small>No registered objects.</small>" : objects.map(o => `
            <button class="secondary full" style="margin-bottom:6px;text-align:left"
              data-object="${esc(o.id)}">${o.icon} ${esc(o.name)}</button>`).join("")}
        </div>
      </div>
    </section>
    ${locationCard()}
  </div>`;
}

function locationCard() {
  return `
  <section class="location-card">
    <div class="gis-map" id="findMap"></div>
    <div class="map-note" id="mapNote">Search for an object to see its last reader on the map.</div>
    <div class="locbody">
      <span class="label">LAST KNOWN LOCATION</span>
      <h2 id="locationObject">🏷️ No object selected</h2>
      <div class="highlight"><span>⌖</span><div>
        <b id="locationRoom">—</b>
        <small id="locationDetails">Building — • Floor — • Reader —</small></div></div>
      <div class="timebox"><span>Last detected</span><b id="locationTime">—</b>
        <small id="locationUID">NFC UID: —</small></div>
      <div class="map-note" id="locationCoords" style="padding-left:0">Coordinates: —</div>
      <button class="primary full" id="route">📍 Show location</button>
      <p style="font-size:8px;color:#9aa5b1;text-align:center">
        The marker is the reader's configured position, not a precise position of the object.</p>
    </div>
  </section>`;
}

function chooserHtml(matches) {
  return `<p style="font-size:10px;color:#718096;margin-bottom:6px">Several objects match. Please choose one:</p>` +
    matches.map(m => `<button class="secondary full" style="margin-bottom:6px;text-align:left"
      data-pick="${esc(m.object.nfc_uid)}">${getObjectIcon(m.object.name)} ${esc(m.object.name)}
      <small>${esc(m.object.nfc_uid)}</small></button>`).join("");
}

function bindPicks(root, fn) {
  root.querySelectorAll("[data-pick]").forEach(b => { b.onclick = () => fn(b.dataset.pick); });
}

async function performLookup(value) {
  const v = (value || "").trim();
  const box = $("#lookupResult");
  if (!box) return;
  if (!v) { toast("Enter an NFC UID or object name", true); return; }
  findTerm = v;
  box.innerHTML = loadingBox("Searching...");
  try {
    const d = await api(`/objects/search?q=${encodeURIComponent(v)}`);
    const m = Array.isArray(d.matches) ? d.matches : [];
    if (m.length === 0) {
      box.innerHTML = errBox(`No registered object or NFC UID matches “${v}”.`);
      findUid = null;
      clearLocationCard();
    } else if (m.length > 1) {
      box.innerHTML = chooserHtml(m);
      bindPicks(box, uid => showFind(uid));
    } else {
      findUid = m[0].object.nfc_uid;
      renderFindResult(fromEntry(m[0]));
    }
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

async function showFind(uid) {
  findUid = uid;
  const box = $("#lookupResult");
  if (!box) return;
  try {
    renderFindResult(await fetchObject(uid));
  } catch (e) {
    box.innerHTML = errBox(e.message);
  }
}

function renderFindResult(o) {
  const box = $("#lookupResult");
  if (box) {
    const d = o.detection;
    box.innerHTML = `
      <div class="highlight"><span>${o.icon}</span><div><b>${esc(o.name)}</b>
        <small>UID: ${esc(o.id)}</small></div></div>
      <div class="timebox" style="margin-top:10px">
        ${d ? `<span>Last detected by</span><b>Reader ${esc(d.reader_id)}</b>
               <small>${esc(fmtTime(d.timestamp))}${d.id != null ? ` • detection #${esc(d.id)}` : ""}</small>`
            : `<span>Status</span><b>Not detected yet</b><small>No reader has recorded this tag.</small>`}
      </div>`;
  }
  updateLocationCard(o);
}

function updateLocationCard(o) {
  const d = o.detection, l = o.location;
  findCoords = null;
  setText("locationObject", `${o.icon} ${o.name}`);
  setText("locationUID", `NFC UID: ${o.id}`);

  if (!d) {
    setText("locationRoom", "Not detected yet");
    setText("locationDetails", "No reader has detected this tag.");
    setText("locationTime", "—");
  } else {
    setText("locationTime", fmtTime(d.timestamp));
    if (!l) {
      setText("locationRoom", "Location not configured");
      setText("locationDetails", `Reader ${d.reader_id} has no configured building, floor or room`);
    } else {
      setText("locationRoom", l.room ? pre("Room", l.room) : "Room not set");
      setText("locationDetails",
        `${l.building || "Building not set"} • ${l.floor ? pre("Floor", l.floor) : "Floor not set"} • Reader ${l.reader_id}`);
    }
  }

  const c = d ? coordsOf(l) : null;
  findCoords = c;
  const cEl = $("#locationCoords");
  if (cEl) {
    cEl.innerHTML = c
      ? `Latitude ${c[0]}, Longitude ${c[1]} • ${osmLink(c)}`
      : d ? "GPS coordinates not configured" : "Coordinates: —";
  }
  const plotted = plotObject("findMap", o);
  setText("mapNote", plotted
    ? "Marker = the reader's configured location, not necessarily the object's exact position."
    : d ? "GPS coordinates not configured for this reader, so no marker is shown."
        : "Not detected yet, so there is nothing to show on the map.");
}

function clearLocationCard() {
  setText("locationObject", "🏷️ No object selected");
  setText("locationRoom", "—");
  setText("locationDetails", "Building — • Floor — • Reader —");
  setText("locationTime", "—");
  setText("locationUID", "NFC UID: —");
  setText("mapNote", "Search for an object to see its last reader on the map.");
  const c = $("#locationCoords");
  if (c) c.textContent = "Coordinates: —";
  findCoords = null;
  const m = maps.findMap;
  if (m) { m.markerLayer.clearLayers(); m.setView([20, 0], 2); }
}

// ---------------- TAGGED OBJECTS ----------------
function objectsPage() {
  return `
  <div class="intro"><div><h2>Tagged Objects</h2>
    <p>Registered NFC stickers and their last detection details.</p></div>
    <button class="primary" id="addObjectBtn">＋ Add object</button></div>
  <section class="table">
    <div class="thead"><span>Object</span><span>NFC ID</span><span>Location</span>
      <span>Last detected</span><span>Status</span></div>
    ${objects.length === 0
      ? `<div style="padding:25px;text-align:center;color:#718096">No registered objects.</div>`
      : objects.map(o => {
          const d = o.detection, l = o.location;
          const loc = !d ? "Not detected yet"
            : !l ? `Reader ${esc(d.reader_id)} <small>location not configured</small>`
            : `${esc(l.building)}, ${esc(pre("Floor", l.floor))}
               <small>${esc(pre("Room", l.room))} • ${esc(l.reader_id)}</small>`;
          return `<div class="tr">
            <span><b>${o.icon} ${esc(o.name)}</b></span>
            <span>${esc(o.id)}</span>
            <span>${loc}</span>
            <span>${d ? esc(fmtTime(d.timestamp)) : "—"}</span>
            <span class="${d ? "success" : "warning"}">${d ? "Detected" : "Not detected"}</span></div>`;
        }).join("")}
  </section>`;
}

function showAddObjectForm() {
  $("#addObjectModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
  <div id="addObjectModal" class="modal-back"><div class="modal-box">
    <h2 style="margin-bottom:6px">Add Tagged Object</h2>
    <p style="color:#718096;font-size:10px;margin-bottom:20px">Register an NFC sticker with an everyday object.</p>
    <label>Object Name</label>
    <input id="newObjectName" type="text" placeholder="e.g. House Keys" autocomplete="off">
    <label>NFC UID</label>
    <input id="newObjectUID" type="text" placeholder="e.g. 53090BF5130001" autocomplete="off"
           style="text-transform:uppercase;margin-bottom:8px">
    <small style="display:block;color:#718096;font-size:9px;margin-bottom:20px">
      The UID must match the UID read from the NFC tag.</small>
    <div class="btns"><button id="cancelAddObject" class="secondary">Cancel</button>
      <button id="saveObject" class="primary">Save Object</button></div>
  </div></div>`);
  $("#cancelAddObject").onclick = () => $("#addObjectModal")?.remove();
  $("#saveObject").onclick = registerNewObject;
  ["#newObjectName", "#newObjectUID"].forEach(s =>
    $(s).addEventListener("keydown", e => { if (e.key === "Enter") registerNewObject(); }));
  setTimeout(() => $("#newObjectName")?.focus(), 50);
}

async function registerNewObject() {
  const nameInput = $("#newObjectName"), uidInput = $("#newObjectUID");
  if (!nameInput || !uidInput) return;
  const name = nameInput.value.trim();
  const uid = uidInput.value.trim().toUpperCase();

  if (!name) { toast("Enter an object name", true); nameInput.focus(); return; }
  if (!uid) { toast("Enter the NFC UID", true); uidInput.focus(); return; }
  if (!/^[0-9A-F]+$/.test(uid)) { toast("NFC UID must contain only 0-9 and A-F", true); uidInput.focus(); return; }

  const existing = objects.find(o => o.id === uid);
  if (existing && !confirm(`${existing.name} is already registered with this UID.\n\nReplace its name with "${name}"?`)) return;

  const btn = $("#saveObject");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    await registerObject(name, uid);
    $("#addObjectModal")?.remove();
    await refreshObjects(false);
    render();
    toast(`${name} registered successfully`);
  } catch (e) {
    toast(e.message || "Could not register object", true);
    if (btn) { btn.disabled = false; btn.textContent = "Save Object"; }
  }
}

// ---------------- ACTIVITY HISTORY ----------------
function historyPage() {
  return `
  <div class="intro"><div><h2>Activity History</h2><p>Real NFC detection events from the backend.</p></div>
    <select id="historyTag" class="secondary">
      ${objects.length === 0 ? `<option value="">No objects registered</option>`
        : objects.map(o => `<option value="${esc(o.id)}" ${o.id === historyUid ? "selected" : ""}>
            ${esc(o.name)} — ${esc(o.id)}</option>`).join("")}
    </select></div>
  <section class="table timeline">
    <div id="historyResults" style="padding:20px;text-align:center;color:#718096">Loading detection history...</div>
  </section>`;
}

let historyUid = null;

async function loadInitialHistory() {
  const select = $("#historyTag");
  if (!select || !select.value) {
    const r = $("#historyResults");
    if (r) r.textContent = "No registered objects.";
    return;
  }
  historyUid = select.value;
  await loadHistory(select.value);
}

async function loadHistory(uid) {
  const box = $("#historyResults");
  if (!box || !uid) return;
  historyUid = uid;
  try {
    const d = await api(`/object/${encodeURIComponent(uid)}/history`);
    const hist = Array.isArray(d.history) ? d.history : [];
    if (hist.length === 0) {
      box.innerHTML = `<p style="padding:20px;color:#718096">No detection history found.</p>`;
      return;
    }
    const o = objects.find(x => x.id === uid);
    box.innerHTML = hist.map(ev => `
      <div class="tr"><span>${esc(fmtTime(ev.timestamp))}</span><span class="dot"></span>
        <span><b>${o ? esc(o.name) : "NFC Object"}</b>
          <small>Reader ${esc(ev.reader_id)} • ${esc(ev.nfc_uid)}</small></span></div>`).join("");
  } catch (e) {
    box.innerHTML = `<p style="padding:20px;color:#c05621">${esc(e.message)}</p>`;
  }
}

// ---------------- LOCATIONS ----------------
function locationsPage() {
  return `
  <div class="intro"><div><h2>Location Hierarchy</h2>
    <p>Building → Floor → Room → Reader → Objects last seen there.</p></div></div>

  <section class="panel" style="padding:15px">
    <div class="panel-head"><div><h3 id="formTitle">Configure reader location</h3>
      <p>Logical location (building / floor / room) and optional GPS coordinates for the map.</p></div></div>
    <form id="readerForm" class="reader-form" autocomplete="off">
      <div><label>READER ID</label><input id="fReader" placeholder="R01" required></div>
      <div><label>BUILDING</label><input id="fBuilding" placeholder="Building A" required></div>
      <div><label>FLOOR</label><input id="fFloor" placeholder="Floor 1" required></div>
      <div><label>ROOM</label><input id="fRoom" placeholder="Room 101" required></div>
      <div><label>LATITUDE (optional)</label><input id="fLat" placeholder="10.5276" inputmode="decimal"></div>
      <div><label>LONGITUDE (optional)</label><input id="fLng" placeholder="76.2144" inputmode="decimal"></div>
      <div class="actions"><button type="submit" class="primary" id="fSave">Save reader</button>
        <button type="button" class="secondary" id="fReset">Clear form</button></div>
    </form>
    <p id="formMsg" class="map-note" style="padding-left:0"></p>
  </section>

  <div class="loc-grid">
    <section class="panel" style="padding:12px">
      <div class="panel-head"><div><h3>Reader map</h3><p>Only readers with valid coordinates</p></div></div>
      <div class="gis-map" id="locMap" style="border-radius:10px"></div>
      <div class="map-note" id="locMapNote" style="padding-left:0">Loading…</div>
    </section>
    <section class="location-hierarchy" id="locationHierarchy">
      <div style="padding:20px;text-align:center;color:#718096">Loading reader locations...</div>
    </section>
  </div>

  <div class="panel" style="margin-top:15px"><h3>How location tracking works</h3>
    <p style="font-size:10px;color:#718096;line-height:1.6">
      When an NFC tag is detected, the ESP32 sends the tag UID and reader ID to the backend, which maps the
      reader to its configured building, floor and room. The <b>logical location</b> (building/floor/room) and the
      <b>geographic location</b> (latitude/longitude) are stored separately. Map markers show where a
      <i>reader</i> is, not an exact indoor position for the object.</p></div>`;
}

function readerHtml(r) {
  const c = coordsOf(r), last = r.last_detection;
  return `
  <details class="hn reader" id="reader-${rid(r.reader_id)}">
    <summary>📡 <b>Reader ${esc(r.reader_id)}</b>
      <span class="pill ${last ? "ok" : ""}">${r.total_detections} detection${r.total_detections === 1 ? "" : "s"}</span></summary>
    <div class="hbody">
      <div>Coordinates: ${c ? `${c[0]}, ${c[1]} • ${osmLink(c)}` : "GPS coordinates not configured"}</div>
      <div>Last detection: ${last ? `${esc(fmtTime(last.timestamp))} — ${esc(last.name || last.nfc_uid)}` : "No detections recorded yet."}</div>
      <div>Objects last seen here:</div>
      ${r.objects.length
        ? `<ul>${r.objects.map(o => `<li>${getObjectIcon(o.name)} ${esc(o.name)} <small>• ${esc(fmtTime(o.timestamp))}</small></li>`).join("")}</ul>`
        : `<small>${last ? "No object currently has this as its latest reader." : "No detections recorded yet."}</small>`}
      <div style="margin-top:8px"><button class="secondary" data-edit-reader="${esc(r.reader_id)}">Edit location</button></div>
    </div>
  </details>`;
}

function hierarchyHtml(d) {
  if (!d.buildings || d.buildings.length === 0) {
    return `<div style="padding:25px;text-align:center;color:#718096">
      No reader locations configured yet. Use the form above to add one.</div>`;
  }
  let h = d.buildings.map(b => `
    <details class="hn" open><summary>🏢 <b>${esc(b.building)}</b></summary><div class="hbody">
      ${b.floors.map(f => `
        <details class="hn" open><summary>▤ ${esc(pre("Floor", f.floor))}</summary><div class="hbody">
          ${f.rooms.map(rm => `
            <details class="hn" open><summary>🚪 ${esc(pre("Room", rm.room))}</summary><div class="hbody">
              ${rm.readers.map(readerHtml).join("")}</div></details>`).join("")}
        </div></details>`).join("")}
    </div></details>`).join("");

  if (d.undetected_objects && d.undetected_objects.length) {
    h += `<details class="hn"><summary>🏷️ Objects not detected yet
      <span class="pill">${d.undetected_objects.length}</span></summary><div class="hbody"><ul>
      ${d.undetected_objects.map(o => `<li>${esc(o.name)} — Not detected yet</li>`).join("")}</ul></div></details>`;
  }
  if (d.unconfigured_readers_with_detections && d.unconfigured_readers_with_detections.length) {
    h += `<p class="map-note">Readers with detections but no configured location:
      ${d.unconfigured_readers_with_detections.map(esc).join(", ")}</p>`;
  }
  return h;
}

function allReaders(d) {
  const out = [];
  (d.buildings || []).forEach(b => b.floors.forEach(f => f.rooms.forEach(r => r.readers.forEach(x => out.push(x)))));
  return out;
}

async function loadLocationsPageData() {
  const box = $("#locationHierarchy");
  if (!box) return;
  try {
    const d = await api("/locations/hierarchy");
    if (!Array.isArray(d.buildings)) throw new Error("Unexpected response from the backend.");
    locData = d;
    box.innerHTML = hierarchyHtml(d);
    box.querySelectorAll("[data-edit-reader]").forEach(b => {
      b.onclick = () => editReader(b.dataset.editReader);
    });
    renderLocMap(allReaders(d));
  } catch (e) {
    box.innerHTML = `<div style="padding:20px;color:#c05621">${esc(e.message)}</div>`;
    setText("locMapNote", "Could not load reader locations.");
  }
}

function readerPopup(r) {
  const last = r.last_detection;
  return `<b>Reader ${esc(r.reader_id)}</b><br>${esc(locParts(r).join(" • "))}<br>` +
    (last ? `Last: ${esc(last.name || last.nfc_uid)}<br>${esc(fmtTime(last.timestamp))}` : "No detections recorded yet.");
}

function renderLocMap(readers) {
  const m = initMap("locMap");
  if (!m) return;
  m.markerLayer.clearLayers();
  const pts = [];
  readers.forEach(r => {
    const c = coordsOf(r);
    if (!c) return;
    pts.push(c);
    L.circleMarker(c, {
      radius: 9, weight: 2, color: "#1b3f60", fillOpacity: 0.9,
      fillColor: r.last_detection ? "#2a9d8f" : "#cbd5e0",
    }).addTo(m.markerLayer).bindPopup(readerPopup(r)).on("click", () => highlightReader(r.reader_id));
  });
  if (pts.length) {
    m.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
    setText("locMapNote", `${pts.length} of ${readers.length} reader(s) have coordinates. Teal = has detections, grey = none yet. Markers show reader positions, not exact object positions.`);
  } else {
    m.setView([20, 0], 2);
    setText("locMapNote", readers.length
      ? "No reader has valid GPS coordinates configured yet."
      : "No readers configured yet.");
  }
  setTimeout(() => m.invalidateSize(), 60);
}

function highlightReader(id) {
  const el = document.getElementById("reader-" + rid(id));
  if (!el) return;
  for (let p = el; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("hl");
  setTimeout(() => el.classList.remove("hl"), 2500);
}

function editReader(id) {
  const r = locData ? allReaders(locData).find(x => x.reader_id === id) : null;
  if (!r) return;
  $("#fReader").value = r.reader_id;
  $("#fBuilding").value = r.building;
  $("#fFloor").value = r.floor;
  $("#fRoom").value = r.room;
  $("#fLat").value = r.latitude ?? "";
  $("#fLng").value = r.longitude ?? "";
  setText("formTitle", `Edit reader ${r.reader_id}`);
  $("#readerForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetReaderForm() {
  $("#readerForm")?.reset();
  setText("formTitle", "Configure reader location");
  setText("formMsg", "");
}

async function submitReaderForm(ev) {
  ev.preventDefault();
  const msg = t => setText("formMsg", t);
  const readerId = $("#fReader").value.trim().toUpperCase();
  const building = $("#fBuilding").value.trim();
  const floor = $("#fFloor").value.trim();
  const room = $("#fRoom").value.trim();
  const latS = $("#fLat").value.trim(), lngS = $("#fLng").value.trim();

  if (!/^[A-Z0-9_-]{1,32}$/.test(readerId)) return msg("Reader ID must be 1-32 characters: letters, digits, - or _.");
  if (!building || !floor || !room) return msg("Building, floor and room are required.");
  if ((latS === "") !== (lngS === "")) return msg("Enter both latitude and longitude, or leave both empty.");

  let latitude = null, longitude = null;
  if (latS !== "") {
    latitude = Number(latS); longitude = Number(lngS);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return msg("Latitude must be a number between -90 and 90.");
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return msg("Longitude must be a number between -180 and 180.");
  }

  const btn = $("#fSave");
  btn.disabled = true;
  msg("Saving…");
  try {
    const res = await api("/readers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reader_id: readerId, building, floor, room, latitude, longitude }),
    });
    toast(res.message || "Reader saved");
    resetReaderForm();
    await refreshObjects(false);
    await loadLocationsPageData();
  } catch (e) {
    msg(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------------- ALERTS ----------------
function alertsPage() {
  const attention = objects.filter(o => !o.detection);
  return `
  <div class="intro"><div><h2>Alerts</h2><p>Objects that may need caregiver attention.</p></div></div>
  <div id="alertsContainer">
    ${attention.length === 0
      ? `<section class="panel"><h3>✓ No attention needed</h3>
          <p style="font-size:10px;color:#718096;margin-top:6px">All registered objects have at least one recorded NFC detection.</p></section>`
      : attention.map(o => `
        <section class="alert"><div class="alert-icon">⚠</div>
          <div class="grow"><span class="warning" style="font-size:8px;font-weight:800">ATTENTION NEEDED</span>
            <h3>${esc(o.name)} has not been detected</h3>
            <p>No NFC detection has been recorded for this object yet.</p></div>
          <button class="primary" data-object="${esc(o.id)}">Find object</button></section>`).join("")}
  </div>
  <section class="panel" style="margin-top:15px"><h3>How alerts work</h3>
    <p style="font-size:10px;color:#718096;line-height:1.6">Currently an object needs attention when it has no recorded
      detection. A future version can alert when an object has not been seen for a defined period.</p></section>`;
}

// ---------------- VOICE INTERACTION ----------------
function voicePage() {
  const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  return `
  <section class="voice-card">
    <span class="voice-label">VOICE-ASSISTED OBJECT SEARCH</span>
    <h2>Ask where an object is</h2>
    <p>Use your microphone, type a question, or try the demo phrase below.</p>
    <button class="mic" id="mic" title="Start / stop listening">🎙</button>
    ${supported ? "" : `<p class="errbox">Speech recognition is not supported in this browser (try Chrome or Edge). Use the text box instead.</p>`}
    <div class="transcript" id="transcript">Tap the microphone and say: <b>“Where are my keys?”</b></div>
    <div class="manual">
      <input id="voiceText" placeholder="Or type: Where is my wallet?">
      <button class="primary" id="voiceAsk">Ask</button>
    </div>
    <div class="answer" id="answer"></div>
    <div id="voiceMapWrap" class="hidden">
      <div class="voice-map"><div class="gis-map" id="voiceMap"></div></div>
      <div class="map-note" id="voiceMapNote"></div>
    </div>
    <button class="secondary" id="demoVoice" style="margin-top:12px">Try demo phrase</button>
  </section>`;
}

const STOP = new Set(["where", "is", "are", "my", "the", "a", "an", "our", "find", "locate", "please", "object", "uid", "of", "me", "show", "to", "tell"]);
const ALIASES = { spectacles: "glasses", specs: "glasses", tablets: "medicine", tablet: "medicine", pills: "medicine", pill: "medicine", purse: "wallet" };

function extractQuery(text) {
  let t = text.toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(please |can you |could you )/, "");
  t = t.replace(/^(where(?:'s| is| are)|find|locate|show me|look for|search for|tell me where)\s+/, "");
  t = t.replace(/^(object (uid|id)|nfc uid|uid)\s+/, "");
  t = t.replace(/^(my|the|a|an|our)\s+/, "").replace(/\s+(please|now)$/, "").trim();
  return t;
}

async function searchObjects(q) {
  const d = await api(`/objects/search?q=${encodeURIComponent(q)}`);
  return Array.isArray(d.matches) ? d.matches : [];
}

async function voiceSearch(q) {
  const compact = q.replace(/[\s-]/g, "").toUpperCase();
  if (/^[0-9A-F]{8,}$/.test(compact)) return searchObjects(compact);

  let m = await searchObjects(q);
  if (m.length) return m;

  // Fallback: search each meaningful word (with a few aliases) and merge
  const tokens = [...new Set(q.split(" ").filter(w => w.length > 2 && !STOP.has(w)).map(w => ALIASES[w] || w))];
  const seen = new Map();
  for (const t of tokens) {
    for (const e of await searchObjects(t)) seen.set(e.object.nfc_uid, e);
  }
  return [...seen.values()];
}

function setTranscript(html) {
  const t = $("#transcript");
  if (t) t.innerHTML = html;
}

function showAnswer(html) {
  const a = $("#answer");
  if (!a) return;
  a.style.display = "block";
  a.innerHTML = html;
}

function speak(sentence) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(sentence);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

function buildSentence(o) {
  const d = o.detection;
  if (!d) return `I found the registered object, ${o.name}, but it has not been detected yet.`;
  const parts = locParts(o.location);
  let s = `Your ${o.name} was last detected by reader ${d.reader_id}`;
  if (parts.length) s += ` in ${parts.join(", ")}`;
  s += `, at ${spokenTime(d.timestamp)}.`;
  if (!parts.length) s += " The location of that reader has not been configured.";
  return s;
}

async function handleVoiceQuery(text, doSpeak = true) {
  setTranscript(`<b>“${esc(text)}”</b>`);
  const q = extractQuery(text);
  if (!q) {
    const s = "I did not catch an object name. Please try again.";
    showAnswer(`<b>${esc(s)}</b>`);
    if (doSpeak) speak(s);
    return;
  }
  showAnswer(loadingBox("Searching…"));
  $("#voiceMapWrap")?.classList.add("hidden");

  let matches;
  try {
    matches = await voiceSearch(q);
  } catch (e) {
    showAnswer(errBox(e.message));
    return;
  }

  if (matches.length === 0) {
    const s = `I could not find a registered object matching ${q}.`;
    showAnswer(`<b>🏷️ Object not found</b><small>${esc(s)}</small>`);
    if (doSpeak) speak(s);
  } else if (matches.length > 1) {
    const names = matches.map(m => m.object.name).join(", ");
    showAnswer(chooserHtml(matches));
    bindPicks($("#answer"), async uid => {
      try { await showVoiceResult(await fetchObject(uid), true); } catch (e) { showAnswer(errBox(e.message)); }
    });
    if (doSpeak) speak(`I found several matching objects: ${names}. Please select one.`);
  } else {
    await showVoiceResult(fromEntry(matches[0]), doSpeak);
  }
}

async function showVoiceResult(o, doSpeak) {
  voiceUid = o.id;
  const d = o.detection, l = o.location, c = d ? coordsOf(l) : null;
  const sentence = buildSentence(o);

  let h = `<b>${o.icon} ${esc(o.name)}</b><small>NFC UID: ${esc(o.id)}</small>`;
  if (!d) {
    h += `<small>Not detected yet.</small>`;
  } else {
    h += `<small>Last detected: ${esc(fmtTime(d.timestamp))} • Reader ${esc(d.reader_id)}</small>`;
    h += l
      ? `<small>Location: ${esc(locParts(l).join(" • ") || "Details incomplete")}</small>`
      : `<small>Location not configured for reader ${esc(d.reader_id)}.</small>`;
    h += c ? `<small>Latitude ${c[0]}, Longitude ${c[1]} • ${osmLink(c)}</small>`
           : `<small>GPS coordinates not configured.</small>`;
  }
  h += `<small class="spoken">“${esc(sentence)}”</small>`;
  showAnswer(h);
  updateVoiceMap(o);
  if (doSpeak) speak(sentence);
}

function updateVoiceMap(o) {
  const wrap = $("#voiceMapWrap"), div = $("#voiceMap");
  if (!wrap || !div) return;
  wrap.classList.remove("hidden");
  const d = o.detection, c = d ? coordsOf(o.location) : null;
  if (!c) {
    div.style.display = "none";
    const known = locParts(o.location).join(" • ");
    setText("voiceMapNote", !d
      ? "Not detected yet, so there is no location to map."
      : `${known ? `Known location: ${known}. ` : ""}Geographic coordinates are unavailable.`);
    return;
  }
  div.style.display = "block";
  plotObject("voiceMap", o);
  maps.voiceMap?.invalidateSize();
  setText("voiceMapNote", "Marker = the reader's configured location, not necessarily the object's exact position.");
}

function listen() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) {
    toast("Speech recognition is not supported in this browser. Use the text box.", true);
    $("#voiceText")?.focus();
    return;
  }
  if (recognizing) { activeRec?.stop(); return; }   // prevents overlapping sessions

  const rec = new R();
  activeRec = rec;
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let handled = false;

  rec.onstart = () => {
    recognizing = true;
    $("#mic")?.classList.add("listening");
    setTranscript("🎙 Listening… (tap the microphone again to stop)");
  };
  rec.onresult = e => {
    handled = true;
    const text = (e.results[0][0].transcript || "").trim();
    if (!text) { setTranscript("I did not hear anything. Please try again."); return; }
    handleVoiceQuery(text, true);
  };
  rec.onerror = e => {
    handled = true;
    const m = {
      "not-allowed": "Microphone access was denied. Allow it in the browser's site settings.",
      "service-not-allowed": "Microphone access was denied. Allow it in the browser's site settings.",
      "no-speech": "No speech was detected. Please try again.",
      "audio-capture": "No microphone was found.",
      "network": "Speech recognition needs a network connection.",
      "aborted": "Listening was stopped.",
    }[e.error] || "Speech recognition failed. Please try again or use the text box.";
    setTranscript(esc(m));
    toast(m, true);
  };
  rec.onend = () => {
    recognizing = false;
    activeRec = null;
    $("#mic")?.classList.remove("listening");
    if (!handled) setTranscript("Tap the microphone and try again.");
  };
  try { rec.start(); } catch (e) { recognizing = false; toast("Could not start listening", true); }
}

// ---------------- EVENT BINDING ----------------
function bind() {
  $("#addObjectBtn") && ($("#addObjectBtn").onclick = showAddObjectForm);

  const scan = $("#scan");
  if (scan) scan.onclick = async () => { await refreshObjects(true); render(); toast("Detections refreshed"); };

  document.querySelectorAll("[data-object]").forEach(b => {
    b.onclick = () => {
      const o = objects.find(x => x.id === b.dataset.object);
      if (!o) return;
      findUid = o.id;
      findTerm = o.name;
      if (currentPage === "find") {
        const s = $("#search");
        if (s) s.value = o.name;
        showFind(o.id);
      } else {
        nav("find");
      }
    };
  });

  const search = $("#search");
  if (search) {
    search.addEventListener("input", () => { findTerm = search.value; });
    search.addEventListener("keydown", e => { if (e.key === "Enter") performLookup(search.value); });
  }
  const lookup = $("#lookupNFC");
  if (lookup) lookup.onclick = () => performLookup($("#search")?.value || "");

  const route = $("#route");
  if (route) route.onclick = () => {
    if (findCoords) window.open(osmUrl(findCoords), "_blank", "noopener");
    else toast("GPS coordinates are not configured for this object's reader", true);
  };

  const tag = $("#historyTag");
  if (tag) tag.onchange = () => loadHistory(tag.value);

  const mic = $("#mic");
  if (mic) mic.onclick = listen;
  const ask = $("#voiceAsk"), vt = $("#voiceText");
  if (ask && vt) {
    const go = () => { const t = vt.value.trim(); if (t) handleVoiceQuery(t, true); else toast("Type a question first", true); };
    ask.onclick = go;
    vt.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  }
  const demo = $("#demoVoice");
  if (demo) demo.onclick = () => handleVoiceQuery("Where are my keys?", true);

  const form = $("#readerForm");
  if (form) {
    form.onsubmit = submitReaderForm;
    $("#fReset").onclick = resetReaderForm;
  }
}

// ---------------- AUTOMATIC REFRESH ----------------
async function refreshCurrentPage() {
  switch (currentPage) {
    case "find": if (findUid) await showFind(findUid); break;
    case "voice":
      if (voiceUid) {
        try { await showVoiceResult(await fetchObject(voiceUid), false); } catch { /* ignore */ }
      }
      break;
    case "locations": await loadLocationsPageData(); break;
    case "history": await loadInitialHistory(); break;
    default: render();
  }
}

async function poll() {
  if (polling || document.hidden) return;   // never overlap requests
  polling = true;
  try {
    const d = await api("/detections/latest-id");
    const id = d.latest_detection_id;
    const changed = lastDetId !== null && id !== lastDetId;
    if (needsReload || changed) {
      needsReload = false;
      await refreshObjects(false);
      await refreshCurrentPage();
    }
    lastDetId = id;
  } catch { /* offline state already shown */ }
  finally { polling = false; }
}

// ---------------- INIT ----------------
async function initializeApp() {
  await refreshObjects(false);
  try {
    lastDetId = (await api("/detections/latest-id")).latest_detection_id;
  } catch { lastDetId = null; }
  render();
  setInterval(poll, POLL_MS);
}

initializeApp();