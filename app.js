import { firebaseConfig } from "./firebase-config.js";

const DAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
const SLOTS = ["buiten1", "buiten2", "binnen1", "binnen2"];
const LAT = 50.9542, LON = 5.8736; // Puth, Limburg (gecontroleerd via Open-Meteo geocoding)
const FIREBASE_VERSION = "12.19.0";
const SAVE_DELAY = 500;

const statusEl = document.getElementById("status");
const notesArea = document.getElementById("notesArea");
const app = document.getElementById("app");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

/* ── Datums ─────────────────────────────────────────────────────────────── */

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekDocId(monday) { return `week-${fmtISO(monday)}`; }
function fmtDayDate(d) { return d.toLocaleDateString("nl-NL", { day: "numeric", month: "numeric" }); }
function fmtRange(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const start = monday.toLocaleDateString("nl-NL", sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" });
  return `${start} – ${sunday.toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}`;
}

/* ── Opslag: Firestore (gedeeld) of localStorage (demo, alleen dit apparaat) ── */

function isConfigured(cfg) {
  return !!(cfg && cfg.projectId);
}

async function createFirestoreStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const fbApp = initializeApp(cfg);
  let db;
  try {
    // Offline-cache: de pagina laadt ook bij slecht bereik in de stal, wijzigingen gaan later mee.
    db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(fbApp);
  }
  return {
    shared: true,
    watch(id, cb, onError) {
      return fs.onSnapshot(fs.doc(db, "planning", id), snap => cb(snap.exists() ? snap.data() : {}), onError);
    },
    merge(id, patch) {
      return fs.setDoc(fs.doc(db, "planning", id), patch, { merge: true });
    }
  };
}

function createLocalStore() {
  const PREFIX = "windrakerhof:";
  const listeners = {};
  const read = id => { try { return JSON.parse(localStorage.getItem(PREFIX + id)) || {}; } catch (e) { return {}; } };
  const deepMerge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v;
    }
    return out;
  };
  const emit = id => (listeners[id] || []).forEach(cb => cb(read(id)));
  window.addEventListener("storage", e => { if (e.key && e.key.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length)); });
  return {
    shared: false,
    watch(id, cb) {
      (listeners[id] = listeners[id] || []).push(cb);
      cb(read(id));
      return () => { listeners[id] = listeners[id].filter(x => x !== cb); };
    },
    async merge(id, patch) {
      try { localStorage.setItem(PREFIX + id, JSON.stringify(deepMerge(read(id), patch))); } catch (e) { throw e; }
      emit(id);
    }
  };
}

/* ── Weer (Open-Meteo, geen sleutel nodig) ────────────────────────────── */

let weatherByDate = {};

function weatherCategory(code) {
  if ([0, 1].includes(code)) return { icon: "☀️", label: "Zon" };
  if ([2, 3, 45, 48].includes(code)) return { icon: "⛅", label: "Bewolkt" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: "❄️", label: "Sneeuw" };
  if ([95, 96, 99].includes(code)) return { icon: "⛈️", label: "Onweer" };
  return { icon: "🌧️", label: "Bui" }; // regen, motregen, buien
}

async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&daily=weather_code,temperature_2m_mean,temperature_2m_max,temperature_2m_min` +
      `&timezone=Europe%2FAmsterdam&past_days=7&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) return;
    const d = (await res.json()).daily;
    if (!d) return;
    const next = {};
    d.time.forEach((iso, i) => {
      const mean = d.temperature_2m_mean[i] ?? (d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2;
      if (d.weather_code[i] == null || mean == null || Number.isNaN(mean)) return;
      next[iso] = { code: d.weather_code[i], avg: Math.round(mean) };
    });
    weatherByDate = next;
    updateWeather();
  } catch (e) {
    // Geen weerbericht beschikbaar: het schema werkt gewoon door.
  }
}

function updateWeather() {
  document.querySelectorAll(".weather[data-date]").forEach(el => {
    const w = weatherByDate[el.dataset.date];
    el.replaceChildren();
    if (!w) { el.textContent = "–"; el.title = "Nog geen weerbericht voor deze dag"; return; }
    const cat = weatherCategory(w.code);
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = cat.icon;
    icon.setAttribute("aria-hidden", "true");
    el.append(icon, `${cat.label}, ${w.avg}°C`);
    el.title = `${cat.label}, gemiddeld ${w.avg}°C`;
  });
  renderBoard();
}

