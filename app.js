/**
 * APEX v2 — app.js
 * Full-featured productivity command center
 * Week view + Month view + Sidebar + Flyouts + Tasks + Notes + Reminders
 */
'use strict';

/* ═══════════ DATA LAYER — Supabase ═══════════
   SB.fetch(table)        → all rows for the current user
   SB.upsert(table, row)  → insert or update one row (by primary key)
   SB.remove(table, id)   → delete one row
   window._currentUserId  → UUID set by revealDashboard() in index.html
═══════════════════════════════════════════════ */
const SB = {
  _uid: () => window._currentUserId,

  fetch: async (table) => {
    const { data, error } = await window._supabase
      .from(table).select('*')
      .eq('user_id', SB._uid())
      .order('created_at', { ascending: true });
    if (error) { console.error('SB.fetch', table, error); return []; }
    return data ?? [];
  },

  upsert: async (table, row) => {
    const { error } = await window._supabase
      .from(table)
      .upsert({ ...row, user_id: SB._uid() }, { onConflict: 'id' });
    if (error) console.error('SB.upsert', table, error);
  },

  remove: async (table, id) => {
    const { error } = await window._supabase
      .from(table).delete()
      .eq('id', id).eq('user_id', SB._uid());
    if (error) console.error('SB.remove', table, error);
  },

  fetchPrefs: async () => {
    const { data } = await window._supabase
      .from('preferences').select('*')
      .eq('user_id', SB._uid()).maybeSingle();
    return data;
  },

  savePrefs: async (prefs) => {
    await window._supabase.from('preferences')
      .upsert({ ...prefs, user_id: SB._uid() }, { onConflict: 'user_id' });
  },
};

// Thin localStorage shim — kept ONLY for instant theme caching (no flash on reload)
const DB = {
  get: (k, d=null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v)      => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Thin localStorage shim — kept ONLY for instant theme caching (no flash on reload)
const DB = {
  get: (k, d=null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v)      => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function todayStr() { return new Date().toISOString().slice(0,10); }

// State starts empty — populated from Supabase inside init().
// Theme is pre-loaded from localStorage to avoid a flash of the wrong theme.
const state = {
  events:       [],
  tasks:        [],
  reminders:    [],
  notes:        [],
  labels:       [],
  activeNote:   null,
  taskFilter:   'all',
  view:         'week',
  viewDate:     new Date(),
  selectedDate: todayStr(),
  flyoutEventId: null,
  theme: DB.get('apx2_theme', 'dark'),  // localStorage cache — instant on reload
};

function defaultLabels() {
  return [
    { id: 'l1', name: 'Work',     color: '#c2715a' },
    { id: 'l2', name: 'Personal', color: '#6b9e7e' },
    { id: 'l3', name: 'Health',   color: '#d4884a' },
    { id: 'l4', name: 'Finance',  color: '#6b8cba' },
    { id: 'l5', name: 'Learning', color: '#a67fb5' },
  ];
}

/* ─── Targeted Supabase save helpers ─────────────────────────────────────────
   Call the specific helper after each mutation instead of the old save().
   Column names map app camelCase → DB snake_case.
──────────────────────────────────────────────────────────────────────────── */
async function saveEvent(ev) {
  await saveEvent({ id: ev.id, title: ev.title, date: ev.date,
    start_time: ev.start, end_time: ev.end, notes: ev.notes, label_id: ev.labelId });
}
async function deleteEvent(id)    { await deleteEvent(state.flyoutEventId); }

async function saveTask(t) {
  await saveTask({ id: t.id, title: t.title, due: t.due,
    priority: t.priority, notes: t.notes, label_id: t.labelId, done: t.done });
}
async function deleteTask(id)     { await deleteTask(delBtn.dataset.id); }

async function saveReminder(r) {
  await saveReminder({ id: r.id, msg: r.msg, date: r.date,
    time: r.time, label_id: r.labelId, fired: r.fired });
}
async function deleteReminder(id) { await deleteReminder(e.target.dataset.id); }

async function saveNote(n) {
  await saveNote('notes', { id: n.id, title: n.title, body: n.body, updated_at: n.updated });
}
async function deleteNote(id)     { await deleteNote(state.activeNote); }

async function saveLabel(l)       { await saveLabel('labels', { id: l.id, name: l.name, color: l.color }); }
async function deleteLabel(id)    { await deleteLabel(e.target.dataset.id); }

async function savePrefs() {
  DB.set('apx2_theme', state.theme);                              // keep localStorage cache for instant load
  await savePrefs({ theme: state.theme, active_note: state.activeNote });
}

// Legacy shim — keeps existing save() call sites working while you migrate them.
// The shim fires-and-forgets all tables. Migrate each call site to the targeted
// helpers above using the table in Step 9, then you can delete this shim.
function save() {
  state.events.forEach(saveEvent);
  state.tasks.forEach(saveTask);
  state.reminders.forEach(saveReminder);
  state.notes.forEach(saveNote);
  state.labels.forEach(saveLabel);
  savePrefs();
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

/* ═══════════ HELPERS ═══════════ */
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function fmtDate(str) {
  if (!str) return '';
  const [y,mo,d] = str.split('-');
  return `${MONTHS_SHORT[parseInt(mo)-1]} ${parseInt(d)}, ${y}`;
}
function fmtDateTime(date,time) { return fmtDate(date) + (time ? ' · ' + fmtTime(time) : ''); }
function getLbl(id) { return state.labels.find(l=>l.id===id)||null; }
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
function weekStart(d) {
  const dt = new Date(d); dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate() - dt.getDay()); return dt;
}
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ═══════════ CLOCK ═══════════ */
function startClock() {
  const te = document.getElementById('sb-time');
  const de = document.getElementById('sb-date');
  function tick() {
    const n = new Date();
    te.textContent = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    de.textContent = `${DAYS[n.getDay()]} · ${MONTHS_SHORT[n.getMonth()]} ${n.getDate()} · ${n.getFullYear()}`;
  }
  tick(); setInterval(tick, 1000);
}

/* ═══════════ THEME ═══════════ */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme === 'light' ? 'light' : '');
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); save();
});

