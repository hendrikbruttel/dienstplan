// ---------- Utils / Config ----------
const CONFIG = {
  tables: {
    plan: 'Planungsperiode',
    dp: 'Dienstplan',
    persons: 'Personen',
    wishes: 'Dienstwunsche',
    groups: 'Dienstgruppen',
  },
  cols: {
    plan: { date: 'Datum', kurzel: 'Kurzel', tag: 'Kurzel_Tag', check: 'Prufe_Teambesetzung' },
    person: { short: 'Kurzel', teamShort: 'Kurzel_Team', groups: 'Dienstgruppen', nD: 'N_Dienste', maxD: 'Maximale_Dienste', nWE: 'N_WE', maxWE: 'Maximale_WE' },
    dp: { date: 'Datum', dienst: 'Dienst', person: 'Person', verf: 'Verfugbar', wunsch: 'Wunsch', label: 'Kurzel', checkCol: 'Check_Dienstgruppe' },
    wish: { date: 'Datum', person: 'Person', df: 'DF', nv: 'NV', present: 'Anwesend', unerw: 'Unerwunscht', display: 'Display' },
    group: { labelShort: 'Kurzel', labelLong: 'Bezeichnung' }
  }
};

const $ = (sel, root=document) => root.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text!=null) n.textContent = text; return n; };
const byId = (arr) => Object.fromEntries(arr.map(r => [r.id, r]));
const toLower = (s)=> (s||'').toString().toLowerCase();
const cmp = (a,b)=> (a||'').toString().localeCompare((b||'').toString(), undefined, {sensitivity:'base'});

function colarize(table) {
  if (!table) return [];
  const keys = Object.keys(table).filter(k => Array.isArray(table[k]));
  const len = (table.id || table[keys[0]] || []).length;
  const rows = [];
  for (let i=0;i<len;i++) { const rec = {}; for (const k of keys) rec[k] = table[k][i]; rows.push(rec); }
  return rows;
}

// ---------- Global Context ----------
const ctx = {
  groupId:null, groupList:[],
  data:null, idx:null,
  touchedSelect:false, sort:"team", teamFilter:'all',
  cellActions: new Map(),
  tableClickBound:false,
  headerRO: null,
};

let groupCache = new Map();
let lastTeamKey = '';
let renderScheduled = false;
let popoverEl = null;

// ---------- Grist API Interaction ----------
grist.ready({ requiredAccess: 'full' });

async function fetchAll() {
  const doc = grist.docApi;
  const [tpPlan, tpDienstplan, tpPersonen, tpWuensche, tpGruppen] = await Promise.all([
    doc.fetchTable(CONFIG.tables.plan),
    doc.fetchTable(CONFIG.tables.dp),
    doc.fetchTable(CONFIG.tables.persons),
    doc.fetchTable(CONFIG.tables.wishes),
    doc.fetchTable(CONFIG.tables.groups),
  ]);
  return {
    Planungsperiode: colarize(tpPlan).sort((a,b)=> new Date(a[CONFIG.cols.plan.date]||0) - new Date(b[CONFIG.cols.plan.date]||0)),
    Dienstplan: colarize(tpDienstplan),
    Personen: colarize(tpPersonen),
    Dienstwunsche: colarize(tpWuensche),
    Dienstgruppen: colarize(tpGruppen),
  };
}

// ---------- Helpers ----------
function normalizeId(val){
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (Array.isArray(val) && val[0] === 'R' && typeof val[1] === 'number') return val[1];
  if (typeof val === 'object' && typeof val.id === 'number') return val.id;
  return null;
}
function teamLabel(p){ return p?.[CONFIG.cols.person.teamShort] || ''; }

