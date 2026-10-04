const S_URL="https://ykeucqritoexykqrggzz.supabase.co";
const S_KEY="sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ";
const SSB=supabase.createClient(S_URL,S_KEY,{global:{fetch:(input,init={})=>fetch(input,{...init,cache:"no-store"})}});
const APP=window.GML_APP_CONFIG||{appName:"CargoTrack",appShort:"CT",appTagline:"SHIPMENT CONTROL CENTER",companyName:"",supportEmail:"",supportWhatsApp:""};
const se=id=>document.getElementById(id);
const sx=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sf=(r,n)=>{for(const x of n){if(r?.[x]!==undefined&&String(r[x]??"").trim()!=="")return r[x]}return"";
};
const sn=v=>String(v??"").toLowerCase().replace(/[^a-z0-9]/g,"");
const sd=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
};
const st=r=>sf(r,["CONTAINER RETURN DATE"])?["RETURNED","good"]:sf(r,["DESTUFFING DATE"])?["DE-STUFFED","good"]:sf(r,["CFS IN"])?["CFS IN","good"]:sf(r,["PORT OUT"])?["PORT OUT","warn"]:sf(r,["PORT IN"])?["PORT IN","warn"]:sf(r,["INWARD DATE"])?["INWARD GRANTED","warn"]:sf(r,["ETD"])?["IN TRANSIT","warn"]:["PENDING","bad"];
const cnum=r=>sf(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]);
let rows=[],session=null,editingIndex=-1,selected=new Set();

function show(id,on=true){se(id).style.display=on?"":"none"}
function notify(msg){const n=se("staffNotice");if(!n)return;n.textContent=msg;n.classList.add("open");setTimeout(()=>n.classList.remove("open"),2200)}
function applyBrand(){document.querySelectorAll("[data-app-name]").forEach(el=>el.textContent=APP.appName);document.querySelectorAll("[data-app-short]").forEach(el=>el.textContent=APP.appShort||"CT");document.querySelectorAll("[data-app-tagline]").forEach(el=>el.textContent="OPERATIONS CONTROL");document.querySelectorAll("[data-app-context]").forEach(el=>el.textContent=APP.appTagline||"SHIPMENT CONTROL CENTER");document.querySelectorAll("[data-page-title]").forEach(el=>el.textContent=APP.appName+" — Operations Control")}
applyBrand();

async function login(){
  const code=String(se("accessCode").value||"").trim().toLowerCase();if(!code)return;
  se("loginBtn").disabled=true;se("loginBtn").textContent="Verifying…";
  try{const {data,error}=await SSB.from("user_roles").select("user_id,role,username").eq("access_code",code).single();if(error||!data)throw new Error("Invalid access code.");session=data;localStorage.setItem("gml_staff_session",JSON.stringify(data));show("loginScreen",false);show("staffApp",true);bootStaff();}
  catch(e){se("loginError").textContent=e.message;show("loginError",true)}
  finally{se("loginBtn").disabled=false;se("loginBtn").textContent="Sign In"}
}
function logout(){localStorage.removeItem("gml_staff_session");location.reload()}
function loadSession(){try{session=JSON.parse(localStorage.getItem("gml_staff_session")||"null")}catch(e){session=null}}

