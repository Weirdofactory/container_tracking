/* Enterprise operations upgrade: derived read-only intelligence over existing shipment records.
   No shipment mutations, schema changes, or authentication changes are performed here. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const auditKey = "gml_ops_hub_session_audit_v1";
  const tabs = [
    ["integrity","Data integrity","◈"],["alerts","Exceptions & alerts","⚠"],
    ["shipment360","Shipment 360°","▣"],["search","Advanced search","⌕"],
    ["scmtr","SCMTR / CSN","▤"],["finance","Finance & LFD","₹"],["audit","Audit trail","◷"]
  ];
  let activeTab = "integrity";
  let selectedIndex = -1;
  let hubSearch = "";
  function safeRows(){ try { return Array.isArray(rows) ? rows.filter(Boolean) : []; } catch (_) { return []; } }
  function field(r,names){ try { return typeof getField==="function" ? getField(r,names) : ""; } catch(_){ return ""; } }
  function escHtml(v){ return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function norm(v){ return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,""); }
  function container(r){ return field(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO","CONTAINER NUMBER"]); }
  function date(v){ if(!v)return null; try { if(typeof parseLocalDate==="function")return parseLocalDate(v); const d=new Date(v);return isNaN(d)?null:d; } catch(_){return null;} }
  function dateText(v){ if(!v)return "Not recorded"; const d=date(v);return d&&!isNaN(d)?d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):String(v); }
  function completed(r){ try{return typeof isFullyCompleted==="function"&&isFullyCompleted(r);}catch(_){return false;} }
  function fees(r){ try{return typeof calculateStandardFees==="function"?calculateStandardFees(r):null;}catch(_){return null;} }
  function audit(message,detail){ let list=[];try{list=JSON.parse(localStorage.getItem(auditKey)||"[]");}catch(_){} list.unshift({at:new Date().toISOString(),message,detail:detail||""});try{localStorage.setItem(auditKey,JSON.stringify(list.slice(0,100)));}catch(_){} }
  function duplicateGroups(list){const map=new Map();list.forEach((r,i)=>{const cn=norm(container(r));if(!cn)return;if(!map.has(cn))map.set(cn,[]);map.get(cn).push({r,i});});return [...map.entries()].filter(([,items])=>items.length>1);}
  function checks(list){
    const dup=duplicateGroups(list), noContainer=list.map((r,i)=>({r,i})).filter(x=>!container(x.r));
    const missingVessel=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
    const missingEta=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["ETA"]));
    const missingPol=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["POL","PORT OF LOADING"]));
    const missingHbl=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["HBL NO","HBL","HOUSE BL","HOUSE BILL OF LADING"]));
    return {dup,noContainer,missingVessel,missingEta,missingPol,missingHbl,total:list.length};
  }
  function exceptions(list){
    const now=new Date();now.setHours(0,0,0,0);
    const result=[];
    list.forEach((r,i)=>{
      const cn=container(r)||"Record "+(i+1), eta=date(field(r,["ETA"])), pi=!!date(field(r,["PORT IN"]));
      if(eta && eta<now && !pi && !completed(r))result.push({level:"high",kind:"ETA overdue",cn,i,detail:"ETA "+dateText(field(r,["ETA"]))+" · Port In not recorded"});
      const f=fees(r);
      if(f && Number.isFinite(f.terminalDaysLeft) && f.terminalDaysLeft<=3 && f.terminalDaysLeft>=0 && !completed(r))result.push({level:f.terminalDaysLeft===0?"high":"medium",kind:"Terminal LFD approaching",cn,i,detail:f.terminalDaysLeft+" day(s) left · LFD "+(f.terminalLFD||"—")});
      if(f && f.terminalDaysLeft<0 && !completed(r))result.push({level:"high",kind:"Terminal LFD passed",cn,i,detail:Math.abs(f.terminalDaysLeft)+" day(s) past LFD"});
      if(!field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]))result.push({level:"low",kind:"Missing vessel",cn,i,detail:"Confirm vessel/voyage before relying on ETA"});
    });
    return result.sort((a,b)=>({high:0,medium:1,low:2}[a.level]-({high:0,medium:1,low:2}[b.level])));
  }
  function money(n){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n)||0);}
  function statusPill(text,kind){return '<span class="eu-pill '+(kind||"")+'">'+escHtml(text)+'</span>';}
  function table(headers,rowsHtml){return '<div class="eu-table-wrap"><table class="eu-table"><thead><tr>'+headers.map(h=>'<th>'+escHtml(h)+'</th>').join("")+'</tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="'+headers.length+'" class="eu-empty">No matching records found.</td></tr>')+'</tbody></table></div>';}
  function rowButton(i,label,cls){return '<button type="button" class="eu-btn '+(cls||"")+'" data-eu-row="'+i+'">'+escHtml(label)+'</button>';}
  function openHub(tab){if(tab&&tabs.some(t=>t[0]===tab))activeTab=tab;const modal=$("euHub");if(!modal)return;modal.classList.add("open");document.body.classList.add("eu-hub-open");render();audit("Opened operations hub",activeTab);}
  function closeHub(){const modal=$("euHub");if(modal)modal.classList.remove("open");document.body.classList.remove("eu-hub-open");}
  function renderIntegrity(list){
    const c=checks(list),cards=[["Records checked",c.total,"blue"],["Duplicate container IDs",c.dup.length,c.dup.length?"red":"green"],["Missing container numbers",c.noContainer.length,c.noContainer.length?"red":"green"],["Missing vessel",c.missingVessel.length,c.missingVessel.length?"amber":"green"],["Missing ETA",c.missingEta.length,c.missingEta.length?"amber":"green"],["Missing HBL",c.missingHbl.length,c.missingHbl.length?"amber":"green"]];
    let rowsHtml="";
    c.dup.forEach(([cn,items])=>rowsHtml+='<tr><td>'+escHtml(cn)+'</td><td>'+items.length+'</td><td>'+items.map(x=>escHtml(container(x.r)||"—")).join(", ")+'</td><td>'+rowButton(items[0].i,"Open shipment")+'</td></tr>');
    c.noContainer.forEach(x=>rowsHtml+='<tr><td>Missing container</td><td>1</td><td>Record '+(x.i+1)+'</td><td>'+rowButton(x.i,"Inspect")+'</td></tr>');
    return '<div class="eu-kpi-grid">'+cards.map(c=>'<div class="eu-kpi '+c[2]+'"><small>'+c[0]+'</small><strong>'+c[1]+'</strong></div>').join("")+'</div><div class="eu-note">Read-only structural checks against the currently loaded shipment dataset. Duplicate identifiers are flagged for review, never deleted automatically. This is not a server-side audit.</div><h3>Integrity findings</h3>'+table(["Finding / container","Count","Records","Action"],rowsHtml);
  }
  function renderAlerts(list){
    const a=exceptions(list);
    const high=a.filter(x=>x.level==="high").length,med=a.filter(x=>x.level==="medium").length;
    const body=a.map(x=>'<tr><td>'+statusPill(x.level.toUpperCase(),x.level)+'</td><td>'+escHtml(x.kind)+'</td><td><strong>'+escHtml(x.cn)+'</strong><small class="eu-sub">'+escHtml(x.detail)+'</small></td><td>'+rowButton(x.i,"Shipment 360°")+'</td></tr>').join("");
    return '<div class="eu-kpi-grid"><div class="eu-kpi red"><small>High priority</small><strong>'+high+'</strong></div><div class="eu-kpi amber"><small>Needs attention</small><strong>'+med+'</strong></div><div class="eu-kpi blue"><small>Total alerts</small><strong>'+a.length+'</strong></div></div><div class="eu-note">Alerts are calculated from existing ETA, Port In, completion and configured terminal LFD fields. No email/SMS alerts are sent by this interface.</div>'+table(["Priority","Alert","Shipment / reason","Action"],body);
  }
  function renderShipment(list){
    let idx=selectedIndex>=0&&list[selectedIndex]?selectedIndex:(list.length?0:-1);
    if(idx<0)return '<div class="eu-empty">No shipment records are loaded yet. Check the cloud sync status and retry before using Shipment 360°.</div>';
    selectedIndex=idx;const r=list[idx],cn=container(r)||"Container number missing";
    const items=[
      ["Container",cn],["HBL",field(r,["HBL NO","HBL","HOUSE BL"])||"—"],["MBL",field(r,["MBL NO","MBL","MASTER BL"])||"—"],
      ["Booking",field(r,["BOOKING NO","BOOKING","BOOKING REF"])||"—"],["Vessel / voyage",field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—"],
      ["POL",field(r,["POL","PORT OF LOADING"])||"—"],["Transshipment",field(r,["TRANSHIPMENT PORT","TRANSHIPMENT","TRANSSHIPMENT PORT","T/S PORT","TS PORT"])||"Not recorded"],
      ["Gateway",field(r,["GATEWAY PORT","POD","PORT OF DISCHARGE","DESTINATION"])||"—"],["ETA",dateText(field(r,["ETA"]))],
      ["Port In",dateText(field(r,["PORT IN"]))],["Port Out",dateText(field(r,["PORT OUT"]))],["CFS In",dateText(field(r,["CFS IN"]))],
      ["Destuffed",dateText(field(r,["DESTUFFING DATE","DESTUFF DATE"]))],["Empty return",dateText(field(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE"]))],
      ["Remarks",field(r,["REMARKS","NOTES","REMARK"])||"—"]
    ];
    const opts=list.map((x,i)=>'<option value="'+i+'" '+(i===idx?"selected":"")+'>'+escHtml((container(x)||"Record "+(i+1))+" · "+(field(x,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"Vessel not recorded"))+'</option>').join("");
    return '<div class="eu-detail-toolbar"><label for="euShipmentSelect">Select shipment</label><select id="euShipmentSelect" class="eu-select">'+opts+'</select>'+rowButton(idx,"Show on map","primary")+'</div><div class="eu-detail-title"><div><span class="eu-eyebrow">SHIPMENT 360°</span><h3>'+escHtml(cn)+'</h3><p>'+escHtml(field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"Vessel not recorded")+'</p></div>'+statusPill(completed(r)?"COMPLETED":"IN PROGRESS",completed(r)?"green":"blue")+'</div><div class="eu-detail-grid">'+items.map(it=>'<div class="eu-detail-cell"><small>'+escHtml(it[0])+'</small><strong>'+escHtml(it[1])+'</strong></div>').join("")+'</div><div class="eu-note">This panel reads the current shipment record. To change data, use the existing authorised shipment edit workflow.</div>';
  }
  function renderSearch(list){
    const q=norm(hubSearch),filtered=q?list.map((r,i)=>({r,i})).filter(x=>norm(Object.entries(x.r).map(([k,v])=>k+" "+String(v??"")).join(" ")).includes(q)):list.map((r,i)=>({r,i}));
    return '<div class="eu-searchbar"><input id="euSearchInput" class="eu-input" value="'+escHtml(hubSearch)+'" placeholder="Search container, HBL, MBL, booking, vessel, truck or any recorded field"><button class="eu-btn primary" id="euSearchGo">Search</button><button class="eu-btn" id="euSearchClear">Clear</button></div><div class="eu-note">Search scans all currently loaded record fields and does not alter shipment data or the main table filters.</div>'+table(["Container","HBL / MBL","Vessel","Gateway","ETA","Action"],filtered.slice(0,100).map(x=>'<tr><td><strong>'+escHtml(container(x.r)||"—")+'</strong></td><td>'+escHtml(field(x.r,["HBL NO","HBL"])||"—")+'<small class="eu-sub">'+escHtml(field(x.r,["MBL NO","MBL"])||"")+'</small></td><td>'+escHtml(field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—")+'</td><td>'+escHtml(field(x.r,["GATEWAY PORT","POD","DESTINATION"])||"—")+'</td><td>'+escHtml(dateText(field(x.r,["ETA"])))+'</td><td>'+rowButton(x.i,"Open 360°")+'</td></tr>').join(""))+'<div class="eu-footnote">Showing '+Math.min(filtered.length,100)+' of '+filtered.length+' matching records.</div>';
  }
  function renderScmtr(list){
    const records=list.map((r,i)=>({r,i})).map(x=>{
      const missing=[];
      if(!field(x.r,["HBL NO","HBL","HOUSE BL"]))missing.push("HBL");
      if(!field(x.r,["MBL NO","MBL","MASTER BL"]))missing.push("MBL");
      if(!field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"]))missing.push("Vessel");
      if(!field(x.r,["POL","PORT OF LOADING"]))missing.push("POL");
      if(!field(x.r,["ETA","ETD","ATD"]))missing.push("ETA/ETD");
      const csn=field(x.r,["CSN STATUS","SCMTR STATUS","CSN FILING STATUS","SCMTR FILING STATUS"]);
      return {...x,missing,csn};
    });
    const ready=records.filter(x=>!x.missing.length).length,needs=records.length-ready;
    return '<div class="eu-kpi-grid"><div class="eu-kpi blue"><small>Records checked</small><strong>'+records.length+'</strong></div><div class="eu-kpi green"><small>Required fields present</small><strong>'+ready+'</strong></div><div class="eu-kpi amber"><small>Needs review</small><strong>'+needs+'</strong></div></div><div class="eu-note">Readiness is a field-completeness aid only. It does not confirm an actual CSN submission, statutory compliance or filing acceptance. A stored filing status is displayed only when present in the record.</div>'+table(["Container","Vessel","CSN status in record","Missing fields","Action"],records.filter(x=>x.missing.length||x.csn).slice(0,150).map(x=>'<tr><td>'+escHtml(container(x.r)||"—")+'</td><td>'+escHtml(field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—")+'</td><td>'+escHtml(x.csn||"Not recorded")+'</td><td>'+escHtml(x.missing.join(", ")||"—")+'</td><td>'+rowButton(x.i,"Inspect")+'</td></tr>').join(""))+'<div class="eu-footnote">Only existing shipment fields are read; no filing status is written or inferred as submitted.</div>';
  }
  function renderFinance(list){
    let total=0,overdue=0,near=0,known=0;
    const rowsHtml=list.map((r,i)=>{const f=fees(r);if(!f)return "";known++;const cost=Number(f.totalCostUSD)||0;total+=cost;if(f.demOverdue)overdue++;if(Number.isFinite(f.terminalDaysLeft)&&f.terminalDaysLeft<=3)near++;if(!cost&&f.terminalDaysLeft==null)return "";return '<tr><td>'+escHtml(container(r)||"—")+'</td><td>'+escHtml(f.terminalLFD||"—")+'</td><td>'+escHtml(f.terminalDaysLeft==null?"—":f.terminalDaysLeft<0?Math.abs(f.terminalDaysLeft)+" days overdue":f.terminalDaysLeft+" days left")+'</td><td>'+money(cost)+'</td><td>'+rowButton(i,"Open 360°")+'</td></tr>';}).join("");
    return '<div class="eu-kpi-grid"><div class="eu-kpi blue"><small>Records evaluated</small><strong>'+known+'</strong></div><div class="eu-kpi amber"><small>LFD within 3 days / overdue</small><strong>'+near+'</strong></div><div class="eu-kpi red"><small>Demurrage records flagged</small><strong>'+overdue+'</strong></div><div class="eu-kpi green"><small>Calculated charges</small><strong>'+money(total)+'</strong></div></div><div class="eu-note">Amounts use the existing configured fee calculation and recorded milestone dates. They are estimates, not confirmed invoices; blank or unavailable charge data is not treated as zero due.</div>'+table(["Container","Terminal LFD","Deadline","Estimated charges","Action"],rowsHtml);
  }
  function renderAudit(){
    let list=[];try{list=JSON.parse(localStorage.getItem(auditKey)||"[]");}catch(_){}
    return '<div class="eu-note eu-warning">Audit history in this initial UI is stored in this browser only. It is not a tamper-resistant server audit and does not yet record authoritative before/after changes. A server-backed audit table and write policy must be configured before this is used for compliance evidence.</div>'+table(["Time","Hub activity","Details"],list.map(x=>'<tr><td>'+escHtml(new Date(x.at).toLocaleString("en-IN"))+'</td><td>'+escHtml(x.message)+'</td><td>'+escHtml(x.detail||"—")+'</td></tr>').join(""))+'<div class="eu-actions"><button class="eu-btn" id="euAuditClear">Clear local hub history</button></div>';
  }
  function render(){
    const list=safeRows(),root=$("euHubBody"),nav=$("euHubTabs"),title=$("euHubTitle");
    if(!root||!nav)return;
    nav.innerHTML=tabs.map(t=>'<button type="button" class="eu-tab '+(activeTab===t[0]?"active":"")+'" data-eu-tab="'+t[0]+'"><span>'+t[2]+'</span>'+t[1]+'</button>').join("");
    title.textContent=(tabs.find(t=>t[0]===activeTab)||tabs[0])[1];
    const renderers={integrity:renderIntegrity,alerts:renderAlerts,shipment360:renderShipment,search:renderSearch,scmtr:renderScmtr,finance:renderFinance,audit:renderAudit};
    root.innerHTML=renderers[activeTab](list);
    nav.querySelectorAll("[data-eu-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.euTab;render();audit("Viewed operations hub",activeTab);}));
    root.querySelectorAll("[data-eu-row]").forEach(b=>b.addEventListener("click",()=>{
      const idx=Number(b.dataset.euRow);if(!Number.isInteger(idx)||!list[idx])return;
      selectedIndex=idx;
      if(activeTab==="integrity"||activeTab==="alerts"||activeTab==="search"||activeTab==="scmtr"||activeTab==="finance")activeTab="shipment360";
      if(b.textContent.toLowerCase().includes("map")){
        closeHub();try{if(typeof showShipmentRoute==="function")showShipmentRoute(idx);}catch(_){}
      }else render();
      audit("Opened shipment record",container(list[idx]));
    }));
    const select=$("euShipmentSelect");if(select)select.addEventListener("change",()=>{selectedIndex=Number(select.value);render();});
    const search=$("euSearchInput"),go=$("euSearchGo"),clear=$("euSearchClear");
    if(search){search.addEventListener("input",()=>{hubSearch=search.value;});search.addEventListener("keydown",e=>{if(e.key==="Enter"){hubSearch=search.value;render();}});}
    if(go)go.addEventListener("click",()=>{hubSearch=(search&&search.value)||"";render();audit("Ran advanced search",hubSearch);});
    if(clear)clear.addEventListener("click",()=>{hubSearch="";render();});
    const auditClear=$("euAuditClear");if(auditClear)auditClear.addEventListener("click",()=>{try{localStorage.removeItem(auditKey);}catch(_){}render();});
  }
  function mount(){
    if(!$("opsDashboardView")||$("euHub"))return;
    const nav=document.querySelector('.staff-reference-sidebar [data-staff-nav="audit"]');
    if(nav){const b=document.createElement("button");b.type="button";b.className="staff-side-link";b.dataset.staffNav="intelligence";b.innerHTML='<span>✦</span> Operations Intelligence';nav.parentNode.insertBefore(b,nav);}
    const top=document.createElement("button");top.type="button";top.className="eu-launch";top.id="euHubLaunch";top.innerHTML='<span>✦</span> Intelligence Hub';
    const overview=document.querySelector("#opsDashboardView .ect-overview-stats");if(overview)overview.appendChild(top);
    const modal=document.createElement("div");modal.id="euHub";modal.className="eu-modal";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-labelledby","euHubTitle");
    modal.innerHTML='<div class="eu-dialog"><header class="eu-header"><div><span class="eu-eyebrow">GML OPERATIONS · INTELLIGENCE</span><h2 id="euHubTitle">Data integrity</h2><p>Derived operational views · existing shipment data remains unchanged</p></div><button type="button" class="eu-close" id="euHubClose" aria-label="Close">×</button></header><nav class="eu-tabs" id="euHubTabs" aria-label="Operations intelligence sections"></nav><main class="eu-body" id="euHubBody"></main><footer class="eu-footer"><span>Read-only analytics · no records modified</span><button type="button" class="eu-btn" id="euHubCloseBottom">Close</button></footer></div>';
    document.body.appendChild(modal);
    top.addEventListener("click",()=>openHub("integrity"));
    modal.querySelector("#euHubClose").addEventListener("click",closeHub);modal.querySelector("#euHubCloseBottom").addEventListener("click",closeHub);
    modal.addEventListener("click",e=>{if(e.target===modal)closeHub();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeHub();});
    document.querySelectorAll('[data-staff-nav="intelligence"]').forEach(b=>b.addEventListener("click",()=>openHub("integrity")));
    document.querySelectorAll('[data-staff-nav="audit"]').forEach(b=>b.addEventListener("dblclick",()=>openHub("audit")));
    // Enhance customer portal copy with a clear privacy/data-source note; existing Shipment 360 and route controls remain intact.
    const customerResults=$("publicResultContainer");
    if(customerResults){
      const note=document.createElement("div");note.className="eu-customer-note";note.textContent="Shipment details and milestones are shown from the latest records available to this portal. Live vessel position is not implied unless an AIS feed is connected.";
      const observer=new MutationObserver(()=>{if(customerResults.childElementCount&&!customerResults.querySelector(".eu-customer-note"))customerResults.appendChild(note);});
      observer.observe(customerResults,{childList:true,subtree:true});
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
  window.openOperationsIntelligence=openHub;
})();