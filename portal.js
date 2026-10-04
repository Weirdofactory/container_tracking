
const GML_SUPABASE_URL="https://ykeucqritoexykqrggzz.supabase.co";
const GML_SUPABASE_KEY="sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ";
const GML_SB=supabase.createClient(GML_SUPABASE_URL,GML_SUPABASE_KEY);

const PORTS={
  SHEKOU:[22.48,113.91],BUSAN:[35.10,129.04],SHANGHAI:[31.23,121.47],NINGBO:[29.86,121.54],
  QINGDAO:[36.06,120.38],"JEBEL ALI":[25.0113,55.0610],SINGAPORE:[1.29,103.85],
  KATTUPALLI:[13.315,80.345],CHENNAI:[13.0827,80.2707],ENNORE:[13.25,80.332],CCTL:[13.085,80.298],
  CITPL:[13.098,80.305],HOUSTON:[29.7341,-95.1179]
};

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=v=>{const s=String(v??"").trim();return !s||/^(n\/a|na|unknown|null|-)$/i.test(s)?"":s};
const field=(r,names)=>{for(const n of names){if(r&&r[n]!==undefined&&String(r[n]??"").trim()!=="")return r[n]}return""};
const dateText=v=>{if(!v)return"—";const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})};
const statusFor=r=>{
  if(field(r,["CONTAINER RETURN DATE"]))return["RETURNED","Empty container returned"];
  if(field(r,["DESTUFFING DATE"]))return["DE-STUFFED","Cargo de-stuff completed"];
  if(field(r,["CFS IN"]))return["CFS IN","Cargo received at CFS"];
  if(field(r,["PORT OUT"]))return["PORT OUT","Container released from port"];
  if(field(r,["PORT IN"]))return["ARRIVED AT PORT","Container arrival recorded"];
  if(field(r,["INWARD DATE"]))return["INWARD GRANTED","Customs inward recorded"];
  if(field(r,["ETD"]))return["IN TRANSIT","Vessel has departed origin"];
  if(field(r,["ETA"]))return["ETA SCHEDULED","Estimated arrival is scheduled"];
  return["TRACKING PENDING","Shipment milestone data pending"];
};
let records=[],igmCache={};