async function loadRows(){
  const btn=se("refreshBtn"),original=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent="↻ Refreshing…";}
  try{
    const {data,error}=await SSB.from("containers").select("data").eq("id","gml_tracking_records").single();
    if(error)throw new Error(error.message||"Unable to load shipment data.");
    rows=Array.isArray(data?.data)?data.data:[];
    selected.clear();
    renderTable();
    notify("Data refreshed • "+rows.length+" shipments loaded.");
    return rows;
  }catch(e){
    const body=se("staffBody");
    if(body)body.innerHTML='<tr><td colspan="9" class="s-table-error-row">Unable to load shipment data: '+sx(e.message)+'</td></tr>';
    const source=se("dataSourceStatus");if(source)source.textContent="Data source unavailable • retry Refresh Data";
    notify("Refresh failed: "+e.message);
    throw e;
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original||"↻ Refresh Data";}
  }
}
function renderKpis(list){const vals=list.reduce((a,r)=>{const s=st(r)[0];a.active+=s!=="RETURNED";a.done+=s==="RETURNED";a.portin+=s==="PORT IN";a.portout+=s==="PORT OUT";a.destuff+=s==="DE-STUFFED";return a},{active:0,done:0,portin:0,portout:0,destuff:0});se("kActive").textContent=vals.active;se("kDone").textContent=vals.done;se("kPortIn").textContent=vals.portin;se("kPortOut").textContent=vals.portout;se("kDestuff").textContent=vals.destuff;se("kTotal").textContent=list.length}
function filtered(){const q=sn(se("staffSearch").value),f=se("statusFilter").value;return rows.filter(r=>{const hay=[cnum(r),sf(r,["MBL NO","MBL"]),sf(r,["VESSEL & VOY","VESSEL"]),sf(r,["LINER"]),sf(r,["POL"]),sf(r,["GATEWAY PORT"])].map(sn).join(" ");return(!q||hay.includes(q))&&(f==="all"||st(r)[0]===f)})}

function renderTable(){
  const list=filtered();
  /* Core shipment rows render first so analytics can never make the main grid disappear. */
  const body=se("staffBody");
  if(body){
    body.innerHTML=list.slice(0,300).map(r=>{
      const idx=rows.indexOf(r),s=st(r),c=cnum(r),m=sf(r,["MBL NO","MBL"]),v=sf(r,["VESSEL & VOY","VESSEL"]),p=sf(r,["POL"]),g=sf(r,["GATEWAY PORT"]),eta=sf(r,["ETA"]);
      return '<tr><td class="s-check-col"><input type="checkbox" class="row-check" data-row="'+idx+'" '+(selected.has(idx)?"checked":"")+' aria-label="Select '+sx(c)+'"></td><td><button class="s-link" data-edit="'+idx+'">'+sx(c||"—")+'</button></td><td>'+sx(m||"—")+'</td><td>'+sx(sf(r,["LINER"])||"—")+'</td><td>'+sx(p||"—")+'</td><td>'+sx(g||"—")+'</td><td>'+sx(v||"—")+'</td><td>'+sx(sd(eta))+'</td><td><span class="s-status '+s[1]+'">'+sx(s[0])+'</span></td></tr>';
    }).join("")||'<tr><td colspan="9" class="s-table-empty-row">No shipments match the current filter.</td></tr>';
    body.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(Number(b.dataset.edit))));
    body.querySelectorAll(".row-check").forEach(b=>b.addEventListener("change",()=>{const i=Number(b.dataset.row);b.checked?selected.add(i):selected.delete(i);updateSelectAll()}));
  }
  se("staffCount").textContent=list.length+" shipments";
  renderKpis(list);
  try{renderOpsIntel(list)}catch(e){console.warn("Operations intelligence render skipped",e)}
  try{renderSmartMetrics(list)}catch(e){console.warn("Smart metrics render skipped",e)}
  try{
    const total=list.length||1;
    const returned=list.filter(r=>st(r)[0]==="RETURNED").length;
    const eta= list.filter(r=>{const d=parseDateValue(sf(r,["ETA"]));const n=new Date();n.setHours(0,0,0,0);const x=new Date(n);x.setDate(x.getDate()+3);return d&&d>=n&&d<=x}).length;
    const cfs=list.filter(r=>st(r)[0]==="CFS IN").length;
    se("snapshotActive").textContent=Math.max(0,total-returned);
    se("snapshotEta").textContent=eta;
    se("snapshotCfs").textContent=cfs;
    se("snapshotRate").textContent=Math.round(returned/total*100)+"%";
  }catch(e){console.warn("Snapshot render skipped",e)}
  updateSelectAll();
}
function updateSelectAll(){const list=filtered();const visible=list.slice(0,300).map(r=>rows.indexOf(r));const all=visible.length>0&&visible.every(i=>selected.has(i));const sa=se("selectAllRows");if(sa)sa.checked=all;if(window.__updateSelectedBadge)window.__updateSelectedBadge(selected.size)}
function selectedRows(){return [...selected].map(i=>rows[i]).filter(Boolean)}
function requireSelection(){const r=selectedRows();if(!r.length){notify("Select at least one shipment first.");return null}return r}

