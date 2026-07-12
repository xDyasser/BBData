/* Blood Bank Statistics — local-storage webapp
 * Data model (store):
 *   { wards:[], components:[], data:{ "YYYY-MM": {
 *       issue:      { comp: { ward: { day: n } } },
 *       received:   { ward: { day: n } },
 *       returned_ward|returned_ash|inventory: { comp: { day: n } }
 *   } } }
 */
(function () {
  "use strict";
  const LS_KEY = "bb_stats_v1";
  const MONTH_NAMES = ["", "January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  const MONTH_ABBR = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const SECTIONS = {
    issue:        { label: "Issuing", rows: "ward", byComponent: true },
    received:     { label: "Received Cross-matched", rows: "ward", byComponent: false },
    returned_ward:{ label: "Returned from Ward", rows: "component", byComponent: false },
    returned_ash: { label: "Returned ARH→ASH", rows: "component", byComponent: false },
    inventory:    { label: "Daily inventory from ASH", rows: "component", byComponent: false },
    labtests:     { label: "Transfusion Lab tests", rows: "labtest", byComponent: false },
    signatures:   { label: "Daily staff signature", rows: "signature", byComponent: false },
  };
  const RET_COMPONENTS = ["PRBC","Platelets","FFP","CRYO"];
  // Transfusion Lab monthly report — ordered test list (Form: Transfusion Lab)
  const LAB_TESTS = ["NO,SPECIMENS REC'D (IP)","NO,SPECIMENS REC'D (OP)","ABO& RhD (IP)","ABO& RhD (OP)",
    "Rh Weak D (OP)","Rh Weak D (IP)","DIRECT COOMBS (OP)","DIRECT COOMBS (IP)","Ab SCREENING RT/37 (IP)",
    "Ab SCREENING RT/37 (OP)","PANEL (OP)","PANEL (IP)","TITRATION (IP)","TITRATION (OP)","Ag TYPING RT (OP)",
    "Ag TYPING RT (IP)","Ag TYPING w/ AHG (IP)","Ag TYPING w/ AHG (OP)","X-MATCHING (IS)","X-MATCHING (AHG)",
    "Trnsfusion reaction","ELUTION","Adsorption"];

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const compColor = { PRBC:"--s-prbc", FFP:"--s-ffp", CRYO:"--s-cryo", Platelets:"--s-plt" };
  // Categorical palette for wards (validated fixed order, blue→…)
  const CAT = ["#2a78d6","#1baf7a","#eda100","#008300","#4a3aa7","#e34948","#e87ba4","#eb6834",
               "#6da7ec","#199e70","#c98500","#9085e9"];

  /* ---------- store ---------- */
  let store;
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function seedStore() {
    const s = window.BB_SEED;
    return migrate(JSON.parse(JSON.stringify({ wards: s.wards, components: s.components, data: s.data })));
  }
  // ensure newer fields exist on older saved data (lab tests + per-day signatures)
  function migrate(st) {
    if (!st.labTests) st.labTests = LAB_TESTS.slice();
    Object.values(st.data||{}).forEach(M=>{
      if (!M.labtests) M.labtests = {};
      if (!M.signatures) M.signatures = {};
    });
    return st;
  }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(store)); refreshFooter(); }
  function daysInMonth(key) { const [y,m]=key.split("-").map(Number); return new Date(y,m,0).getDate(); }
  function monthKeys() { return Object.keys(store.data).sort(); }
  function years() { return [...new Set(monthKeys().map(k=>k.slice(0,4)))].sort(); }
  function keyLabel(k){ const [y,m]=k.split("-"); return `${MONTH_ABBR[+m]} ${y}`; }

  /* ---------- aggregation ---------- */
  function emptyMonth() {
    const m = { issue:{}, received:{}, returned_ward:{}, returned_ash:{}, inventory:{}, labtests:{}, signatures:{} };
    store.components.forEach(c => { m.issue[c] = {}; });
    return m;
  }
  function sumDays(obj) { let t=0; if(obj) for(const d in obj) t+=Number(obj[d])||0; return t; }

  // total issued in a month for a component (all wards) or all components
  function issueMonthTotal(key, comp, ward) {
    const M = store.data[key]; if(!M) return 0;
    const comps = comp==="__all"? store.components : [comp];
    let t=0;
    comps.forEach(c=>{
      const cw = M.issue[c]||{};
      if (ward==="__all") for(const w in cw) t+=sumDays(cw[w]);
      else t+=sumDays(cw[ward]);
    });
    return t;
  }
  function issueDayTotal(key, comp, ward, day) {
    const M = store.data[key]; if(!M) return 0;
    const comps = comp==="__all"? store.components : [comp];
    let t=0;
    comps.forEach(c=>{
      const cw=M.issue[c]||{};
      if (ward==="__all") for(const w in cw){ t+=Number((cw[w]||{})[day])||0; }
      else t+=Number((cw[ward]||{})[day])||0;
    });
    return t;
  }
  function issueByWard(key, comp) {
    return store.wards.map(w => issueMonthTotal(key, comp, w));
  }
  function issueByComponent(key, ward) {
    return store.components.map(c => issueMonthTotal(key, c, ward));
  }
  function sectionMonthTotal(key, section) {
    const M = store.data[key]; if(!M) return 0;
    if (section==="issue") return issueMonthTotal(key,"__all","__all");
    let t=0; const blk=M[section]||{};
    for (const r in blk) t+=sumDays(blk[r]);
    return t;
  }

  /* ---------- charts ---------- */
  const charts = {};
  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  const gridColor = () => css("--border");
  const tickColor = () => css("--text-secondary");
  function baseScales(stacked) {
    return {
      x:{ stacked:!!stacked, grid:{display:false}, ticks:{color:tickColor(),font:{size:11}} },
      y:{ stacked:!!stacked, beginAtZero:true, grid:{color:gridColor()}, ticks:{color:tickColor(),font:{size:11}} }
    };
  }
  const legendCfg = () => ({ position:"bottom", labels:{ color:tickColor(), boxWidth:12, boxHeight:12, usePointStyle:true, pointStyle:"rectRounded", font:{size:12} } });

  /* ---------- dashboard ---------- */
  const $ = (s)=>document.querySelector(s);
  function fillSelect(el, items, valfn, labfn, keep) {
    const prev = keep && el.value;
    el.innerHTML = "";
    items.forEach(it=>{ const o=document.createElement("option"); o.value=valfn(it); o.textContent=labfn(it); el.appendChild(o); });
    if (prev && [...el.options].some(o=>o.value===prev)) el.value=prev;
  }

  function initDashFilters() {
    const compSel = $("#f-component");
    compSel.innerHTML = '<option value="__all">All components</option>';
    store.components.forEach(c=>compSel.add(new Option(c,c)));
    const wardSel = $("#f-ward");
    wardSel.innerHTML = '<option value="__all">All wards</option>';
    store.wards.forEach(w=>wardSel.add(new Option(w,w)));
    fillSelect($("#f-year"), years(), y=>y, y=>y, true);
    syncMonthList();
  }
  function syncMonthList() {
    const yr = $("#f-year").value;
    const mk = monthKeys().filter(k=>k.startsWith(yr));
    fillSelect($("#f-month"), mk, k=>k, keyLabel, true);
  }

  function renderDashboard() {
    if (!years().length) { $("#kpis").innerHTML="<p class='muted'>No data yet. Add a month or import a file from the Manage tab.</p>"; return; }
    const scope = $("#f-scope").value;
    $("#wrap-month").hidden = scope==="year";
    const comp = $("#f-component").value, ward = $("#f-ward").value;
    const compLabel = comp==="__all"?"all components":comp;
    const wardLabel = ward==="__all"?"all wards":ward;

    let periodKeys, trendLabels, trendTitle;
    if (scope==="year") {
      const ys = years();
      periodKeys = ys; trendLabels = ys;
      trendTitle = `Yearly issued — ${compLabel}, ${wardLabel}`;
    } else if (scope==="month") {
      const yr=$("#f-year").value;
      periodKeys = monthKeys().filter(k=>k.startsWith(yr));
      trendLabels = periodKeys.map(k=>MONTH_ABBR[+k.slice(5)]);
      trendTitle = `Monthly issued in ${yr} — ${compLabel}, ${wardLabel}`;
    } else {
      const km=$("#f-month").value;
      const n = km?daysInMonth(km):0;
      periodKeys=[km]; trendLabels=Array.from({length:n},(_,i)=>i+1);
      trendTitle = `Daily issued — ${km?keyLabel(km):""}, ${compLabel}, ${wardLabel}`;
    }
    $("#cap-trend").textContent = trendTitle;

    renderKpis(scope, comp, ward);
    renderTrend(scope, comp, ward, trendLabels);
    renderComponentChart(scope, ward);
    renderWardChart(scope, comp);
    renderSectionsChart(scope);
  }

  function scopeKeys(scope) {
    if (scope==="year") return { groups: years().map(y=>({label:y, keys:monthKeys().filter(k=>k.startsWith(y))})) };
    if (scope==="month") { const yr=$("#f-year").value; return { groups: monthKeys().filter(k=>k.startsWith(yr)).map(k=>({label:MONTH_ABBR[+k.slice(5)], keys:[k]})) }; }
    const km=$("#f-month").value; return { single:km };
  }

  function renderKpis(scope, comp, ward) {
    const wrap=$("#kpis"); wrap.innerHTML="";
    let keys;
    if (scope==="day") keys = $("#f-month").value?[$("#f-month").value]:[];
    else if (scope==="month") keys = monthKeys().filter(k=>k.startsWith($("#f-year").value));
    else keys = monthKeys();
    const totalIssued = keys.reduce((a,k)=>a+issueMonthTotal(k,comp,ward),0);
    const received = keys.reduce((a,k)=>a+sectionMonthTotal(k,"received"),0);
    const returned = keys.reduce((a,k)=>a+sectionMonthTotal(k,"returned_ward")+sectionMonthTotal(k,"returned_ash"),0);
    // top component
    const perComp = store.components.map(c=>({c, n:keys.reduce((a,k)=>a+issueMonthTotal(k,c,ward),0)})).sort((a,b)=>b.n-a.n);
    const top = perComp[0]||{c:"—",n:0};
    const cards=[
      {label:"Units issued", value:totalIssued, sub:`${comp==="__all"?"all components":comp}`},
      {label:"Cross-matched received", value:received, sub:"all wards"},
      {label:"Returned units", value:returned, sub:"ward + ASH"},
      {label:"Top component", value:top.n, sub:top.c, swatch:compColor[top.c]},
    ];
    cards.forEach(c=>{
      const d=document.createElement("div"); d.className="kpi";
      d.innerHTML=`<div class="k-label">${c.label}</div>
        <div class="k-value">${c.value.toLocaleString()}</div>
        <div class="k-sub">${c.swatch?`<span class="swatch" style="background:${css(c.swatch)}"></span>`:""}${c.sub}</div>`;
      wrap.appendChild(d);
    });
  }

  function renderTrend(scope, comp, ward, labels) {
    // one line per component (or single line if a component is selected)
    const comps = comp==="__all"? store.components : [comp];
    let getPeriods;
    if (scope==="year") getPeriods = years().map(y=>({keys:monthKeys().filter(k=>k.startsWith(y))}));
    else if (scope==="month") getPeriods = monthKeys().filter(k=>k.startsWith($("#f-year").value)).map(k=>({keys:[k]}));
    else { const km=$("#f-month").value; const n=km?daysInMonth(km):0; getPeriods=Array.from({length:n},(_,i)=>({day:String(i+1),key:km})); }

    const datasets = comps.map(c=>{
      const col = css(compColor[c]);
      const data = getPeriods.map(p=> scope==="day"
        ? issueDayTotal(p.key, c, ward, p.day)
        : p.keys.reduce((a,k)=>a+issueMonthTotal(k,c,ward),0));
      return { label:c, data, borderColor:col, backgroundColor:col+"22",
        borderWidth:2, tension:.25, pointRadius:scope==="day"?0:3, pointHoverRadius:5, fill:comps.length===1 };
    });
    mk("chart-trend", { type:"line",
      data:{ labels, datasets },
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:"index",intersect:false},
        plugins:{ legend: comps.length>1?legendCfg():{display:false},
          tooltip:{callbacks:{}} },
        scales: baseScales(false) } });
  }

  function renderComponentChart(scope, ward) {
    let keys;
    if (scope==="day") keys=$("#f-month").value?[$("#f-month").value]:[];
    else if (scope==="month") keys=monthKeys().filter(k=>k.startsWith($("#f-year").value));
    else keys=monthKeys();
    const data = store.components.map(c=>keys.reduce((a,k)=>a+issueMonthTotal(k,c,ward),0));
    $("#cap-component").textContent = `Issued by component — ${ward==="__all"?"all wards":ward}`;
    mk("chart-component",{ type:"doughnut",
      data:{ labels:store.components, datasets:[{ data,
        backgroundColor:store.components.map(c=>css(compColor[c])), borderColor:css("--surface-1"), borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:"58%", plugins:{ legend:legendCfg() } } });
  }

  function renderWardChart(scope, comp) {
    let keys;
    if (scope==="day") keys=$("#f-month").value?[$("#f-month").value]:[];
    else if (scope==="month") keys=monthKeys().filter(k=>k.startsWith($("#f-year").value));
    else keys=monthKeys();
    $("#cap-ward").textContent = `Issued by ward / floor — ${comp==="__all"?"all components":comp}`;
    // stacked by component so identity is preserved
    const comps = comp==="__all"? store.components : [comp];
    const datasets = comps.map(c=>({
      label:c, backgroundColor:css(compColor[c]),
      data: store.wards.map(w=>keys.reduce((a,k)=>a+issueMonthTotal(k,c,w),0)),
      borderColor:css("--surface-1"), borderWidth:1, borderRadius:3, borderSkipped:false }));
    mk("chart-ward",{ type:"bar",
      data:{ labels:store.wards, datasets },
      options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false,
        plugins:{ legend: comps.length>1?legendCfg():{display:false} },
        scales: baseScales(true) } });
  }

  function renderSectionsChart(scope) {
    let keys;
    if (scope==="day") keys=$("#f-month").value?[$("#f-month").value]:[];
    else if (scope==="month") keys=monthKeys().filter(k=>k.startsWith($("#f-year").value));
    else keys=monthKeys();
    const secs=[["issue","Issued"],["received","Received XM"],["returned_ward","Returned (ward)"],["returned_ash","Returned (ASH)"],["inventory","Inventory"]];
    const data = secs.map(([s])=>keys.reduce((a,k)=>a+sectionMonthTotal(k,s),0));
    mk("chart-sections",{ type:"bar",
      data:{ labels:secs.map(s=>s[1]), datasets:[{ data,
        backgroundColor:secs.map((_,i)=>CAT[i]), borderRadius:4, borderSkipped:false }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:baseScales(false) } });
  }

  /* ---------- data entry ---------- */
  function initEntry() {
    fillSelect($("#e-month"), monthKeys(), k=>k, keyLabel, true);
    const cs=$("#e-component"); cs.innerHTML=""; store.components.forEach(c=>cs.add(new Option(c,c)));
    if(!$("#e-add-year").value) $("#e-add-year").value=new Date().getFullYear();
    renderEntry();
  }
  function renderEntry() {
    const key=$("#e-month").value, section=$("#e-section").value;
    const meta=SECTIONS[section];
    $("#e-wrap-comp").style.display = meta.byComponent?"":"none";
    const table=$("#entry-table");
    if (!key){ table.innerHTML="<caption class='muted'>No month selected — add one above to start entering data.</caption>"; return; }
    if (!store.data[key]) store.data[key]=emptyMonth();
    const M=store.data[key];
    if(!M.labtests) M.labtests={}; if(!M.signatures) M.signatures={};
    const nDays=daysInMonth(key);
    // signatures: one free-text field per day (who recorded that day)
    if (section==="signatures"){ renderSignatures(key,M,nDays); return; }
    const rowLabels = meta.rows==="ward"? store.wards : meta.rows==="labtest"? store.labTests : RET_COMPONENTS;
    const rowHead = meta.rows==="ward"?"Ward / Floor" : meta.rows==="labtest"?"Name of test" : "Component";
    // resolve the data block we edit
    let block, comp=null;
    if (section==="issue"){ comp=$("#e-component").value; M.issue[comp]=M.issue[comp]||{}; block=M.issue[comp]; }
    else block=M[section];
    $("#e-hint").classList.remove("err-hint");
    $("#e-hint").textContent = `${keyLabel(key)} · ${meta.label}${comp?" · "+comp:""} · enter daily counts, totals auto-calculate`;

    // header
    let html="<thead><tr><th class='rowhead'>"+rowHead+"</th>";
    for(let d=1;d<=nDays;d++) html+=`<th>${d}</th>`;
    html+="<th class='total'>Total</th></tr></thead><tbody>";
    rowLabels.forEach((r,ri)=>{
      block[r]=block[r]||{};
      html+=`<tr><td class="rowhead">${r}</td>`;
      for(let d=1;d<=nDays;d++){
        const v=block[r][d];
        html+=`<td><input inputmode="numeric" data-row="${encodeURIComponent(r)}" data-day="${d}" data-r="${ri}" data-c="${d-1}" value="${v??""}" placeholder="·"></td>`;
      }
      html+=`<td class="total" data-rowtotal="${encodeURIComponent(r)}">${sumDays(block[r])||0}</td></tr>`;
    });
    html+="</tbody><tfoot><tr><td class='rowhead'>Total</td>";
    for(let d=1;d<=nDays;d++) html+=`<td data-coltotal="${d}">${colTotal(block,rowLabels,d)}</td>`;
    html+=`<td class="total" data-grandtotal>${grandTotal(block,rowLabels)}</td></tr></tfoot>`;
    table.innerHTML=html;

    // ----- grid model -----
    const nRows=rowLabels.length, nCols=nDays;
    const cell=(ri,ci)=> table.querySelector(`input[data-r="${ri}"][data-c="${ci}"]`);
    const commit=(inp,{recalc=true}={})=>{
      const r=decodeURIComponent(inp.dataset.row), d=inp.dataset.day;
      let val=parseInt(inp.value,10);
      if (inp.value.trim()===""||isNaN(val)||val<0){ delete block[r][d]; inp.value=""; }
      else { block[r][d]=val; inp.value=String(val); }
      if(recalc){
        table.querySelector(`[data-rowtotal="${encodeURIComponent(r)}"]`).textContent=sumDays(block[r])||0;
        table.querySelector(`[data-coltotal="${d}"]`).textContent=colTotal(block,rowLabels,d);
        table.querySelector("[data-grandtotal]").textContent=grandTotal(block,rowLabels);
      }
    };
    const recalcAll=()=>{
      rowLabels.forEach(r=> table.querySelector(`[data-rowtotal="${encodeURIComponent(r)}"]`).textContent=sumDays(block[r])||0);
      for(let d=1;d<=nDays;d++) table.querySelector(`[data-coltotal="${d}"]`).textContent=colTotal(block,rowLabels,d);
      table.querySelector("[data-grandtotal]").textContent=grandTotal(block,rowLabels);
    };

    table.oninput=(e)=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      commit(inp); save();
    };

    // ----- cell selection -----
    let anchor=null;                       // {ri,ci}
    const clearSel=()=> table.querySelectorAll("input.cell-selected").forEach(i=>i.classList.remove("cell-selected"));
    const selectRange=(a,b)=>{
      clearSel();
      const r0=Math.min(a.ri,b.ri), r1=Math.max(a.ri,b.ri);
      const c0=Math.min(a.ci,b.ci), c1=Math.max(a.ci,b.ci);
      for(let ri=r0;ri<=r1;ri++) for(let ci=c0;ci<=c1;ci++){ const c=cell(ri,ci); if(c) c.classList.add("cell-selected"); }
    };
    const pos=(inp)=>({ri:+inp.dataset.r, ci:+inp.dataset.c});

    let dragging=false;
    table.addEventListener("mousedown",e=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      if(e.shiftKey && anchor){ e.preventDefault(); selectRange(anchor,pos(inp)); return; }
      anchor=pos(inp); dragging=true; clearSel(); inp.classList.add("cell-selected");
    });
    table.addEventListener("mouseover",e=>{
      if(!dragging) return;
      const inp=e.target; if(inp.tagName!=="INPUT"||!anchor) return;
      selectRange(anchor,pos(inp));
    });
    document.addEventListener("mouseup",()=>{ dragging=false; });

    // ----- keyboard navigation -----
    const focusCell=(ri,ci)=>{ const c=cell(ri,ci); if(c){ c.focus(); c.select(); anchor=pos(c); clearSel(); c.classList.add("cell-selected"); } return !!c; };
    table.addEventListener("keydown",e=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      const {ri,ci}=pos(inp);
      const atStart=inp.selectionStart===0 && inp.selectionEnd===0;
      const atEnd=inp.selectionStart===inp.value.length && inp.selectionEnd===inp.value.length;
      let nr=ri,nc=ci,handled=true;
      switch(e.key){
        case "Enter":      nr=ri+(e.shiftKey?-1:1); break;
        case "Tab":        nc=ci+(e.shiftKey?-1:1); break;
        case "ArrowDown":  nr=ri+1; break;
        case "ArrowUp":    nr=ri-1; break;
        case "ArrowRight": if(!atEnd){handled=false;break;} nc=ci+1; break;
        case "ArrowLeft":  if(!atStart){handled=false;break;} nc=ci-1; break;
        default: handled=false;
      }
      if(!handled) return;
      // wrap Tab across row edges
      if(e.key==="Tab"){
        if(nc<0){ nc=nCols-1; nr=ri-1; }
        else if(nc>=nCols){ nc=0; nr=ri+1; }
      }
      if(nr<0||nr>=nRows||nc<0||nc>=nCols){ e.preventDefault(); return; }
      e.preventDefault();
      focusCell(nr,nc);
    });

    // ----- paste from Excel -----
    table.addEventListener("paste",e=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      const text=(e.clipboardData||window.clipboardData).getData("text");
      if(text==null) return;
      const rows=text.replace(/\r\n?/g,"\n").replace(/\n$/,"").split("\n").map(l=>l.split("\t"));
      if(rows.length===1 && rows[0].length===1) return;  // single value: let default paste happen
      e.preventDefault();
      const {ri,ci}=pos(inp);
      let lastR=ri,lastC=ci;
      rows.forEach((cells,dr)=>{
        cells.forEach((raw,dc)=>{
          const c=cell(ri+dr,ci+dc); if(!c) return;
          c.value=raw.trim();
          commit(c,{recalc:false});
          lastR=ri+dr; lastC=ci+dc;
        });
      });
      recalcAll(); save();
      selectRange({ri,ci},{ri:lastR,ci:lastC});
      const lc=cell(lastR,lastC); if(lc) lc.focus();
    });
  }
  function colTotal(block,rows,d){ let t=0; rows.forEach(r=>t+=Number((block[r]||{})[d])||0); return t||0; }
  function grandTotal(block,rows){ let t=0; rows.forEach(r=>t+=sumDays(block[r])); return t||0; }

  // per-day staff signature grid (text, one value per day)
  function renderSignatures(key, M, nDays){
    const table=$("#entry-table");
    $("#e-wrap-comp").style.display="none";
    $("#e-hint").classList.remove("err-hint");
    $("#e-hint").textContent = `${keyLabel(key)} · Daily staff signature · type the name/initials of who recorded each day`;
    let html="<thead><tr><th class='rowhead'>Day</th>";
    for(let d=1;d<=nDays;d++) html+=`<th>${d}</th>`;
    html+="</tr></thead><tbody><tr><td class='rowhead'>Signature</td>";
    for(let d=1;d<=nDays;d++){
      const v=M.signatures[d]||"";
      html+=`<td><input class="sig" type="text" data-day="${d}" value="${(v+"").replace(/"/g,"&quot;")}" placeholder="—"></td>`;
    }
    html+="</tr></tbody>";
    table.innerHTML=html;
    table.oninput=(e)=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      const d=inp.dataset.day, val=inp.value.trim();
      if(val) M.signatures[d]=val; else delete M.signatures[d];
      save();
    };
  }

  /* ---------- manage ---------- */
  function renderManage() {
    const list=$("#month-list"); list.innerHTML="";
    const keys=monthKeys();
    if(!keys.length) list.innerHTML="<p class='muted'>No months yet.</p>";
    keys.forEach(k=>{
      const p=document.createElement("span"); p.className="month-pill";
      p.innerHTML=`${keyLabel(k)} <button title="Delete" data-del="${k}">✕</button>`;
      list.appendChild(p);
    });
    list.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
      if(confirm(`Delete all data for ${keyLabel(b.dataset.del)}?`)){ delete store.data[b.dataset.del]; save(); refreshAll(); }
    });
    if(!$("#add-year").value) $("#add-year").value=new Date().getFullYear();
  }
  // returns the new month key, or null on failure. reporter(text, cls) shows feedback.
  function createMonth(m,y,reporter){
    if(!y||y<2000){ reporter&&reporter("Enter a valid year.","err"); return null; }
    const key=`${y}-${String(m).padStart(2,"0")}`;
    if(store.data[key]){ reporter&&reporter(`${keyLabel(key)} already exists.`,"err"); return null; }
    store.data[key]=emptyMonth(); save(); refreshAll();
    return key;
  }
  function addMonth() {
    const key=createMonth(+$("#add-month").value, +$("#add-year").value, msg);
    if(key) msg(`Added ${keyLabel(key)}. Switch to Data Entry to fill it in.`,"ok");
  }
  function addMonthFromEntry() {
    const key=createMonth(+$("#e-add-month").value, +$("#e-add-year").value,
      (t,cls)=>{ const el=$("#e-hint"); el.textContent=t; el.classList.toggle("err-hint",cls==="err"); });
    if(key){ $("#e-month").value=key; renderEntry(); }
  }
  function msg(t,cls){ const el=$("#io-msg"); el.textContent=t; el.className="io-msg "+(cls||""); }

  /* ---------- import / export ---------- */
  function exportJSON() {
    const blob=new Blob([JSON.stringify(store,null,1)],{type:"application/json"});
    download(blob, `blood-bank-data-${today()}.json`);
  }
  function importJSON(file) {
    const r=new FileReader();
    r.onload=()=>{ try{
      const obj=JSON.parse(r.result);
      if(!obj.data||!obj.wards) throw 0;
      store=obj; save(); refreshAll(); msg("JSON imported successfully.","ok");
    }catch(e){ msg("Could not read that JSON file.","err"); } };
    r.readAsText(file);
  }
  function today(){ return new Date().toISOString().slice(0,10); }
  function download(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

  /* ---------- styled Excel export (inject live values into a pre-styled,
     chart-bearing template via JSZip XML surgery — preserves formatting) ---------- */
  function b64ToBytes(b64){ const bin=atob(b64); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
  function xmlEsc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  const colL=(i)=>String.fromCharCode(66+i); // 0->B, 1->C, ...
  function putCell(xml, ref, inner, type){ // inner=null blanks the cell (keeps style)
    const re=new RegExp('<c r="'+ref+'"[^>]*?(?:/>|>[\\s\\S]*?</c>)');
    return xml.replace(re,(m)=>{
      const sm=m.match(/ s="(\d+)"/); const sAttr=sm?(' s="'+sm[1]+'"'):"";
      if(inner==null) return '<c r="'+ref+'"'+sAttr+' t="n"/>';
      if(type==="inlineStr") return '<c r="'+ref+'"'+sAttr+' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(inner)+'</t></is></c>';
      return '<c r="'+ref+'"'+sAttr+' t="n"><v>'+inner+'</v></c>';
    });
  }
  const setNum=(xml,ref,v)=>putCell(xml,ref, v==null?null:v, "n");
  const setTxt=(xml,ref,v)=>putCell(xml,ref, v==null?null:v, "inlineStr");

  async function exportStyledXLSX(){
    const keys=monthKeys();
    if(!keys.length){ msg("No data to export.","err"); return; }
    if(!window.JSZip||!window.BB_TEMPLATE_B64){ msg("Styled template unavailable; using plain export.","err"); return exportXLSX(); }
    msg("Building styled workbook…","");
    const zip=await JSZip.loadAsync(b64ToBytes(window.BB_TEMPLATE_B64));
    const meta=window.BB_TEMPLATE_META, comps=store.components;

    // map sheet name -> worksheet part path
    const wbxml=await zip.file("xl/workbook.xml").async("string");
    const relsxml=await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const rid={};
    (relsxml.match(/<Relationship\b[^>]*>/g)||[]).forEach(s=>{
      const id=(s.match(/Id="([^"]+)"/)||[])[1], tg=(s.match(/Target="([^"]+)"/)||[])[1];
      if(id&&tg) rid[id]=tg.replace(/^\//,"");
    });
    const path={};
    [...wbxml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].forEach(m=>{ path[m[1]]=rid[m[2]]; });

    // --- Summary ---
    let s=await zip.file(path["Summary"]).async("string");
    const st=sectionTotalsAll(), ct=componentTotals();
    s=setTxt(s,"B2", keyLabel(keys[0])+" – "+keyLabel(keys[keys.length-1]));
    s=setNum(s,"B3", keys.length);
    s=setTxt(s,"B4", new Date().toLocaleString());
    ["B7","B8","B9","B10","B11"].forEach((r,i)=> s=setNum(s,r, st[i].n));
    comps.forEach((c,i)=> s=setNum(s,"B"+(14+i), ct.find(x=>x.c===c).n));
    zip.file(path["Summary"], s);

    // --- By Year ---
    let y=await zip.file(path["By Year"]).async("string");
    const ym=yearlyMatrix(), ys=ym.ys;
    for(let i=0;i<meta.yearsReserved;i++){ const r=3+i;
      if(i<ys.length){ y=setTxt(y,"A"+r, ys[i]); comps.forEach((c,j)=> y=setNum(y,colL(j)+r, ym.cell(ys[i],c))); }
      else { y=setTxt(y,"A"+r,null); ["B","C","D","E","F"].forEach(col=> y=setNum(y,col+r,null)); }
    }
    zip.file(path["By Year"], y);

    // --- By Ward (11 fixed rows; labels & F/G formulas already in template) ---
    let w=await zip.file(path["By Ward"]).async("string");
    const wardComp=(wd,c)=>keys.reduce((a,k)=>a+issueMonthTotal(k,c,wd),0);
    store.wards.forEach((wd,i)=>{ const r=3+i; comps.forEach((c,j)=> w=setNum(w,colL(j)+r, wardComp(wd,c))); });
    zip.file(path["By Ward"], w);

    // --- By Month ---
    let mo=await zip.file(path["By Month"]).async("string");
    for(let i=0;i<meta.monthsReserved;i++){ const r=3+i;
      if(i<keys.length){ const k=keys[i];
        mo=setTxt(mo,"A"+r, keyLabel(k));
        comps.forEach((c,j)=> mo=setNum(mo,colL(j)+r, issueMonthTotal(k,c,"__all")));
        mo=setNum(mo,"F"+r, sectionMonthTotal(k,"received"));
        mo=setNum(mo,"G"+r, sectionMonthTotal(k,"returned_ward")+sectionMonthTotal(k,"returned_ash"));
      } else { mo=setTxt(mo,"A"+r,null); ["B","C","D","E","F","G","H"].forEach(col=> mo=setNum(mo,col+r,null)); }
    }
    zip.file(path["By Month"], mo);

    // --- patch chart data ranges to the live year/month extents ---
    const yEnd=2+ys.length, mEnd=2+keys.length;
    const chartFiles=Object.keys(zip.files).filter(n=>/^xl\/charts\/chart\d+\.xml$/.test(n));
    for(const cf of chartFiles){
      let x=await zip.file(cf).async("string");
      x=x.replace(/('By Year'!\$[A-F]\$3:\$[A-F]\$)\d+/g,(m,p)=>p+yEnd);
      x=x.replace(/('By Month'!\$[A-H]\$3:\$[A-H]\$)\d+/g,(m,p)=>p+mEnd);
      zip.file(cf,x);
    }
    // drop calcChain so Excel recalculates all formulas on open
    if(zip.file("xl/calcChain.xml")){
      zip.remove("xl/calcChain.xml");
      const ct2=await zip.file("[Content_Types].xml").async("string");
      zip.file("[Content_Types].xml", ct2.replace(/<Override[^>]*calcChain\.xml"[^>]*\/>/,""));
    }

    const blob=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    download(blob, `blood-bank-analysis-${today()}.xlsx`);
    msg("Styled Excel exported — Summary, By Year, By Ward, By Month with native charts.","ok");
  }

  // Styled monthly-form export: clone the embedded styled FORM sheet per month and
  // inject each month's values via JSZip XML surgery (preserves styling + formulas).
  async function exportXLSX(){
    const keys=monthKeys();
    if(!keys.length){ msg("No data to export.","err"); return; }
    if(!window.JSZip||!window.BB_FORM_TEMPLATE_B64){ msg("Form template unavailable.","err"); return; }
    msg("Building styled monthly forms\u2026","");
    const L=window.BB_FORM_LAYOUT;
    const zip=await JSZip.loadAsync(b64ToBytes(window.BB_FORM_TEMPLATE_B64));
    let wbxml=await zip.file("xl/workbook.xml").async("string");
    let relsxml=await zip.file("xl/_rels/workbook.xml.rels").async("string");
    let ctxml=await zip.file("[Content_Types].xml").async("string");

    // locate the single blueprint FORM sheet
    const sm=wbxml.match(/<sheet [^>]*\/>/);
    const bpRid=(sm[0].match(/r:id="(rId\d+)"/)||[])[1];
    let bpTarget=null;
    (relsxml.match(/<Relationship\b[^>]*>/g)||[]).forEach(rel=>{
      if(new RegExp('Id="'+bpRid+'"').test(rel)) bpTarget=(rel.match(/Target="([^"]+)"/)||[])[1];
    });
    const norm=(t)=>{ t=t.replace(/^\//,""); return t.startsWith("xl/")?t:"xl/"+t; };
    const bpPath=norm(bpTarget);
    const BLUE=await zip.file(bpPath).async("string");

    // build a ref->value map for one month, then rewrite all matching cells in one pass
    const buildMap=(key)=>{
      const M=store.data[key], nDays=daysInMonth(key), map={};
      map[L.title.ref]={t:"s",v:"Blood Bank Daily Statistics \u2014 "+keyLabel(key)};
      const put=(block,label,row)=>{ const rec=block[label]||{};
        for(let d=1;d<=31;d++){ const v=(d<=nDays)?rec[d]:undefined; map[L.dayCols[d]+row]={t:"n",v:(v==null||v===0||v==="")?null:v}; } };
      L.sections.forEach(sec=>{ const block=sec.kind==="issue"?(M.issue[sec.comp]||{}):(M[sec.kind]||{}); sec.rows.forEach(rw=>put(block,rw.label,rw.row)); });
      for(let d=1;d<=31;d++){ const v=(d<=nDays)?(M.signatures||{})[d]:undefined; map[L.dayCols[d]+L.sigRow]={t:"s",v:(v==null||v==="")?null:v}; }
      return map;
    };
    const injectCells=(xml,map)=> xml.replace(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,(m,ref)=>{
      if(!Object.prototype.hasOwnProperty.call(map,ref)) return m;
      const sMatch=m.match(/ s="(\d+)"/); const sAttr=sMatch?(' s="'+sMatch[1]+'"'):"";
      const cell=map[ref];
      if(cell==null||cell.v==null||cell.v==="") return '<c r="'+ref+'"'+sAttr+' t="n"/>';
      if(cell.t==="s") return '<c r="'+ref+'"'+sAttr+' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(cell.v)+'</t></is></c>';
      return '<c r="'+ref+'"'+sAttr+' t="n"><v>'+cell.v+'</v></c>';
    });
    const sheetName=(k)=>keyLabel(k).replace(/[\[\]:*?/\\]/g," ").slice(0,31);

    let ridNum=Math.max(0,...[...relsxml.matchAll(/Id="rId(\d+)"/g)].map(m=>+m[1]));
    let sidNum=Math.max(0,...[...wbxml.matchAll(/sheetId="(\d+)"/g)].map(m=>+m[1]));
    const sheetTags=[], relTags=[], ctTags=[];
    keys.forEach((k,i)=>{
      const file="worksheets/bbform"+(i+1)+".xml";
      zip.file("xl/"+file, injectCells(BLUE, buildMap(k)));
      ridNum++; sidNum++;
      const rid="rId"+ridNum;
      relTags.push('<Relationship Id="'+rid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="'+file+'"/>');
      sheetTags.push('<sheet name="'+xmlEsc(sheetName(k))+'" sheetId="'+sidNum+'" r:id="'+rid+'"/>');
      ctTags.push('<Override PartName="/xl/'+file+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    });

    // remove the blueprint sheet (file, <sheet>, rel, content-type), add the month sheets
    zip.remove(bpPath);
    wbxml=wbxml.replace(sm[0],"").replace("</sheets>", sheetTags.join("")+"</sheets>");
    relsxml=relsxml.replace(new RegExp('<Relationship\\b[^>]*Id="'+bpRid+'"[^>]*/>'),"")
                   .replace(new RegExp('<Relationship\\b[^>]*Target="'+bpTarget.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+'"[^>]*/>'),"")
                   .replace("</Relationships>", relTags.join("")+"</Relationships>");
    ctxml=ctxml.replace(new RegExp('<Override PartName="/'+bpPath+'"[^>]*/>'),"")
               .replace("</Types>", ctTags.join("")+"</Types>");
    zip.file("xl/workbook.xml", wbxml);
    zip.file("xl/_rels/workbook.xml.rels", relsxml);
    zip.file("[Content_Types].xml", ctxml);
    if(zip.file("xl/calcChain.xml")) zip.remove("xl/calcChain.xml");

    const blob=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    download(blob, `blood-bank-monthly-forms-${today()}.xlsx`);
    msg("Styled monthly forms exported ("+keys.length+" sheets, one per month).","ok");
  }

  // Excel import: parse a workbook shaped like the original form
  function importXLSX(file) {
    const r=new FileReader();
    r.onload=()=>{ try{
      const wb=XLSX.read(r.result,{type:"array"});
      let added=0;
      wb.SheetNames.forEach(name=>{
        const res=parseSheet(wb.Sheets[name], name);
        if(res){ // merge section-by-section so a lab sheet doesn't wipe blood-bank data (and vice-versa)
          const M=store.data[res.key]||emptyMonth();
          Object.keys(res.patch).forEach(sec=>{ M[sec]=res.patch[sec]; });
          store.data[res.key]=M; added++;
        }
      });
      migrate(store); save(); refreshAll();
      msg(added?`Imported ${added} month(s) from workbook.`:"No recognizable months found in that workbook.", added?"ok":"err");
    }catch(e){ console.error(e); msg("Could not read that Excel file.","err"); } };
    r.readAsArrayBuffer(file);
  }
  const MONTH_LOOKUP=[["septamber",9],["novembr",11],["octo",10],["march",3],["april",4],["august",8],["agu",8],
    ["january",1],["february",2],["jan",1],["feb",2],["mar",3],["apr",4],["may",5],["june",6],["july",7],
    ["jun",6],["jul",7],["aug",8],["sep",9],["oct",10],["nov",11],["december",12],["dec",12]];
  function detectMonthYear(title){
    const u=String(title).toLowerCase(); let mo=null;
    for(const [k,v] of MONTH_LOOKUP){ if(u.includes(k)){ mo=v; break; } }
    const ym=u.match(/(20\d\d)/); const yr=ym?+ym[1]:null;
    return mo?{mo,yr}:null;
  }
  const labTestCanon=(s)=>{ const u=String(s).replace(/\s+/g," ").trim();
    const found=store.labTests.find(t=>t.toLowerCase()===u.toLowerCase()); return found||u; };
  function parseSheet(ws, name){
    const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
    // month/year: from the tab name, else from a "MONTH- <name> <year>" cell anywhere in the sheet
    let my=detectMonthYear(name);
    if(!my || !my.yr){
      for(const row of aoa){ for(const cell of row){ if(typeof cell==="string" && /month/i.test(cell)){ const d=detectMonthYear(cell); if(d){ my=d; break; } } } if(my&&my.yr) break; }
    }
    if(!my) return null;
    const key=`${my.yr||2024}-${String(my.mo).padStart(2,"0")}`;

    // ---- Transfusion Lab form? (has a "NAME OF TEST" header) ----
    const isLab=aoa.some(row=>row.some(c=>typeof c==="string" && /name of test/i.test(c)));
    if(isLab){
      const labtests={}; let daymap=null;
      aoa.forEach(row=>{
        const testCell=row.find((c,ci)=>ci>=1 && typeof c==="string" && /name of test/i.test(c));
        if(testCell!=null){ daymap={}; row.forEach((h,ci)=>{ if(typeof h==="number"&&h>=1&&h<=31) daymap[ci]=h; }); return; }
        if(!daymap) return;
        // test name is the first non-numeric text cell in the row (skip the row-number col)
        let label=null;
        for(let ci=1;ci<row.length;ci++){ const v=row[ci]; if(typeof v==="string"&&v.trim()){ label=v.trim(); break; } }
        if(!label) return;
        const t=labTestCanon(label); const rec={};
        for(const ci in daymap){ const v=row[ci]; if(typeof v==="number"&&v!==0) rec[daymap[ci]]=v; }
        if(Object.keys(rec).length) labtests[t]=rec; else labtests[t]=labtests[t]||{};
      });
      return {key, patch:{labtests}};
    }

    // ---- Blood Bank daily statistics form ----
    const month=emptyMonth();
    const secOf=(b)=>{ const u=String(b||"").replace(/\s+/g," ").trim().toUpperCase();
      if(u.startsWith("ISSUING PRBC"))return["issue","PRBC"]; if(u.startsWith("ISSUING FFP"))return["issue","FFP"];
      if(u.startsWith("ISSUING CRYO"))return["issue","CRYO"]; if(u.startsWith("ISSUING PLATELET"))return["issue","Platelets"];
      if(u.startsWith("RECEIVED CROSS"))return["received",null]; if(u.startsWith("RETURNED FROM WARD"))return["returned_ward",null];
      if(u.includes("RETURNED FROM ARH")||u.includes("RETURNED ARH"))return["returned_ash",null];
      if(u.includes("DAILY INVENTORY")||u.includes("INVENTORY FROM ASH"))return["inventory",null]; return null; };
    const wardCanon=(s)=>{ const map={ "12 FLOOR":"12 floor","13 FLOOR":"13 floor","HDU":"HDU","DHDU":"HDU" };
      const u=String(s).replace(/\s+/g," ").trim(); const U=u.toUpperCase();
      const found=store.wards.find(w=>w.toUpperCase()===U); return found|| map[U] || u; };
    const compCanon=(s)=>{ const U=String(s).replace(/\s+/g," ").trim().toUpperCase().replace(/\.$/,"");
      return {PRBC:"PRBC",PLATELETS:"Platelets",FFP:"FFP",CRYO:"CRYO"}[U]||String(s).trim(); };
    let cur=null, daymap=null, dayCols=null;
    const signatures={};
    aoa.forEach(row=>{
      const b=row[1];
      const sk=secOf(b);
      if(sk){ cur=sk; daymap={};
        for(let c=2;c<row.length;c++){ const h=row[c]; if(typeof h==="number"&&h>=1&&h<=31) daymap[c]=h; }
        if(!dayCols) dayCols=daymap;
        return; }
      // "DONE BY:" row holds one staff signature per day
      if(typeof b==="string" && /done\s*by/i.test(b)){
        const dc=dayCols||{}; for(const c in dc){ const v=row[c];
          if(typeof v==="string" && v.trim()) signatures[dc[c]]=v.trim();
          else if(typeof v==="number") signatures[dc[c]]=String(v); }
        return;
      }
      if(cur && b!=null && String(b).trim()!==""){
        const [skind,comp]=cur;
        const label = (skind==="returned_ward"||skind==="returned_ash"||skind==="inventory")? compCanon(b) : wardCanon(b);
        const target = skind==="issue" ? (month.issue[comp]=month.issue[comp]||{}, month.issue[comp][label]={})
                     : (month[skind][label]={});
        for(const c in daymap){ const v=row[c]; if(typeof v==="number"&&v!==0) target[daymap[c]]=v; }
      }
    });
    const patch={issue:month.issue, received:month.received, returned_ward:month.returned_ward, returned_ash:month.returned_ash, inventory:month.inventory};
    if(Object.keys(signatures).length) patch.signatures=signatures;
    return {key, patch};
  }

  /* ---------- analysis engine (used by report + Excel) ---------- */
  const RPT = { PRBC:"#e34948", FFP:"#eda100", CRYO:"#2a78d6", Platelets:"#1baf7a" };
  function keysInYear(y){ return monthKeys().filter(k=>k.startsWith(y)); }
  function yearlyMatrix(){ // {years, comps, cell(y,c), rowTotal(y), colTotal(c), grand}
    const ys=years(), comps=store.components;
    const cell=(y,c)=>keysInYear(y).reduce((a,k)=>a+issueMonthTotal(k,c,"__all"),0);
    return {ys,comps,cell,
      rowTotal:y=>comps.reduce((a,c)=>a+cell(y,c),0),
      colTotal:c=>ys.reduce((a,y)=>a+cell(y,c),0),
      grand:()=>ys.reduce((a,y)=>a+comps.reduce((b,c)=>b+cell(y,c),0),0)};
  }
  function wardTotals(){ return store.wards.map(w=>({w, n:monthKeys().reduce((a,k)=>a+issueMonthTotal(k,"__all",w),0)})); }
  function componentTotals(){ return store.components.map(c=>({c, n:monthKeys().reduce((a,k)=>a+issueMonthTotal(k,c,"__all"),0)})); }
  function sectionTotalsAll(){
    const secs=[["issue","Units issued"],["received","Cross-matched received"],["returned_ward","Returned from ward"],["returned_ash","Returned ARH→ASH"],["inventory","Inventory from ASH"]];
    return secs.map(([s,l])=>({s,l,n:monthKeys().reduce((a,k)=>a+sectionMonthTotal(k,s),0)}));
  }
  function insights(){
    const out=[]; const keys=monthKeys(); if(!keys.length) return out;
    const grand=keys.reduce((a,k)=>a+issueMonthTotal(k,"__all","__all"),0);
    const ct=componentTotals().sort((a,b)=>b.n-a.n);
    const wt=wardTotals().sort((a,b)=>b.n-a.n);
    const pct=n=>grand?Math.round(n/grand*100):0;
    out.push(`A total of <b>${grand.toLocaleString()}</b> units were issued across <b>${keys.length}</b> months (${keyLabel(keys[0])} – ${keyLabel(keys.slice(-1)[0])}).`);
    if(ct[0]) out.push(`<b>${ct[0].c}</b> is the most-issued component — ${ct[0].n.toLocaleString()} units (${pct(ct[0].n)}% of all issuance), followed by ${ct[1]?ct[1].c+" ("+pct(ct[1].n)+"%)":"—"}.`);
    if(wt[0]) out.push(`<b>${wt[0].w}</b> receives the most product — ${wt[0].n.toLocaleString()} units (${pct(wt[0].n)}% of the total); the top 3 wards account for ${pct(wt[0].n+(wt[1]?wt[1].n:0)+(wt[2]?wt[2].n:0))}%.`);
    const ys=years();
    if(ys.length>=2){
      const a=keysInYear(ys[ys.length-2]).reduce((s,k)=>s+issueMonthTotal(k,"__all","__all"),0);
      const b=keysInYear(ys[ys.length-1]).reduce((s,k)=>s+issueMonthTotal(k,"__all","__all"),0);
      if(a){ const d=Math.round((b-a)/a*100); out.push(`Issuance ${d>=0?"rose":"fell"} <b>${Math.abs(d)}%</b> from ${ys[ys.length-2]} (${a.toLocaleString()}) to ${ys[ys.length-1]} (${b.toLocaleString()}). <span class="muted">Note: partial years affect this.</span>`); }
    }
    const st=sectionTotalsAll(); const iss=st.find(x=>x.s==="issue").n;
    const ret=st.find(x=>x.s==="returned_ward").n+st.find(x=>x.s==="returned_ash").n;
    if(iss) out.push(`Returns represent <b>${(ret/iss*100).toFixed(1)}%</b> of issued volume (${ret.toLocaleString()} returned vs ${iss.toLocaleString()} issued).`);
    return out;
  }

  /* ---------- report (graphs + analysis, printable / PDF) ---------- */
  function chartImg(cfg, w=900, h=340){
    return new Promise(res=>{
      const holder=$("#report-offscreen");
      const c=document.createElement("canvas");
      c.style.width=w+"px"; c.style.height=h+"px"; holder.appendChild(c);
      let done=false;
      const finish=(ch)=>{ if(done)return; done=true; let url=""; try{url=ch.toBase64Image("image/png",1);}catch(e){} ch.destroy(); c.remove(); res(url); };
      cfg.options=Object.assign({responsive:false,animation:{duration:0},devicePixelRatio:2},cfg.options);
      const ch=new Chart(c,cfg);
      requestAnimationFrame(()=>requestAnimationFrame(()=>finish(ch)));
      setTimeout(()=>finish(ch),500);
    });
  }
  const RPT_SCALES={ x:{grid:{display:false},ticks:{color:"#555",font:{size:12}}}, y:{beginAtZero:true,grid:{color:"#e7e7e4"},ticks:{color:"#555",font:{size:12}}} };
  const RPT_LEGEND={position:"bottom",labels:{color:"#333",usePointStyle:true,pointStyle:"rectRounded",boxWidth:12,font:{size:12}}};

  async function buildReport(){
    const keys=monthKeys();
    if(!keys.length){ msg("No data to report on.","err"); return; }
    msg("Generating report…","");
    const ys=years(), comps=store.components;
    // 1) yearly issued by component (grouped bars)
    const yearlyImg=await chartImg({type:"bar",
      data:{labels:ys,datasets:comps.map(c=>({label:c,backgroundColor:RPT[c],borderRadius:3,
        data:ys.map(y=>keysInYear(y).reduce((a,k)=>a+issueMonthTotal(k,c,"__all"),0))}))},
      options:{plugins:{legend:RPT_LEGEND},scales:RPT_SCALES}});
    // 2) component share doughnut
    const ctv=componentTotals();
    const compImg=await chartImg({type:"doughnut",
      data:{labels:comps,datasets:[{data:ctv.map(x=>x.n),backgroundColor:comps.map(c=>RPT[c]),borderColor:"#fff",borderWidth:2}]},
      options:{cutout:"58%",plugins:{legend:RPT_LEGEND}}},430,340);
    // 3) issued by ward (stacked horizontal by component)
    const wardImg=await chartImg({type:"bar",
      data:{labels:store.wards,datasets:comps.map(c=>({label:c,backgroundColor:RPT[c],borderColor:"#fff",borderWidth:1,
        data:store.wards.map(w=>keys.reduce((a,k)=>a+issueMonthTotal(k,c,w),0))}))},
      options:{indexAxis:"y",plugins:{legend:RPT_LEGEND},scales:{x:{stacked:true,...RPT_SCALES.x,grid:{color:"#e7e7e4"}},y:{stacked:true,ticks:{color:"#333",font:{size:11}},grid:{display:false}}}}},900,420);
    // 4) monthly trend for latest year
    const ly=ys[ys.length-1], lyk=keysInYear(ly);
    const monthlyImg=await chartImg({type:"line",
      data:{labels:lyk.map(k=>MONTH_ABBR[+k.slice(5)]),datasets:comps.map(c=>({label:c,borderColor:RPT[c],backgroundColor:RPT[c]+"22",borderWidth:2,tension:.25,pointRadius:3,
        data:lyk.map(k=>issueMonthTotal(k,c,"__all"))}))},
      options:{plugins:{legend:RPT_LEGEND},scales:RPT_SCALES}});

    // Transfusion Lab tests (only when there is any lab data)
    const labTot=(store.labTests||[]).map(t=>({t,n:monthKeys().reduce((a,k)=>a+sumDays((store.data[k].labtests||{})[t]),0)}));
    const labSum=labTot.reduce((a,x)=>a+x.n,0);
    let labImg="", labTable="";
    if(labSum>0){
      labImg=await chartImg({type:"bar",
        data:{labels:labTot.map(x=>x.t),datasets:[{data:labTot.map(x=>x.n),backgroundColor:"#2a78d6",borderRadius:3,borderColor:"#fff",borderWidth:1}]},
        options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{...RPT_SCALES.x,grid:{color:"#e7e7e4"}},y:{ticks:{color:"#333",font:{size:10}},grid:{display:false}}}}},900,480);
      labTable=`<table class="rt"><thead><tr><th>Test</th><th>Count</th></tr></thead><tbody>${
        labTot.slice().sort((a,b)=>b.n-a.n).map(x=>`<tr><td class="l">${x.t}</td><td>${x.n.toLocaleString()}</td></tr>`).join("")
      }</tbody></table>`;
    }

    // tables
    const ym=yearlyMatrix();
    const fmt=n=>n.toLocaleString();
    const yearlyTable=`<table class="rt"><thead><tr><th>Year</th>${comps.map(c=>`<th>${c}</th>`).join("")}<th>Total</th></tr></thead><tbody>${
      ym.ys.map(y=>`<tr><td class="l">${y}</td>${comps.map(c=>`<td>${fmt(ym.cell(y,c))}</td>`).join("")}<td class="tot">${fmt(ym.rowTotal(y))}</td></tr>`).join("")
    }</tbody><tfoot><tr><td class="l">Total</td>${comps.map(c=>`<td>${fmt(ym.colTotal(c))}</td>`).join("")}<td class="tot">${fmt(ym.grand())}</td></tr></tfoot></table>`;
    const grand=ym.grand()||1;
    const wardTable=`<table class="rt"><thead><tr><th>Ward / Floor</th><th>Units</th><th>Share</th></tr></thead><tbody>${
      wardTotals().sort((a,b)=>b.n-a.n).map(x=>`<tr><td class="l">${x.w}</td><td>${fmt(x.n)}</td><td>${(x.n/grand*100).toFixed(1)}%</td></tr>`).join("")
    }</tbody></table>`;
    const secTable=`<table class="rt"><thead><tr><th>Activity</th><th>Total units</th></tr></thead><tbody>${
      sectionTotalsAll().map(x=>`<tr><td class="l">${x.l}</td><td>${fmt(x.n)}</td></tr>`).join("")
    }</tbody></table>`;
    const bullets=insights().map(t=>`<li>${t}</li>`).join("");

    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Blood Bank Statistics — Report</title>
<style>
:root{--ink:#111;--mut:#666;--line:#e2e2df;--accent:#c0392b}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);margin:0;background:#f3f3f1}
.page{max-width:900px;margin:0 auto;background:#fff;padding:36px 44px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:20px}
.hd h1{margin:0;font-size:22px}
.hd .sub{color:var(--mut);font-size:13px;margin-top:2px}
.hd .drop{font-size:30px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);margin:26px 0 10px;border-bottom:1px solid var(--line);padding-bottom:5px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:6px 0 4px}
.kpi{border:1px solid var(--line);border-radius:9px;padding:11px 13px}
.kpi .l{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.03em}
.kpi .v{font-size:24px;font-weight:700}
ul.ins{margin:4px 0;padding-left:20px;line-height:1.6;font-size:14px}
ul.ins li{margin:3px 0}
img.chart{width:100%;border:1px solid var(--line);border-radius:9px;margin:6px 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
table.rt{border-collapse:collapse;width:100%;font-size:13px;margin:4px 0}
table.rt th,table.rt td{border:1px solid var(--line);padding:5px 8px;text-align:right}
table.rt th{background:#faf9f7;font-size:11px;text-transform:uppercase;letter-spacing:.02em;color:#555}
table.rt td.l,table.rt th:first-child{text-align:left}
table.rt td.tot,table.rt tfoot td{font-weight:700;background:#faf9f7}
.muted{color:var(--mut);font-size:.9em;font-weight:400}
.foot{margin-top:26px;border-top:1px solid var(--line);padding-top:10px;color:var(--mut);font-size:11px;display:flex;justify-content:space-between}
.bar{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);padding:10px 44px;display:flex;gap:10px;justify-content:flex-end;max-width:900px;margin:0 auto}
.bar button{font:inherit;font-weight:600;border:1px solid var(--accent);background:var(--accent);color:#fff;padding:8px 16px;border-radius:8px;cursor:pointer}
.bar button.sec{background:#fff;color:var(--accent)}
@media print{.bar{display:none}body{background:#fff}.page{padding:0}h2{break-after:avoid}img.chart,table.rt{break-inside:avoid}.two{break-inside:avoid}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨 Print / Save as PDF</button><button class="sec" onclick="window.close()">Close</button></div>
<div class="page">
  <div class="hd"><div><h1>Blood Bank Statistics Report</h1><div class="sub">Form-LAB-ARH-GEN-016 · ${keyLabel(keys[0])} – ${keyLabel(keys.slice(-1)[0])} · ${keys.length} months</div></div><div class="drop">🩸</div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Units issued</div><div class="v">${fmt(sectionTotalsAll()[0].n)}</div></div>
    <div class="kpi"><div class="l">Cross-matched</div><div class="v">${fmt(sectionTotalsAll()[1].n)}</div></div>
    <div class="kpi"><div class="l">Returned</div><div class="v">${fmt(sectionTotalsAll()[2].n+sectionTotalsAll()[3].n)}</div></div>
    <div class="kpi"><div class="l">Top component</div><div class="v">${componentTotals().sort((a,b)=>b.n-a.n)[0].c}</div></div>
  </div>
  <h2>Key findings</h2><ul class="ins">${bullets}</ul>
  <h2>Yearly issuance by component</h2><img class="chart" src="${yearlyImg}">
  <div class="two"><div><h2>Component share</h2><img class="chart" src="${compImg}"></div><div><h2>Component totals</h2>${yearlyTable}</div></div>
  <h2>Issued by ward / floor</h2><img class="chart" src="${wardImg}">
  <div class="two"><div><h2>Ward breakdown</h2>${wardTable}</div><div><h2>Activity summary</h2>${secTable}</div></div>
  <h2>Monthly trend — ${ly}</h2><img class="chart" src="${monthlyImg}">
  ${labSum>0?`<h2>Transfusion Lab tests</h2><div class="two" style="grid-template-columns:1.1fr .9fr"><div><img class="chart" src="${labImg}"></div><div>${labTable}</div></div>`:""}
  <div class="foot"><span>Generated ${new Date().toLocaleString()}</span><span>Blood Bank Statistics app</span></div>
</div></body></html>`;

    const w=window.open("","_blank");
    if(!w){ // popup blocked → download instead
      download(new Blob([html],{type:"text/html"}), `blood-bank-report-${today()}.html`);
      msg("Report downloaded (popup was blocked). Open it and print to PDF.","ok"); return;
    }
    w.document.open(); w.document.write(html); w.document.close();
    msg("Report opened in a new tab — use its Print / Save as PDF button.","ok");
  }

  /* ---------- view switching ---------- */
  function refreshFooter(){ $("#foot-count").textContent=`${monthKeys().length} months · ${years().length? years()[0]+"–"+years().slice(-1)[0]:"—"}`; }
  function refreshAll(){ initDashFilters(); renderDashboard(); initEntry(); renderManage(); refreshFooter(); }

  function switchView(v){
    document.querySelectorAll(".view").forEach(el=>el.hidden = el.id!=="view-"+v);
    document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
    if(v==="dashboard") renderDashboard();
    if(v==="entry") initEntry();
    if(v==="manage") renderManage();
  }

  /* ---------- init ---------- */
  function boot(){
    store = load() || seedStore();
    if(!store.data) store.data={};
    migrate(store);
    save();
    // theme sync for chart tokens
    document.getElementById("tabs").addEventListener("click",e=>{ if(e.target.dataset.view) switchView(e.target.dataset.view); });
    ["f-scope","f-year","f-component","f-ward"].forEach(id=>{
      $("#"+id).addEventListener("change",()=>{ if(id==="f-year") syncMonthList(); renderDashboard(); });
    });
    $("#f-month").addEventListener("change",renderDashboard);
    ["e-month","e-section","e-component"].forEach(id=>$("#"+id).addEventListener("change",renderEntry));
    $("#btn-add-month").onclick=addMonth;
    $("#e-btn-add-month").onclick=addMonthFromEntry;
    $("#btn-export-json").onclick=exportJSON;
    $("#btn-export-xlsx").onclick=()=>exportStyledXLSX().catch(e=>{console.error(e);msg("Styled export failed: "+e.message,"err");});
    $("#btn-export-forms").onclick=()=>exportXLSX().catch(e=>{console.error(e);msg("Monthly-forms export failed: "+e.message,"err");});
    $("#btn-report").onclick=buildReport;
    $("#imp-json").onchange=e=>e.target.files[0]&&importJSON(e.target.files[0]);
    $("#imp-xlsx").onchange=e=>e.target.files[0]&&importXLSX(e.target.files[0]);
    $("#btn-reseed").onclick=()=>{ if(confirm("Replace ALL current data with the bundled workbook data?")){ store=seedStore(); save(); refreshAll(); msg("Bundled data restored.","ok"); } };
    $("#btn-wipe").onclick=()=>{ if(confirm("Delete ALL data permanently?")){ store={wards:window.BB_SEED.wards,components:window.BB_SEED.components,data:{}}; save(); refreshAll(); msg("All data deleted.","ok"); } };
    refreshAll();
    // re-render charts on OS theme change
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",renderDashboard);
  }
  boot();
})();