function personGroupIds(p){
  let s = groupCache.get(p.id);
  if (s) return s;
  s = new Set();
  const arr = Array.isArray(p[CONFIG.cols.person.groups]) ? p[CONFIG.cols.person.groups] : [];
  if (arr[0] === 'L') {
      for(let i = 1; i < arr.length; i++) {
        const id = normalizeId(arr[i]);
        if (id != null) s.add(id);
      }
  } else {
    for (const v of arr) { const id = normalizeId(v); if (id != null) s.add(id); }
  }
  groupCache.set(p.id, s);
  return s;
}
function personGroupNamesByKurzel(p, dgById){
  const ids = Array.from(personGroupIds(p));
  if (!ids.length) return '-';
  return ids.map(id => dgById[id]?.[CONFIG.cols.group.labelShort] || dgById[id]?.[CONFIG.cols.group.labelLong] || `#${id}`).join(', ');
}
function matchGroup(val, groupId){ if (groupId == null) return true; const id = normalizeId(val); return id === groupId; }
function minDGId(p){
  const ids = Array.from(personGroupIds(p));
  if (!ids.length) return Number.POSITIVE_INFINITY;
  return Math.min(...ids);
}

function buildIndexes(data, groupId){
  const wByPersonDate = new Map();
  for (const w of data.Dienstwunsche) {
    const did = normalizeId(w[CONFIG.cols.wish.date]);
    const pid = normalizeId(w[CONFIG.cols.wish.person]);
    if (did == null || pid == null) continue;
    wByPersonDate.set(`${pid}|${did}`, w);
  }

  const verfByDate = new Map();
  const tooltipReasons = new Map();

  for (const dp of data.Dienstplan) {
    if (!matchGroup(dp[CONFIG.cols.dp.dienst], groupId)) continue;
    const did = normalizeId(dp[CONFIG.cols.dp.date]);
    if (did == null) continue;

    const availSet = new Set();
    const v = dp[CONFIG.cols.dp.verf];
    if (Array.isArray(v) && v[0] === 'L') for (let i = 1; i < v.length; i++) { const id = normalizeId(v[i]); if (id != null) availSet.add(id); }

    const wunschSet = new Set();
    const wunschRaw = dp[CONFIG.cols.dp.wunsch];
    if (Array.isArray(wunschRaw) && wunschRaw[0] === 'L') for (let i = 1; i < wunschRaw.length; i++) { const id = normalizeId(wunschRaw[i]); if (id != null) wunschSet.add(id); }

    const dienstId = normalizeId(dp[CONFIG.cols.dp.dienst]);

    let arr = verfByDate.get(did); if (!arr){ arr = []; verfByDate.set(did, arr); }
    arr.push({ dp, availSet, wunschSet, dienstId });

    const checkJson = dp[CONFIG.cols.dp.checkCol];
    if (typeof checkJson === 'string' && checkJson.startsWith('[')) {
      try {
        const checkData = JSON.parse(checkJson);
        if (Array.isArray(checkData)) {
          for (const item of checkData) {
            if (item.id && Array.isArray(item.Reasons) && item.Reasons.length > 0) {
              const key = `${dp.id}|${item.id}`;
              tooltipReasons.set(key, item.Reasons);
            }
          }
        }
      } catch (e) { /* JSON-Parsing-Fehler ignorieren */ }
    }
  }

  return { wByPersonDate, verfByDate, tooltipReasons };
}

function filteredSlotsForPerson(vlist, person){
  const gids = personGroupIds(person);
  if (!gids.size) return [];
  return (vlist || []).filter(slot => gids.has(slot.dienstId));
}

function countAvailability(vlist, w, person){
  const slots = filteredSlotsForPerson(vlist, person);
  if (!slots.length || !w) return {num:0, total: slots.length};
  const wid = w.id; let num = 0;
  for (const slot of slots) if (slot.availSet.has(wid)) num++;
  return {num, total: slots.length};
}
function hasWunschFor(vlist, w, person){
  const slots = filteredSlotsForPerson(vlist, person);
  if (!slots.length || !w) return false;
  const wid = w.id;
  return slots.some(slot => slot.wunschSet.has(wid));
}
function offeredChoicesFor(dateId, w, idx, person){
  const slots = filteredSlotsForPerson(idx.verfByDate.get(dateId) || [], person);
  const out = [];
  for (const {dp, availSet} of slots) if (availSet.has(w.id)) out.push(dp);
  return out;
}
function findAssignedDp(dateId, w, person){
  const slots = filteredSlotsForPerson(ctx.idx.verfByDate.get(dateId) || [], person);
  for (const {dp} of slots) {
    const pid = normalizeId(dp[CONFIG.cols.dp.person]);
    if (pid === w.id) return dp;
  }
  return null;
}

