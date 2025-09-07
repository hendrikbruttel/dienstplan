/* script.js — Bulk-Paste ➜ Grist (Startdatum + dynamische Tage; onRecords; Mapping Pflicht)
   - Chunk-Größe = 100
   - Fortschrittsleiste + Prozent + Abbrechen
*/
(() => {
  // ------------------ Config / State ------------------
  const INITIAL_DAYS = 7;
  const CHUNK_SIZE   = 100;
  let colCount = INITIAL_DAYS;
  let rows = [];             // [{ person: string, cells: string[] }]
  let sel  = { r: 0, c: 0 };

  // Startdatum
  let startDate = null;      // Date (lokale Mitternacht)
  let isoDates = [];         // vorab berechnete ISO-Daten je Spalte ("YYYY-MM-DD")
  let colsDirty = true;

  // Grist
  let linkedTableId = null;  // tableId für applyUserActions
  let latestMappings = null; // aus onRecords (zwingend)

  // Import-Flow
  let importing = false;
  let cancelRequested = false;

  // ------------------ DOM ------------------
  const $            = (s) => document.querySelector(s);
  const thead        = $('#grid thead');
  const tbody        = $('#grid tbody');
  const gridWrap     = $('#gridWrap');
  const statusBox    = $('#status');
  const progressWrap = $('#progressWrap');
  const progressBar  = $('#progressBar');
  const startInput   = $('#startDate');

  const clearBtn     = $('#clearGrid');
  const pasteBtn     = $('#pasteBtn');
  const commitBtn    = $('#commitBtn');
  const cancelBtn    = $('#cancelBtn');

  // ------------------ Utils ------------------
  const sanitize = (s)=> (s==null ? '' : String(s).replace(/\r/g,'').trim());
  const isEmpty  = (s)=> sanitize(s)==='';
  const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  function setStatus(msg, kind='info') {
    if (!statusBox) return;
    statusBox.textContent = msg || '';
    statusBox.style.color = (kind==='error') ? '#dc2626' : (kind==='ok') ? '#0284c7' : '#6b7280';
  }

  // Fortschritt-Helpers
  function showProgress(){ if (progressWrap) progressWrap.hidden = false; setProgress(0); }
  function hideProgress(){ if (progressWrap) progressWrap.hidden = true; }
  function setProgress(pct){
    if (!progressBar) return;
    const v = Math.max(0, Math.min(100, Math.floor(pct)));
    progressBar.style.width = v + '%';
    progressBar.setAttribute('aria-valuenow', String(v));
  }

  function ymd(d){ return [d.getFullYear(), d.getMonth()+1, d.getDate()]; }
  function toISODate(d){
    const [Y,M,D] = ymd(d);
    const mm = String(M).padStart(2,'0');
    const dd = String(D).padStart(2,'0');
    return `${Y}-${mm}-${dd}`;
  }
  function fromISODate(s){
    const [Y,M,D] = (s||'').split('-').map(x=>parseInt(x,10));
    if (!Y || !M || !D) return null;
    const d = new Date(Y, M-1, D, 0, 0, 0, 0);
    d.setHours(0,0,0,0);
    return d;
  }
  function dateForCol(index){
    if (!startDate) return null;
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index, 0,0,0,0);
    d.setHours(0,0,0,0);
    return d;
  }
  function formatHeader(d){
    const [Y,M,D] = ymd(d);
    return `${String(D).padStart(2,'0')}.${String(M).padStart(2,'0')}.${Y}`;
  }

  function recomputeIsoDates(){
    isoDates = Array.from({length: colCount}, (_,i)=>{
      const d = dateForCol(i);
      return d ? toISODate(d) : null;
    });
  }

  // ------------------ Grid Model & Rendering ------------------
  function ensureColCount(n){
    if(n>colCount){
      colCount = n;
      colsDirty = true;
      recomputeIsoDates();
    }
  }
  function ensureRowCount(n){
    while(rows.length<n) rows.push({ person:'', cells:Array(colCount).fill('') });
  }
  function normalizeRowLengths(){
    if (!colsDirty) return;
    for(const r of rows){
      if(!Array.isArray(r.cells)) r.cells=[];
      if(r.cells.length<colCount) r.cells.push(...Array(colCount-r.cells.length).fill(''));
      else if(r.cells.length>colCount) r.cells.length=colCount;
    }
    colsDirty = false;
  }

  function renderHeader(){
    if (!thead) return;
    const tr=document.createElement('tr');

    const thPerson=document.createElement('th');
    thPerson.textContent='Person';
    tr.appendChild(thPerson);

    for(let i=0;i<colCount;i++){
      const th=document.createElement('th');
      const d = dateForCol(i);
      th.textContent = d ? formatHeader(d) : '';
      tr.appendChild(th);
    }
    thead.innerHTML=''; thead.appendChild(tr);
  }

  function makeCellEditable(td, rIndex, cIndex){
    td.contentEditable='true';
    td.spellcheck=false;
    td.addEventListener('focus', ()=>{ sel={r:rIndex,c:cIndex}; });
    td.addEventListener('click',  ()=>{ sel={r:rIndex,c:cIndex}; });
    td.addEventListener('input', ()=>{
      const v=sanitize(td.textContent);
      if(cIndex===0) rows[rIndex].person=v;
      else rows[rIndex].cells[cIndex-1]=v;
      updateCommitButton();
    });
    td.addEventListener('paste',(e)=>{
      e.preventDefault();
      const text=(e.clipboardData||window.clipboardData).getData('text');
      handlePaste(text, rIndex, cIndex);
    });
  }

  function renderBody(){
    if (!tbody) return;
    tbody.innerHTML='';
    rows.forEach((row,r)=>{
      const tr=document.createElement('tr');

      const tdP=document.createElement('td');
      tdP.textContent=row.person||'';
      if(isEmpty(row.person)) tdP.classList.add('cell-empty');
      makeCellEditable(tdP,r,0);
      tr.appendChild(tdP);

      for(let c=1;c<=colCount;c++){
        const td=document.createElement('td');
        const val=row.cells[c-1]||'';
        td.textContent=val;
        if(isEmpty(val)) td.classList.add('cell-empty');
        makeCellEditable(td,r,c);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    });
  }

  function renderAll(){
    normalizeRowLengths();
    renderHeader();
    renderBody();
    updateCommitButton();
  }

  // ------------------ Startdatum handling ------------------
  function applyStartFromInput(){
    startDate = fromISODate(startInput?.value || '');

    if (rows.length === 0) {
      ensureRowCount(1);
    }

    recomputeIsoDates();
    renderAll();
    if (!startDate) {
      setStatus('Bitte Startdatum setzen.', 'error');
    } else {
      const lastIdx = Math.max(0, colCount-1);
      const last = dateForCol(lastIdx);
      setStatus(`Start: ${formatHeader(startDate)} • Spalten: ${colCount}${last? ` • Letzte Spalte: ${formatHeader(last)}`:''}`);
    }
  }

  // ------------------ Paste handling (nur Tab / \n) ------------------
  function parseClipboard(text){
    const rowsRaw = text.replace(/\r/g,'').split('\n');
    const trimmed = (rowsRaw.length && rowsRaw[rowsRaw.length-1]==='') ? rowsRaw.slice(0,-1) : rowsRaw;
    return trimmed.map(line => line.split('\t').map(sanitize));
  }

  function handlePaste(text, startRow=sel.r, startCol=sel.c){
    const block=parseClipboard(text);
    if(!block.length) return;

    const neededCols = Math.max(0, startCol + block[0].length - 1);
    ensureColCount(Math.max(colCount, neededCols));

    ensureRowCount(startRow + block.length);

    for (let r = 0; r < block.length; r++) {
      const tRow = rows[startRow + r] || { person:'', cells:Array(colCount).fill('') };
      const line = block[r];
      for (let c = 0; c < line.length; c++) {
        const gCol = startCol + c;
        const val = line[c];
        if (gCol === 0) tRow.person = val;
        else if (gCol >= 1) {
          if (!tRow.cells) tRow.cells = Array(colCount).fill('');
          if (tRow.cells.length < colCount) tRow.cells.push(...Array(colCount - tRow.cells.length).fill(''));
          tRow.cells[gCol - 1] = val;
        }
      }
      rows[startRow + r] = tRow;
    }

    renderAll();
    setStatus(`Eingefügt: ${block.length} Zeilen × ${block[0].length} Spalten.`);
  }

  // ------------------ Button-Logik ------------------
  function rowsWithPersonCount(){
    let n=0;
    for (let r=0; r<rows.length; r++) if (!isEmpty(rows[r].person)) n++;
    return n;
  }
  function environmentReady(){
    return !!(
      linkedTableId &&
      window.grist?.docApi?.applyUserActions &&
      startDate &&
      latestMappings &&
      typeof window.grist?.mapColumnNamesBack === 'function'
    );
  }
  const updateCommitButton = ()=>{
    if (!commitBtn) return;
    const nPersons = rowsWithPersonCount();
    const n = nPersons * colCount;
    const ready = environmentReady() && nPersons > 0 && colCount > 0 && !importing;
    commitBtn.disabled = !ready;
    commitBtn.textContent = ready ? `Übernehmen (${n})` : `Übernehmen`;
  };

  // ------------------ Busy-UI & Cancel ------------------
  function setBusy(isBusy){
    importing = isBusy;
    cancelRequested = false;
    if (pasteBtn)   pasteBtn.disabled   = isBusy;
    if (clearBtn)   clearBtn.disabled   = isBusy;
    if (startInput) startInput.disabled = isBusy;
    if (commitBtn)  commitBtn.disabled  = true;

    if (cancelBtn) {
      cancelBtn.style.display = isBusy ? 'inline-block' : 'none';
      cancelBtn.disabled = !isBusy;
    }

    if (isBusy) showProgress(); else hideProgress();
  }
  cancelBtn?.addEventListener('click', ()=>{
    cancelRequested = true;
    cancelBtn.disabled = true;
    setStatus('Abbruch angefordert …');
  });

  // ------------------ Schreiben (mit Fortschrittsleiste + Abbrechen) ------------------
  async function applyActionsInChunksWithProgress(actions, size=CHUNK_SIZE){
    let done = 0;
    const total = actions.length;

    // Initial 0 %
    setProgress(0);

    for (let i = 0; i < total; i += size) {
      if (cancelRequested) {
        const pct = Math.floor((done / total) * 100);
        setProgress(pct);
        setStatus(`Abgebrochen: ${done}/${total} (${pct}%) eingefügt.`, 'error');
        return { cancelled: true, done, total };
      }
      const chunk = actions.slice(i, i + size);
      await window.grist.docApi.applyUserActions(chunk);
      done += chunk.length;
      const pct = Math.floor((done / total) * 100);
      setProgress(pct);
      setStatus(`Einfügen: ${done}/${total} (${pct}%) …`);
    }

    setProgress(100);
    setStatus('Fertig.', 'ok');
    return { cancelled: false, done, total };
  }

  async function commitToGrist(){
    if (!environmentReady()){
      setStatus('Bitte Startdatum setzen.', 'error');
      return;
    }

    const actions = [];
    let anyPerson = false;

    for (let r = 0; r < rows.length; r++) {
      const person = sanitize(rows[r].person);
      if (isEmpty(person)) continue;
      anyPerson = true;

      for (let j = 0; j < colCount; j++) {
        const wish = sanitize(rows[r].cells[j]);
        const isoDate = isoDates[j];

        const friendlyFields = { Input_Person: person, Input_Datum: isoDate, Wunsch: wish };
        const resolvedFields = window.grist.mapColumnNamesBack(friendlyFields, { mappings: latestMappings });

        actions.push(['AddRecord', linkedTableId, null, resolvedFields]);
      }
    }

    if (!anyPerson) {
      setStatus('Keine Personenzeilen gefunden.', 'error');
      return;
    }
    if (!actions.length) {
      setStatus('Nichts zu übernehmen – keine Daten gefunden.', 'error');
      return;
    }

    try {
      setBusy(true);
      setStatus(`Einfügen: 0/${actions.length} (0%) …`);
      const result = await applyActionsInChunksWithProgress(actions, CHUNK_SIZE);
      if (result.cancelled) return;
      setStatus('Fertig.', 'ok');
    } catch (e) {
      setStatus(`Fehler beim Anlegen: ${e?.message || e}`, 'error');
    } finally {
      setBusy(false);
      updateCommitButton();
    }
  }

  // ------------------ Grist Init ------------------
  async function getTableIdViaTableOps() {
    const t = window.grist?.getTable?.();
    const tableOps = (t && typeof t.then === 'function') ? await t : t;
    if (tableOps?.getTableId) {
      return await tableOps.getTableId();
    }
    return null;
  }

  async function initGrist(){
    const GR = window.grist;
    if (!GR) { setStatus('Grist-API nicht gefunden. Läuft das Widget in Grist?', 'error'); return; }

    GR.ready({
      requiredAccess: 'full',
      columns: [
        { name:'Input_Person', title:'Input_Person' },
        { name:'Input_Datum',  title:'Input_Datum'  },
        { name:'Wunsch',       title:'Wunsch'       },
      ],
    });

    if (GR.onRecords) {
      GR.onRecords((records, mappings) => {
        latestMappings = mappings || latestMappings;
        updateCommitButton();
      });
    }

    linkedTableId = await getTableIdViaTableOps();

    // Default: 01. des Folgemonats
    (function setDefaultStartDate() {
      if (!startInput || startInput.value) return;
      const now = new Date();
      const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      firstOfNextMonth.setHours(0, 0, 0, 0);
      startInput.value = toISODate(firstOfNextMonth);
    })();

    applyStartFromInput();
    updateCommitButton();
  }

  // ------------------ Events ------------------
  function bindEvents(){
    clearBtn?.addEventListener('click', ()=>{
      if (importing) return;
      rows=[]; ensureRowCount(1);
      renderAll();
      setStatus(startDate ? `Start: ${formatHeader(startDate)} • Spalten: ${colCount}` : 'Bitte Startdatum setzen.', startDate ? 'info' : 'error');
    });

    pasteBtn?.addEventListener('click', ()=>{
      if (importing) return;
      gridWrap?.focus();
      setStatus('Fokus im Raster – jetzt Strg/⌘+V zum Einfügen.');
    });

    gridWrap?.addEventListener('paste', (e)=>{
      if (importing) return;
      e.preventDefault();
      const text=(e.clipboardData||window.clipboardData)?.getData('text');
      if(text) handlePaste(text, sel.r, sel.c);
    });

    commitBtn?.addEventListener('click', ()=>{
      if (!importing) commitToGrist();
    });

    startInput?.addEventListener('change', ()=>{
      if (importing) return;
      applyStartFromInput();
    });

    tbody?.addEventListener('input', debounce(updateCommitButton, 150));
  }

  // ------------------ Bootstrap ------------------
  (async function main(){
    try { bindEvents(); await initGrist(); }
    catch (e) { setStatus(`Init-Fehler: ${e?.message||e}`, 'error'); }
  })();
})();