function openEditor(i){editingIndex=i;const r=rows[i]||{};const map=[["CONTAINER NO.","Container Number"],["TYPE","Size / Type"],["MBL NO","MBL Number"],["LINER","Liner"],["GATEWAY PORT","Gateway Port"],["CFS NAME","CFS"],["POL","POL"],["ETD","ETD"],["ETA","ETA"],["INWARD DATE","Inward Date"],["PORT IN","Port In"],["PORT OUT","Port Out"],["CFS IN","CFS In"],["DESTUFFING DATE","Destuffing Date"],["CONTAINER RETURN DATE","Empty Return"],["VESSEL & VOY","Vessel / Voyage"]];se("editFields").innerHTML=map.map(([k,l])=>'<div><label class="s-label">'+sx(l)+'</label><input class="s-input edit-input" data-field="'+sx(k)+'" value="'+sx(r[k]||"")+'"></div>').join("");se("editDrawer").classList.add("open")}
async function saveEditor(){if(editingIndex<0)return;const r=rows[editingIndex];se("saveEdit").disabled=true;try{se("editFields").querySelectorAll(".edit-input").forEach(x=>r[x.dataset.field]=x.value);if(!["Admin","Editor"].includes(session.role))throw new Error("Editor access required.");const {error}=await SSB.from("containers").upsert({id:"gml_tracking_records",data:rows});if(error)throw error;se("editDrawer").classList.remove("open");notify("Shipment updated.");renderTable()}catch(e){alert(e.message)}finally{se("saveEdit").disabled=false}}

function norm(v){return String(v??"").trim()}
function normHeader(v){return norm(v).toLowerCase().replace(/[^a-z0-9]+/g,"")}
function findCol(headers,cands){const n=headers.map(normHeader);for(const c of cands){const t=normHeader(c),i=n.indexOf(t);if(i>=0)return i}for(const c of cands){const t=normHeader(c),i=n.findIndex(h=>h.includes(t)||t.includes(h));if(i>=0)return i}return-1}
function parseWorkbookRows(file){return file.arrayBuffer().then(buf=>{const wb=XLSX.read(buf,{type:"array",raw:false,cellDates:false});const sheet=wb.Sheets[wb.SheetNames[0]];const data=XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});if(!data.length)throw new Error("The selected file contains no rows.");return data})}
async function importTracking(){
  if(!["Admin","Editor"].includes(session.role))throw new Error("Bulk import is available to Admin / Editor users only.");
  const file=se("trackingFile").files[0];if(!file)throw new Error("Select an Excel or CSV file.");
  const incoming=await parseWorkbookRows(file);
  const canonical=(rec)=>{
    const out={...rec}, keys=Object.keys(rec);
    const find=(aliases)=>{const target=aliases.map(normHeader);const key=keys.find(k=>target.includes(normHeader(k))||target.some(t=>normHeader(k).includes(t)||t.includes(normHeader(k))));return key};
    const containerKey=find(["CONTAINER NO.","CONTAINER NO","CONTAINER","CONTAINER NUMBER","CONTAINERNO","CNTR NO","CNTR NUMBER"]);
    const mblKey=find(["MBL NO","MBL NUMBER","MBL"]);
    const vesselKey=find(["VESSEL & VOY","VESSEL / VOYAGE","VESSEL/VOYAGE","VESSEL","VESSEL NAME"]);
    const lineKey=find(["LINER","LINE","CARRIER","CARRIER / LINE"]);
    const polKey=find(["POL","PORT OF LOADING","LOADING PORT"]);
    const gatewayKey=find(["GATEWAY PORT","GATEWAY","POD","PORT OF DISCHARGE"]);
    const etaKey=find(["ETA","ESTIMATED ARRIVAL"]);
    const etdKey=find(["ETD","ESTIMATED DEPARTURE"]);
    if(containerKey)out["CONTAINER NO."]=rec[containerKey];
    if(mblKey)out["MBL NO"]=rec[mblKey];
    if(vesselKey)out["VESSEL & VOY"]=rec[vesselKey];
    if(lineKey)out["LINER"]=rec[lineKey];
    if(polKey)out["POL"]=rec[polKey];
    if(gatewayKey)out["GATEWAY PORT"]=rec[gatewayKey];
    if(etaKey)out["ETA"]=rec[etaKey];
    if(etdKey)out["ETD"]=rec[etdKey];
    return out;
  };
  const normalized=incoming.map(canonical).filter(r=>sn(cnum(r)));
  if(!normalized.length)throw new Error("No container numbers were found. Supported headers include Container Number / Container No / CNTR No.");
  const existingBy={};rows.forEach((r,i)=>{const k=sn(cnum(r));if(k)existingBy[k]=i});
  let added=0,updated=0;
  normalized.forEach(rec=>{const k=sn(cnum(rec));if(existingBy[k]!==undefined){rows[existingBy[k]]={...rows[existingBy[k]],...rec};updated++}else{rows.push(rec);existingBy[k]=rows.length-1;added++}});
  const {error}=await SSB.from("containers").upsert({id:"gml_tracking_records",data:rows});
  if(error)throw new Error("Database save failed: "+error.message);
  se("importSummary").innerHTML='<div class="s-import-result"><b>Bulk import complete</b><br>'+normalized.length+' rows read • '+added+' new shipments added • '+updated+' existing shipments updated.</div>';
  renderTable();notify("Bulk import saved.");
}
function exportExcel(){
  const list=selectedRows();const data=list.length?list:filtered();if(!data.length){notify("No shipment data to export.");return}
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),"Tracking_Data");XLSX.writeFile(wb,(APP.appName||"CargoTrack")+"_Shipments_"+new Date().toISOString().slice(0,10)+".xlsx");notify("Excel download started.");
}