function sortPersons(arr){
  const mode = ctx.sort;
  const personShort = CONFIG.cols.person.short;
  const nD = CONFIG.cols.person.nD;
  const nWE = CONFIG.cols.person.nWE;
  
  if (mode === 'name_asc')  return [...arr].sort((a,b)=> cmp(a[personShort], b[personShort]));
  if (mode === 'name_desc') return [...arr].sort((a,b)=> cmp(b[personShort], a[personShort]));
  
  const numSort = (a,b,col) => (Number(a[col]||0) - Number(b[col]||0)) || cmp(a[personShort], b[personShort]);
  if (mode === 'dienste_asc')  return [...arr].sort((a,b)=> numSort(a,b,nD));
  if (mode === 'dienste_desc') return [...arr].sort((a,b)=> numSort(b,a,nD));
  if (mode === 'we_asc')  return [...arr].sort((a,b)=> numSort(a,b,nWE));
  if (mode === 'we_desc') return [...arr].sort((a,b)=> numSort(b,a,nWE));
  
  // default: team
  return [...arr].sort((a,b)=>{
    const ta = toLower(teamLabel(a)), tb = toLower(teamLabel(b));
    if (ta !== tb) return cmp(ta, tb);
    if (ctx.groupId == null) {
      const da = minDGId(a), db = minDGId(b);
      if (da !== db) return da - db;
    }
    return cmp(a[personShort], b[personShort]);
  });
}

function markColored(cell){ cell.dataset.colored = '1'; }

function scheduleRender(){
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(()=>{ renderScheduled = false; renderMatrix(); });
}

function toast(msg){
  const t = el('div','toast', msg);
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 3500);
}

function setLoader(visible) {
  const loader = $('#loader');
  if (loader) {
    if (visible) loader.classList.remove('hidden');
    else loader.classList.add('hidden');
  }
}

// ---------- Popover ----------
function closePopover(){
  if (!popoverEl) return;
  window.removeEventListener('click', onDocClick, true);
  window.removeEventListener('keydown', onKey, true);
  popoverEl.remove(); popoverEl = null;
}
function onDocClick(e){ if (popoverEl && !popoverEl.contains(e.target)) closePopover(); }
function onKey(e){ if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } }

function openPopoverForCell(cell, {person, w, date, choices=[], assignedDp=null}){
  closePopover();
  const rect = cell.getBoundingClientRect();
  popoverEl = el('div','popover'); popoverEl.tabIndex = -1;

  const h = el('h4', null, `Schicht wählen (${person[CONFIG.cols.person.short] ?? ''} – ${date[CONFIG.cols.plan.kurzel] ?? ''})`);
  popoverEl.appendChild(h);

  if (assignedDp) {
    const del = el('div','opt');
    const label = assignedDp[CONFIG.cols.dp.label] || `Dienst #${assignedDp.id}`;
    const strong = el('strong', null, '🗑️ Zuweisung löschen');
    const small = el('small', null, label);
    small.style.cssText='display:block;opacity:.7';
    del.appendChild(strong); del.appendChild(small);
    del.addEventListener('click', ()=> assignPerson(assignedDp.id, null));
    popoverEl.appendChild(del);
    popoverEl.appendChild(el('hr','sep'));
  }

  if (choices.length === 0) {
    popoverEl.appendChild(el('div','empty','Keine passenden Schichten.'));
  } else {
    for (const dp of choices) {
      const row = el('div','opt');
      row.textContent = dp[CONFIG.cols.dp.label] || `Dienst #${dp.id}`;
      row.addEventListener('click', ()=> assignPerson(dp.id, w.id));
      popoverEl.appendChild(row);
    }
  }

  document.body.appendChild(popoverEl);
  const top = Math.min(window.innerHeight - popoverEl.offsetHeight - 8, rect.bottom + 6);
  const left = Math.min(window.innerWidth - popoverEl.offsetWidth - 8, rect.left);
  popoverEl.style.top = `${Math.max(6, top)}px`;
  popoverEl.style.left = `${Math.max(6, left)}px`;

  setTimeout(()=> {
    window.addEventListener('click', onDocClick, true);
    window.addEventListener('keydown', onKey, true);
    popoverEl.focus();
  }, 0);
}