/* ═══════════ STATS BAR ═══════════ */
function renderStats() {
  const today = todayStr();
  const ws = weekStart(new Date());
  const we = addDays(ws, 7);
  const weStr = dateStr(we);
  const wsStr = dateStr(ws);

  const todayTasks  = state.tasks.filter(t => t.due === today && !t.done).length;
  const doneTasks   = state.tasks.filter(t => t.done).length;
  const weekEvents  = state.events.filter(e => e.date >= wsStr && e.date < weStr).length;
  const pendingRems = state.reminders.filter(r => !r.fired).length;
  const total = state.tasks.length;
  const pct   = total ? Math.round(doneTasks/total*100) : 0;

  document.getElementById('stat-tasks-today').textContent = todayTasks;
  document.getElementById('stat-done').textContent        = doneTasks;
  document.getElementById('stat-week-events').textContent = weekEvents;
  document.getElementById('stat-reminders').textContent   = pendingRems;
  document.getElementById('stat-bar-fill').style.width    = pct + '%';
  document.getElementById('stat-pct').textContent         = pct + '%';
}

/* ═══════════ MINI CALENDAR (sidebar) ═══════════ */
let mcYear = new Date().getFullYear();
let mcMonth = new Date().getMonth();

function renderMiniCal() {
  document.getElementById('mc-label').textContent = `${MONTHS_SHORT[mcMonth]} ${mcYear}`;
  const wdEl = document.getElementById('mc-weekdays');
  wdEl.innerHTML = '';
  DAYS.forEach(d => { const s = document.createElement('span'); s.textContent = d[0]; wdEl.appendChild(s); });

  const grid = document.getElementById('mc-grid');
  grid.innerHTML = '';
  const firstDay = new Date(mcYear, mcMonth, 1).getDay();
  const dim = new Date(mcYear, mcMonth+1, 0).getDate();
  const prevDim = new Date(mcYear, mcMonth, 0).getDate();
  const today = todayStr();
  let cells = [];

  for (let i = firstDay-1; i >= 0; i--) {
    const yr = mcMonth===0?mcYear-1:mcYear;
    const mo = mcMonth===0?11:mcMonth-1;
    cells.push({ d: prevDim-i, mo, yr, other: true });
  }
  for (let d=1; d<=dim; d++) cells.push({ d, mo: mcMonth, yr: mcYear, other: false });
  let nx=1;
  while (cells.length%7) {
    const yr = mcMonth===11?mcYear+1:mcYear;
    const mo = mcMonth===11?0:mcMonth+1;
    cells.push({ d: nx++, mo, yr, other: true });
  }

  cells.forEach(c => {
    const ds = `${c.yr}-${String(c.mo+1).padStart(2,'0')}-${String(c.d).padStart(2,'0')}`;
    const hasEv = state.events.some(e=>e.date===ds);
    const cell = document.createElement('div');
    cell.className = 'mc-cell' + (c.other?'':' cur-month') + (ds===today?' today':'') + (ds===state.selectedDate?' selected':'');
    cell.innerHTML = c.d + (hasEv && !c.other ? '<span class="mc-dot"></span>' : '');
    cell.addEventListener('click', () => {
      state.selectedDate = ds;
      state.viewDate = new Date(ds + 'T12:00:00');
      mcYear = c.yr; mcMonth = c.mo;
      renderMiniCal();
      if (state.view === 'week') renderWeekView();
      else renderMonthView();
      renderSidebarAgenda();
    });
    grid.appendChild(cell);
  });
}

document.getElementById('mc-prev').addEventListener('click', () => {
  mcMonth--; if (mcMonth<0) { mcMonth=11; mcYear--; } renderMiniCal();
});
document.getElementById('mc-next').addEventListener('click', () => {
  mcMonth++; if (mcMonth>11) { mcMonth=0; mcYear++; } renderMiniCal();
});