function makeFeatureModal(id,title,subtitle,body,footer){
  const old=se(id);if(old)old.remove();const m=document.createElement("div");m.id=id;m.className="s-feature-modal";m.innerHTML='<div class="s-feature-card"><div class="s-feature-head"><div><div class="s-kicker">OPERATIONS TOOL</div><h3>'+sx(title)+'</h3><p>'+sx(subtitle)+'</p></div><button class="s-btn" data-close>✕</button></div><div class="s-feature-body">'+body+'</div><div class="s-feature-foot">'+footer+'</div></div>';document.body.appendChild(m);m.querySelector("[data-close]").addEventListener("click",()=>m.remove());return m}

function openWhatsApp(){
  const list=requireSelection();if(!list)return;
  const date=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  const text="*"+(APP.appName||"CargoTrack")+" • SHIPMENT UPDATE*\n"+date+"\n\n"+list.map((r,i)=>{const c=cnum(r)||"—",s=st(r)[0],v=sf(r,["VESSEL & VOY","VESSEL"])||"—",eta=sd(sf(r,["ETA"])),pod=sf(r,["GATEWAY PORT"])||"—";return (i+1)+". *"+c+"*\nStatus: "+s+"\nVessel: "+v+"\nETA: "+eta+"\nGateway: "+pod}).join("\n\n")+"\n\nPlease contact operations for further assistance.";
  const m=makeFeatureModal("waModal","WhatsApp Message Composer","Prepare a formatted message for the selected shipments.",'<textarea class="s-wa-text" id="waText">'+sx(text)+'</textarea>','<button class="s-btn" data-copy>📋 Copy Message</button><a class="s-btn blue" id="waOpen" target="_blank" rel="noopener">Open in WhatsApp ↗</a>');
  m.querySelector("[data-copy]").addEventListener("click",async()=>{await navigator.clipboard?.writeText(text);notify("Message copied.");});
  const number=String(APP.supportWhatsApp||"").replace(/\D/g,"");m.querySelector("#waOpen").href=number?"https://wa.me/"+number+"?text="+encodeURIComponent(text):"https://wa.me/?text="+encodeURIComponent(text);
  m.classList.add("open");
}