/* ── Staat ────────────────────────────────────────────────────────────── */

let store;
let weeks = [];          // [{title, css, monday, id}]
let weekData = {};       // id -> {Maandag: {buiten1: "..."}}
let vastData = {};       // {Maandag: {buiten1: {naam, vast}}}
let fields = [];         // {weekId, day, slot, input, toggle, cb, pending}
let unsubscribers = [];
let renderedMonday = null;
let savingCount = 0;

function vastOf(day, slot) {
  const v = vastData[day] && vastData[day][slot];
  return { naam: (v && typeof v.naam === "string") ? v.naam : "", vast: !!(v && v.vast) };
}
function stored(weekId, day, slot) {
  const w = weekData[weekId];
  return (w && w[day] && typeof w[day][slot] === "string") ? w[day][slot] : "";
}
// Een vaste naam gaat altijd voor (zoals in het prototype); anders geldt wat er voor die week is ingevuld.
function displayed(weekId, day, slot) {
  const v = vastOf(day, slot);
  return v.vast ? v.naam : stored(weekId, day, slot);
}

async function save(docId, patch) {
  savingCount++;
  setStatus(navigator.onLine ? "Opslaan…" : "Offline — wordt opgeslagen zodra je weer verbinding hebt");
  try {
    await store.merge(docId, patch);
    savingCount--;
    if (savingCount === 0) setStatus(store.shared ? "Opgeslagen ✓ (zichtbaar voor iedereen)" : "Opgeslagen op dit apparaat ✓");
  } catch (e) {
    savingCount--;
    console.error(e);
    setStatus("Opslaan mislukt — controleer je internetverbinding en probeer opnieuw", true);
  }
}

const timers = {};
function debounce(key, fn) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { delete timers[key]; fn(); }, SAVE_DELAY);
}

/* ── Weergave ─────────────────────────────────────────────────────────── */

function buildWeeks() {
  const monday = getMonday(new Date());
  renderedMonday = fmtISO(monday);
  const next = addDays(monday, 7);
  weeks = [
    { title: "Deze week (actueel)", css: "current", monday, id: weekDocId(monday) },
    { title: "Volgende week", css: "next", monday: next, id: weekDocId(next) }
  ];
  fields = [];
  // Op zaterdag en zondag is "deze week" bijna voorbij: laat het bord dan standaard volgende week zien.
  const weekday = new Date().getDay();
  boardIndex = (weekday === 6 || weekday === 0) ? 1 : 0;
  app.replaceChildren(...weeks.map(renderBlock));
  refreshAll();
  updateWeather();
}

function renderBlock(week) {
  const block = document.createElement("section");
  block.className = "schema-block";
  block.dataset.week = week.id;

  const header = document.createElement("div");
  header.className = `schema-header ${week.css}`;
  const label = document.createElement("h2");
  label.className = "label";
  label.style.margin = "0";
  label.textContent = week.title;
  const range = document.createElement("span");
  range.className = "range";
  range.textContent = fmtRange(week.monday);
  const summary = document.createElement("span");
  summary.className = "summary";
  header.append(label, range, summary);
  block.appendChild(header);

  const todayISO = fmtISO(new Date());
  DAYS.forEach((day, idx) => {
    const date = addDays(week.monday, idx);
    const row = document.createElement("div");
    row.className = "day-row";
    row.dataset.day = day;
    row.id = `dag-${week.id}-${day}`;
    if (fmtISO(date) === todayISO) row.classList.add("today");

    const top = document.createElement("div");
    top.className = "day-top";
    const title = document.createElement("div");
    title.className = "day-title";
    const dayName = document.createElement("span");
    dayName.className = "day-name";
    dayName.textContent = `${day} ${fmtDayDate(date)}`;
    title.appendChild(dayName);
    if (row.classList.contains("today")) {
      const tag = document.createElement("span");
      tag.className = "today-tag";
      tag.textContent = "vandaag";
      title.appendChild(tag);
    }
    const badge = document.createElement("span");
    badge.className = "day-badge";
    title.appendChild(badge);
    const weather = document.createElement("div");
    weather.className = "weather";
    weather.dataset.date = fmtISO(date);
    weather.textContent = "–";
    top.append(title, weather);
    row.appendChild(top);

    ["buiten", "binnen"].forEach(group => {
      const groupRow = document.createElement("div");
      groupRow.className = "group-row";
      const gl = document.createElement("div");
      gl.className = "group-label";
      gl.textContent = group === "buiten" ? "Buiten" : "Binnen";
      const persons = document.createElement("div");
      persons.className = "persons";
      persons.appendChild(renderField(week, day, `${group}Tijd`, `${gl.textContent} zetten, ${day} ${fmtDayDate(date)}, tijd`, "time"));
      [1, 2].forEach(n => persons.appendChild(renderField(week, day, `${group}${n}`, `${gl.textContent} zetten, ${day} ${fmtDayDate(date)}, persoon ${n}`)));
      groupRow.append(gl, persons);
      row.appendChild(groupRow);
    });
    block.appendChild(row);
  });
  return block;
}

