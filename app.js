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
  };
  const RET_COMPONENTS = ["PRBC","Platelets","FFP","CRYO"];

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
    return JSON.parse(JSON.stringify({ wards: s.wards, components: s.components, data: s.data }));
  }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(store)); refreshFooter(); }
  function daysInMonth(key) { const [y,m]=key.split("-").map(Number); return new Date(y,m,0).getDate(); }
  function monthKeys() { return Object.keys(store.data).sort(); }
  function years() { return [...new Set(monthKeys().map(k=>k.slice(0,4)))].sort(); }
  function keyLabel(k){ const [y,m]=k.split("-"); return `${MONTH_ABBR[+m]} ${y}`; }

  /* ---------- aggregation ---------- */
  function emptyMonth() {
    const m = { issue:{}, received:{}, returned_ward:{}, returned_ash:{}, inventory:{} };
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
    renderEntry();
  }
  function renderEntry() {
    const key=$("#e-month").value, section=$("#e-section").value;
    const meta=SECTIONS[section];
    $("#e-wrap-comp").style.display = meta.byComponent?"":"none";
    const table=$("#entry-table");
    if (!key){ table.innerHTML="<caption class='muted'>No month selected — add one from Manage.</caption>"; return; }
    if (!store.data[key]) store.data[key]=emptyMonth();
    const M=store.data[key];
    const nDays=daysInMonth(key);
    const rowLabels = meta.rows==="ward"? store.wards : RET_COMPONENTS;
    // resolve the data block we edit
    let block, comp=null;
    if (section==="issue"){ comp=$("#e-component").value; M.issue[comp]=M.issue[comp]||{}; block=M.issue[comp]; }
    else block=M[section];
    $("#e-hint").textContent = `${keyLabel(key)} · ${meta.label}${comp?" · "+comp:""} · enter daily counts, totals auto-calculate`;

    // header
    let html="<thead><tr><th class='rowhead'>"+(meta.rows==="ward"?"Ward / Floor":"Component")+"</th>";
    for(let d=1;d<=nDays;d++) html+=`<th>${d}</th>`;
    html+="<th class='total'>Total</th></tr></thead><tbody>";
    rowLabels.forEach(r=>{
      block[r]=block[r]||{};
      html+=`<tr><td class="rowhead">${r}</td>`;
      for(let d=1;d<=nDays;d++){
        const v=block[r][d];
        html+=`<td><input inputmode="numeric" data-row="${encodeURIComponent(r)}" data-day="${d}" value="${v??""}" placeholder="·"></td>`;
      }
      html+=`<td class="total" data-rowtotal="${encodeURIComponent(r)}">${sumDays(block[r])||0}</td></tr>`;
    });
    html+="</tbody><tfoot><tr><td class='rowhead'>Total</td>";
    for(let d=1;d<=nDays;d++) html+=`<td data-coltotal="${d}">${colTotal(block,rowLabels,d)}</td>`;
    html+=`<td class="total" data-grandtotal>${grandTotal(block,rowLabels)}</td></tr></tfoot>`;
    table.innerHTML=html;

    table.oninput=(e)=>{
      const inp=e.target; if(inp.tagName!=="INPUT") return;
      const r=decodeURIComponent(inp.dataset.row), d=inp.dataset.day;
      let val=parseInt(inp.value,10);
      if (inp.value.trim()===""||isNaN(val)||val<0){ delete block[r][d]; }
      else block[r][d]=val;
      table.querySelector(`[data-rowtotal="${encodeURIComponent(r)}"]`).textContent=sumDays(block[r])||0;
      table.querySelector(`[data-coltotal="${d}"]`).textContent=colTotal(block,rowLabels,d);
      table.querySelector("[data-grandtotal]").textContent=grandTotal(block,rowLabels);
      save();
    };
  }
  function colTotal(block,rows,d){ let t=0; rows.forEach(r=>t+=Number((block[r]||{})[d])||0); return t||0; }
  function grandTotal(block,rows){ let t=0; rows.forEach(r=>t+=sumDays(block[r])); return t||0; }

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
  function addMonth() {
    const m=+$("#add-month").value, y=+$("#add-year").value;
    if(!y||y<2000){ msg("Enter a valid year.","err"); return; }
    const key=`${y}-${String(m).padStart(2,"0")}`;
    if(store.data[key]){ msg(`${keyLabel(key)} already exists.`,"err"); return; }
    store.data[key]=emptyMonth(); save(); refreshAll();
    msg(`Added ${keyLabel(key)}. Switch to Data Entry to fill it in.`,"ok");
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

  // Excel export: one sheet per month, mirroring the form layout
  function exportXLSX() {
    const wb=XLSX.utils.book_new();
    monthKeys().forEach(key=>{
      const M=store.data[key], nDays=daysInMonth(key);
      const rows=[];
      const hdr=(title)=>{ const r=[title]; for(let d=1;d<=nDays;d++) r.push(d); r.push("Total"); rows.push(r); };
      const dataRow=(label,obj)=>{ const r=[label]; let t=0; for(let d=1;d<=nDays;d++){ const v=Number((obj||{})[d])||0; r.push(v||""); t+=v; } r.push(t); rows.push(r); };
      rows.push(["Blood Bank Daily Statistics — "+keyLabel(key)]);
      store.components.forEach(c=>{ hdr("ISSUING "+c); store.wards.forEach(w=>dataRow(w,(M.issue[c]||{})[w])); });
      hdr("RECEIVED CROSS MATCHED"); store.wards.forEach(w=>dataRow(w,M.received[w]));
      [["returned_ward","RETURNED FROM WARD"],["returned_ash","RETURNED ARH→ASH"],["inventory","DAILY INVENTORY FROM ASH"]].forEach(([s,t])=>{
        hdr(t); RET_COMPONENTS.forEach(c=>dataRow(c,M[s][c])); });
      const ws=XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, keyLabel(key).replace(/[^A-Za-z0-9 ]/g,"").slice(0,31));
    });
    XLSX.writeFile(wb, `blood-bank-report-${today()}.xlsx`);
  }

  // Excel import: parse a workbook shaped like the original form
  function importXLSX(file) {
    const r=new FileReader();
    r.onload=()=>{ try{
      const wb=XLSX.read(r.result,{type:"array"});
      let added=0;
      wb.SheetNames.forEach(name=>{
        const res=parseSheet(wb.Sheets[name], name);
        if(res){ store.data[res.key]=res.month; added++; }
      });
      save(); refreshAll();
      msg(added?`Imported ${added} month(s) from workbook.`:"No recognizable months found in that workbook.", added?"ok":"err");
    }catch(e){ console.error(e); msg("Could not read that Excel file.","err"); } };
    r.readAsArrayBuffer(file);
  }
  const MONTH_LOOKUP=[["septamber",9],["novembr",11],["octo",10],["march",3],["april",4],["august",8],["agu",8],
    ["january",1],["february",2],["jan",1],["feb",2],["mar",3],["apr",4],["may",5],["june",6],["july",7],
    ["jun",6],["jul",7],["aug",8],["sep",9],["oct",10],["nov",11],["december",12],["dec",12]];
  function detectMonthYear(title){
    const u=title.toLowerCase(); let mo=null;
    for(const [k,v] of MONTH_LOOKUP){ if(u.includes(k)){ mo=v; break; } }
    const ym=title.match(/(20\d\d)/); const yr=ym?+ym[1]:2024;
    return mo?{mo,yr}:null;
  }
  function parseSheet(ws, name){
    const my=detectMonthYear(name); if(!my) return null;
    const key=`${my.yr}-${String(my.mo).padStart(2,"0")}`;
    const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
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
    let cur=null, daymap=null;
    aoa.forEach(row=>{
      const b=row[1];
      const sk=secOf(b);
      if(sk){ cur=sk; daymap={};
        for(let c=2;c<row.length;c++){ const h=row[c]; if(typeof h==="number"&&h>=1&&h<=31) daymap[c]=h; }
        return; }
      if(cur && b!=null && String(b).trim()!==""){
        const [skind,comp]=cur;
        const label = (skind==="returned_ward"||skind==="returned_ash"||skind==="inventory")? compCanon(b) : wardCanon(b);
        const target = skind==="issue" ? (month.issue[comp]=month.issue[comp]||{}, month.issue[comp][label]={})
                     : (month[skind][label]={});
        for(const c in daymap){ const v=row[c]; if(typeof v==="number"&&v!==0) target[daymap[c]]=v; }
      }
    });
    return {key,month};
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
    save();
    // theme sync for chart tokens
    document.getElementById("tabs").addEventListener("click",e=>{ if(e.target.dataset.view) switchView(e.target.dataset.view); });
    ["f-scope","f-year","f-component","f-ward"].forEach(id=>{
      $("#"+id).addEventListener("change",()=>{ if(id==="f-year") syncMonthList(); renderDashboard(); });
    });
    $("#f-month").addEventListener("change",renderDashboard);
    ["e-month","e-section","e-component"].forEach(id=>$("#"+id).addEventListener("change",renderEntry));
    $("#btn-add-month").onclick=addMonth;
    $("#btn-export-json").onclick=exportJSON;
    $("#btn-export-xlsx").onclick=exportXLSX;
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