/* ═══════════ SIDEBAR AGENDA ═══════════ */
function renderSidebarAgenda() {
  const list = document.getElementById('sb-agenda-list');
  list.innerHTML = '';
  const today = todayStr();
  const upcoming = state.events
    .filter(e => e.date >= today)
    .sort((a,b) => a.date.localeCompare(b.date) || (a.start||'').localeCompare(b.start||''))
    .slice(0, 6);

  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-msg" style="color:var(--sidebar-muted);font-size:.72rem;padding:.5rem 0;text-align:left;font-style:italic;">No upcoming events.</div>';
    return;
  }
  upcoming.forEach(ev => {
    const lbl = getLbl(ev.labelId);
    const color = lbl ? lbl.color : '#888';
    const item = document.createElement('div');
    item.className = 'sb-agenda-item';
    item.innerHTML = `
      <div class="sb-agenda-dot" style="background:${color}"></div>
      <div class="sb-agenda-info">
        <span class="sb-agenda-title">${esc(ev.title)}</span>
        <span class="sb-agenda-time">${fmtDate(ev.date)}${ev.start?' · '+fmtTime(ev.start):''}</span>
      </div>`;
    item.addEventListener('click', () => openFlyout(ev.id));
    list.appendChild(item);
  });
}

/* ═══════════ SIDEBAR LABELS ═══════════ */
function renderSidebarLabels() {
  const el = document.getElementById('sb-label-list');
  el.innerHTML = '';
  state.labels.forEach(lbl => {
    const row = document.createElement('div');
    row.className = 'sb-label-row';
    row.innerHTML = `<div class="sb-label-swatch" style="background:${lbl.color}"></div><span>${esc(lbl.name)}</span>`;
    el.appendChild(row);
  });
}

/* ═══════════ VIEW SWITCHING ═══════════ */
document.querySelectorAll('.vc-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vc-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    document.querySelectorAll('.cal-view').forEach(v => v.classList.remove('active'));
    document.getElementById(state.view+'-view').classList.add('active');
    renderCurrentView();
  });
});

document.getElementById('view-prev').addEventListener('click', () => {
  if (state.view === 'week') state.viewDate = addDays(state.viewDate, -7);
  else { state.viewDate = new Date(state.viewDate); state.viewDate.setMonth(state.viewDate.getMonth()-1); }
  renderCurrentView();
});
document.getElementById('view-next').addEventListener('click', () => {
  if (state.view === 'week') state.viewDate = addDays(state.viewDate, 7);
  else { state.viewDate = new Date(state.viewDate); state.viewDate.setMonth(state.viewDate.getMonth()+1); }
  renderCurrentView();
});
document.getElementById('go-today').addEventListener('click', () => {
  state.viewDate = new Date();
  state.selectedDate = todayStr();
  mcYear = new Date().getFullYear(); mcMonth = new Date().getMonth();
  renderMiniCal(); renderCurrentView(); renderSidebarAgenda();
});

function renderCurrentView() {
  if (state.view === 'week') renderWeekView();
  else renderMonthView();
}

/* ═══════════ WEEK VIEW ═══════════ */
const HOURS = Array.from({length:24},(_,i)=>i);

function renderWeekView() {
  const ws = weekStart(state.viewDate);
  const days = Array.from({length:7}, (_,i) => addDays(ws,i));
  const today = todayStr();

  // View label
  const we = addDays(ws,6);
  document.getElementById('view-label').textContent =
    ws.getMonth()===we.getMonth()
      ? `${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`
      : `${MONTHS_SHORT[ws.getMonth()]} – ${MONTHS_SHORT[we.getMonth()]} ${we.getFullYear()}`;

  // Header
  const hdr = document.getElementById('week-header');
  hdr.innerHTML = '';
  hdr.style.gridTemplateColumns = `52px repeat(7,1fr)`;
  // time gutter spacer
  const gutter = document.createElement('div');
  gutter.style.cssText = 'border-right:1px solid var(--main-border);flex-shrink:0;width:52px';
  hdr.appendChild(gutter);

  days.forEach(d => {
    const ds = dateStr(d);
    const col = document.createElement('div');
    col.className = 'week-day-hdr' + (ds===today ? ' today-col' : '') + (ds===state.selectedDate ? ' sel-col' : '');
    col.innerHTML = `<span class="wdh-dow">${DAYS[d.getDay()]}</span><span class="wdh-num">${d.getDate()}</span>`;
    col.addEventListener('click', () => { state.selectedDate = ds; renderWeekView(); });
    hdr.appendChild(col);
  });

  // Time labels
  const tl = document.getElementById('week-time-labels');
  tl.innerHTML = '';
  HOURS.forEach(h => {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = h===0?'':(`${h%12||12}${h<12?'am':'pm'}`);
    tl.appendChild(label);
  });

  // Grid
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  days.forEach(d => {
    const ds = dateStr(d);
    const col = document.createElement('div');
    col.className = 'week-col';

    // Hour cells
    HOURS.forEach(h => {
      const cell = document.createElement('div');
      cell.className = 'week-hour-cell';
      cell.addEventListener('click', () => {
        state.selectedDate = ds;
        const hStr = String(h).padStart(2,'0');
        document.getElementById('event-date-input').value = ds;
        document.getElementById('event-start-input').value = `${hStr}:00`;
        document.getElementById('event-end-input').value   = `${String(h+1).padStart(2,'0')}:00`;
        renderLabelPickRow('event-label-select','');
        document.getElementById('event-edit-id').value = '';
        document.getElementById('event-modal-title').textContent = 'NEW EVENT';
        document.getElementById('event-title-input').value = '';
        document.getElementById('event-notes-input').value = '';
        openModal('event-modal');
      });
      col.appendChild(cell);
    });

    // Events for this day
    const dayEvs = state.events.filter(e=>e.date===ds && e.start);
    dayEvs.forEach(ev => {
      const lbl = getLbl(ev.labelId);
      const color = lbl ? lbl.color : '#c2715a';
      const [sh,sm] = (ev.start||'00:00').split(':').map(Number);
      const [eh,em] = (ev.end||ev.start||'01:00').split(':').map(Number);
      const topPx   = (sh*60+sm) / 60 * 54;
      const heightPx= Math.max(((eh*60+em)-(sh*60+sm)) / 60 * 54, 22);
      const evEl = document.createElement('div');
      evEl.className = 'week-event';
      evEl.style.cssText = `top:${topPx}px;height:${heightPx}px;background:rgba(${hexToRgb(color)},.18);border-left:3px solid ${color};color:${color}`;
      evEl.innerHTML = `<span class="week-event-title">${esc(ev.title)}</span><span class="week-event-time">${fmtTime(ev.start)}${ev.end?' – '+fmtTime(ev.end):''}</span>`;
      evEl.addEventListener('click', e => { e.stopPropagation(); openFlyout(ev.id); });
      col.appendChild(evEl);
    });

    grid.appendChild(col);
  });

  // Current time line
  const nowLine = document.getElementById('now-line') || (() => {
    const l = document.createElement('div'); l.id='now-line'; l.className='now-line'; return l;
  })();
  const now = new Date();
  const todayIdx = days.findIndex(d=>dateStr(d)===today);
  if (todayIdx >= 0) {
    const minFromMid = now.getHours()*60+now.getMinutes();
    const topPx = minFromMid/60*54;
    const colWidth = grid.offsetWidth/7;
    nowLine.style.cssText = `top:${topPx}px;left:${todayIdx*colWidth}px;width:${colWidth}px`;
    grid.appendChild(nowLine);
  } else {
    nowLine.remove();
  }

  // Scroll to 7am
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById('week-scroll');
    if (scrollEl.scrollTop === 0) scrollEl.scrollTop = 7 * 54;
  });
}