// kind "name": invulveld voor een naam (telt mee als open plek); kind "time": buiten-/binnenzettijd (optioneel).
function renderField(week, day, slot, aria, kind = "name") {
  const personRow = document.createElement("div");
  personRow.className = kind === "time" ? "person-row time-row" : "person-row";

  const input = document.createElement("input");
  input.setAttribute("aria-label", aria);
  if (kind === "time") {
    input.type = "time";
    input.step = 300; // stappen van 5 minuten in de tijdkiezer
    const icon = document.createElement("span");
    icon.className = "time-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🕗";
    personRow.appendChild(icon);
  } else {
    input.type = "text";
    input.placeholder = "naam";
    input.maxLength = 40;
    input.autocomplete = "off";
  }

  const toggle = document.createElement("label");
  toggle.className = "vast-toggle";
  toggle.title = kind === "time" ? "Deze tijd elke week automatisch terug laten komen" : "Elke week automatisch terug laten komen";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  toggle.append(cb, "vast");
  personRow.append(input, toggle);

  const field = { weekId: week.id, day, slot, input, toggle, cb };
  fields.push(field);
  const key = `${week.id}|${day}|${slot}`;

  const onEdit = () => {
    field.pending = true;
    updateEmptyState();
    const value = input.value.trim() ? input.value : "";
    debounce(key, () => {
      field.pending = false;
      const writes = [save(week.id, { [day]: { [slot]: value } })];
      if (vastOf(day, slot).vast) writes.push(save("vast", { [day]: { [slot]: { naam: value, vast: true } } }));
      return Promise.all(writes);
    });
  };
  input.addEventListener("input", onEdit);
  if (kind === "time") input.addEventListener("change", onEdit); // iOS meldt een gekozen tijd pas bij "change"
  input.addEventListener("blur", () => { if (!timers[key]) { field.pending = false; refreshAll(); } });

  cb.addEventListener("change", () => {
    // Eerst alles uitrekenen: elke opslag kan meteen een verversing van het scherm veroorzaken.
    const checked = cb.checked;
    const naam = input.value.trim() ? input.value : "";
    // Zet de naam ook in beide zichtbare weken, zodat hij daar blijft staan (ook na uitvinken).
    const perWeek = weeks.map(w => [w.id, checked ? naam : displayed(w.id, day, slot)]);
    vastData = { ...vastData, [day]: { ...(vastData[day] || {}), [slot]: { naam, vast: checked } } };
    save("vast", { [day]: { [slot]: { naam, vast: checked } } });
    perWeek.forEach(([id, value]) => save(id, { [day]: { [slot]: value } }));
    refreshAll();
  });

  return personRow;
}

/* ── Bord: in één oogopslag wie welke dag buiten en binnen zet ────────── */

const boardWeeksEl = document.getElementById("boardWeeks");
let boardIndex = 0; // welke week het bord op de telefoon toont (op een breed scherm staan ze naast elkaar)

function setupBoard() {
  document.querySelectorAll(".board-switch [data-board]").forEach(btn => {
    btn.addEventListener("click", () => { boardIndex = Number(btn.dataset.board); renderBoard(); });
  });
}