async function loadContainers(){
  const {data,error}=await GML_SB.from("containers").select("data").eq("id","gml_tracking_records").single();
  if(error)throw error;
  records=Array.isArray(data?.data)?data.data:[];
  return records;
}
function norm(s){return String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"")}
function searchRecord(r,q,type){
  const values=type==="container"
    ? [field(r,["CONTAINER NO.","CONTAINER","CONTAINER NO"])]
    : [field(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]),field(r,["MBL NO","MBL"]),field(r,["HBL NO","HBL"]),field(r,["BOOKING NO","BOOKING"]),field(r,["VESSEL & VOY","VESSEL"]),field(r,["CUSTOMER REF","CUSTOMER REFERENCE"])];
  return values.map(norm).some(v=>v&&v.includes(norm(q)));
}
function milestones(r){
  const pol=clean(field(r,["POL","PORT OF LOADING"]))||"Origin",pod=clean(field(r,["GATEWAY PORT","POD","PORT OF DISCHARGE"]))||"Destination";
  return[
    ["Vessel Departed",pol,field(r,["ETD"])],
    ["Arrival at Discharge",pod,field(r,["ETA"])],
    ["Inward Granted",pod,field(r,["INWARD DATE"])],
    ["Port In",pod,field(r,["PORT IN"])],
    ["Port Out",pod,field(r,["PORT OUT"])],
    ["CFS In-Gate",clean(field(r,["CFS NAME"]))||pod,field(r,["CFS IN"])],
    ["De-stuffing",clean(field(r,["CFS NAME"]))||pod,field(r,["DESTUFFING DATE"])],
    ["Empty Returned",pod,field(r,["CONTAINER RETURN DATE"])]
  ];
}
function coords(name,fallback){
  const k=String(name||"").trim().toUpperCase();
  return PORTS[k]||fallback;
}
function routePoints(pol,pod,a,b){
  const p=String(pol||"").toUpperCase(),d=String(pod||"").toUpperCase();
  const indiaGateway=/^(CITPL|KATTUPALLI|CHENNAI|ENNORE|CCTL)$/.test(d);
  const asiaOrigin=/^(NINGBO|SHANGHAI|QINGDAO|BUSAN|SHEKOU)$/.test(p);
  if(indiaGateway&&asiaOrigin){
    // Schematic deep-sea corridor: keeps the visual route over water instead of cutting across China/SE Asia.
    return [
      a,[26.0,118.0],[21.0,114.0],[15.0,108.0],[8.5,103.5],[2.0,103.8],
      [4.0,97.0],[7.5,91.0],[10.5,86.0],b
    ];
  }
  const mid=[(a[0]+b[0])/2-3,(a[1]+b[1])/2+5];
  return [a,mid,b];
}
function initMap(id,r){
  const node=$(id); if(!node||typeof L==="undefined")return;
  const pol=clean(field(r,["POL"]))||"BUSAN",pod=clean(field(r,["GATEWAY PORT"]))||"KATTUPALLI";
  const a=coords(pol,[20,80]),b=coords(pod,[13.08,80.27]),route=routePoints(pol,pod,a,b),shipPoint=route[Math.floor(route.length/2)];
  const map=L.map(id,{zoomControl:false,scrollWheelZoom:false,attributionControl:true});
  const light=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
  const sat=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:18});
  const line=L.polyline(route,{color:"#0b87df",weight:4,lineCap:"round",lineJoin:"round"}).addTo(map);
  const mk=(text,cls)=>L.divIcon({className:"gml-map-marker",html:'<div style="background:#fff;border:1px solid #d6e1eb;box-shadow:0 5px 12px rgba(8,40,70,.15);padding:7px 9px;border-radius:8px;font:800 11px Plus Jakarta Sans;color:#173b60;white-space:nowrap" class="'+cls+'">'+esc(text)+'</div>',iconSize:null});
  L.marker(a,{icon:mk(pol,"")}).addTo(map);
  L.marker(shipPoint,{icon:mk("🚢 "+(field(r,["VESSEL & VOY"])||"Vessel"),"")}).addTo(map);
  L.marker(b,{icon:mk(pod,"")}).addTo(map);
  map.fitBounds(line.getBounds(),{padding:[28,28]});
  $(id).dataset.mapReady="1"; window.__gmlMaps=window.__gmlMaps||{};window.__gmlMaps[id]={map,light,sat};
}
function toggleMap(id,mode,btn){
  const set=window.__gmlMaps?.[id];if(!set)return;
  if(mode==="satellite"){set.map.removeLayer(set.light);set.sat.addTo(set.map)}else{set.map.removeLayer(set.sat);set.light.addTo(set.map)}
  btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===btn));
}

async function igmForContainer(container){
  const {data,error}=await GML_SB.rpc("get_customer_igm_bundle",{p_container:container});
  if(error)throw error;
  const rows=Array.isArray(data?.hbls)?data.hbls:[];
  rows.forEach(x=>igmCache[String(x.hbl_no||"").toUpperCase()]=x);
  return {rows,totalPackages:Number(data?.total_packages||0),totalWeight:Number(data?.total_gross_weight||0),igmNumbers:data?.igm_numbers||[]};
}

