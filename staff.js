
const S_URL="https://ykeucqritoexykqrggzz.supabase.co";
const S_KEY="sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ";
const SSB=supabase.createClient(S_URL,S_KEY); const APP=window.GML_APP_CONFIG||{appName:"CargoTrack",appShort:"CT",appTagline:"SHIPMENT CONTROL CENTER"};
const se=id=>document.getElementById(id);
const sx=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sf=(r,n)=>{for(const x of n){if(r?.[x]!==undefined&&String(r[x]??"").trim()!=="")return r[x]}return""};
const sn=v=>String(v??"").toLowerCase().replace(/[^a-z0-9]/g,"");
const sd=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})};
const st=r=>sf(r,["CONTAINER RETURN DATE"])?["RETURNED","good"]:sf(r,["DESTUFFING DATE"])?["DE-STUFFED","good"]:sf(r,["CFS IN"])?["CFS IN","good"]:sf(r,["PORT OUT"])?["PORT OUT","warn"]:sf(r,["PORT IN"])?["PORT IN","warn"]:sf(r,["INWARD DATE"])?["INWARD GRANTED","warn"]:sf(r,["ETD"])?["IN TRANSIT","warn"]:["PENDING","bad"];
let rows=[],session=null,editingIndex=-1;

function show(id,on=true){se(id).style.display=on?"":"none"}
function notify(msg){const n=se("staffNotice");n.textContent=msg;n.classList.add("open");setTimeout(()=>n.classList.remove("open"),2200)}