async function downloadStatusPhoto(){
  const list=requireSelection();if(!list)return;if(typeof html2canvas!=="function"){notify("Status photo engine unavailable.");return}
  const rowsHtml=list.map(r=>{const s=st(r),c=cnum(r)||"—",v=sf(r,["VESSEL & VOY","VESSEL"])||"—",eta=sd(sf(r,["ETA"])),route=(sf(r,["POL"])||"—")+" → "+(sf(r,["GATEWAY PORT"])||"—");return '<div class="s-status-row"><div><small>Container</small><b>'+sx(c)+'</b></div><div><small>Status</small><b>'+sx(s[0])+'</b></div><div><small>Vessel / Route</small><b>'+sx(v)+'<br>'+sx(route)+'</b></div><div><small>ETA</small><b>'+sx(eta)+'</b></div></div>'}).join("");
  const host=makeFeatureModal("photoModal","Status Photo","Create a share-ready image for the selected shipments.",'<div class="s-status-canvas" id="statusCanvas"><div class="s-status-head"><small>'+sx(APP.appTagline||"SHIPMENT CONTROL CENTER")+'</small><h3>'+sx(APP.appName||"CargoTrack")+' — Shipment Status</h3><p>'+new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})+' • '+list.length+' shipment'+(list.length===1?"":"s")+'</p></div><div class="s-status-list">'+rowsHtml+'</div></div>','<button class="s-btn" data-close>Close</button><button class="s-btn blue" id="downloadStatus">⬇ Download PNG</button>');
  host.classList.add("open");
  host.querySelector("#downloadStatus").addEventListener("click",async()=>{const canvas=await html2canvas(host.querySelector("#statusCanvas"),{backgroundColor:"#ffffff",scale:2,useCORS:true});canvas.toBlob(blob=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(APP.appName||"CargoTrack")+"_Status_"+Date.now()+".png";a.click();URL.revokeObjectURL(a.href);notify("Status photo downloaded.")},"image/png")});
  host.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>host.remove()));
}

function parseIgm(file){
  return file.arrayBuffer().then(buf=>{
    if(typeof XLSX==="undefined")throw new Error("Excel parser unavailable.");
    const wb=XLSX.read(buf,{type:"array",raw:false,cellDates:false});const out=[];const fallback=(String(file.name).match(/igm[_\-\s]*(\d+)/i)||[])[1]||"";
    for(const snm of wb.SheetNames){
      const m=XLSX.utils.sheet_to_json(wb.Sheets[snm],{header:1,defval:"",raw:false});
      for(let i=0;i<m.length;i++){
        const row=m[i].map(norm).join(" | ").toLowerCase();
        if(!/house\s*bl\s*no/.test(row)||!/cargo\s*movement/.test(row))continue;
        const hh=m[i],di=m[i+1];if(!di)continue;
        const h=findCol(hh,["House BL No","House Bill No","HBL No"]);if(h<0)continue;
        const hbl=norm(di[h]);if(!hbl)continue;
        const base={
          hbl_no:hbl,mbl_no:norm(di[findCol(hh,["BL No","Master BL","MBL No"])])||"",
          bl_date:norm(di[findCol(hh,["BL Date","Bill Date"])]),hbl_date:norm(di[findCol(hh,["House BL Date","HBL Date"])]),
          line_number:hnum(di[findCol(hh,["Line Number","Line No","Line"])]),subline_number:hnum(di[findCol(hh,["Subline Number","Subline No","Subline"])]),
          cargo_movement:norm(di[findCol(hh,["Cargo Movement","Movement"])]),gross_weight:hnum(di[findCol(hh,["Gross Weight","GrossWeight","Weight"])]),
          unit_of_weight:norm(di[findCol(hh,["Unit Of Weight","Unit of Weight","Weight Unit","UOM"])]),total_package:hnum(di[findCol(hh,["Total Package","Total Packages","Packages","No of Packages"])]),
          package_code:norm(di[findCol(hh,["Package Code","Pkg Code","Package Type"])]),port_destination:norm(di[findCol(hh,["Port Destination","Destination Port"])]),
          desc_of_goods:norm(di[findCol(hh,["Desc Of Goods","Description of Goods","Goods Description","Cargo Description"])]),igm_no:fallback,igm_date:"",inw_date:"",
          igm_file_name:snm,gateway_port:"",voyage_number:"",imo_no:"",vessel_code:"",source_file_name:file.name
        };
        let container="",status="LCL";
        for(let j=i+2;j<m.length;j++){
          const t=m[j].map(norm).join(" | ").toLowerCase();if(/house\s*bl\s*no/.test(t))break;
          if(/igm\s*no/.test(t)&&/voyage\s*number/.test(t)){const ih=m[j],d=m[j+1]||[];base.igm_no=norm(d[findCol(ih,["IGM No","IGM Number","IGM"])])||base.igm_no;base.igm_date=norm(d[findCol(ih,["IGM Date","IGM Filing Date","IGM Date/Time"])]);base.inw_date=norm(d[findCol(ih,["INW Date","Inward Date","INW"])]);base.gateway_port=norm(d[findCol(ih,["Gateway Port","Gateway"])]);base.voyage_number=norm(d[findCol(ih,["Voyage Number","Voyage No","Voyage"])]);base.imo_no=norm(d[findCol(ih,["IMO No","IMO Number","IMO"])]);base.vessel_code=norm(d[findCol(ih,["Vessel Code","Vessel ID"])]);j+=1}
          if(/container\s*details/.test(t)&&/container\s*status/.test(t)){const ch=m[j],d=m[j+1]||[];container=norm(d[findCol(ch,["Container Details","Container No","Container Number","Container"])]);status=norm(d[findCol(ch,["Container Status","Status"])])||"LCL";j+=1}
        }
        if(container)out.push({...base,container_no:container,container_status:status});
      }
    }
    const u={};for(const r of out)u[sn(r.hbl_no)+"|"+sn(r.container_no)]=r;return Object.values(u)
  })
}
async function importIgm(){
  if(!["Admin","Editor"].includes(session.role))throw new Error("Admin / Editor access required.");
  const file=se("igmFile").files[0];if(!file)throw new Error("Select an IGM Excel file.");
  const recs=await parseIgm(file);if(!recs.length)throw new Error("No HBL + container blocks detected.");
  let count=0;for(let i=0;i<recs.length;i+=250){const chunk=recs.slice(i,i+250);const {data,error}=await SSB.rpc("import_igm_hbl_rows",{p_user_id:session.user_id,p_rows:chunk});if(error)throw error;count+=Number(data?.imported||chunk.length)}
  se("importSummary").innerHTML='<div class="s-import-result"><b>Import complete</b><br>'+recs.length+' HBL/container rows detected and '+count+' rows submitted to the database.</div>';
}


