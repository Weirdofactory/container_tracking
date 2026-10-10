/* ATLAS TRACK — independent customer tracking application
   New UI controller. Connects to the existing Supabase shipment register and customs RPCs. */
(() => {
  "use strict";
  const DB_URL = "https://ykeucqritoexykqrggzz.supabase.co";
  const DB_KEY = "sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ";
  const db = window.supabase.createClient(DB_URL, DB_KEY);
  const config = window.GML_APP_CONFIG || {appName:"CargoTrack",appShort:"CT",companyName:"",supportEmail:"",supportWhatsApp:""};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const clean = v => { const s=String(v ?? "").trim(); return !s || /^(n\/a|na|unknown|null|-)$/i.test(s) ? "" : s; };
  const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g,"");
  let records = [];
  let busy = false;

  function val(row, keys) {
    for (const k of keys) {
      const found = Object.keys(row || {}).find(x => x.toLowerCase().trim() === k.toLowerCase().trim());
      if (found && clean(row[found])) return row[found];
    }
    return "";
  }
  function fmtDate(raw) {
    const s=clean(raw); if(!s) return "—";
    let d;
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
      const p=s.split(/[-/]/); d=new Date(Number(p[2]),Number(p[1])-1,Number(p[0]));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const p=s.split("-"); d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));
    } else d=new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
  }
  function status(row) {
    const fields = [
      ["CONTAINER RETURN DATE","EMPTY RETURNED","Container returned","complete"],
      ["PORT OUT","PORT OUT","Port out recorded","complete"],
      ["DESTUFFING DATE","DE-STUFFED","Destuffing recorded","active"],
      ["CFS IN","CFS IN","Cargo received at CFS","active"],
      ["PORT IN","PORT IN","Container gated in","active"],
      ["INWARD DATE","INWARD GRANTED","Inward granted","active"],
      ["ETA","IN TRANSIT","Estimated arrival","transit"],
      ["ETD","VESSEL DEPARTED","Vessel departed","transit"]
    ];
    for (const [field,label,desc,tone] of fields) if(clean(val(row,[field]))) return {label,desc,tone,date:fmtDate(val(row,[field]))};
    return {label:"TRACKING PENDING",desc:"Shipment milestone data pending",tone:"pending",date:"—"};
  }
  async function loadRecords(force=false) {
    if (records.length && !force) return records;
    const {data,error}=await db.from("containers").select("data").eq("id","gml_tracking_records").single();
    if(error) throw error;
    records=Array.isArray(data?.data) ? data.data : [];
    return records;
  }
  function matches(row, query, mode) {
    const keys = mode==="container"
      ? ["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]
      : ["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO","MBL NO","MBL","HBL NO","HBL","BOOKING NO","BOOKING","VESSEL & VOY","VESSEL","CUSTOMER REF","CUSTOMER REFERENCE","IGM NO","IGM"];
    return keys.some(k => norm(val(row,[k])).includes(norm(query)));
  }
  function milestones(row) {
    const origin=clean(val(row,["POL","PORT OF LOADING"]))||"Origin";
    const dest=clean(val(row,["GATEWAY PORT","POD","PORT OF DISCHARGE"]))||"Destination";
    const cfs=clean(val(row,["CFS NAME"]))||dest;
    return [
      ["Vessel departed",origin,val(row,["ETD"])],
      ["Arrival at gateway",dest,val(row,["ETA"])],
      ["Inward granted",dest,val(row,["INWARD DATE"])],
      ["Port in",dest,val(row,["PORT IN"])],
      ["Port out",dest,val(row,["PORT OUT"])],
      ["CFS in-gate",cfs,val(row,["CFS IN"])],
      ["De-stuffing",cfs,val(row,["DESTUFFING DATE"])],
      ["Empty returned",dest,val(row,["CONTAINER RETURN DATE"])]
    ];
  }
  function card(row,index) {
    const cntr=clean(val(row,["CONTAINER NO.","CONTAINER","CONTAINER NO"]))||"Reference matched";
    const st=status(row);
    const pol=clean(val(row,["POL","PORT OF LOADING"]))||"—";
    const pod=clean(val(row,["GATEWAY PORT","POD","PORT OF DISCHARGE"]))||"—";
    const vessel=clean(val(row,["VESSEL & VOY","VESSEL"]))||"—";
    const mbl=clean(val(row,["MBL NO","MBL"]))||"—";
    const liner=clean(val(row,["LINER","LINE"]))||"—";
    const type=clean(val(row,["TYPE","SIZE"]))||"—";
    const etd=fmtDate(val(row,["ETD"])),eta=fmtDate(val(row,["ETA"]));
    const ms=milestones(row);
    const done=ms.filter(x=>clean(x[2])).length;
    const activeIndex=ms.findIndex(x=>!clean(x[2]));
    return `<article class="track-result" data-result-index="${index}">
      <div class="result-top"><div class="result-identity"><span class="result-chip">CONTAINER</span><h3>${esc(cntr)}</h3><span class="result-sub">${esc(type)} equipment · ${esc(liner)}</span></div><div class="result-status ${st.tone}"><i></i><span><b>${esc(st.label)}</b><small>${esc(st.desc)}</small></span></div></div>
      <div class="route-strip"><div class="route-place"><small>ORIGIN / POL</small><b>${esc(pol)}</b><span>ETD · ${esc(etd)}</span></div><div class="route-track"><span class="route-track-line"></span><span class="route-track-dot"></span><span class="route-track-ship">↗</span></div><div class="route-place destination"><small>GATEWAY / POD</small><b>${esc(pod)}</b><span>ETA · ${esc(eta)}</span></div></div>
      <div class="result-facts"><div><small>MASTER BILL</small><b>${esc(mbl)}</b></div><div><small>VESSEL / VOYAGE</small><b>${esc(vessel)}</b></div><div><small>LAST UPDATE</small><b>${esc(st.date)}</b></div><div><small>MILESTONES</small><b>${done} / ${ms.length} recorded</b></div></div>
      <div class="result-details"><div class="details-heading"><div><span>SHIPMENT JOURNEY</span><b>Milestone timeline</b></div><button type="button" class="journey-toggle" data-toggle-journey="${index}">View journey <span>＋</span></button></div>
        <div class="journey-list" id="journey-${index}" hidden>${ms.map((m,i)=>`<div class="journey-event ${clean(m[2])?'is-done':i===activeIndex?'is-next':''}"><span class="journey-pin">${clean(m[2])?'✓':String(i+1).padStart(2,'0')}</span><span class="journey-copy"><b>${esc(m[0])}</b><small>${esc(m[1])}</small></span><time>${esc(fmtDate(m[2]))}</time></div>`).join("")}</div>
      </div>
      <div class="result-bottom"><span>SHIPMENT REFERENCE <b>${esc(cntr)}</b></span><div><button type="button" class="result-action" data-hbl-container="${esc(cntr)}">View IGM / HBL ↗</button><button type="button" class="result-action copy-ref" data-copy-ref="${esc(cntr)}">Copy reference</button></div></div>
    </article>`;
  }
  function setCount(n) { $("resultCount").textContent=n+" result"+(n===1?"":"s"); }
  function emptyState(kind,title,detail) {
    $("resultHost").innerHTML=`<div class="empty-state search-state"><div class="empty-graphic"><span>${kind==="error"?"!":"⌕"}</span><i></i><i></i><i></i></div><div><span class="eyebrow-label">${kind==="error"?"SERVICE NOTICE":"SEARCH COMPLETE"}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p><a href="#track">Try another reference <span>↑</span></a></div><div class="empty-index">TRACK<br>AND TRACE</div></div>`;
  }
  async function runSearch(queryOverride) {
    if(busy) return;
    const input=$("searchInput"), q=String(queryOverride ?? input.value).trim(), mode=$("searchType").value;
    if(!q){input.focus();return}
    busy=true;
    const button=$("trackBtn"); button.disabled=true; button.innerHTML="<span>Searching…</span><b>↻</b>";
    setCount(0);
    $("resultHost").innerHTML='<div class="search-loading"><div class="loading-ring"></div><div><b>Searching shipment records</b><span>Checking the live register and customs references.</span></div></div>';
    try {
      await loadRecords();
      let hits=records.filter(r=>matches(r,q,mode));
      if(!hits.length && mode==="all") {
        try {
          const {data,error}=await db.rpc("search_customer_igm",{p_query:q});
          if(!error && Array.isArray(data) && data.length) {
            const containers=[...new Set(data.map(x=>String(x.container_no||"").trim()).filter(Boolean))];
            hits=records.filter(r=>containers.includes(String(val(r,["CONTAINER NO.","CONTAINER","CONTAINER NO"])).trim()));
          }
        } catch(e) { console.warn("Customs lookup unavailable",e); }
      }
      setCount(hits.length);
      if(!hits.length) emptyState("empty","No matching shipment found","Check the reference for typing errors, or switch to Any reference to search by MBL, HBL, booking number or vessel.");
      else {
        $("resultHost").innerHTML='<div class="results-summary"><span>RESULTS FOR</span><b>'+esc(q)+'</b><small>'+hits.length+' match'+(hits.length===1?"":"es")+' · sorted by register order</small></div><div class="track-result-list">'+hits.slice(0,20).map(card).join("")+'</div>';
      }
    } catch(err) {
      console.error("Shipment lookup failed",err);
      emptyState("error","We couldn't reach the shipment register","Please check your connection and try again. If the issue continues, contact the operations team.");
    } finally {
      busy=false;button.disabled=false;button.innerHTML="<span>Track shipment</span><b>↗</b>";
    }
  }
  async function showIgm(container) {
    const modal=$("igmModal"),body=$("igmModalBody");
    $("igmModalTitle").textContent="IGM / HBL details";
    $("igmModalSub").textContent="Container "+container+" · Customs-linked cargo data";
    body.innerHTML='<div class="search-loading"><div class="loading-ring"></div><div><b>Loading manifest details</b><span>Retrieving linked house bills and cargo totals.</span></div></div>';
    modal.classList.add("open");modal.setAttribute("aria-hidden","false");
    try {
      const {data,error}=await db.rpc("get_customer_igm_bundle",{p_container:container});
      if(error)throw error;
      const rows=Array.isArray(data?.hbls)?data.hbls:[];
      const igms=Array.isArray(data?.igm_numbers)?data.igm_numbers:[];
      body.innerHTML=`<div class="manifest-summary"><div><small>CONTAINER</small><b>${esc(container)}</b></div><div><small>HBL COUNT</small><b>${rows.length}</b></div><div><small>TOTAL PACKAGES</small><b>${esc(data?.total_packages??"—")}</b></div><div><small>GROSS WEIGHT (KG)</small><b>${esc(data?.total_gross_weight??"—")}</b></div></div><div class="manifest-refs"><span>IGM NUMBER(S)</span><b>${esc(igms.join(", ")||"Not available")}</b></div>${rows.length?`<div class="manifest-table-wrap"><table class="manifest-table"><thead><tr><th>HBL NUMBER</th><th>PORT DESTINATION</th><th>CARGO MOVEMENT</th><th>PACKAGES</th><th>GROSS WEIGHT</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.hbl_no||"—")}</td><td>${esc(r.port_destination||"—")}</td><td>${esc(r.cargo_movement||"—")}</td><td>${esc(r.total_package??"—")}</td><td>${esc(r.gross_weight??"—")}</td></tr>`).join("")}</tbody></table></div>`:'<div class="manifest-no-data">No HBL records are linked to this container yet.</div>'}`;
    } catch(err) {
      console.error("Manifest lookup failed",err);
      body.innerHTML='<div class="manifest-no-data">Manifest details could not be loaded for this container. Please try again or contact operations.</div>';
    }
  }
  function closeModal(id) { const m=$(id);if(m){m.classList.remove("open");m.setAttribute("aria-hidden","true");} }
  function configureBrand() {
    document.querySelectorAll("[data-app-name]").forEach(el=>el.textContent=config.appName||"CargoTrack");
    document.querySelectorAll("[data-app-short]").forEach(el=>el.textContent=config.appShort||"CT");
    document.querySelectorAll("[data-page-title]").forEach(el=>el.textContent=(config.appName||"CargoTrack")+" | Track & Trace");
    if(config.supportEmail){$("supportEmailBtn").href="mailto:"+config.supportEmail;}else $("supportEmailBtn").hidden=true;
    if(config.supportWhatsApp){$("supportWhatsAppBtn").href="https://wa.me/"+String(config.supportWhatsApp).replace(/\D/g,"");}else $("supportWhatsAppBtn").hidden=true;
  }
  function bind() {
    $("trackBtn").addEventListener("click",()=>runSearch());
    $("trackingForm").addEventListener("submit",e=>{e.preventDefault();runSearch()});
    $("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();runSearch()}});
    $("clearSearch").addEventListener("click",()=>{$("searchInput").value="";$("searchInput").focus()});
    document.querySelectorAll("[data-track-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-track-tab]").forEach(b=>b.classList.toggle("active",b===btn));
      $("searchType").value=btn.dataset.trackTab;
    }));
    $("multipleBtn").addEventListener("click",()=>{$("multiModal").classList.add("open");$("multiModal").setAttribute("aria-hidden","false");$("multiInput").focus()});
    ["closeMulti","cancelMulti"].forEach(id=>$(id).addEventListener("click",()=>closeModal("multiModal")));
    $("runMulti").addEventListener("click",async()=>{
      const queries=[...new Set($("multiInput").value.split(/[\n,;\t]+/).map(x=>x.trim()).filter(Boolean))].slice(0,20);
      if(!queries.length)return;
      closeModal("multiModal");$("searchType").value="all";
      document.querySelectorAll("[data-track-tab]").forEach(b=>b.classList.toggle("active",b.dataset.trackTab==="all"));
      $("searchInput").value=queries.join(", ");
      busy=true;const btn=$("trackBtn");btn.disabled=true;
      $("resultHost").innerHTML='<div class="search-loading"><div class="loading-ring"></div><div><b>Looking up your batch</b><span>Checking '+queries.length+' references against the live register.</span></div></div>';
      try {
        await loadRecords();
        let hits=records.filter(r=>queries.some(q=>matches(r,q,"all")));
        setCount(hits.length);
        if(!hits.length)emptyState("empty","No matching shipments found","None of the submitted references matched the current shipment register.");
        else $("resultHost").innerHTML='<div class="results-summary"><span>BATCH LOOKUP</span><b>'+queries.length+' references submitted</b><small>'+hits.length+' matching shipments</small></div><div class="track-result-list">'+hits.slice(0,20).map(card).join("")+'</div>';
      } catch(e){emptyState("error","Batch lookup unavailable","The shipment register could not be reached. Please retry.");}
      finally{busy=false;btn.disabled=false;btn.innerHTML="<span>Track shipment</span><b>↗</b>";}
    });
    $("closeIgm").addEventListener("click",()=>closeModal("igmModal"));
    ["multiModal","igmModal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target.id===id)closeModal(id)}));
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal("multiModal");closeModal("igmModal")}});
    $("resultHost").addEventListener("click",e=>{
      const journey=e.target.closest("[data-toggle-journey]");
      if(journey){const el=$("journey-"+journey.dataset.toggleJourney);const open=el.hidden;el.hidden=!open;journey.innerHTML=open?'Hide journey <span>−</span>':'View journey <span>＋</span>';return;}
      const igm=e.target.closest("[data-hbl-container]");
      if(igm){showIgm(igm.dataset.hblContainer);return;}
      const copy=e.target.closest("[data-copy-ref]");
      if(copy){const value=copy.dataset.copyRef;if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(()=>toast("Container reference copied")).catch(()=>fallbackCopy(value));else fallbackCopy(value);}
    });
    document.querySelectorAll(".mobile-nav a").forEach(a=>a.addEventListener("click",()=> $("mobileNav").classList.remove("open")));
  }
  function fallbackCopy(text){const el=document.createElement("textarea");el.value=text;el.style.position="fixed";el.style.opacity="0";document.body.appendChild(el);el.select();try{document.execCommand("copy");toast("Container reference copied")}catch(e){toast("Copy unavailable in this browser")}el.remove();}
  let toastTimer;
  function toast(msg){const t=$("gmlToast");t.textContent=msg;t.classList.add("open");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("open"),2200);}
  configureBrand();bind();
  const params=new URLSearchParams(location.search);
  const initial=params.get("cntr")||params.get("container")||"";
  if(initial){$("searchInput").value=initial;runSearch(initial);}
})();