function reportHtml(r,index){
  const cntr=clean(field(r,["CONTAINER NO.","CONTAINER"]))||"—",type=clean(field(r,["TYPE","SIZE"]))||"—";
  const mbl=clean(field(r,["MBL NO","MBL"]))||"—",liner=clean(field(r,["LINER"]))||"—",vessel=clean(field(r,["VESSEL & VOY","VESSEL"]))||"—";
  const pol=clean(field(r,["POL"]))||"—",pod=clean(field(r,["GATEWAY PORT","POD"]))||"—";const st=statusFor(r);
  const etd=dateText(field(r,["ETD"])),eta=dateText(field(r,["ETA"]));
  const cfs=clean(field(r,["CFS NAME"]))||"—";
  const ms=milestones(r),done=ms.filter(x=>x[2]).length;
  let h='<article class="gml-report" id="gmlReport_'+index+'" data-cntr="'+esc(cntr)+'">';
  h+='<div class="gml-report-top"><div class="gml-report-brand"><div class="gml-report-mark">GML</div><div><b>GREENWICH MERIDIAN LOGISTICS</b><span>Customer Shipment Tracking</span></div></div><div class="gml-report-date"><span>STATUS REPORT</span><b>'+dateText(new Date())+'</b></div></div>';
  h+='<div class="gml-report-hero"><div><span class="gml-status">● '+esc(st[0])+'</span><h3>'+esc(st[1])+'</h3><p>Latest operational milestone</p></div><div class="gml-container-box"><span>CONTAINER</span><b>'+esc(cntr)+'</b><small>'+esc(type)+' EQUIPMENT</small></div></div>';
  /* Summary carries only unique operational facts. Do not repeat vessel, liner or MBL from the detail card. */
  h+='<div class="gml-summary"><div class="gml-summary-cell"><span>ORIGIN</span><b>'+esc(pol)+'</b></div><div class="gml-summary-cell"><span>DESTINATION</span><b>'+esc(pod)+'</b></div><div class="gml-summary-cell"><span>ETD</span><b>'+esc(etd)+'</b></div><div class="gml-summary-cell status"><span>ETA</span><b>'+esc(eta)+'</b></div></div>';
  h+='<div class="gml-tabs"><button class="gml-tab active" data-tab="overview">Overview</button><button class="gml-tab" data-tab="route">Route & Map</button><button class="gml-tab" data-tab="cargo">Cargo & HBL</button><button class="gml-tab" data-tab="history">Event History</button></div>';
  h+='<section class="gml-pane active" data-pane="overview"><div class="gml-overview"><div><div class="gml-card"><div class="gml-card-head"><b>SHIPMENT INFORMATION</b><span>REFERENCE DATA</span></div><div class="gml-info-grid">';
  [["MBL Number",mbl],["Vessel / Voyage",vessel],["Carrier / Line",liner],["Size / Type",type],["Gateway Port",pod],["CFS",cfs]].forEach(x=>h+='<div class="gml-info-item"><span>'+esc(x[0])+'</span><b>'+esc(x[1]||"—")+'</b></div>');
  h+='</div></div><div class="gml-card" style="margin-top:13px"><div class="gml-card-head"><b>CARGO INFORMATION</b><span>IGM / HBL SUMMARY</span></div><div id="gmlCargo_'+index+'" class="gml-cargo-grid"><div class="gml-metric" style="grid-column:1/-1"><span>LOADING</span><b>Loading IGM / HBL data…</b></div></div></div></div>';
  h+='<div><div class="gml-card"><div class="gml-card-head"><b>ROUTE & MAP</b><span>PORT-TO-PORT</span></div><div class="gml-map-wrap"><div id="gmlMap_'+index+'" class="gml-map"></div><div class="gml-map-toggle"><button class="active" data-map="map">Map</button><button data-map="satellite">Satellite</button></div></div><div class="gml-map-foot"><span>'+esc(pol)+' → '+esc(pod)+'</span><b>'+esc(cfs)+'</b></div></div>';
  h+='<div class="gml-card" style="margin-top:13px"><div class="gml-card-head"><b>KEY MILESTONES</b><span>'+done+' RECORDED</span></div><div class="gml-milestones">';
  ms.forEach((x,i)=>h+='<div class="gml-mile '+(x[2]?"done ":"")+(x[2]===""&&i===done?"active":"")+'"><div class="gml-dot">'+(x[2]?"✓":String(i+1).padStart(2,"0"))+'</div><div><b>'+esc(x[0])+'</b><small>'+esc(x[1])+'</small></div><time>'+(x[2]?esc(dateText(x[2])):"Pending")+'</time></div>');
  h+='</div></div></div></div></section>';
  h+='<section class="gml-pane" data-pane="route"><div style="padding:0 18px 18px"><div class="gml-card"><div class="gml-card-head"><b>SHIPMENT ROUTE</b><span>ORIGIN → DELIVERY</span></div><div class="gml-info-grid">';
  [["Place of Receipt",pol],["Loading Port",pol],["Discharge Port",pod],["Place of Delivery",pod],["Gateway / Terminal",pod],["CFS",field(r,["CFS NAME"])||"—"],["ETD",dateText(field(r,["ETD"]))],["ETA",dateText(field(r,["ETA"]))]].forEach(x=>h+='<div class="gml-info-item"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>');
  h+='</div></div></div></section>';
  h+='<section class="gml-pane" data-pane="cargo"><div style="padding:0 18px 18px"><div class="gml-card"><div class="gml-card-head"><b>CARGO & HBL DETAILS</b><span>CLICK HBL FOR IGM</span></div><div id="gmlCargoFull_'+index+'" class="gml-hbl-table" style="padding:12px">Loading…</div></div></div></section>';
  h+='<section class="gml-pane" data-pane="history"><div style="padding:0 18px 18px"><div class="gml-card"><div class="gml-card-head"><b>EVENT HISTORY</b><span>CHRONOLOGICAL</span></div><div class="gml-hbl-table"><table><thead><tr><th>EVENT</th><th>LOCATION</th><th>DATE</th></tr></thead><tbody>'+ms.filter(x=>x[2]).map(x=>'<tr><td>'+esc(x[0])+'</td><td>'+esc(x[1])+'</td><td>'+esc(dateText(x[2]))+'</td></tr>').join("")+'</tbody></table></div></div></div></section>';
  h+='<div class="gml-actions"><button class="gml-action" data-action="print">🖨 Print / PDF</button><button class="gml-action" data-action="share">🔗 Share Tracking</button><a class="gml-action" href="mailto:madhan@gmlindia.net">✉ Email Updates</a><a class="gml-action primary" href="https://wa.me/919884070344" target="_blank">💬 WhatsApp</a></div>';
  h+='<div class="gml-report-foot"><span>GREENWICH MERIDIAN LOGISTICS • CUSTOMER TRACKING</span><b>'+esc(cntr)+'</b></div></article>';
  return h;
}