function parseDateValue(v){if(!v)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))return null;return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
function renderOpsIntel(list){
  const today=new Date(); today.setHours(0,0,0,0);
  const soon=new Date(today); soon.setDate(soon.getDate()+3);
  const alerts=[];
  list.forEach((r)=>{
    const c=cnum(r)||"—",s=st(r)[0],eta=parseDateValue(sf(r,["ETA"]));
    if(s==="RETURNED")return;
    if(eta&&eta<today&&!sf(r,["PORT IN"])){alerts.push({kind:"bad",title:"ETA overdue",detail:c+" • ETA "+sd(sf(r,["ETA"])),date:sd(sf(r,["ETA"])),idx:rows.indexOf(r)})}
    else if(s==="PORT IN"){alerts.push({kind:"warn",title:"Port release pending",detail:c+" • awaiting Port Out",date:"Action",idx:rows.indexOf(r)})}
    else if(s==="CFS IN"){alerts.push({kind:"warn",title:"Destuffing pending",detail:c+" • received at CFS",date:"Action",idx:rows.indexOf(r)})}
    else if(s==="DE-STUFFED"){alerts.push({kind:"good",title:"Empty return pending",detail:c+" • destuff completed",date:"Follow-up",idx:rows.indexOf(r)})}
    else if(eta&&eta>=today&&eta<=soon){alerts.push({kind:"good",title:"ETA within 3 days",detail:c+" • "+sd(sf(r,["ETA"])),date:sd(sf(r,["ETA"])),idx:rows.indexOf(r)})}
  });
  const alertHost=se("alertsHost"),alertCount=se("alertCount");
  if(alertCount)alertCount.textContent=alerts.length+" alert"+(alerts.length===1?"":"s");
  if(alertHost)alertHost.innerHTML=alerts.slice(0,8).map(a=>'<div class="s-alert-row" data-alert-row="'+a.idx+'"><i class="s-alert-dot '+a.kind+'"></i><div><b>'+sx(a.title)+'</b><span>'+sx(a.detail)+'</span></div><time>'+sx(a.date)+'</time></div>').join("")||'<div class="s-alert-empty">✓ No immediate operational exceptions.</div>';
  alertHost?.querySelectorAll("[data-alert-row]").forEach(x=>x.addEventListener("click",()=>openEditor(Number(x.dataset.alertRow))));
  const groups={};
  const vesselToday=new Date(); vesselToday.setHours(0,0,0,0);
  list.forEach(r=>{
    if(sf(r,["CONTAINER RETURN DATE"])) return;
    const eta=sf(r,["ETA"]); const d=parseDateValue(eta);
    if(!d || d<vesselToday) return;
    const v=sf(r,["VESSEL & VOY","VESSEL"])||"Unassigned";
    const key=v+"|"+(sf(r,["POL"])||"—")+"|"+(sf(r,["GATEWAY PORT"])||"—");
    if(!groups[key]) groups[key]={v:v,pol:sf(r,["POL"])||"—",gw:sf(r,["GATEWAY PORT"])||"—",eta:eta,n:0};
    groups[key].n++;
  });
  const vessels=Object.values(groups).sort((a,b)=>{const da=parseDateValue(a.eta),db=parseDateValue(b.eta);return (da?da.getTime():9999999999999)-(db?db.getTime():9999999999999);});
  se("vesselCount").textContent=vessels.length+" upcoming vessel"+(vessels.length===1?"":"s");
  se("vesselBody").innerHTML=vessels.slice(0,12).map(v=>'<tr><td><b>'+sx(v.v)+'</b></td><td>'+sx(v.pol)+'</td><td>'+sx(v.gw)+'</td><td>'+sx(sd(v.eta))+'</td><td>'+v.n+'</td></tr>').join("")||'<tr><td colspan="5" style="padding:25px;text-align:center;color:#8998a8">No vessel schedule available.</td></tr>';
}