// ---------- Assignment (optimistisch) ----------
async function assignPerson(dpId, personId){
  setLoader(true);
  try {
    const dp = ctx.data.Dienstplan.find(r => r.id === dpId);
    if (dp) dp[CONFIG.cols.dp.person] = personId ?? null;
    ctx.idx = buildIndexes(ctx.data, ctx.groupId);
    scheduleRender();
    await grist.docApi.applyUserActions([["UpdateRecord", CONFIG.tables.dp, dpId, { [CONFIG.cols.dp.person]: personId ?? null }]]);
  } catch (e) {
    console.error("Assignment failed:", e);
    toast('Aktualisierung fehlgeschlagen – synchronisiere neu …');
    await hardRefresh();
  } finally {
    closePopover();
    setLoader(false);
  }
}

// ---------- UI Builders & Updaters ----------
function applyHeaderFlagStyles(dates){
  let tag = document.getElementById('hdrFlagsStyle');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'hdrFlagsStyle';
    document.head.appendChild(tag);
  }
  let css = '';
  for (let i = 0; i < dates.length; i++) {
    const flag = !!dates[i]?.[CONFIG.cols.plan.check];
    const bg = flag ? 'var(--hdr-true)' : 'var(--hdr-false)';
    const colRow1 = i + 2;
    const colRow2 = i + 1;
    css += `thead tr:nth-child(1) th:nth-child(${colRow1}){background-color:${bg}!important;}\n`;
    css += `thead tr:nth-child(2) th:nth-child(${colRow2}){background-color:${bg}!important;}\n`;
  }
  tag.textContent = css;
}

function updateHeaderStickyOffsets() {
  const headRow1 = $('#matrix thead tr:nth-child(1)');
  const h = headRow1 ? Math.ceil(headRow1.getBoundingClientRect().height) : 32;
  document.documentElement.style.setProperty('--hdr-row1-h', `${h}px`);
}

function buildTeamFilterOptions(basePersons){
  const sel = $('#teamFilter');
  const prev = ctx.teamFilter ?? 'all';
  const teams = [...new Set(basePersons.map(p => teamLabel(p) || ''))]
    .sort((a,b)=> cmp(a,b));
  const key = teams.join('|');
  if (key === lastTeamKey && sel.options.length) return;
  lastTeamKey = key;
  sel.innerHTML = '';
  sel.appendChild(el('option', null, 'Alle Teams')).value = 'all';
  for (const t of teams) {
    const opt = el('option', null, t === '' ? 'Ohne Team' : t);
    opt.value = (t === '' ? '__none__' : t);
    sel.appendChild(opt);
  }
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'all';
  sel.onchange = () => {
    ctx.teamFilter = sel.value;
    scheduleRender();
  };
}
function applyTeamFilter(persons){
  const f = ctx.teamFilter;
  if (!f || f === 'all') return persons;
  if (f === '__none__') return persons.filter(p => !teamLabel(p));
  return persons.filter(p => teamLabel(p) === f);
}