function renderIgm(index,bundle){
  const cargo=$("gmlCargo_"+index),full=$("gmlCargoFull_"+index); if(!cargo||!full)return;
  if(!bundle.rows.length){cargo.innerHTML='<div class="gml-metric" style="grid-column:1/-1"><span>IGM / HBL</span><b>No IGM records linked to this container.</b></div>';full.innerHTML='<div style="padding:18px;color:#7e8ea0;font-size:11px">No HBL/IGM records linked to this container.</div>';return;}
  const types=[...new Set(bundle.rows.map(x=>x.package_code).filter(Boolean))].join(", ")||"—";
  const igm=[...new Set(bundle.rows.map(x=>x.igm_no).filter(Boolean))].join(", ")||"—";
  cargo.innerHTML='<div class="gml-metric"><span>HBL COUNT</span><b>'+bundle.rows.length+'</b></div><div class="gml-metric"><span>PACKAGES</span><b>'+bundle.totalPackages.toLocaleString("en-IN")+'</b></div><div class="gml-metric"><span>GROSS WEIGHT</span><b>'+bundle.totalWeight.toLocaleString("en-IN",{maximumFractionDigits:2})+' KGS</b></div><div class="gml-metric"><span>PACKAGE TYPES</span><b>'+esc(types)+'</b></div><div class="gml-metric"><span>IGM NUMBER</span><b>'+esc(igm)+'</b></div><div class="gml-metric"><span>DESTINATION</span><b>'+esc(bundle.rows[0].port_destination||"—")+'</b></div>';
  full.innerHTML='<table><thead><tr><th>HBL</th><th>SUBLINE</th><th>PACKAGE</th><th>QTY</th><th>WEIGHT</th></tr></thead><tbody>'+bundle.rows.map(x=>'<tr><td><button class="gml-hbl-link" data-hbl="'+esc(String(x.hbl_no||"").toUpperCase())+'">'+esc(String(x.hbl_no||"").toUpperCase())+'</button></td><td>'+esc(x.subline_number||"—")+'</td><td>'+esc(x.package_code||"—")+'</td><td>'+esc(x.total_package||"—")+'</td><td>'+esc(x.gross_weight||"—")+' '+esc(x.unit_of_weight||"")+'</td></tr>').join("")+'</tbody></table>';
  full.querySelectorAll("[data-hbl]").forEach(b=>b.addEventListener("click",()=>openIgm(b.dataset.hbl)));
}
function openIgm(hbl){
  const row=igmCache[String(hbl||"").toUpperCase()];if(!row)return;
  $("igmModalTitle").textContent=row.hbl_no||hbl;$("igmModalSub").textContent="IGM "+(row.igm_no||"—")+" • Line "+(row.line_number||"—")+" / Subline "+(row.subline_number||"—");
  const fields=[["IGM Number",row.igm_no],["IGM Date",dateText(row.igm_date)],["MBL Number",row.mbl_no],["BL Date",dateText(row.bl_date)],["HBL Number",row.hbl_no],["HBL Date",dateText(row.hbl_date)],["Container",row.container_no],["Container Status",row.container_status],["Gateway Port",row.gateway_port],["Voyage",row.voyage_number],["IMO Number",row.imo_no],["Vessel Code",row.vessel_code],["Destination",row.port_destination],["Cargo Movement",row.cargo_movement],["Gross Weight",(row.gross_weight||"—")+" "+(row.unit_of_weight||"")],["Packages",(row.total_package||"—")+" "+(row.package_code||"")]];
  $("igmModalBody").innerHTML='<div class="gml-modal-grid">'+fields.map(x=>'<div class="gml-modal-cell"><span>'+esc(x[0])+'</span><b>'+esc(x[1]||"—")+'</b></div>').join("")+'</div><div class="gml-modal-section"><h4>CARGO DECLARATION</h4><div class="gml-modal-cargo"><div><span>Description of Goods</span><b>'+esc(row.desc_of_goods||"—")+'</b></div><div><span>Destination</span><b>'+esc(row.port_destination||"—")+'</b></div><div><span>Gross Weight</span><b>'+esc(row.gross_weight||"—")+' '+esc(row.unit_of_weight||"")+'</b></div><div><span>Packages</span><b>'+esc(row.total_package||"—")+' '+esc(row.package_code||"")+'</b></div></div></div>';
  $("igmModal").classList.add("open");
}
async function hydrateReport(r,index){
  initMap("gmlMap_"+index,r);
  try{renderIgm(index,await igmForContainer(clean(field(r,["CONTAINER NO."]))));}
  catch(e){$("gmlCargo_"+index).innerHTML='<div class="gml-metric" style="grid-column:1/-1"><span>IGM / HBL</span><b>IGM data unavailable.</b></div>';console.warn(e)}
}
function bindReport(report,index,r){
  report.querySelectorAll(".gml-tab").forEach(t=>t.addEventListener("click",()=>{
    report.querySelectorAll(".gml-tab").forEach(x=>x.classList.toggle("active",x===t));
    report.querySelectorAll(".gml-pane").forEach(x=>x.classList.toggle("active",x.dataset.pane===t.dataset.tab));
    if(t.dataset.tab==="route")setTimeout(()=>{},30);
  }));
  report.querySelectorAll("[data-map]").forEach(b=>b.addEventListener("click",()=>toggleMap("gmlMap_"+index,b.dataset.map,b)));
  report.querySelector('[data-action="print"]')?.addEventListener("click",()=>window.print());
  report.querySelector('[data-action="share"]')?.addEventListener("click",async()=>{const url=location.origin+location.pathname+"?cntr="+encodeURIComponent(field(r,["CONTAINER NO."]));if(navigator.share)await navigator.share({title:"GML Shipment Tracking",url});else navigator.clipboard?.writeText(url)});
}