function renderSmartMetrics(list){
  const today=new Date();today.setHours(0,0,0,0);const soon=new Date(today);soon.setDate(soon.getDate()+3);
  let missing=0,soonCount=0,cfs=0,returned=0;
  list.forEach(r=>{
    const eta=parseDateValue(sf(r,["ETA"]));if(eta&&eta>=today&&eta<=soon)soonCount++;
    if(st(r)[0]==="CFS IN")cfs++;if(st(r)[0]==="RETURNED")returned++;
    if(!cnum(r)||!sf(r,["ETA"])||!sf(r,["VESSEL & VOY","VESSEL"])||!sf(r,["GATEWAY PORT"]))missing++;
  });
  const total=list.length||1;
  se("healthMissing").textContent=missing;
  se("etaWindow").textContent=soonCount;
  se("cfsWorkload").textContent=cfs;
  se("completionRate").textContent=Math.round(returned/total*100)+"%";
  const health=Math.max(0,Math.round((1-(missing/total))*100));
  se("networkHealth").textContent=health+"%";se("healthBar").style.width=health+"%";
  se("healthText").textContent=missing?missing+" shipment"+(missing===1?" is":"s are")+" missing one or more core fields.":"Core shipment fields are healthy across the current workspace.";
  const side=se("sideAlertCount");if(side)side.textContent=se("alertCount")?.textContent?.replace(/ .*/,"")||"0";
}
function enableRealtime(){
  try{
    const channel=SSB.channel("cargotrack-live")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"containers",filter:"id=eq.gml_tracking_records"},()=>loadRows().catch(()=>{}))
      .subscribe(status=>{
        const live=se("liveState"),source=se("dataSourceStatus");
        if(status==="SUBSCRIBED"){if(live){live.textContent="LIVE";live.parentElement?.classList.add("connected")}if(source)source.textContent="Live source • realtime channel connected";}
        else {if(live)live.textContent="SYNC";if(source)source.textContent="Live source • refresh fallback enabled";}
      });
    window.__cargotrackChannel=channel;
  }catch(e){console.warn("Realtime unavailable",e)}
}