function buildGroupSelect(){
  const sel = $('#groupSelect');
  sel.innerHTML = '';
  sel.appendChild(el('option', null, 'Alle Dienstgruppen')).value = 'all';
  for (const g of ctx.groupList) {
    const opt = el('option', null, g[CONFIG.cols.group.labelLong] ?? g[CONFIG.cols.group.labelShort] ?? `Gruppe #${g.id}`);
    opt.value = String(g.id);
    sel.appendChild(opt);
  }
  sel.value = (ctx.groupId == null) ? 'all' : String(ctx.groupId);
  sel.addEventListener('change', ()=> {
    ctx.touchedSelect = true;
    ctx.groupId = (sel.value === 'all') ? null : Number(sel.value);
    hardRefresh();
  });
}

function buildSortSelect(){
  const sel = $('#sortSelect');
  sel.value = ctx.sort;
  sel.addEventListener('change', ()=> {
    ctx.sort = sel.value;
    scheduleRender();
  });
}

function ensureTableClickHandler(){
  if (ctx.tableClickBound) return;
  $('#matrix').addEventListener('click', (ev)=>{
    const td = ev.target.closest('td[data-cellkey]');
    if (td) {
        const info = ctx.cellActions.get(td.dataset.cellkey);
        if (info) openPopoverForCell(td, info);
    }
  });
  ctx.tableClickBound = true;
}

// ---------- Render ----------
function renderLegend(){
  const leg = $('#legend'); leg.innerHTML = '';
  const legend = el('div','legend');
  const items = [
    {bg: 'var(--blue)', text: 'belegt (Dienstplan)'},
    {bg: 'var(--gray)', text: 'DF'},
    {bg: 'var(--darkg)', text: 'NV'},
    {bg: 'var(--black)', text: 'nicht anwesend'},
    {bg: 'var(--green)', text: 'verfügbar (Wunsch)'},
    {bg: 'var(--yellow)', text: 'verfügbar (unerwünscht)'},
    {bg: '#fff', text: 'verfügbar (neutral)'},
    {bg: 'repeating-linear-gradient(45deg,#16a34a 0,#16a34a 8px,var(--red) 8px,var(--red)16px)', text: 'teilweise verfügbar (Wunsch)', isImg: true},
    {bg: 'repeating-linear-gradient(45deg,#facc15 0,#facc15 8px,var(--red) 8px,var(--red)16px)', text: 'teilweise verfügbar (unerwünscht)', isImg: true},
    {bg: 'repeating-linear-gradient(45deg,#ffffff 0,#ffffff 8px,var(--red) 8px,var(--red)16px)', text: 'teilweise verfügbar (neutral)', isImg: true},
  ];
  for (const item of items) {
    const d = el('div','item');
    const sw = el('span','swatch');
    if (item.isImg) sw.style.backgroundImage = item.bg; else sw.style.background = item.bg;
    d.appendChild(sw); d.appendChild(el('span', null, ' '+item.text));
    legend.appendChild(d);
  }
  leg.appendChild(legend);
}

