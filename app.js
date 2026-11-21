const DB_NAME = "kids-lifts";
const DB_VERSION = 1;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let PLAN = null;
let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("logs")) d.createObjectStore("logs", { keyPath: "id" });
      if (!d.objectStoreNames.contains("ten")) d.createObjectStore("ten", { keyPath: "id" });
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txGet(store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly").objectStore(store).get(key);
    t.onsuccess = () => resolve(t.result || null);
    t.onerror = () => reject(t.error);
  });
}
function txPut(store, value) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite").objectStore(store).put(value);
    t.onsuccess = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function todayName() {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
}

function currentWeekDefault() {
  // No start date required: parent picks the week. Default to week 1 until logs exist.
  return 1;
}

function sessionById(id) {
  for (const week of PLAN.weeks) {
    for (const session of week.sessions) {
      if (session.id === id) return { week, session };
    }
  }
  return null;
}

function showView(name) {
  $$(".view").forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$(".tab").forEach((t) => {
    const on = t.dataset.view === name || (name === "session" && t.dataset.view === "plan");
    t.classList.toggle("is-on", t.dataset.view === name || (name === "session" && t.dataset.view === "today"));
    t.setAttribute("aria-selected", t.classList.contains("is-on") ? "true" : "false");
  });
}


function howButton(exerciseId) {
  return `<button type="button" class="btn ghost how-btn" data-how="${escapeHtml(exerciseId)}" data-testid="how-button">How?</button>`;
}