/* ═══════════ MONTH VIEW ═══════════ */
function renderMonthView() {
  const y = state.viewDate.getFullYear();
  const m = state.viewDate.getMonth();
  document.getElementById('view-label').textContent = `${MONTHS[m]} ${y}`;

  const dowRow = document.getElementById('month-dow-row');
  dowRow.innerHTML = '';
  DAYS.forEach(d => { const s=document.createElement('span'); s.textContent=d; dowRow.appendChild(s); });

  const grid = document.getElementById('month-grid');
  grid.innerHTML = '';
  const today = todayStr();
  const firstDay = new Date(y,m,1).getDay();
  const dim = new Date(y,m+1,0).getDate();
  const prevDim = new Date(y,m,0).getDate();
  let cells = [];

  for (let i=firstDay-1;i>=0;i--) {
    const yr=m===0?y-1:y; const mo=m===0?11:m-1;
    cells.push({d:prevDim-i,mo,yr,other:true});
  }
  for (let d=1;d<=dim;d++) cells.push({d,mo:m,yr:y,other:false});
  let nx=1;
  while(cells.length%7) { const yr=m===11?y+1:y; const mo=m===11?0:m+1; cells.push({d:nx++,mo,yr,other:true}); }

  // Auto row height via CSS
  grid.style.gridTemplateRows = `repeat(${cells.length/7}, 1fr)`;

  cells.forEach(c => {
    const ds = `${c.yr}-${String(c.mo+1).padStart(2,'0')}-${String(c.d).padStart(2,'0')}`;
    const cell = document.createElement('div');
    cell.className = 'month-cell' + (c.other?' other-month':'') + (ds===today?' today':'') + (ds===state.selectedDate?' selected':'');

    const num = document.createElement('div');
    num.className = 'mc-num';
    num.textContent = c.d;
    cell.appendChild(num);

    // Events
    const dayEvs = state.events.filter(e=>e.date===ds).slice(0,3);
    dayEvs.forEach(ev => {
      const lbl = getLbl(ev.labelId);
      const color = lbl ? lbl.color : '#c2715a';
      const pill = document.createElement('div');
      pill.className = 'month-ev-pill';
      pill.style.cssText = `background:rgba(${hexToRgb(color)},.15);color:${color}`;
      pill.textContent = ev.title;
      pill.addEventListener('click', e => { e.stopPropagation(); openFlyout(ev.id); });
      cell.appendChild(pill);
    });

    cell.addEventListener('click', () => {
      state.selectedDate = ds;
      mcYear = c.yr; mcMonth = c.mo;
      renderMonthView(); renderMiniCal();
    });
    cell.addEventListener('dblclick', () => {
      state.selectedDate = ds;
      document.getElementById('event-date-input').value = ds;
      document.getElementById('event-edit-id').value = '';
      document.getElementById('event-modal-title').textContent = 'NEW EVENT';
      document.getElementById('event-title-input').value='';
      document.getElementById('event-start-input').value='';
      document.getElementById('event-end-input').value='';
      document.getElementById('event-notes-input').value='';
      renderLabelPickRow('event-label-select','');
      openModal('event-modal');
    });
    grid.appendChild(cell);
  });
}