function renderMatrix(){
  closePopover();
  const host = $('#matrix'); host.innerHTML = '';
  $('#legend').innerHTML = '';

  if (!ctx.data || !ctx.data.Planungsperiode.length) {
    host.appendChild(el('div', 'empty-state', 'Keine Planungsdaten gefunden. Bitte fügen Sie Tage in der Tabelle "Planungsperiode" hinzu.'));
    return;
  }
  
  const dates = ctx.data.Planungsperiode;
  document.documentElement.style.setProperty('--date-cols', String(dates.length));

  const personenByGroup = (ctx.groupId == null)
    ? ctx.data.Personen
    : ctx.data.Personen.filter(p => personGroupIds(p).has(ctx.groupId));

  if (!personenByGroup.length) {
    host.appendChild(el('div', 'empty-state', 'Für die ausgewählte Dienstgruppe wurden keine Personen gefunden.'));
    return;
  }
  
  const personen = sortPersons(applyTeamFilter(personenByGroup));
  const dgById = byId(ctx.data.Dienstgruppen);

  $('#groupInfo').textContent = (ctx.groupId == null)
    ? 'Alle Gruppen'
    : dgById[ctx.groupId]?.[CONFIG.cols.group.labelLong] || '–';

  const table = el('table','matrix');
  const thead = el('thead');
  let tr = el('tr');
  const personHeader = (ctx.groupId == null) ? 'Person (Team / DG)' : 'Person (Team)';
  const hPerson = el('th','th col-person', personHeader); hPerson.rowSpan = 2; tr.appendChild(hPerson);
  dates.forEach(d => tr.appendChild(el('th','th col-date', d[CONFIG.cols.plan.kurzel] ?? '')));
  const thDienste = el('th','th col-sum col-sum-1','# Dienste'); thDienste.rowSpan = 2; tr.appendChild(thDienste);
  const thWE = el('th','th col-sum col-sum-2','# WE'); thWE.rowSpan = 2; tr.appendChild(thWE);
  thead.appendChild(tr);

  tr = el('tr');
  dates.forEach(d => tr.appendChild(el('th','th col-date', String(d[CONFIG.cols.plan.tag] ?? '').slice(0,2))));
  thead.appendChild(tr);
  table.appendChild(thead);
  applyHeaderFlagStyles(dates);

  const tbody = el('tbody');
  ctx.cellActions.clear();
  let prevTeamKey = null;

  personen.forEach((person, i) => {
    const teamKey = toLower(teamLabel(person));
    const isTeamBreak = (ctx.sort === 'team' && prevTeamKey !== null && teamKey !== prevTeamKey);
    const row = el('tr','tr '+(i % 2 === 0 ? 'even' : 'odd') + (isTeamBreak ? ' team-sep' : ''));

    const dgNames = personGroupNamesByKurzel(person, dgById);
    const personText = (ctx.groupId == null)
      ? `${person[CONFIG.cols.person.short] ?? ''} (${teamLabel(person)} / ${dgNames})`
      : `${person[CONFIG.cols.person.short] ?? ''} (${teamLabel(person)})`;
    row.appendChild(el('td','td col-person', personText));

    dates.forEach(d => {
      const key = `${person.id}|${d.id}`;
      const w = ctx.idx.wByPersonDate.get(key);
      const cell = el('td','td col-date bold');
      cell.textContent = w?.[CONFIG.cols.wish.display] ?? '';
      
      if (w) {
        const vlistAll = ctx.idx.verfByDate.get(d.id) || [];
        const assignedDp = findAssignedDp(d.id, w, person);
        if (assignedDp) {
          cell.classList.add('c-blue'); markColored(cell);
          const choices = offeredChoicesFor(d.id, w, ctx.idx, person).filter(dp => dp.id !== assignedDp.id);
          cell.dataset.cellkey = key;
          ctx.cellActions.set(key, {person, w, date:d, choices, assignedDp});
          cell.style.cursor = 'pointer';
        } else if (w[CONFIG.cols.wish.df]) {
          cell.classList.add('c-gray'); markColored(cell);
        } else if (w[CONFIG.cols.wish.nv]) {
          cell.classList.add('c-darkg'); markColored(cell);
        } else if (w[CONFIG.cols.wish.present] === false) {
          cell.classList.add('c-black'); markColored(cell);
        } else {
          const {num:numAvail, total:totalSlots} = countAvailability(vlistAll, w, person);
          const hasWunsch = hasWunschFor(vlistAll, w, person);
          const isUnerw = !!w[CONFIG.cols.wish.unerw];
          if (totalSlots === 0 || numAvail === 0) {
            cell.classList.add('c-red');
            const allReasons = new Set();
            const slotsForDay = ctx.idx.verfByDate.get(d.id) || [];
            for (const slot of filteredSlotsForPerson(slotsForDay, person)) {
              const reasonKey = `${slot.dp.id}|${w.id}`;
              const reasons = ctx.idx.tooltipReasons.get(reasonKey);
              if (reasons) {
                reasons.forEach(r => allReasons.add(r));
              }
            }
            if (allReasons.size > 0) {
              cell.title = Array.from(allReasons).join('\n');
            }
          } else if (numAvail === totalSlots) {
            if (hasWunsch) cell.classList.add('c-green');
            else if (isUnerw) cell.classList.add('c-yellow');
          } else {
            if (hasWunsch) cell.classList.add('pat-green-red');
            else if (isUnerw) cell.classList.add('pat-yellow-red');
            else cell.classList.add('pat-white-red');
          }
          if (cell.classList.length > 2) markColored(cell);

          const choices = offeredChoicesFor(d.id, w, ctx.idx, person);
          if (choices.length > 0) {
            cell.dataset.cellkey = key;
            ctx.cellActions.set(key, {person, w, date:d, choices});
            cell.style.cursor = 'pointer';
          }
        }
      }
      row.appendChild(cell);
    });

    const nD = person[CONFIG.cols.person.nD] ?? 0, maxD = person[CONFIG.cols.person.maxD] ?? 0;
    const tdD = el('td','td bold col-sum col-sum-1', `${nD} / ${maxD}`);
    if (nD > maxD) { tdD.classList.add('c-red'); markColored(tdD); }
    row.appendChild(tdD);

    const nWE = person[CONFIG.cols.person.nWE] ?? 0, maxWE = person[CONFIG.cols.person.maxWE] ?? 0;
    const tdWE = el('td','td bold col-sum col-sum-2', `${nWE} / ${maxWE}`);
    if (nWE > maxWE) { tdWE.classList.add('c-red'); markColored(tdWE); }
    row.appendChild(tdWE);
    
    tbody.appendChild(row);
    prevTeamKey = teamKey;
  });

  table.appendChild(tbody);
  host.appendChild(table);

  ensureTableClickHandler();
  renderLegend();

  updateHeaderStickyOffsets();
  window.addEventListener('resize', updateHeaderStickyOffsets);
  if (ctx.headerRO) try { ctx.headerRO.disconnect(); } catch{}
  const theadEl = table.querySelector('thead');
  if (window.ResizeObserver && theadEl) {
    ctx.headerRO = new ResizeObserver(updateHeaderStickyOffsets);
    ctx.headerRO.observe(theadEl);
  }
}

