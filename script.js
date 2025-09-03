(()=>{
  // ---------- utils ----------
  const PALETTE={green:{bg:"#dcfce7",fg:"#166534",dot:"#16a34a"},yellow:{bg:"#fef9c3",fg:"#854d0e",dot:"#facc15"},red:{bg:"#fee2e2",fg:"#991b1b",dot:"#dc2626"},gray:{bg:"#e5e7eb",fg:"#374151",dot:"#9ca3af"},blue:{bg:"#dbeafe",fg:"#1e3a8a"}};
  const bucket=v=>{ if(typeof v==="boolean") v=v?1:0; const x=parseFloat(v); if(Number.isNaN(x)) return "gray"; if(x>=1) return "green"; if(x<=0) return "red"; return "yellow"; };
  const escapeHTML = (s)=>{
    if(s==null) return "";
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
  };
  const badge=(col,text)=>{
    const c = ["green","yellow","red","gray"].includes(col)? col : "gray";
    return `<span class="badge badge--${c}">${escapeHTML(text??"")}</span>`;
  };
  const dot=col=>{
    const c = ["green","yellow","red","gray"].includes(col)? col : "gray";
    return `<span class="dot dot--${c}"></span>`;
  };
  const safeJSON=(v,fallback)=>{ if(v==null) return fallback; if(typeof v==="string"){ const t=v.trim(); if(!t) return fallback; try{ return JSON.parse(t);}catch(e){ console.warn("JSON parse error:",e,v); return fallback; } } if(typeof v==="object") return v; return fallback; };
  const debounce=(fn, wait=16)=>{ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; };
  const closest = (el, sel)=>{ while(el && el.nodeType===1){ if(el.matches(sel)) return el; el=el.parentElement; } return null; };
  let listenersInstalled=false;
  let selectedPersonId=null;
  let lastRecord=null;
  let lastMappings=null;
  let lastRowId=null;
  let lastTableId=null;
  let personColId='Person';
  let tableApi=null;
  let lastSave=null;

  async function writePersonId(id){
    const GR = window.grist;
    if(!GR){ console.warn('grist API nicht vorhanden'); return; }
    // 1) getTable().update bevorzugen (stabil, entspricht deinem Beispiel)
    try{
      if(!tableApi && typeof GR.getTable === 'function'){
        tableApi = GR.getTable();
      }
      if(tableApi && typeof tableApi.update === 'function' && lastRowId && personColId){
        if(lastSave){ return; }
        const fields={}; fields[personColId]=id;
        lastSave = tableApi.update({ id: lastRowId, fields }).finally(()=>{ lastSave=null; });
        return lastSave;
      }
    }catch(e){ console.warn('getTable().update fehlgeschlagen:', e); }
    // 2) Doc API wie im Beispiel (falls benötigt)
    try{
      const docApi = GR.docApi;
      if(docApi && typeof docApi.applyUserActions === 'function' && lastRowId && lastTableId && personColId){
        const patch = {}; patch[personColId] = String(id);
        return docApi.applyUserActions([[ 'UpdateRecord', lastTableId, lastRowId, patch ]]);
      }
    }catch(e){ console.warn('applyUserActions fehlgeschlagen:', e); }
    // 3) setCellValue (falls verfügbar)
    if(typeof GR.setCellValue === 'function'){
      return GR.setCellValue('Person', String(id));
    }
    // 4) Weitere (ältere) APIs
    if(typeof GR.setValue === 'function'){
      return GR.setValue('Person', String(id));
    }
    if(typeof GR.update === 'function'){
      return GR.update({ Person: String(id) });
    }
    if(typeof GR.updateRecord === 'function'){
      return GR.updateRecord({ Person: String(id) });
    }
    console.warn('Kein Schreibweg verfügbar. Bitte prüfe: Access=Full, Mapping der Spalte Person, ausgewählte Zeile, mappings.tableId und columns.Person.colId.');
  }

  // ---------- checks ----------
  function renderChecks(checksObj){
    if(!checksObj||typeof checksObj!=="object") return "<ul></ul>";
    let html="<ul class=\"check-list\">";
    for(const k of Object.keys(checksObj)){
      const o=checksObj[k]; if(!o?.applicable) continue;
      const active=o.active===true;
      const col = active? "green":"red";
      html+=`<li class="check-item">${dot(col)}<span class="text-default">${escapeHTML(o.display||k)}</span></li>`;
    }
    html+="</ul>"; return html;
  }

  // ---------- info (Key/Value aus InfoJSON) ----------
  function renderInfo(infoObj){
    if(!infoObj||typeof infoObj!=="object"||!Object.keys(infoObj).length){
      return `<div class="card card--min"><div class="hdr">Dienstplan Schicht</div><div class="text-muted">Keine Daten</div></div>`;
    }
    let rows=""; for(const k of Object.keys(infoObj)){ rows+=`<tr><td>${escapeHTML(k)}</td><td>${escapeHTML(infoObj[k]??"")}</td></tr>`; }
    return `<div class="card card--min"><div class="hdr"> Schicht Info</div><div class="flex-1"><table class="kv-table"><tbody>${rows}</tbody></table></div></div>`;
  }

  // ---------- tabelle unten ----------
  function renderTable(data){
    if(!Array.isArray(data)||!data.length){
      return `<div class="card"><div class="hdr">Übersicht</div><div class="text-muted">Keine Daten</div></div>`;
    }
    const translations={AnwesenheitFolgetag:"Folgetag",TeamFolgetag:"Folgetag"};
    const cols=Object.keys(data[0]);
    let thead="<thead><tr>";
    for(const c of cols){ const label=translations[c]||c; const thClass = c==="Person"?"text-left":""; thead+=`<th scope="col" class="${thClass}">${escapeHTML(label)}</th>`; }
    thead+="</tr></thead>";
    let tbody="<tbody>";
    for(const row of data){
      tbody+="<tr>";
      for(const c of cols){
        const cell=row[c]||{}; const disp=cell.display??""; const st=cell.status;
        if(c==="Person"){
          const b=bucket(st); const hl=cell.highlight;
          const name = hl==="blue" ? `<span class="name-hl-blue">${escapeHTML(disp)}</span>` :
                       hl ? `<span class="name-hl">${escapeHTML(disp)}</span>` :
                       `<span class="name-default">${escapeHTML(disp)}</span>`;
          const clickable = (b==="green" && cell.id!=null);
          const sel = (cell.id!=null && String(cell.id)===String(selectedPersonId));
          const cellCls = `person-cell${clickable?" person-cell--selectable":""}${sel?" person-cell--selected":""}`;
          const attrs = clickable? ` role="button" tabindex="0" aria-label="Person auswählen" data-person-id="${escapeHTML(cell.id)}"` : "";
          tbody+=`<td class="text-left"><span class="${cellCls}"${attrs}>${dot(b)}${name}</span></td>`;
        }else{
          const b=bucket(st);
          tbody+=`<td>${badge(b,disp)}</td>`;
        }
      }
      tbody+="</tr>";
    }
    tbody+="</tbody>";
    return `<div class="card"><div class="hdr">Dienstgruppe</div><table><caption class="sr-only">Dienstgruppenübersicht</caption>${thead}${tbody}</table></div>`;
  }

  // ---------- main render ----------
  function render(record, mappings){
    const top=document.getElementById("top"), tableBox=document.getElementById("tableBox");
    if(!record){ top.innerHTML=""; tableBox.innerHTML=""; return; }

    const GRIST = window.grist;
    const mapped = (GRIST && GRIST.mapColumnNames) ? GRIST.mapColumnNames(record, {mappings}) : record;
    console.debug("record:", record);
    console.debug("mappings:", mappings);
    console.debug("mapped:", mapped);

    const infoRaw  = (mapped && mapped.InfoJSON)!=null ? mapped.InfoJSON  : (record.InfoJSON ?? record.Info ?? record.A);
    const tableRaw = (mapped && mapped.TableJSON)!=null ? mapped.TableJSON : (record.TableJSON ?? record.Table_JSON ?? record.table);
    const checksRaw= (mapped && mapped.Checks)!=null   ? mapped.Checks    : (record.Checks ?? record.checks);

    const infoVal  = safeJSON(infoRaw,  {});
    const tableVal = safeJSON(tableRaw, []);
    const checksVal= safeJSON(checksRaw,{});
    // aktuell gespeicherte Auswahl (falls vorhanden) lesen
    selectedPersonId = mapped && mapped.Person != null ? String(mapped.Person) : (record.Person != null ? String(record.Person) : null);
    lastRecord = record;
    lastMappings = mappings;
    lastRowId = (record && (record.id ?? record._rowId ?? record._id)) || null;
    lastTableId = (mappings && (mappings.tableId || mappings.table?.id || mappings.table)) || null;
    personColId = (mappings && mappings.columns && (mappings.columns.Person?.colId ?? mappings.columns.Person?.id ?? mappings.columns.Person)) || 'Person';
    if(GRIST && typeof GRIST.getTable==='function'){ tableApi = GRIST.getTable(); }

    // Oben: Info + Checks
    top.innerHTML = renderInfo(infoVal) + `<div class="card card--min"><div class="hdr">Checks</div><div class="flex-1">${renderChecks(checksVal)}</div></div>`;
    // Unten: Tabelle
    tableBox.innerHTML = renderTable(tableVal);

    if(!listenersInstalled){
      listenersInstalled=true;
      tableBox.addEventListener('click', ev=>{
        const el = closest(ev.target, '[data-person-id]');
        if(!el) return;
        const id = el.getAttribute('data-person-id');
        // Kein Schreibvorgang wenn identische Auswahl
        if(String(id) === String(selectedPersonId)){
          return;
        }
        writePersonId(id);
        selectedPersonId = String(id);
        // leichte visuelle Rückmeldung sofort
        tableBox.querySelectorAll('.person-cell--selected').forEach(n=>n.classList.remove('person-cell--selected'));
        el.classList.add('person-cell--selected');
      });
      tableBox.addEventListener('keydown', ev=>{
        if(ev.key!=='Enter' && ev.key!==' ') return;
        const el = closest(ev.target, '[data-person-id]');
        if(!el) return;
        ev.preventDefault();
        el.click();
      });
    }
  }

  // ---------- grist: Map Columns ----------
  const GRIST = window.grist;
  if(GRIST && typeof GRIST.ready==="function"){
    GRIST.ready({
      requiredAccess:'full',
      columns:[
        {name:'InfoJSON',  title:'Info JSON (Objekt)', type:'Any', optional:false},
        {name:'TableJSON', title:'Table JSON (Array)', type:'Any', optional:false},
        {name:'Checks',    title:'Checks (JSON)',      type:'Any', optional:false},
        {name:'Person',    title:'Person ID (Zielspalte)', type:'Any', optional:false},
      ]
    });
    GRIST.onRecord(debounce(render, 16));
  }
})();