/* ═══════════ EVENT FLYOUT ═══════════ */
function openFlyout(evId) {
  const ev = state.events.find(e=>e.id===evId); if (!ev) return;
  state.flyoutEventId = evId;
  const lbl = getLbl(ev.labelId);
  const color = lbl ? lbl.color : '#c2715a';
  document.getElementById('flyout-color-bar').style.background = color;
  document.getElementById('flyout-title').textContent = ev.title;

  const body = document.getElementById('flyout-body');
  body.innerHTML = '';
  const rows = [
    { icon: '📅', text: fmtDate(ev.date) },
    ev.start ? { icon: '⏰', text: fmtTime(ev.start) + (ev.end ? ' – ' + fmtTime(ev.end) : '') } : null,
    lbl ? { icon: '⊛', text: lbl.name } : null,
    ev.notes ? { icon: '📝', text: ev.notes, italic: true } : null,
  ].filter(Boolean);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'flyout-row';
    row.innerHTML = `<span class="flyout-row-icon">${r.icon}</span><span${r.italic?' class="flyout-notes"':''}>${esc(r.text)}</span>`;
    body.appendChild(row);
  });

  document.getElementById('event-flyout').classList.remove('hidden');
  document.getElementById('flyout-overlay').classList.remove('hidden');
}

document.getElementById('flyout-close').addEventListener('click', closeFlyout);
document.getElementById('flyout-overlay').addEventListener('click', closeFlyout);
function closeFlyout() {
  document.getElementById('event-flyout').classList.add('hidden');
  document.getElementById('flyout-overlay').classList.add('hidden');
  state.flyoutEventId = null;
}
document.getElementById('flyout-edit').addEventListener('click', () => {
  if (!state.flyoutEventId) return;
  closeFlyout(); openEventModal(state.flyoutEventId);
});
document.getElementById('flyout-delete').addEventListener('click', () => {
  if (!state.flyoutEventId) return;
  state.events = state.events.filter(e=>e.id!==state.flyoutEventId);
  save(); closeFlyout(); renderCurrentView(); renderSidebarAgenda(); renderStats();
  showToast('Event deleted.');
});

/* ═══════════ EVENTS MODAL ═══════════ */
document.getElementById('open-event-modal-top').addEventListener('click', () => openEventModal());
document.getElementById('open-task-modal-top').addEventListener('click', () => openTaskModal());

function openEventModal(editId) {
  const isEdit = !!editId;
  document.getElementById('event-modal-title').textContent = isEdit ? 'EDIT EVENT' : 'NEW EVENT';
  document.getElementById('event-edit-id').value = editId||'';
  const ev = isEdit ? state.events.find(e=>e.id===editId) : null;
  document.getElementById('event-title-input').value = ev?.title||'';
  document.getElementById('event-date-input').value  = ev?.date||state.selectedDate;
  document.getElementById('event-start-input').value = ev?.start||'';
  document.getElementById('event-end-input').value   = ev?.end||'';
  document.getElementById('event-notes-input').value = ev?.notes||'';
  renderLabelPickRow('event-label-select', ev?.labelId||'');
  openModal('event-modal');
}
document.getElementById('save-event-btn').addEventListener('click', () => {
  const title = document.getElementById('event-title-input').value.trim();
  if (!title) { showToast('Event title required.'); return; }
  const id = document.getElementById('event-edit-id').value;
  const ev = {
    id: id||uid(), title,
    date:    document.getElementById('event-date-input').value||state.selectedDate,
    start:   document.getElementById('event-start-input').value,
    end:     document.getElementById('event-end-input').value,
    notes:   document.getElementById('event-notes-input').value,
    labelId: getPickedLabel('event-label-select'),
  };
  if (id) { const idx=state.events.findIndex(e=>e.id===id); if(idx!==-1) state.events[idx]=ev; }
  else state.events.push(ev);
  save(); closeModal('event-modal');
  renderCurrentView(); renderSidebarAgenda(); renderStats(); renderMiniCal();
  showToast(id?'Event updated.':'Event saved.','success');
});

/* ═══════════ TASKS ═══════════ */
document.getElementById('open-task-modal').addEventListener('click', () => openTaskModal());

function openTaskModal(editId) {
  const isEdit = !!editId;
  document.getElementById('task-modal-title').textContent = isEdit ? 'EDIT TASK' : 'NEW TASK';
  document.getElementById('task-edit-id').value = editId||'';
  const t = isEdit ? state.tasks.find(x=>x.id===editId) : null;
  document.getElementById('task-title-input').value    = t?.title||'';
  document.getElementById('task-due-input').value      = t?.due||'';
  document.getElementById('task-priority-input').value = t?.priority||'medium';
  document.getElementById('task-notes-input').value    = t?.notes||'';
  renderLabelPickRow('task-label-select', t?.labelId||'');
  openModal('task-modal');
}
document.getElementById('save-task-btn').addEventListener('click', () => {
  const title = document.getElementById('task-title-input').value.trim();
  if (!title) { showToast('Task title required.'); return; }
  const id = document.getElementById('task-edit-id').value;
  const task = {
    id: id||uid(), title,
    due:      document.getElementById('task-due-input').value,
    priority: document.getElementById('task-priority-input').value,
    notes:    document.getElementById('task-notes-input').value,
    labelId:  getPickedLabel('task-label-select'),
    done:     id ? (state.tasks.find(t=>t.id===id)?.done||false) : false,
    created:  id ? (state.tasks.find(t=>t.id===id)?.created||Date.now()) : Date.now(),
  };
  if (id) { const idx=state.tasks.findIndex(t=>t.id===id); if(idx!==-1) state.tasks[idx]=task; }
  else state.tasks.push(task);
  save(); closeModal('task-modal'); renderTasks(); renderStats();
  showToast(id?'Task updated.':'Task added.','success');
});