// ---------- Main Refresh & Initialization ----------
async function hardRefresh() {
  await refresh();
}

async function refresh(selectedRecord, options = {}){
  const { soft = false } = options;
  if (!soft) {
    setLoader(true);
  }
  
  try {
    const isInitialLoad = !ctx.data;
    ctx.data = await fetchAll();
    if (!isInitialLoad) groupCache.clear();

    if (isInitialLoad) {
      ctx.groupList = [...ctx.data.Dienstgruppen].sort((a,b)=> cmp(a[CONFIG.cols.group.labelLong] || a[CONFIG.cols.group.labelShort], b[CONFIG.cols.group.labelLong] || b[CONFIG.cols.group.labelShort]));
      buildGroupSelect();
      buildSortSelect();
    }

    if (selectedRecord && selectedRecord.id != null && !ctx.touchedSelect) {
      ctx.groupId = selectedRecord.id;
    }
    
    const sel = $('#groupSelect');
    if (sel) {
      sel.value = (ctx.groupId == null) ? 'all' : String(ctx.groupId);
    }

    ctx.idx = buildIndexes(ctx.data, ctx.groupId);
    const basePersons = (ctx.groupId == null)
      ? ctx.data.Personen
      : ctx.data.Personen.filter(p => personGroupIds(p).has(ctx.groupId));
    buildTeamFilterOptions(basePersons);
    scheduleRender();
  } catch (e) {
    console.error("Refresh failed:", e);
    $('#matrix').innerHTML = '';
    $('#matrix').appendChild(el('div', 'empty-state', 'Ein Fehler ist aufgetreten. Prüfen Sie die Tabellen- und Spaltennamen.'));
  } finally {
    if (!soft) {
      setLoader(false);
    }
  }
}

let initialLoadHandled = false;

grist.onRecord((record) => {
  initialLoadHandled = true;
  refresh(record);
});

grist.onRecords(() => {
  if (!initialLoadHandled) {
    initialLoadHandled = true;
    refresh();
  } else {
    refresh(null, { soft: true });
  }
});