async function search(queryOverride){
  const input=$("searchInput"),typeEl=$("searchType");
  const q=String(queryOverride??input.value).trim(),type=typeEl.value;
  if(!q){input.focus();return}
  saveRecentSearch(q,type);
  $("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">…</div><strong>Searching live shipment data</strong><span>Checking shipment and customs-linked references.</span></div></div>';
  try{
    await loadContainers();
    let hits=records.filter(r=>searchRecord(r,q,type));
    if(!hits.length && type==="all"){
      try{
        const {data,error}=await GML_SB.rpc("search_customer_igm",{p_query:q});
        if(!error&&Array.isArray(data)&&data.length){
          const cntrs=[...new Set(data.map(x=>String(x.container_no||"").trim()).filter(Boolean))];
          hits=records.filter(r=>cntrs.includes(String(field(r,["CONTAINER NO.","CONTAINER","CONTAINER NO"])).trim()));
          data.forEach(x=>igmCache[String(x.hbl_no||"").toUpperCase()]=x);
        }
      }catch(e){console.warn("HBL/IGM search unavailable",e)}
    }
    $("resultCount").textContent=hits.length+" result"+(hits.length===1?"":"s");
    if(!hits.length){
      $("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">⌕</div><strong>No shipment found</strong><span>Check the reference and try again.</span></div></div>';
      return;
    }
    const shown=hits.slice(0,20);
    $("resultHost").innerHTML='<div class="gml-result-stack">'+shown.map(reportHtml).join("")+'</div>';
    shown.forEach((r,i)=>{const report=$("gmlReport_"+i);bindReport(report,i,r);hydrateReport(r,i)});
    document.querySelector(".gml-results-head")?.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    console.error(e);
    $("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">!</div><strong>Tracking service unavailable</strong><span>Please try again in a moment.</span></div></div>';
  }
}
function saveRecentSearch(q,type){
  try{
    const key="gml_recent_searches_v2";
    let list=JSON.parse(localStorage.getItem(key)||"[]");
    list=[{q,type,at:Date.now()},...list.filter(x=>x.q!==q)].slice(0,6);
    localStorage.setItem(key,JSON.stringify(list));
  }catch(e){}
}
function showToast(message){
  const node=$("gmlToast");if(!node)return;node.textContent=message;node.classList.add("open");
  clearTimeout(window.__gmlToastTimer);window.__gmlToastTimer=setTimeout(()=>node.classList.remove("open"),2200);
}
function openMulti(){const m=$("multiModal"),t=$("multiInput");if(!m||!t)return;m.classList.add("open");m.setAttribute("aria-hidden","false");t.focus()}
function closeMulti(){const m=$("multiModal");if(!m)return;m.classList.remove("open");m.setAttribute("aria-hidden","true")}
async function runMultiple(){
  const raw=String($("multiInput")?.value||"");
  const refs=[...new Set(raw.split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean))].slice(0,20);
  if(!refs.length){$("multiInput")?.focus();return}
  closeMulti();$("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">…</div><strong>Tracking multiple references</strong><span>Preparing '+refs.length+' shipment lookups.</span></div></div>';
  try{
    await loadContainers();let hits=[];
    refs.forEach(ref=>records.forEach(r=>{if(searchRecord(r,ref,"all")&&!hits.includes(r))hits.push(r)}));
    $("resultCount").textContent=hits.length+" result"+(hits.length===1?"":"s");
    if(!hits.length){$("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">⌕</div><strong>No shipments found</strong><span>None of the supplied references matched.</span></div></div>';return}
    hits=hits.slice(0,20);
    $("resultHost").innerHTML='<div class="gml-result-stack">'+hits.map(reportHtml).join("")+'</div>';
    hits.forEach((r,i)=>{const report=$("gmlReport_"+i);bindReport(report,i,r);hydrateReport(r,i)});
    showToast(hits.length+" shipments loaded");
  }catch(e){console.error(e);$("resultHost").innerHTML='<div class="gml-empty"><div><div class="gml-empty-icon">!</div><strong>Multiple tracking failed</strong><span>Please try again.</span></div></div>'}
}

$("trackBtn").addEventListener("click",()=>search());
$("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter")search()});
$("multipleBtn").addEventListener("click",openMulti);
$("closeMulti").addEventListener("click",closeMulti);
$("cancelMulti").addEventListener("click",closeMulti);
$("runMulti").addEventListener("click",runMultiple);
$("mobileMenuBtn")?.addEventListener("click",()=>$("mobileNav")?.classList.toggle("open"));
document.querySelectorAll("#mobileNav a").forEach(a=>a.addEventListener("click",()=>$("mobileNav")?.classList.remove("open")));
$("multiModal")?.addEventListener("click",e=>{if(e.target.id==="multiModal")closeMulti()});
$("igmModal")?.addEventListener("click",e=>{if(e.target.id==="igmModal")$("igmModal").classList.remove("open")});
$("closeIgm")?.addEventListener("click",()=>$("igmModal").classList.remove("open"));
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMulti();$("igmModal").classList.remove("open")}});
const initial=new URLSearchParams(location.search).get("cntr");
if(initial){$("searchInput").value=initial;setTimeout(()=>search(initial),100);}