document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.taskFilter = btn.dataset.filter;
    renderTasks();
  });
});

function renderTasks() {
  const today = todayStr();
  let tasks = [...state.tasks];
  if      (state.taskFilter==='today')    tasks = tasks.filter(t=>t.due===today&&!t.done);
  else if (state.taskFilter==='upcoming') tasks = tasks.filter(t=>t.due>today&&!t.done);
  else if (state.taskFilter==='done')     tasks = tasks.filter(t=>t.done);

  const pOrder = {critical:0,high:1,medium:2,low:3};
  tasks.sort((a,b) => {
    if (a.done!==b.done) return a.done?1:-1;
    const pd=(pOrder[a.priority]||2)-(pOrder[b.priority]||2); if(pd) return pd;
    return (a.due||'9').localeCompare(b.due||'9');
  });

  const list = document.getElementById('task-list');
  list.innerHTML = '';
  if (!tasks.length) { list.innerHTML='<div class="empty-msg">Nothing here.</div>'; }

  tasks.forEach(t => {
    const lbl = getLbl(t.labelId);
    const color = lbl ? lbl.color : 'var(--right-border)';
    const overdue = t.due && t.due<today && !t.done;
    const item = document.createElement('div');
    item.className = 'task-item'+(t.done?' done':'');
    item.style.borderLeftColor = color;
    item.innerHTML = `
      <div class="t-check${t.done?' checked':''}" data-id="${t.id}">${t.done?'✓':''}</div>
      <div class="task-body-wrap">
        <span class="task-title">${esc(t.title)}</span>
        <div class="task-sub">
          ${t.due?`<span class="task-due${overdue?' overdue':''}">${fmtDate(t.due)}</span>`:''}
          <span class="pri-badge pri-${t.priority}">${t.priority}</span>
          ${lbl?`<span style="font-size:.58rem;color:${lbl.color};font-family:var(--font-mono)">${esc(lbl.name)}</span>`:''}
        </div>
      </div>
      <div class="task-acts">
        <button class="tact edit-t" data-id="${t.id}" title="Edit">✎</button>
        <button class="tact del delete-t" data-id="${t.id}" title="Delete">✕</button>
      </div>`;
    list.appendChild(item);
  });

  const all=state.tasks.length, done=state.tasks.filter(t=>t.done).length;
  document.getElementById('task-progress-label').textContent = `${done} / ${all}`;
  document.getElementById('task-progress-fill').style.width = all ? (done/all*100)+'%' : '0%';
}

document.getElementById('task-list').addEventListener('click', e => {
  const check  = e.target.closest('.t-check');
  const editBtn= e.target.closest('.edit-t');
  const delBtn = e.target.closest('.delete-t');
  if (check)   { const t=state.tasks.find(x=>x.id===check.dataset.id); if(t){t.done=!t.done;save();renderTasks();renderStats();} }
  if (editBtn) openTaskModal(editBtn.dataset.id);
  if (delBtn)  { state.tasks=state.tasks.filter(t=>t.id!==delBtn.dataset.id); save();renderTasks();renderStats(); showToast('Task deleted.'); }
});

/* ═══════════ NOTEPAD ═══════════ */
let noteSaveTimer = null;

function renderNoteSelector() {
  const sel = document.getElementById('note-selector');
  sel.innerHTML = '';
  state.notes.forEach(n => {
    const o=document.createElement('option'); o.value=n.id; o.textContent=n.title||'Untitled';
    o.selected=n.id===state.activeNote; sel.appendChild(o);
  });
}
function loadNote() {
  const note = state.notes.find(n=>n.id===state.activeNote)||state.notes[0];
  if (!note) return;
  state.activeNote = note.id;
  document.getElementById('note-title').value = note.title;
  document.getElementById('notepad').value = note.body;
  updateWordCount(); renderNoteSelector();
}
function updateWordCount() {
  const w = document.getElementById('notepad').value.trim();
  const n = w ? w.split(/\s+/).length : 0;
  document.getElementById('note-word-count').textContent = `${n} word${n!==1?'s':''}`;
}
function setSaved(saved) {
  const el = document.getElementById('note-saved-status');
  el.textContent = saved ? '● SAVED' : '○ UNSAVED';
  el.style.color = saved ? 'var(--accent2)' : 'var(--accent3)';
}
document.getElementById('notepad').addEventListener('input', () => {
  updateWordCount(); setSaved(false); clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    const note = state.notes.find(n=>n.id===state.activeNote);
    if (note) { note.body=document.getElementById('notepad').value; note.updated=Date.now(); save(); setSaved(true); }
  }, 800);
});
document.getElementById('note-title').addEventListener('input', () => {
  const note=state.notes.find(n=>n.id===state.activeNote);
  if (note) { note.title=document.getElementById('note-title').value; clearTimeout(noteSaveTimer); noteSaveTimer=setTimeout(()=>{save();renderNoteSelector();setSaved(true);},600); }
});
document.getElementById('note-selector').addEventListener('change', e => { state.activeNote=e.target.value; loadNote(); });
document.getElementById('new-note-btn').addEventListener('click', () => {
  const n={id:uid(),title:'New Note',body:'',updated:Date.now()};
  state.notes.push(n); state.activeNote=n.id; save(); renderNoteSelector(); loadNote();
  document.getElementById('note-title').focus();
});
document.getElementById('delete-note-btn').addEventListener('click', () => {
  if (state.notes.length<=1) { showToast('Cannot delete the last note.'); return; }
  state.notes=state.notes.filter(n=>n.id!==state.activeNote);
  state.activeNote=state.notes[0].id; save(); renderNoteSelector(); loadNote(); showToast('Note deleted.');
});