function openHow(exerciseId) {
  const ex = PLAN.exercises[exerciseId];
  if (!ex) return;
  $("#how-title").textContent = ex.name;
  const img = $("#how-image");
  const src = ex.illustration || `exercises/${exerciseId}.svg`;
  img.src = src;
  img.alt = `Start and finish picture for ${ex.name}`;
  const cues = $("#how-cues");
  cues.innerHTML = (ex.cues || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
  const link = $("#how-video");
  if (ex.videoUrl) {
    link.href = ex.videoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = false;
    const label = ex.videoTitle ? `Watch how — ${ex.videoTitle}` : "Watch how";
    link.textContent = ex.videoSource ? `${label} (${ex.videoSource})` : label;
  } else {
    link.hidden = true;
    link.removeAttribute("href");
  }
  const dialog = $("#how-guide");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeHow() {
  const dialog = $("#how-guide");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

const MAILTO_MAX = 1800;
let currentSessionId = null;

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitizeKlt(s) {
  return String(s || "").replace(/[\r\n|]+/g, " ").trim();
}

function compactReps(reps) {
  return String(reps || "")
    .trim()
    .toLowerCase()
    .replace(/seconds?/g, "s")
    .replace(/\beach\s+leg\b/g, "/leg")
    .replace(/\beach\s+side\b/g, "/side")
    .replace(/\s+each\b/g, "/side")
    .replace(/\s+slow\s+reps\b/g, "")
    .replace(/\s+reps\b/g, "")
    .replace(/\s+/g, "") || "-";
}

function targetLoad(item, ex) {
  const eid = item.exerciseId || "";
  const name = (ex && ex.name) || "";
  const blob = `${eid} ${name} ${item.load || ""}`.toLowerCase();
  if (eid.includes("2lb") || name.toLowerCase().includes("2 lb") || blob.includes("2-lb")) return "2lb";
  if (eid.includes("band") || name.toLowerCase().includes("band")) return "band";
  return "bw";
}

function isHold(item) {
  return Boolean(item.holdSec) || /second/i.test(String(item.reps || ""));
}

function formatPerformed(item, recs) {
  const n = item.sets || 0;
  const hold = isHold(item);
  const weight = targetLoad(item, PLAN.exercises[item.exerciseId] || {});
  const tokens = [];
  for (let i = 1; i <= n; i++) {
    const rec = (recs && recs[i]) || {};
    if (rec.reps === undefined || rec.reps === null || String(rec.reps).trim() === "") {
      tokens.push("-");
      continue;
    }
    const val = String(rec.reps).trim();
    if (hold) {
      const num = val.replace(/[^0-9.]+/g, "") || val;
      tokens.push(num && !String(num).endsWith("s") ? `${num}s` : (num || "-"));
    } else if (/^\d+lb$/.test(weight)) {
      tokens.push(`${weight.replace(/lb$/, "")}x${val}`);
    } else {
      tokens.push(val);
    }
  }
  return tokens.join(" ") || "-";
}

function sessionType(session) {
  const blob = `${session.focus || ""} ${session.title || ""} ${session.day || ""}`.toLowerCase();
  if (blob.includes("lower")) return "Lower";
  if (blob.includes("upper")) return "Upper";
  if (blob.includes("full")) return "Full";
  if (session.day === "Monday") return "Lower";
  if (session.day === "Friday") return "Upper";
  return "Full";
}

function sessionDayIndex(week, session) {
  const i = week.sessions.findIndex((s) => s.id === session.id);
  return i >= 0 ? i + 1 : 1;
}

function buildKltBody(greeting, header, eLines, notes, part, includeNotes) {
  const lines = [];
  const greet = sanitizeKlt(greeting);
  if (greet) lines.push(greet);
  if (part && part[1] > 1) lines.push(`part ${part[0]} of ${part[1]}`);
  lines.push(header);
  lines.push(...eLines);
  if (includeNotes) lines.push(`N Notes: ${sanitizeKlt(notes) || "-"}`);
  lines.push("END");
  return lines.join("\n");
}

function mailtoUrl(email, subject, body) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function packMailtos(email, baseSubject, greeting, header, eLines, notes, maxUrl = MAILTO_MAX) {
  const subjectFor = (part, total) => {
    const sub = baseSubject.replace(/ part \d+ of \d+/g, "").trim();
    return total > 1 ? `${sub} part ${part} of ${total}` : sub;
  };
  const measure = (elines, note, includeNotes, part = 99, total = 99) => {
    const body = buildKltBody(greeting, header, elines, note, total > 1 ? [part, total] : null, includeNotes);
    return mailtoUrl(email, subjectFor(part, total), body).length;
  };
  const longestNotePrefix = (elines, text) => {
    if (measure(elines, text, true) <= maxUrl) return text;
    let lo = 0, hi = text.length, best = "";
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const chunk = text.slice(0, mid);
      if (chunk && measure(elines, chunk, true) <= maxUrl) {
        best = chunk;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  };

  if (measure(eLines, notes, true, 1, 1) <= maxUrl) {
    const body = buildKltBody(greeting, header, eLines, notes, null, true);
    const href = mailtoUrl(email, baseSubject, body);
    return [{ subject: baseSubject, body, href, part: 1, parts: 1 }];
  }

  const buckets = [];
  let current = [];
  for (const line of eLines) {
    const trial = current.concat([line]);
    if (current.length && measure(trial, "-", false) > maxUrl) {
      buckets.push(current);
      current = [line];
    } else {
      current = trial;
    }
  }
  if (current.length || !buckets.length) buckets.push(current);

  let remaining = (notes || "-").trim() || "-";
  const noteParts = [];
  const first = longestNotePrefix(buckets[buckets.length - 1], remaining);
  noteParts.push(first);
  remaining = remaining.slice(first.length);
  while (remaining) {
    const chunk = longestNotePrefix([], remaining);
    if (!chunk) {
      noteParts.push(remaining);
      break;
    }
    noteParts.push(chunk);
    remaining = remaining.slice(chunk.length);
  }

  const assembled = buckets.map((bucket, i) => (
    i === buckets.length - 1
      ? [bucket, noteParts[0], Boolean(noteParts[0])]
      : [bucket, "-", false]
  ));
  for (const extra of noteParts.slice(1)) assembled.push([[], extra, true]);

  const total = assembled.length;
  return assembled.map(([bucket, note, include], idx) => {
    const part = idx + 1;
    const body = buildKltBody(greeting, header, bucket, note, total > 1 ? [part, total] : null, include);
    const subject = subjectFor(part, total);
    const href = mailtoUrl(email, subject, body);
    return { subject, body, href, part, parts: total, oversize: href.length > maxUrl };
  });
}

function readCoachMeta(root = document) {
  const dateEl = root.querySelector('[data-log="date"]');
  const finEl = root.querySelector('[data-log="fin"]');
  const feelEl = root.querySelector('[data-log="feel"]');
  const hurtEl = root.querySelector('[data-log="hurt"]');
  const notesEl = root.querySelector('[data-log="notes"]');
  return {
    date: (dateEl && dateEl.value) || isoDate(),
    fin: !!(finEl && finEl.checked),
    feel: (feelEl && feelEl.value) || "-",
    hurt: !!(hurtEl && hurtEl.checked),
    notes: (notesEl && notesEl.value) || "",
  };
}

function kltFromSession(week, session, saved) {
  const kid = PLAN.kidId || "tyler";
  const typ = sessionType(session);
  const d = sessionDayIndex(week, session);
  const date = saved.date || isoDate();
  const feel = saved.feel || "-";
  const fin = saved.fin ? 1 : 0;
  const hurt = saved.hurt ? 1 : 0;
  const header = `KLT1 kid=${kid} w=${week.week} d=${d} type=${typ} date=${date} fin=${fin} feel=${feel} hurt=${hurt}`;
  const eLines = session.exercises.map((item, i) => {
    const ex = PLAN.exercises[item.exerciseId];
    const recs = (saved.sets || {})[item.exerciseId] || {};
    const note = ((saved.exerciseNotes || {})[item.exerciseId]) || "";
    return `E${i} ${sanitizeKlt(ex.name)} | ${item.sets}x${compactReps(item.reps)} @${targetLoad(item, ex)} | ${formatPerformed(item, recs)} | note: ${sanitizeKlt(note) || "-"}`;
  });
  const greeting = `Hi ${PLAN.coachName} — ${PLAN.kidName} logged week ${week.week} day ${d} (${typ}).`;
  const subject = `KLT ${kid} W${week.week}D${d} ${date}`;
  const notes = saved.notes || "-";
  const parts = packMailtos(PLAN.coachEmail, subject, greeting, header, eLines, notes);
  const fullBody = buildKltBody(greeting, header, eLines, notes, null, true);
  return { subject, parts, fullBody };
}

function kltFromTen(saved, ten) {
  const kid = PLAN.kidId || "tyler";
  const date = saved.date || isoDate();
  const feel = saved.feel || "-";
  const hurt = saved.hurt ? 1 : 0;
  const total = ten.checklist.length;
  const done = ten.checklist.filter((item) => saved.checks && saved.checks[item.exerciseId]).length;
  const header = `KLT1 kid=${kid} ten=1 date=${date} done=${done}/${total} feel=${feel} hurt=${hurt}`;
  const greeting = `Hi ${PLAN.coachName} — ${PLAN.kidName} logged Tyler's Ten.`;
  const subject = `KLT ${kid} TEN ${date}`;
  const notes = saved.notes || "-";
  const parts = packMailtos(PLAN.coachEmail, subject, greeting, header, [], notes);
  const fullBody = buildKltBody(greeting, header, [], notes, null, true);
  return { subject, parts, fullBody };
}

function coachActionsHtml(klt, testid) {
  const links = klt.parts.map((p, i) => {
    const label = klt.parts.length > 1 ? `Send to coach (${p.part} of ${p.parts})` : "Send to coach";
    const cls = i === 0 ? "btn primary" : "btn ghost";
    const attrs = i === 0
      ? ` id="send-to-coach" data-testid="${testid}"`
      : ` data-testid="${testid}-part-${p.part}"`;
    return `<a class="${cls}"${attrs} href="${escapeHtml(p.href)}">${escapeHtml(label)}</a>`;
  }).join("");
  return `<div class="coach-actions">${links}
    <button type="button" class="btn ghost" data-testid="copy-for-coach" data-copy-coach>Copy for coach</button>
    <p class="meta copy-status" data-copy-status hidden></p>
  </div>`;
}

function coachMetaHtml(saved, opts = {}) {
  const includeFin = opts.includeFin !== false;
  const date = saved.date || isoDate();
  const feel = saved.feel || "-";
  return `<div class="coach-box" data-testid="coach-box">
      <p class="meta">When you finish, send tonight's log to your coach. If the email app won't open, use Copy for coach and paste it.</p>
      <div class="coach-row">
        <label>Date <input type="date" data-log="date" value="${escapeHtml(date)}"></label>
        ${includeFin ? `<label class="ack tight"><input type="checkbox" data-log="fin" ${saved.fin ? "checked" : ""}> We finished</label>` : ""}
        <label>Feel
          <select data-log="feel">
            <option value="-" ${feel === "-" ? "selected" : ""}>—</option>
            <option value="EASY" ${feel === "EASY" ? "selected" : ""}>Easy</option>
            <option value="OK" ${feel === "OK" ? "selected" : ""}>OK</option>
            <option value="HARD" ${feel === "HARD" ? "selected" : ""}>Hard</option>
          </select>
        </label>
        <label class="ack tight"><input type="checkbox" data-log="hurt" ${saved.hurt ? "checked" : ""}> Something hurt</label>
      </div>
      <label class="notes-label">Notes for coach
        <textarea data-log="notes" rows="2" placeholder="Anything your coach should know?">${escapeHtml(saved.notes || "")}</textarea>
      </label>
      <div data-coach-links></div>
    </div>`;
}

function visibleView() {
  return document.querySelector(".view:not([hidden])") || document;
}

function fillCoachLinks(klt, testid, root) {
  const scope = root || visibleView();
  const slot = scope.querySelector("[data-coach-links]");
  if (slot) slot.innerHTML = coachActionsHtml(klt, testid);
}

function safetyBlock(compact = false) {
  const items = PLAN.safety.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  return `<aside class="safety-banner" data-testid="safety-banner">Safety First — a grown-up watches, stop on pain, form before weight.</aside>
    ${compact ? "" : `<ol class="safety-list" data-testid="safety-list">${items}</ol>`}`;
}

function renderSafety() {
  $("#view-safety").innerHTML = `
    <div class="card">
      <p class="eyebrow">Safety First</p>
      <h2>Read this every time</h2>
      ${safetyBlock()}
      <p class="meta">This is fitness fun, not medical advice. A grown-up is the boss of safety.</p>
    </div>`;
}

function suggestedToday() {
  const day = todayName();
  const weekN = currentWeekDefault();
  const week = PLAN.weeks[weekN - 1];
  if (PLAN.schedule.strengthDays.includes(day)) {
    const session = week.sessions.find((s) => s.day === day);
    return { kind: "strength", week, session, day };
  }
  if (PLAN.schedule.tylersTenDays.includes(day)) {
    return { kind: "ten", week, day };
  }
  return { kind: "rest", day };
}

function renderToday() {
  const hint = suggestedToday();
  let body = "";
  if (hint.kind === "strength") {
    body = `
      <p class="eyebrow">Today is ${escapeHtml(hint.day)}</p>
      <h2>Week ${hint.week.week} • ${escapeHtml(hint.session.title)}</h2>
      <p class="meta">${escapeHtml(hint.week.phaseLabel)} • about ${hint.session.durationMin} minutes</p>
      <button class="btn primary" data-open-session="${hint.session.id}">Start tonight's workout</button>`;
  } else if (hint.kind === "ten") {
    body = `
      <p class="eyebrow">Today is ${escapeHtml(hint.day)}</p>
      <h2>Tyler's Ten night</h2>
      <p class="meta">About 10 easy minutes of stretching, balance, and light core. After tennis is perfect.</p>
      <button class="btn primary" data-goto="ten">Open Tyler's Ten</button>`;
  } else {
    body = `<h2>Nice rest energy</h2><p class="meta">Use the 12 weeks tab if you need to catch up on a session.</p>`;
  }
  $("#view-today").innerHTML = `
    ${safetyBlock(true)}
    <div class="card">${body}</div>
    <div class="card">
      <h3>The week at a glance</h3>
      <p class="meta">Mon, Wed, Fri = strength (20–25 min). Tue, Thu, Sat, Sun = Tyler's Ten (about 10 min).</p>
      <button class="btn ghost" data-goto="plan">See all 12 weeks</button>
    </div>`;
}

function renderPlan() {
  const weeks = PLAN.weeks.map((w) => `
    <div class="card" data-week="${w.week}">
      <p class="eyebrow">Week ${w.week} • ${escapeHtml(w.phaseLabel)}</p>
      <h3>${escapeHtml(w.theme)}</h3>
      <div class="day-list">
        ${w.sessions.map((s) => `
          <button class="session-link" data-open-session="${s.id}">
            <span><strong>${escapeHtml(s.day)}</strong><br><span class="meta">${escapeHtml(s.title)} • ${s.durationMin} min</span></span>
            <span class="pill ${s.legLoad === "none" ? "easy" : ""}">${escapeHtml(s.focus)}</span>
          </button>`).join("")}
      </div>
    </div>`).join("");
  $("#view-plan").innerHTML = `${safetyBlock(true)}${weeks}`;
}

async function renderTen() {
  const ten = PLAN.sections.find((s) => s.id === "tylers-ten");
  const week = currentWeekDefault();
  const day = todayName();
  const id = `ten-w${week}-${day}`;
  const saved = (await txGet("ten", id)) || { id, checks: {} };
  const items = ten.checklist.map((item, i) => {
    const ex = PLAN.exercises[item.exerciseId];
    const checked = saved.checks[item.exerciseId] ? "checked" : "";
    return `<li>
      <input type="checkbox" data-ten="${item.exerciseId}" ${checked} id="ten-${i}">
      <label for="ten-${i}"><strong>${escapeHtml(ex.name)}</strong> — ${escapeHtml(item.reps)}<br>
      <span class="meta">${escapeHtml(item.target)}</span></label>
      ${howButton(item.exerciseId)}
    </li>`;
  }).join("");
  $("#view-ten").innerHTML = `
    ${safetyBlock(true)}
    <div class="card">
      <p class="eyebrow">Tyler's Ten</p>
      <h2>About ${ten.minutes} easy minutes</h2>
      <p class="meta">${escapeHtml(ten.blurb)}</p>
      <p class="meta">Saving for Week ${week}, ${day}. Check each move when you finish it.</p>
      <ul class="check-list" data-testid="tylers-ten">${items}</ul>
      ${coachMetaHtml(saved, { includeFin: false })}
    </div>`;
  fillCoachLinks(kltFromTen(saved, ten), "send-ten-to-coach", $("#view-ten"));
}

async function logKey(sessionId) {
  return `log-${sessionId}`;
}

async function renderSession(sessionId) {
  const found = sessionById(sessionId);
  if (!found) return;
  const { week, session } = found;
  const key = await logKey(sessionId);
  const saved = (await txGet("logs", key)) || { id: key, sessionId, sets: {} };

  const block = (title, items, loggable) => {
    const rows = items.map((item) => {
      const ex = PLAN.exercises[item.exerciseId];
      const cues = (ex.cues || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
      const sets = [];
      for (let i = 1; i <= item.sets; i++) {
        const rec = (saved.sets[item.exerciseId] || {})[i] || {};
        if (loggable) {
          sets.push(`<div class="set-row">
            <input type="checkbox" data-sid="${sessionId}" data-ex="${item.exerciseId}" data-set="${i}" ${rec.done ? "checked" : ""} aria-label="Set ${i} done">
            <label>Set ${i} • aim for ${escapeHtml(String(item.reps))}</label>
            <input type="number" min="0" max="99" inputmode="numeric" placeholder="${isHold(item) ? "sec" : "reps"}" value="${rec.reps ?? ""}"
              data-sid="${sessionId}" data-ex="${item.exerciseId}" data-set="${i}" data-field="reps" aria-label="Set ${i} ${isHold(item) ? "seconds" : "reps"}">
          </div>`);
        }
      }
      const swap = ex.swapIn ? `<p class="meta">Later swap-in: ${escapeHtml(ex.swapIn)}</p>` : "";
      return `<article class="ex ${loggable ? "" : ""}" data-exercise="${item.exerciseId}">
        <div class="ex-head">
          <h3>${escapeHtml(ex.name)}</h3>
          ${howButton(item.exerciseId)}
        </div>
        <p class="meta">${item.sets} × ${escapeHtml(String(item.reps))}${item.tempo ? " • tempo " + escapeHtml(item.tempo) : ""} • ${escapeHtml(item.load || "as written")}</p>
        <p>${escapeHtml(item.target)}</p>
        <ul class="cues">${cues}</ul>
        ${loggable ? `<div class="sets">${sets.join("")}</div>` : ""}
        ${loggable ? `<input type="text" class="ex-note" data-sid="${sessionId}" data-ex="${item.exerciseId}" data-field="exnote" placeholder="Note for coach (optional)" value="${escapeHtml((saved.exerciseNotes || {})[item.exerciseId] || "")}">` : ""}
        ${swap}
      </article>`;
    }).join("");
    return `<h3>${escapeHtml(title)}</h3>${rows}`;
  };

  $("#view-session").innerHTML = `
    ${safetyBlock(true)}
    <button class="btn ghost back" data-goto="plan">Back to 12 weeks</button>
    <div class="card">
      <p class="eyebrow">Week ${week.week} • ${escapeHtml(week.phaseLabel)}</p>
      <h2>${escapeHtml(session.day)} • ${escapeHtml(session.title)}</h2>
      <p class="meta">About ${session.durationMin} minutes. Leave 2 or 3 reps in the tank.</p>
      ${block("Warm-up (easy)", session.warmup, false)}
      ${block("Strength work", session.exercises, true)}
      ${block("Cool-down", session.cooldown, false)}
      ${coachMetaHtml(saved)}
    </div>`;
  currentSessionId = sessionId;
  fillCoachLinks(kltFromSession(week, session, saved), "send-to-coach", $("#view-session"));
  showView("session");
}

async function saveSet(sessionId, exerciseId, setNo, patch) {
  const key = await logKey(sessionId);
  const saved = (await txGet("logs", key)) || { id: key, sessionId, sets: {} };
  saved.sets[exerciseId] = saved.sets[exerciseId] || {};
  saved.sets[exerciseId][setNo] = { ...(saved.sets[exerciseId][setNo] || {}), ...patch };
  if (!saved.date) saved.date = isoDate();
  await txPut("logs", saved);
  refreshSessionCoach(sessionId, saved);
}

function mergeSavedWithForm(saved, root) {
  const box = (root || visibleView()).querySelector(".coach-box");
  if (!box) return saved;
  return { ...saved, ...readCoachMeta(box) };
}

function refreshSessionCoach(sessionId, saved) {
  const found = sessionById(sessionId);
  if (!found) return;
  const root = $("#view-session");
  fillCoachLinks(kltFromSession(found.week, found.session, mergeSavedWithForm(saved, root)), "send-to-coach", root);
}

async function saveLogMeta(sessionId, patch) {
  const key = await logKey(sessionId);
  const saved = (await txGet("logs", key)) || { id: key, sessionId, sets: {} };
  Object.assign(saved, patch);
  if (!saved.date) saved.date = isoDate();
  await txPut("logs", saved);
  refreshSessionCoach(sessionId, saved);
}

async function saveExNote(sessionId, exerciseId, note) {
  const key = await logKey(sessionId);
  const saved = (await txGet("logs", key)) || { id: key, sessionId, sets: {} };
  saved.exerciseNotes = saved.exerciseNotes || {};
  saved.exerciseNotes[exerciseId] = note;
  if (!saved.date) saved.date = isoDate();
  await txPut("logs", saved);
  refreshSessionCoach(sessionId, saved);
}

function tenId() {
  return `ten-w${currentWeekDefault()}-${todayName()}`;
}

async function saveTen(exerciseId, checked) {
  const id = tenId();
  const saved = (await txGet("ten", id)) || { id, checks: {} };
  saved.checks[exerciseId] = checked;
  if (!saved.date) saved.date = isoDate();
  await txPut("ten", saved);
  const ten = PLAN.sections.find((s) => s.id === "tylers-ten");
  fillCoachLinks(kltFromTen(mergeSavedWithForm(saved, $("#view-ten")), ten), "send-ten-to-coach", $("#view-ten"));
}

async function saveTenMeta(patch) {
  const id = tenId();
  const saved = (await txGet("ten", id)) || { id, checks: {} };
  Object.assign(saved, patch);
  if (!saved.date) saved.date = isoDate();
  await txPut("ten", saved);
  const ten = PLAN.sections.find((s) => s.id === "tylers-ten");
  fillCoachLinks(kltFromTen(mergeSavedWithForm(saved, $("#view-ten")), ten), "send-ten-to-coach", $("#view-ten"));
}

async function copyCoachText(kind) {
  let klt;
  if (kind === "ten") {
    const ten = PLAN.sections.find((s) => s.id === "tylers-ten");
    const saved = (await txGet("ten", tenId())) || { id: tenId(), checks: {} };
    klt = kltFromTen(mergeSavedWithForm(saved, $("#view-ten")), ten);
  } else {
    const found = sessionById(currentSessionId);
    if (!found) return;
    const key = await logKey(currentSessionId);
    const saved = (await txGet("logs", key)) || { id: key, sessionId: currentSessionId, sets: {} };
    klt = kltFromSession(found.week, found.session, mergeSavedWithForm(saved, $("#view-session")));
  }
  const text = `Subject: ${klt.subject}\n\n${klt.fullBody}`;
  const status = visibleView().querySelector("[data-copy-status]");
  try {
    await navigator.clipboard.writeText(text);
    if (status) { status.hidden = false; status.textContent = "Copied. You can paste it into an email to the coach."; }
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    ta.remove();
    if (status) { status.hidden = false; status.textContent = "Copied. You can paste it into an email to the coach."; }
  }
}

function renderGate() {
  $("#gate-list").innerHTML = PLAN.safety.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  $("#gate-title").textContent = `Read this with a grown-up before ${PLAN.kidName} lifts`;
}

async function maybeGate() {
  const ack = await txGet("settings", "safetyAck");
  const dialog = $("#safety-gate");
  if (ack && ack.value) return;
  renderGate();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function wire() {
  $("#how-close")?.addEventListener("click", closeHow);
  $("#how-video")?.addEventListener("click", (e) => {
    const url = e.currentTarget.getAttribute("href");
    if (!url) return;
    // Installed home-screen apps can swallow target=_blank links inside a dialog.
    // Open explicitly in a new tab or the YouTube app.
    e.preventDefault();
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = url;
    }
  });

  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    const view = t.dataset.view;
    if (view === "ten") renderTen();
    showView(view);
  }));
  document.body.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy-coach]");
    if (copyBtn) {
      e.preventDefault();
      copyCoachText(copyBtn.closest("#view-ten") ? "ten" : "session");
      return;
    }
    const how = e.target.closest("[data-how]");
    if (how) {
      e.preventDefault();
      openHow(how.dataset.how);
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) {
      const view = go.dataset.goto;
      if (view === "ten") renderTen();
      if (view === "plan") renderPlan();
      showView(view);
    }
    const open = e.target.closest("[data-open-session]");
    if (open) renderSession(open.dataset.openSession);
  });
  document.body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && (t.dataset.log || t.dataset.field === "exnote" || t.dataset.field === "reps")) {
      t.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  document.body.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.ten) {
      await saveTen(t.dataset.ten, t.checked);
      t.closest("li")?.classList.toggle("done", t.checked);
    }
    if (t.dataset.sid && t.type === "checkbox") {
      await saveSet(t.dataset.sid, t.dataset.ex, t.dataset.set, { done: t.checked });
    }
    if (t.dataset.sid && t.dataset.field === "reps") {
      await saveSet(t.dataset.sid, t.dataset.ex, t.dataset.set, { reps: t.value });
    }
    if (t.dataset.sid && t.dataset.field === "exnote") {
      await saveExNote(t.dataset.sid, t.dataset.ex, t.value);
    }
    if (t.dataset.log) {
      const patch = {};
      if (t.dataset.log === "date") patch.date = t.value;
      if (t.dataset.log === "fin") patch.fin = t.checked;
      if (t.dataset.log === "feel") patch.feel = t.value;
      if (t.dataset.log === "hurt") patch.hurt = t.checked;
      if (t.dataset.log === "notes") patch.notes = t.value;
      if (t.closest("#view-ten")) await saveTenMeta(patch);
      else if (currentSessionId) await saveLogMeta(currentSessionId, patch);
    }
  });
  $("#gate-check").addEventListener("change", (e) => {
    $("#gate-go").disabled = !e.target.checked;
  });
  $("#gate-go").addEventListener("click", async () => {
    await txPut("settings", { key: "safetyAck", value: true, at: Date.now() });
    $("#safety-gate").close?.();
    $("#safety-gate").removeAttribute("open");
  });
}

async function boot() {
  PLAN = await (await fetch("plan.json")).json();
  db = await openDb();
  $("#hey").textContent = `Hey, ${PLAN.kidName}!`;
  $("#appTitle").textContent = `${PLAN.kidName}'s Lifts`;
  document.title = `${PLAN.kidName}'s Lifts`;
  $("#footer").textContent = `${PLAN.coachName} • fitness guidance only, not medical advice`;
  renderSafety();
  renderToday();
  renderPlan();
  await renderTen();
  wire();
  await maybeGate();
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (err) { console.warn(err); }
  }
}

boot().catch((err) => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="safety-banner">Could not load the plan. ${escapeHtml(err.message)}</p>`);
});