function openBulkUpdate(){
  const list=requireSelection();if(!list)return;
  const form='<div class="s-bulk-help">Updating <b>'+list.length+'</b> selected shipment'+(list.length===1?"":"s")+'. Leave a field blank to keep each existing value unchanged.</div><div class="s-bulk-form">'+
    '<div><label class="s-label">ETD</label><input class="s-input" id="buETD" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">ETA</label><input class="s-input" id="buETA" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">Port In</label><input class="s-input" id="buPortIn" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">Port Out</label><input class="s-input" id="buPortOut" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">CFS In</label><input class="s-input" id="buCfsIn" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">Destuffing Date</label><input class="s-input" id="buDestuff" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">Empty Return</label><input class="s-input" id="buReturn" placeholder="DD-MMM-YYYY"></div>'+
    '<div><label class="s-label">Vessel / Voyage</label><input class="s-input" id="buVessel" placeholder="e.g. EVER BRAVE V0104W"></div>'+
    '<div class="full"><label class="s-label">Gateway Port</label><input class="s-input" id="buGateway" placeholder="e.g. CITPL"></div></div>';
  const m=makeFeatureModal("bulkUpdateModal","Bulk Shipment Update","Apply the same operational change to the selected containers.",form,'<button class="s-btn" data-close>Cancel</button><button class="s-btn blue" id="applyBulkUpdate">Apply Update</button>');
  m.classList.add("open");
  m.querySelector("#applyBulkUpdate").addEventListener("click",async()=>{
    if(!["Admin","Editor"].includes(session.role)){notify("Admin / Editor access required.");return}
    const fields={ETD:"buETD",ETA:"buETA","PORT IN":"buPortIn","PORT OUT":"buPortOut","CFS IN":"buCfsIn","DESTUFFING DATE":"buDestuff","CONTAINER RETURN DATE":"buReturn","VESSEL & VOY":"buVessel","GATEWAY PORT":"buGateway"};
    let changes=0; list.forEach(r=>{Object.entries(fields).forEach(([key,id])=>{const value=se(id)?.value.trim();if(value){r[key]=value;changes++}})});
    const {error}=await SSB.from("containers").upsert({id:"gml_tracking_records",data:rows});
    if(error){notify("Bulk update failed: "+error.message);return}
    m.remove();renderTable();notify(changes+" field updates saved.");
  });
}

function applySelectAll(){const list=filtered().slice(0,300);const checked=se("selectAllRows").checked;list.forEach(r=>{const i=rows.indexOf(r);checked?selected.add(i):selected.delete(i)});renderTable()}
function bootStaff(){applyBrand();se("staffUsername").textContent=session.username||"Staff";se("staffRole").textContent=session.role||"Staff";loadRows().then(()=>enableRealtime()).catch(e=>alert(e.message))}

loadSession();
if(session){show("loginScreen",false);show("staffApp",true);bootStaff()}
se("loginBtn").addEventListener("click",login);
se("logoutBtn").addEventListener("click",logout);
se("staffSearch").addEventListener("input",renderTable);
se("statusFilter").addEventListener("change",renderTable);
se("refreshBtn").addEventListener("click",()=>loadRows().catch(e=>notify(e.message)));
se("saveEdit").addEventListener("click",saveEditor);
se("closeEdit").addEventListener("click",()=>se("editDrawer").classList.remove("open"));
se("igmFile").addEventListener("change",()=>importIgm().catch(e=>{se("importSummary").innerHTML='<div class="s-import-result" style="border-color:#e9cccc;background:#fff7f7;color:#b84141">'+sx(e.message)+'</div>'}));
se("trackingFile").addEventListener("change",async()=>{try{await importTracking()}catch(e){se("importSummary").innerHTML='<div class="s-import-result" style="border-color:#e9cccc;background:#fff7f7;color:#b84141">'+sx(e.message)+'</div>';notify(e.message)}finally{se("trackingFile").value=""}});
se("importTrackingBtn").addEventListener("click",()=>se("trackingFile").click());
se("exportBtn").addEventListener("click",exportExcel);
se("statusPhotoBtn").addEventListener("click",downloadStatusPhoto);
se("whatsappBtn").addEventListener("click",openWhatsApp);se("bulkUpdateBtn").addEventListener("click",openBulkUpdate);
se("selectAllRows").addEventListener("change",applySelectAll);