/* ═══════════ REMINDERS ═══════════ */
document.getElementById('open-reminder-modal').addEventListener('click', () => {
  document.getElementById('reminder-msg-input').value='';
  document.getElementById('reminder-date-input').value='';
  document.getElementById('reminder-time-input').value='';
  renderLabelPickRow('reminder-label-select','');
  openModal('reminder-modal');
});
document.getElementById('save-reminder-btn').addEventListener('click', () => {
  const msg=document.getElementById('reminder-msg-input').value.trim();
  const date=document.getElementById('reminder-date-input').value;
  const time=document.getElementById('reminder-time-input').value;
  if (!msg||!date||!time) { showToast('Message, date and time required.'); return; }
  state.reminders.push({ id:uid(), msg, date, time, labelId:getPickedLabel('reminder-label-select'), fired:false });
  save(); closeModal('reminder-modal'); renderReminders(); renderStats();
  showToast('Reminder set.','success');
});

function renderReminders() {
  const list = document.getElementById('reminder-list');
  const now = new Date();
  const sorted = [...state.reminders].sort((a,b)=>new Date(a.date+'T'+a.time)-new Date(b.date+'T'+b.time));
  list.innerHTML = '';
  if (!sorted.length) { list.innerHTML='<div class="empty-msg">No reminders.</div>'; return; }
  sorted.forEach(r => {
    const dt = new Date(r.date+'T'+r.time);
    const upcoming = dt>now && !r.fired;
    const lbl = getLbl(r.labelId);
    const color = lbl ? lbl.color : 'var(--right-border)';
    const item = document.createElement('div');
    item.className = 'reminder-item'+(r.fired?' fired':upcoming?' upcoming':'');
    item.style.borderLeftColor = color;
    item.innerHTML = `
      <span class="rem-icon">${r.fired?'🔕':'🔔'}</span>
      <div class="rem-body">
        <span class="rem-msg">${esc(r.msg)}</span>
        <span class="rem-when">${fmtDateTime(r.date,r.time)}</span>
      </div>
      <button class="rem-del" data-id="${r.id}" title="Delete">✕</button>`;
    list.appendChild(item);
  });
}
document.getElementById('reminder-list').addEventListener('click', e => {
  if (e.target.classList.contains('rem-del')) {
    state.reminders=state.reminders.filter(r=>r.id!==e.target.dataset.id);
    save(); renderReminders(); renderStats();
  }
});
function checkReminders() {
  const now=new Date(); let ch=false;
  state.reminders.forEach(r=>{ if(!r.fired&&new Date(r.date+'T'+r.time)<=now){ r.fired=true; ch=true; showToast('🔔 '+r.msg,'remind'); } });
  if(ch){ save(); renderReminders(); renderStats(); }
}
setInterval(checkReminders, 30000);

/* ═══════════ LABELS ═══════════ */
const COLOR_PRESETS = [
  '#c2715a','#6b9e7e','#d4884a','#6b8cba','#a67fb5',
  '#e8a030','#5ca8c0','#c06080','#80a858','#c08040',
  '#4890c0','#d05858','#58a890','#b06890','#708090',
];

function renderLabelManager() {
  const list = document.getElementById('label-list-display');
  list.innerHTML = '';
  if (!state.labels.length) { list.innerHTML='<div class="empty-msg">No labels.</div>'; }
  state.labels.forEach(lbl => {
    const row=document.createElement('div'); row.className='lbl-row';
    row.innerHTML=`<div class="lbl-swatch" style="background:${lbl.color}"></div><span class="lbl-name">${esc(lbl.name)}</span><button class="lbl-del" data-id="${lbl.id}">✕</button>`;
    list.appendChild(row);
  });
  const cp = document.getElementById('color-presets');
  cp.innerHTML = '';
  COLOR_PRESETS.forEach(c => {
    const b=document.createElement('button'); b.className='cp-swatch'; b.style.background=c; b.title=c;
    b.addEventListener('click',()=>document.getElementById('new-label-color').value=c);
    cp.appendChild(b);
  });
}
document.getElementById('label-list-display').addEventListener('click', e => {
  if (e.target.classList.contains('lbl-del')) {
    state.labels=state.labels.filter(l=>l.id!==e.target.dataset.id);
    save(); renderLabelManager(); renderSidebarLabels();
  }
});
document.getElementById('create-label-btn').addEventListener('click', () => {
  const name=document.getElementById('new-label-name').value.trim();
  if (!name) { showToast('Label name required.'); return; }
  state.labels.push({id:uid(),name,color:document.getElementById('new-label-color').value});
  document.getElementById('new-label-name').value='';
  save(); renderLabelManager(); renderSidebarLabels(); showToast('Label created.','success');
});
document.getElementById('open-label-manager').addEventListener('click', () => { renderLabelManager(); openModal('label-modal'); });