function boardCell(weekId, day, group) {
  const td = document.createElement("td");
  const time = displayed(weekId, day, `${group}Tijd`);
  if (time) {
    const t = document.createElement("span");
    t.className = "b-time";
    t.textContent = time;
    td.appendChild(t);
  }
  const names = [1, 2].map(n => displayed(weekId, day, `${group}${n}`).trim());
  if (!names[0] && !names[1]) {
    const open = document.createElement("span");
    open.className = "b-open";
    open.textContent = "nog niemand";
    td.appendChild(open);
    return td;
  }
  names.forEach(name => {
    const el = document.createElement("span");
    el.className = name ? "b-name" : "b-open";
    el.textContent = name || "+ 1 open";
    td.appendChild(el);
  });
  return td;
}

function renderBoard() {
  if (!weeks.length) return;
  const todayISO = fmtISO(new Date());
  document.querySelectorAll(".board-switch [data-board]").forEach(btn => {
    const active = Number(btn.dataset.board) === boardIndex;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  boardWeeksEl.replaceChildren(...weeks.map((week, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "board-week" + (idx === boardIndex ? " active" : "");
    const title = document.createElement("div");
    title.className = `board-week-title ${week.css}`;
    title.textContent = `${idx === 0 ? "Deze week" : "Volgende week"} · ${fmtRange(week.monday)}`;

    const table = document.createElement("table");
    table.className = "board-table";
    const head = table.createTHead().insertRow();
    ["Dag", "Buiten", "Binnen"].forEach((label, i) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      if (i) th.className = i === 1 ? "col-buiten" : "col-binnen";
      head.appendChild(th);
    });
    const body = table.createTBody();

    DAYS.forEach((day, i) => {
      const date = addDays(week.monday, i);
      const iso = fmtISO(date);
      const tr = body.insertRow();
      if (iso === todayISO) tr.classList.add("today");
      else if (iso < todayISO) tr.classList.add("past");

      const th = document.createElement("th");
      th.scope = "row";
      const name = document.createElement("span");
      name.className = "b-day";
      name.textContent = `${day.slice(0, 2)} ${fmtDayDate(date)}`;
      th.appendChild(name);
      if (iso === todayISO) {
        const tag = document.createElement("span");
        tag.className = "b-today";
        tag.textContent = "vandaag";
        th.appendChild(tag);
      }
      const w = weatherByDate[iso];
      if (w) {
        const wx = document.createElement("span");
        wx.className = "b-weather";
        const cat = weatherCategory(w.code);
        wx.textContent = `${cat.icon} ${w.avg}°`;
        wx.title = `${cat.label}, gemiddeld ${w.avg}°C`;
        th.appendChild(wx);
      }
      tr.append(th, boardCell(week.id, day, "buiten"), boardCell(week.id, day, "binnen"));

      // Tik op een dag: spring naar die dag in het invulgedeelte.
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", `${day} ${fmtDayDate(date)} invullen`);
      const jump = () => {
        const target = document.getElementById(`dag-${week.id}-${day}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      tr.addEventListener("click", jump);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") jump(); });
    });

    wrap.append(title, table);
    return wrap;
  }));
}

function refreshAll() {
  fields.forEach(f => {
    const v = vastOf(f.day, f.slot);
    if (!f.pending && document.activeElement !== f.input) f.input.value = displayed(f.weekId, f.day, f.slot);
    f.cb.checked = v.vast;
    f.toggle.classList.toggle("active", v.vast);
    f.input.classList.toggle("is-vast", v.vast);
  });
  updateEmptyState();
  renderBoard();
}

function updateEmptyState() {
  // Alleen namen tellen als open plek; een tijd is optioneel.
  fields.forEach(f => { if (f.input.type === "text") f.input.classList.toggle("empty", !f.input.value.trim()); });
  document.querySelectorAll(".schema-block").forEach(block => {
    let openTotal = 0;
    block.querySelectorAll(".day-row").forEach(row => {
      const open = row.querySelectorAll("input[type=text].empty").length;
      openTotal += open;
      row.classList.toggle("incomplete", open > 0);
      row.classList.toggle("complete", open === 0);
      const badge = row.querySelector(".day-badge");
      badge.className = `day-badge ${open ? "open" : "done"}`;
      badge.textContent = open ? `nog ${open} open` : "✓ compleet";
    });
    block.querySelector(".summary").textContent =
      openTotal ? `Nog ${openTotal} ${openTotal === 1 ? "plek" : "plekken"} open` : "Alles ingevuld ✓";
  });
}

/* ── Live koppeling ───────────────────────────────────────────────────── */

function subscribe() {
  unsubscribers.forEach(u => u && u());
  const onError = e => { console.error(e); setStatus("Geen verbinding met de gedeelde database — probeer de pagina te verversen", true); };
  unsubscribers = [
    store.watch("vast", data => { vastData = data || {}; refreshAll(); }, onError),
    ...weeks.map(w => store.watch(w.id, data => { weekData[w.id] = data || {}; refreshAll(); }, onError))
  ];
}

let notesPending = false;
function setupNotes() {
  store.watch("notities", data => {
    if (!notesPending && document.activeElement !== notesArea) notesArea.value = (data && data.text) || "";
  });
  notesArea.addEventListener("input", () => {
    notesPending = true;
    debounce("notities", async () => { await save("notities", { text: notesArea.value }); notesPending = false; });
  });
  notesArea.addEventListener("blur", () => { if (!timers.notities) notesPending = false; });
}

// Nieuwe week begonnen terwijl de pagina openstaat? Dan schuift alles automatisch door.
function checkRollover() {
  if (fmtISO(getMonday(new Date())) !== renderedMonday) {
    buildWeeks();
    subscribe();
    loadWeather();
  }
}

/* ── App op de telefoon ────────────────────────────────────────────────── */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(e => console.warn("Service worker niet geregistreerd", e));
}

// Installeerbalk: alleen in een gewone browsertab op een telefoon (of als de browser zelf installeren aanbiedt).
function setupInstallBanner() {
  const banner = document.getElementById("installBanner");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (!banner || standalone) return;

  const DISMISS_KEY = "windrakerhof:install-niet-tot";
  let hiddenUntil = 0;
  try { hiddenUntil = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch (e) { /* opslag geblokkeerd */ }
  if (Date.now() < hiddenUntil) return;

  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const text = document.getElementById("installInstructions");
  const button = document.getElementById("installButton");
  const hide = () => { banner.hidden = true; };

  document.getElementById("installDismiss").addEventListener("click", () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000)); } catch (e) { /* opslag geblokkeerd */ }
    hide();
  });
  window.addEventListener("appinstalled", hide);

  if (isIOS) {
    text.textContent = "Tik onderin op Delen (vierkantje met pijl) en kies ‘Zet op beginscherm’.";
    banner.hidden = false;
  } else if (isAndroid) {
    text.textContent = "Tik in Chrome op ⋮ en kies ‘App installeren’ of ‘Toevoegen aan startscherm’.";
    banner.hidden = false;
  }

  // Chrome en Edge bieden zelf een installeerknop aan.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    text.textContent = "Met één tik op je beginscherm, ook bij slecht bereik in de stal.";
    button.hidden = false;
    button.onclick = () => {
      e.prompt();
      e.userChoice.then(choice => { if (choice && choice.outcome === "accepted") hide(); }).catch(() => {});
    };
    banner.hidden = false;
  });
}

async function init() {
  registerServiceWorker();
  setupInstallBanner();
  try {
    store = isConfigured(firebaseConfig) ? await createFirestoreStore(firebaseConfig) : createLocalStore();
  } catch (e) {
    console.error(e);
    setStatus("De gedeelde database kon niet geladen worden — controleer je internetverbinding", true);
    return;
  }
  if (!store.shared) document.getElementById("demoBanner").hidden = false;

  setupBoard();
  buildWeeks();
  setupNotes();
  subscribe();
  loadWeather();
  setStatus(store.shared ? "Live verbonden ✓ — wijzigingen zijn direct zichtbaar voor iedereen" : "Klaar (alleen op dit apparaat)");

  setInterval(checkRollover, 60 * 1000);
  setInterval(loadWeather, 3 * 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkRollover(); } });
  window.addEventListener("online", () => setStatus("Weer online ✓"));
  window.addEventListener("offline", () => setStatus("Offline — wijzigingen worden verstuurd zodra je weer verbinding hebt"));
}

init();