async function login(){
  const code=String(se("accessCode").value||"").trim().toLowerCase();
  if(!code)return;
  se("loginBtn").disabled=true;se("loginBtn").textContent="Verifying…";
  try{
    const {data,error}=await SSB.from("user_roles").select("user_id,role,username").eq("access_code",code).single();
    if(error||!data)throw new Error("Invalid access code.");
    session=data;localStorage.setItem("gml_staff_session",JSON.stringify(data));
    show("loginScreen",false);show("staffApp",true);bootStaff();
  }catch(e){se("loginError").textContent=e.message;show("loginError",true)}
  finally{se("loginBtn").disabled=false;se("loginBtn").textContent="Sign In"}
}
function logout(){localStorage.removeItem("gml_staff_session");location.reload()}
function loadSession(){try{session=JSON.parse(localStorage.getItem("gml_staff_session")||"null")}catch(e){session=null}}
async function loadRows(){
  const {data,error}=await SSB.from("containers").select("data").eq("id","gml_tracking_records").single();
  if(error)throw error;
  rows=Array.isArray(data?.data)?data.data:[];return rows;
}
function renderKpis(list){
  const vals=list.reduce((a,r)=>{const s=st(r)[0];a.active+=s!=="RETURNED";a.done+=s==="RETURNED";a.portin+=s==="ARRIVED AT PORT";a.portout+=s==="PORT OUT";a.destuff+=s==="DE-STUFFED";return a},{active:0,done:0,portin:0,portout:0,destuff:0});
  se("kActive").textContent=vals.active;se("kDone").textContent=vals.done;se("kPortIn").textContent=vals.portin;se("kPortOut").textContent=vals.portout;se("kDestuff").textContent=vals.destuff;se("kTotal").textContent=list.length;
}
function filtered(){
  const q=sn(se("staffSearch").value),f=se("statusFilter").value;
  return rows.filter(r=>{const hay=[sf(r,["CONTAINER NO."]),sf(r,["MBL NO"]),sf(r,["VESSEL & VOY"]),sf(r,["LINER"]),sf(r,["POL"]),sf(r,["GATEWAY PORT"])].map(sn).join(" ");const okQ=!q||hay.includes(q);const s=st(r)[0];const okF=f==="all"||s===f;return okQ&&okF})
}
function renderTable(){
  const list=filtered();renderKpis(list);se("staffCount").textContent=list.length+" shipments";
  se("staffBody").innerHTML=list.slice(0,200).map((r)=>{
    const idx=rows.indexOf(r),s=st(r),c=sf(r,["CONTAINER NO."]),m=sf(r,["MBL NO"]),v=sf(r,["VESSEL & VOY"]),p=sf(r,["POL"]),g=sf(r,["GATEWAY PORT"]),eta=sf(r,["ETA"]);
    return '<tr><td><button class="s-link" data-edit="'+idx+'">'+sx(c||"—")+'</button></td><td>'+sx(m||"—")+'</td><td>'+sx(sf(r,["LINER"])||"—")+'</td><td>'+sx(p||"—")+'</td><td>'+sx(g||"—")+'</td><td>'+sx(v||"—")+'</td><td>'+sx(sd(eta))+'</td><td><span class="s-status '+s[1]+'">'+sx(s[0])+'</span></td></tr>';
  }).join("")||'<tr><td colspan="8" style="padding:30px;text-align:center;color:#7e8da0">No shipments match the current filter.</td></tr>';
  se("staffBody").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(Number(b.dataset.edit))));
}
function openEditor(i){
  editingIndex=i;const r=rows[i]||{};
  const map=[
    ["CONTAINER NO.","Container Number"],["TYPE","Size / Type"],["MBL NO","MBL Number"],["LINER","Liner"],
    ["GATEWAY PORT","Gateway Port"],["CFS NAME","CFS"],["POL","POL"],["ETD","ETD"],["ETA","ETA"],["INWARD DATE","Inward Date"],
    ["PORT IN","Port In"],["PORT OUT","Port Out"],["CFS IN","CFS In"],["DESTUFFING DATE","Destuffing Date"],["CONTAINER RETURN DATE","Empty Return"],["VESSEL & VOY","Vessel / Voyage"]
  ];
  se("editFields").innerHTML=map.map(([k,l])=>'<div><label class="s-label">'+sx(l)+'</label><input class="s-input edit-input" data-field="'+sx(k)+'" value="'+sx(r[k]||"")+'"></div>').join("");
  se("editDrawer").classList.add("open");
}
async function saveEditor(){
  if(editingIndex<0)return;const r=rows[editingIndex];
  se("saveEdit").disabled=true;try{
    se("editFields").querySelectorAll(".edit-input").forEach(x=>{r[x.dataset.field]=x.value});
    if(!["Admin","Editor"].includes(session.role))throw new Error("Editor access required.");
    const {error}=await SSB.from("containers").upsert({id:"gml_tracking_records",data:rows});if(error)throw error;
    se("editDrawer").classList.remove("open");notify("Shipment updated.");renderTable();
  }catch(e){alert(e.message)}finally{se("saveEdit").disabled=false}
}
function norm(v){return String(v??"").trim()}
function normHeader(v){return norm(v).toLowerCase().replace(/[^a-z0-9]+/g,"")}
function findCol(headers,cands){const n=headers.map(normHeader);for(const c of cands){const t=normHeader(c);const i=n.indexOf(t);if(i>=0)return i}for(const c of cands){const t=normHeader(c);const i=n.findIndex(h=>h.includes(t)||t.includes(h));if(i>=0)return i}return-1}
function hnum(v){const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:null}
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
function bootStaff(){document.querySelectorAll("[data-app-name]").forEach(el=>el.textContent=APP.appName);document.querySelectorAll("[data-app-short]").forEach(el=>el.textContent=APP.appShort||"CT");document.querySelectorAll("[data-app-tagline]").forEach(el=>el.textContent="OPERATIONS CONTROL");document.querySelectorAll("[data-app-context]").forEach(el=>el.textContent=APP.appTagline||"SHIPMENT CONTROL CENTER");document.querySelectorAll("[data-page-title]").forEach(el=>el.textContent=APP.appName+" — Operations Control");se("staffUsername").textContent=session.username||"Staff";se("staffRole").textContent=session.role||"Staff";loadRows().then(renderTable).catch(e=>alert(e.message))}
loadSession();
if(session){show("loginScreen",false);show("staffApp",true);bootStaff()}
se("loginBtn").addEventListener("click",login);se("logoutBtn").addEventListener("click",logout);se("staffSearch").addEventListener("input",renderTable);se("statusFilter").addEventListener("change",renderTable);
se("refreshBtn").addEventListener("click",()=>loadRows().then(renderTable));se("saveEdit").addEventListener("click",saveEditor);se("closeEdit").addEventListener("click",()=>se("editDrawer").classList.remove("open"));
se("igmFile").addEventListener("change",()=>importIgm().catch(e=>{se("importSummary").innerHTML='<div class="s-import-result" style="border-color:#e9cccc;background:#fff7f7;color:#b84141">'+sx(e.message)+'</div>'}));