function renderLabelPickRow(containerId, selectedId) {
  const el = document.getElementById(containerId); el.innerHTML='';
  const none=document.createElement('div'); none.className='lchip'+(selectedId===''?' selected':'');
  none.style.cssText='background:rgba(0,0,0,.06);color:var(--main-muted);border-color:var(--main-border)';
  none.dataset.lid=''; none.textContent='None';
  none.addEventListener('click',()=>selectPick(containerId,''));
  el.appendChild(none);
  state.labels.forEach(lbl => {
    const chip=document.createElement('div'); chip.className='lchip'+(selectedId===lbl.id?' selected':'');
    chip.style.cssText=`background:rgba(${hexToRgb(lbl.color)},.12);color:${lbl.color};border-color:rgba(${hexToRgb(lbl.color)},.3)`;
    chip.dataset.lid=lbl.id; chip.textContent=lbl.name;
    chip.addEventListener('click',()=>selectPick(containerId,lbl.id));
    el.appendChild(chip);
  });
}
function selectPick(containerId, labelId) {
  document.getElementById(containerId).querySelectorAll('.lchip').forEach(c=>{
    c.classList.toggle('selected', c.dataset.lid===labelId);
  });
}
function getPickedLabel(containerId) {
  const sel=document.getElementById(containerId).querySelector('.selected');
  return sel ? sel.dataset.lid : '';
}

/* ═══════════ MODAL INFRASTRUCTURE ═══════════ */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-x, [data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close||el.closest('.modal-overlay')?.id));
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if(e.target===ov) closeModal(ov.id); });
});
document.addEventListener('keydown', e => {
  if (e.key==='Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'));
    closeFlyout();
  }
});

/* ═══════════ TOAST ═══════════ */
function showToast(msg, type='') {
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className=`toast${type==='success'?' success':type==='remind'?' remind':''}`;
  t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>t.remove(),3100);
}

/* ═══════════ KEYBOARD SHORTCUTS ═══════════ */
document.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if (document.querySelector('.modal-overlay.open')) return;
  if (e.key==='e') openEventModal();
  if (e.key==='t') openTaskModal();
  if (e.key==='n') document.getElementById('new-note-btn').click();
  if (e.key==='r') document.getElementById('open-reminder-modal').click();
  if (e.key==='l') { renderLabelManager(); openModal('label-modal'); }
  if (e.key==='w') { document.querySelector('.vc-tab[data-view="week"]').click(); }
  if (e.key==='m') { document.querySelector('.vc-tab[data-view="month"]').click(); }
});

/* ═══════════ UPDATE NOW LINE EVERY MINUTE ═══════════ */
setInterval(() => { if (state.view==='week') renderWeekView(); }, 60000);

/* ═══════════ INIT ═══════════ */
async function init() {
  applyTheme();
  startClock();

  // ── Load all user data from Supabase in parallel ─────────────────────────
  const [evRaw, tkRaw, rmRaw, ntRaw, lbRaw, prefs] = await Promise.all([
    SB.fetch('events'),
    SB.fetch('tasks'),
    SB.fetch('reminders'),
    SB.fetch('notes'),
    SB.fetch('labels'),
    SB.fetchPrefs(),
  ]);

  // ── Map DB snake_case column names → app camelCase field names ────────────
  state.events    = evRaw.map(e => ({
    id: e.id, title: e.title, date: e.date,
    start: e.start_time, end: e.end_time,
    notes: e.notes, labelId: e.label_id,
  }));
  state.tasks     = tkRaw.map(t => ({
    id: t.id, title: t.title, due: t.due,
    priority: t.priority, notes: t.notes,
    labelId: t.label_id, done: t.done,
  }));
  state.reminders = rmRaw.map(r => ({
    id: r.id, msg: r.msg, date: r.date,
    time: r.time, labelId: r.label_id, fired: r.fired,
  }));
  state.notes     = ntRaw.map(n => ({
    id: n.id, title: n.title, body: n.body, updated: n.updated_at,
  }));
  state.labels    = lbRaw.length > 0
    ? lbRaw.map(l => ({ id: l.id, name: l.name, color: l.color }))
    : defaultLabels();  // seed defaults for first-time users

  // ── First-login seeding ───────────────────────────────────────────────────
  if (lbRaw.length === 0) state.labels.forEach(saveLabel);   // write default labels

  if (state.notes.length === 0) {
    const starter = { id: uid(), title: 'Quick Notes', body: '', updated: Date.now() };
    state.notes.push(starter);
    await saveNote(starter);
  }

  // ── Restore user preferences ──────────────────────────────────────────────
  if (prefs) {
    if (prefs.theme)       { state.theme = prefs.theme; applyTheme(); }
    if (prefs.active_note) { state.activeNote = prefs.active_note; }
  }

  if (!state.activeNote || !state.notes.find(n => n.id === state.activeNote)) {
    state.activeNote = state.notes[0]?.id || null;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  renderMiniCal();
  renderSidebarAgenda();
  renderSidebarLabels();
  renderCurrentView();
  renderTasks();
  renderNoteSelector();
  loadNote();
  renderReminders();
  renderStats();
  checkReminders();
}

document.addEventListener('DOMContentLoaded', init);
