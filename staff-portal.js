;
/* ===== Consolidated from staff-portal-v8.js; original order preserved ===== */
/* Staff Portal UI v8 — layout state bridge; no data access or backend calls. */
(function(){
'use strict';
function init(){
const body=document.body,dashboard=document.getElementById('opsDashboardView'),sheet=document.getElementById('sheetView'),tray=document.querySelector('#opsDashboardView .control-tray');
if(!dashboard||!sheet||!tray)return;
const top=tray.querySelector('.control-tray-top');
if(top&&!document.getElementById('staffWorkspaceActions')){
const dock=document.createElement('div');dock.id='staffWorkspaceActions';dock.setAttribute('aria-label','Shipment actions');
const view=top.querySelector('.view-selector');if(view)view.insertAdjacentElement('afterend',dock);else top.appendChild(dock);
const add=document.getElementById('addBtn'),exp=document.getElementById('exportBtn'),input=document.getElementById('excelInput'),label=input?input.closest('label'):null;
[add,exp,label].filter(Boolean).forEach(el=>dock.appendChild(el));
}
function visible(el){return !!el&&window.getComputedStyle(el).display!=='none'&&el.getAttribute('aria-hidden')!=='true'}
function update(){
const signedIn=visible(dashboard);body.classList.toggle('staff-authenticated',signedIn);
const active=document.querySelector('#opsDashboardView .view-btn.active');
const table=signedIn&&(visible(sheet)||(active&&active.dataset.view==='sheet'));
body.classList.toggle('staff-table-mode',!!table);
const sidebar=document.getElementById('staffReferenceSidebar');
if(signedIn&&sidebar&&!sidebar.dataset.v8Opened){sidebar.classList.remove('collapsed');sidebar.dataset.v8Opened='1'}
const search=document.getElementById('search');if(search)search.setAttribute('aria-label','Search shipments by container, MBL, vessel, liner or truck');
}
const observer=new MutationObserver(update);
observer.observe(dashboard,{attributes:true,attributeFilter:['style','class']});
observer.observe(sheet,{attributes:true,attributeFilter:['style','class']});
const controls=document.querySelector('#opsDashboardView .view-selector');
if(controls)observer.observe(controls,{subtree:true,attributes:true,attributeFilter:['class','style']});
update();
document.addEventListener('click',e=>{if(e.target.closest('#staffSidebarToggle,.view-btn'))setTimeout(update,0)});
window.addEventListener('resize',update,{passive:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v9.js; original order preserved ===== */
/* Shipment workspace v9: compact register + detail drawer using existing records/actions */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const isEmpty=v=>v===undefined||v===null||String(v).trim()===''||['—','-','N/A','NA','NULL'].includes(String(v).trim().toUpperCase());
const escText=v=>typeof esc==='function'?esc(String(v??'')):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function val(record,keys){try{return typeof getField==='function'?getField(record,keys)||'':(keys.map(k=>record?.[k]).find(v=>!isEmpty(v))||'')}catch(_){return ''}}
function display(v){return isEmpty(v)?'—':String(v).trim()}
function date(v){if(isEmpty(v))return '—';const s=String(v).trim();const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return s;const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
function recordStatus(r){try{const s=typeof getStatus==='function'?getStatus(r):null;return {text:(s?.text||'REVIEW').replace(/^\p{Extended_Pictographic}\s*/u,''),klass:s?.class||'progress'}}catch(_){return {text:'REVIEW',klass:'progress'}}}
function currentRecords(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function chosenIndices(){
 const body=byId('sheetTableBody');if(!body)return [];
 return [...body.querySelectorAll('tr')].map(tr=>Number(tr.dataset.row??tr.querySelector('input.chk-item')?.value)).filter(i=>Number.isInteger(i)&&i>=0);
}
function renderCompactTable(){
 const table=byId('sheetView'),tbody=byId('sheetTableBody');if(!table||!tbody||!document.body.classList.contains('staff-table-mode'))return;
 const records=currentRecords(),idxs=chosenIndices();
 const headers=['','Shipment','MBL No.','Liner','Gateway / Terminal','Vessel & Voyage','ETA','Port In','Port Out','CFS Depot','Current stage'];
 const thead=table.querySelector('thead');if(thead)thead.innerHTML='<tr>'+headers.map((h,i)=>'<th scope="col"'+(i===0?' aria-label="Select shipments"':'')+'>'+(i===0?'<input type="checkbox" id="staffTableSelectAll" aria-label="Select all shipments">':escText(h))+'</th>').join('')+'</tr>';
 const oldRows=[...tbody.querySelectorAll('tr')];
 const html=[];
 oldRows.forEach(tr=>{
   let i=Number(tr.dataset.row??tr.querySelector('input.chk-item')?.value);
   if(!Number.isInteger(i)||i<0||i>=records.length){
     const text=tr.textContent.trim();
     if(text){html.push('<tr class="st9-empty-row"><td colspan="12">'+escText(text)+'</td></tr>')}
     return;
   }
   const r=records[i]||{},status=recordStatus(r);
   const cn=val(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);
   const type=val(r,['TYPE','SIZE','CONTAINER TYPE']);
   const mbl=val(r,['MBL NO','MBL','MASTER BL']);
   const liner=val(r,['LINER','LINE','CARRIER']);
   const gw=val(r,['GATEWAY PORT','POD','PORT','DESTINATION']);
   const vessel=val(r,['VESSEL & VOY','VESSEL','VESSEL NAME']);
   const eta=val(r,['ETA']);
   const portIn=val(r,['PORT IN']),portOut=val(r,['PORT OUT']);
   const cfs=val(r,['CFS NAME','CFS']);
   const isChecked=(()=>{try{return selectedIndices.has(i)}catch(_){return false}})();
   const cls=['completed','done','returned'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'completed':(['warning','overdue','pending','delay','danger'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'warning':'progress');
   html.push('<tr data-row="'+i+'" tabindex="0" role="button" aria-label="Open shipment '+escText(cn)+'">'+
    '<td class="st9-checkbox-cell"><input type="checkbox" class="chk-item st9-row-check" value="'+i+'" '+(isChecked?'checked':'')+' aria-label="Select '+escText(cn)+'"></td>'+
    '<td><button type="button" class="st9-container-link" data-st9-detail="'+i+'">'+escText(display(cn))+'<span class="st9-container-sub">'+escText(display(type))+'</span></button></td>'+
    '<td>'+escText(display(mbl))+'</td><td>'+escText(display(liner))+'</td><td>'+escText(display(gw))+'</td><td>'+escText(display(vessel))+'</td>'+
    '<td>'+escText(date(eta))+'</td><td>'+escText(date(portIn))+'</td><td>'+escText(date(portOut))+'</td><td>'+escText(display(cfs))+'</td>'+
    '<td><span class="st9-status '+cls+'" title="'+escText(status.text)+'">'+escText(status.text.replace(/\s+/g,' ').slice(0,26))+'</span></td>'+
   '</tr>');
 });
 if(html.length)tbody.innerHTML=html.join('');
 const all=byId('staffTableSelectAll');
 if(all){const boxes=[...tbody.querySelectorAll('.chk-item')];all.checked=boxes.length>0&&boxes.every(b=>b.checked);all.indeterminate=boxes.some(b=>b.checked)&&!all.checked;all.addEventListener('change',()=>{boxes.forEach(b=>{b.checked=all.checked;b.dispatchEvent(new Event('change',{bubbles:true}))})})}
 if(typeof bindCheckboxes==='function')bindCheckboxes();
 const count=byId('searchResultCount');const n=idxs.length;if(count&&!count.textContent.trim())count.textContent=n+' shipments';
}
function addDetailShell(){
 if(byId('staffShipmentDetailOverlay'))return;
 const overlay=document.createElement('div');overlay.className='st9-detail-overlay';overlay.id='staffShipmentDetailOverlay';
 overlay.innerHTML='<aside class="st9-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="st9DetailTitle"><div class="st9-drawer-topbar"><div class="st9-drawer-brand"><span class="st9-drawer-brand-mark">⚓</span> GML · SHIPMENT DETAILS</div><button type="button" class="st9-drawer-close" data-st9-close aria-label="Close shipment details">×</button></div><div class="st9-detail-scroll" id="st9DetailContent"></div><div class="st9-detail-actions" id="st9DetailActions"></div></aside>';
 document.body.appendChild(overlay);
 overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-st9-close]'))closeStaffShipmentDetail()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeStaffShipmentDetail()});
}
function fieldBlock(label,value){if(isEmpty(value))return '';return '<div class="st9-info-field"><small>'+escText(label)+'</small><strong>'+escText(display(value))+'</strong></div>'}
function infoSection(title,sub,fields){
 const content=fields.map(([label,value])=>fieldBlock(label,value)).join('');
 if(!content)return '';
 return '<section class="st9-detail-section"><div class="st9-detail-section-head"><h3>'+escText(title)+'</h3><small>'+escText(sub||'')+'</small></div><div class="st9-info-grid">'+content+'</div></section>'
}
function openStaffShipmentDetail(i){
 const records=currentRecords(),r=records[Number(i)];if(!r)return;
 addDetailShell();const overlay=byId('staffShipmentDetailOverlay'),content=byId('st9DetailContent'),actions=byId('st9DetailActions');
 const cn=val(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']),type=val(r,['TYPE','SIZE','CONTAINER TYPE']),mbl=val(r,['MBL NO','MBL','MASTER BL']),liner=val(r,['LINER','LINE','CARRIER']),pol=val(r,['POL','PORT OF LOADING','ORIGIN']),gateway=val(r,['GATEWAY PORT','POD','PORT','DESTINATION']),vessel=val(r,['VESSEL & VOY','VESSEL','VESSEL NAME']),status=recordStatus(r);
 const gwInfo=(()=>{try{return typeof getGatewayPortInfo==='function'?getGatewayPortInfo(r):{key:gateway}}catch(_){return {key:gateway}}})();
 const overview=[
  ['Container type',type],['Master B/L',mbl],['Liner / Carrier',liner],['Vessel & Voyage',vessel],
  ['Port of Loading',pol],['Transshipment Port(s)',val(r,['TRANSSHIPMENT PORT','TRANSHIPMENT PORT','TRANS-SHIPMENT PORT','T/S PORT','TS PORT'])],
  ['Gateway / Terminal',gwInfo?.key||gateway],['CFS Depot',val(r,['CFS NAME','CFS'])],['Seal Number',val(r,['SEAL NO.','SEAL NO','SEAL NUMBER'])],['Free Days',val(r,['FREE DAYS'])]
 ];
 const handling=[
  ['Truck / Vehicle',val(r,['TRUCK NO.','TRUCK NO','VEHICLE NO'])],['Driver Contact',val(r,['DRIVER CONTACT','DRIVER PHONE'])],
  ['Planning Notes',val(r,['PLANNING','PLANNING NOTES'])],['Remarks',val(r,['REMARKS','NOTES'])]
 ];
 const milestoneDefs=[
  ['ETD · Planned departure',['ETD']],['ETA · Estimated arrival',['ETA']],['Inward date',['INWARD DATE']],
  ['Port In',['PORT IN']],['Port Out',['PORT OUT']],['CFS In',['CFS IN']],
  ['Destuffing',['DESTUFFING DATE','DESTUFF DATE']],['Container return',['CONTAINER RETURN DATE','EMPTY RETURN DATE']]
 ];
 const milestones=milestoneDefs.map(([label,keys])=>({label,value:val(r,keys)}));
 const progress=milestones.filter(m=>!isEmpty(m.value)).length;
 const timeline=milestones.map((m,k)=>{const done=!isEmpty(m.value);return '<div class="st9-timeline-row '+(done?'done':'')+'"><span class="st9-timeline-dot">'+(done?'✓':'·')+'</span><div><div class="st9-timeline-label">'+escText(m.label)+'</div><div class="st9-timeline-date">'+escText(done?date(m.value):'Not recorded')+'</div></div><span class="st9-timeline-state">'+(done?'Recorded':'Pending')+'</span></div>'}).join('');
 let finance='';try{const f=typeof calculateStandardFees==='function'?calculateStandardFees(r):null;if(f)finance=infoSection('LFD & financial exposure','Calculated from stored milestones',[
  ['Terminal LFD',f.terminalLFD],['Detention LFD',f.detentionLFD],['Estimated exposure',typeof formatCurrency==='function'?formatCurrency(f.totalCostUSD):f.totalCostUSD]
 ])}catch(_){}
 const from=pol||'Origin not recorded',to=gateway||'Gateway not recorded';
 content.innerHTML='<section class="st9-detail-hero"><div class="st9-detail-eyebrow">SHIPMENT RECORD · '+escText('DETAILS')+'</div><div class="st9-detail-title-row"><div><h2 class="st9-detail-title" id="st9DetailTitle">'+escText(display(cn))+'</h2><div class="st9-detail-subtitle">'+escText(display(mbl))+' · '+escText(display(liner))+'</div></div><span class="st9-status '+(['completed','returned','done'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'completed':'progress')+'">'+escText(status.text.replace(/\s+/g,' ').slice(0,27))+'</span></div><div class="st9-route-summary"><div class="st9-route-end"><small>Port of loading</small><strong>'+escText(display(from))+'</strong></div><div class="st9-route-arrow" aria-hidden="true">→</div><div class="st9-route-end"><small>Gateway / terminal</small><strong>'+escText(display(to))+'</strong></div></div></section>'+
 infoSection('Shipment information','Core routing & booking data',overview)+
 '<section class="st9-detail-section"><div class="st9-detail-section-head"><h3>Operational milestones</h3><small>'+progress+' of '+milestones.length+' dates recorded</small></div><div class="st9-timeline">'+timeline+'</div></section>'+
 infoSection('Handling & delivery','Last-mile information',handling)+finance;
 const viewer=(()=>{try{return currentUser&&currentUser.role==='Viewer'}catch(_){return false}})();
 const admin=(()=>{try{return currentUser&&currentUser.role==='Admin'}catch(_){return false}})();
 actions.innerHTML='<button type="button" class="primary" data-st9-action="edit" data-idx="'+Number(i)+'" '+(viewer?'disabled':'')+'>Edit shipment</button><button type="button" data-st9-action="map" data-idx="'+Number(i)+'">Show route</button>'+
 (!viewer?'<button type="button" data-st9-action="return" data-idx="'+Number(i)+'">Mark returned</button>':'')+
 (admin?'<button type="button" class="danger" data-st9-action="delete" data-idx="'+Number(i)+'">Delete</button>':'');
 actions.querySelectorAll('[data-st9-action]').forEach(btn=>btn.addEventListener('click',()=>{
  const idx=Number(btn.dataset.idx),action=btn.dataset.st9Action;
  if(action==='edit'){closeStaffShipmentDetail();if(typeof openModal==='function')openModal(idx)}
  else if(action==='map'){closeStaffShipmentDetail();if(typeof setView==='function')setView('cards');if(typeof showShipmentRoute==='function')showShipmentRoute(idx);document.querySelector('.staff-map-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}
  else if(action==='return'){closeStaffShipmentDetail();if(typeof markSingleReturned==='function')markSingleReturned(idx)}
  else if(action==='delete'){closeStaffShipmentDetail();if(typeof deleteRow==='function')deleteRow(idx)}
 }));
 overlay.classList.add('open');document.body.style.overflow='hidden';
 const close=overlay.querySelector('[data-st9-close]');if(close)close.focus();
}
function closeStaffShipmentDetail(){const o=byId('staffShipmentDetailOverlay');if(o)o.classList.remove('open');document.body.style.overflow='';}
window.openStaffShipmentDetail=openStaffShipmentDetail;window.closeStaffShipmentDetail=closeStaffShipmentDetail;
function configureHeading(){
 const intro=document.querySelector('#opsDashboardView .staff-table-intro');if(!intro)return;
 const copy=intro.querySelector('.staff-table-intro-copy'),h=copy?.querySelector('h1'),p=copy?.querySelector('p');
 if(h&&h.textContent!=='Shipments')h.textContent='Shipments';
 if(p)p.textContent='Manage containers, port milestones and empty returns from one register.';
 if(copy&&!copy.querySelector('.staff-table-intro-breadcrumb')){
  const bc=document.createElement('div');bc.className='staff-table-intro-breadcrumb';bc.innerHTML='<span>Dashboard</span><span aria-hidden="true">/</span><strong>Shipments</strong>';
  copy.insertBefore(bc,copy.firstChild);
 }
 const mark=intro.querySelector('.staff-table-intro-mark');if(mark)mark.textContent='SH';
}
function enhance(){
 configureHeading();addDetailShell();
 if(!document.body.classList.contains('staff-table-mode'))return;
 renderCompactTable();
}
function init(){
 const original=window.renderUI;
 if(typeof original==='function'){
  window.renderUI=function(){const result=original.apply(this,arguments);try{enhance()}catch(e){console.warn('Shipment UI enhancement skipped',e)}return result};
 }
 const dashboard=byId('opsDashboardView'),sheet=byId('sheetView'),tbody=byId('sheetTableBody');
 const observer=new MutationObserver(()=>{try{enhance()}catch(e){console.warn('Shipment table refresh skipped',e)}});
 [dashboard,sheet,document.body].filter(Boolean).forEach(el=>observer.observe(el,{attributes:true,attributeFilter:el===document.body?['class']:['style','class']}));
 document.addEventListener('click',e=>{const b=e.target.closest('[data-st9-detail]');if(b){e.preventDefault();openStaffShipmentDetail(Number(b.dataset.st9Detail));return;}const tr=e.target.closest('#sheetTableBody tr[data-row]');if(tr&&!e.target.closest('input,button,a,select,label'))openStaffShipmentDetail(Number(tr.dataset.row))});
 document.addEventListener('keydown',e=>{const tr=e.target.closest('#sheetTableBody tr[data-row]');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openStaffShipmentDetail(Number(tr.dataset.row))}});
 document.addEventListener('click',e=>{if(e.target.closest('.view-btn'))setTimeout(enhance,0)});
 setTimeout(enhance,0);setTimeout(enhance,300);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v10.js; original order preserved ===== */
/* Staff workspace v10 — overview, shipments, and full-page shipment details.
   Presentation/navigation only: uses existing in-memory records and existing actions. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const body=document.body;
let currentPage='overview';
let currentDetailIndex=null;
let lastSignedIn=false;
const empty=v=>v===undefined||v===null||String(v).trim()===''||['—','-','N/A','NA','NULL'].includes(String(v).trim().toUpperCase());
const text=v=>typeof esc==='function'?esc(String(v??'')):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function records(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function read(r,keys){try{return typeof getField==='function'?(getField(r,keys)||''):(keys.map(k=>r?.[k]).find(v=>!empty(v))||'')}catch(_){return ''}}
function show(v){return empty(v)?'Not recorded':String(v).trim()}
function prettyDate(v){
 if(empty(v))return 'Not recorded';
 const s=String(v).trim(),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
 if(!m)return s;
 const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
 return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function getStatusSafe(r){try{return typeof getStatus==='function'?getStatus(r):{text:'Status not available',class:'progress'}}catch(_){return {text:'Status not available',class:'progress'}}}
function detailStatusClass(st){
 const t=String(st?.class||'')+' '+String(st?.text||'');
 if(/complete|returned|done/i.test(t))return 'completed';
 if(/overdue|warning|pending|danger|delay/i.test(t))return 'warning';
 return 'progress';
}
function addPage(){
 let page=byId('staffShipmentDetailPage');
 if(page)return page;
 const main=byId('opsDashboardView');
 if(!main)return null;
 page=document.createElement('section');
 page.id='staffShipmentDetailPage';
 page.setAttribute('aria-live','polite');
 page.setAttribute('aria-label','Shipment details');
 main.appendChild(page);
 return page;
}
function setActiveNav(target){
 document.querySelectorAll('#staffReferenceSidebar .staff-side-link').forEach(el=>{
  el.classList.toggle('active',el.getAttribute('data-staff-nav')===target);
 });
}
function setViewSafe(view){
 try{
  if(typeof setView==='function')setView(view);
  else document.querySelector('#opsDashboardView .view-btn[data-view="'+view+'"]')?.click();
 }catch(e){console.warn('Could not switch shipment list view',e)}
}
function refreshModeClasses(page){
 body.classList.remove('staff-overview-page','staff-shipment-list-page','staff-shipment-detail-page');
 if(page==='overview')body.classList.add('staff-overview-page');
 if(page==='shipments')body.classList.add('staff-shipment-list-page');
 if(page==='detail')body.classList.add('staff-shipment-detail-page');
}
function renderOverviewPage(){
 currentPage='overview';currentDetailIndex=null;refreshModeClasses('overview');setActiveNav('dashboard');
 setViewSafe('cards');
 const main=byId('opsDashboardView');if(main)main.scrollIntoView({block:'start',behavior:'auto'});
}
function renderShipmentsPage(){
 currentPage='shipments';currentDetailIndex=null;refreshModeClasses('shipments');setActiveNav('shipments');
 const intro=document.querySelector('#opsDashboardView .staff-table-intro');
 if(intro){
  const copy=intro.querySelector('.staff-table-intro-copy'),h=copy?.querySelector('h1'),p=copy?.querySelector('p');
  if(h)h.textContent='Shipments';
  if(p)p.textContent='Search, filter, and open a container to review the complete shipment record.';
  if(copy&&!copy.querySelector('.staff-table-intro-breadcrumb')){
   const bc=document.createElement('div');bc.className='staff-table-intro-breadcrumb';
   bc.innerHTML='<span>Workspace</span><span aria-hidden="true">/</span><strong>Shipments</strong>';
   copy.insertBefore(bc,copy.firstChild);
  }
  const mark=intro.querySelector('.staff-table-intro-mark');if(mark)mark.textContent='SH';
 }
 body.classList.add('staff-table-mode');
 setViewSafe('sheet');
 setTimeout(()=>{if(currentPage==='shipments'){body.classList.add('staff-table-mode');try{if(typeof renderUI==='function')renderUI()}catch(_){} }},0);
 const main=byId('opsDashboardView');if(main)main.scrollIntoView({block:'start',behavior:'auto'});
}
function field(label,value,opts={}){
 const cls=empty(value)?' is-empty':'';
 const shown=opts.raw?show(value):(opts.date?prettyDate(value):show(value));
 return '<div class="stv10-field"><span class="stv10-field-label">'+text(label)+'</span><strong class="stv10-field-value'+cls+'">'+text(shown)+'</strong></div>';
}
function fieldPanel(title,subtitle,items){
 const contents=items.filter(it=>it&&it.length>=2).map(it=>field(it[0],it[1],it[2]||{})).join('');
 if(!contents)return '';
 return '<section class="stv10-panel"><div class="stv10-panel-heading"><h2>'+text(title)+'</h2><small>'+text(subtitle||'')+'</small></div><div class="stv10-fields">'+contents+'</div></section>';
}
function renderDetailPage(idx){
 const data=records(),r=data[Number(idx)];
 if(!r){renderShipmentsPage();return}
 currentPage='detail';currentDetailIndex=Number(idx);refreshModeClasses('detail');setActiveNav('shipments');
 const page=addPage();if(!page)return;
 const cn=read(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);
 const pol=read(r,['POL','PORT OF LOADING','ORIGIN']);
 const gwInfo=(()=>{try{return typeof getGatewayPortInfo==='function'?getGatewayPortInfo(r):null}catch(_){return null}})();
 const gateway=gwInfo?.name||gwInfo?.key||read(r,['GATEWAY PORT','POD','PORT','DESTINATION']);
 const mbl=read(r,['MBL NO','MBL','MASTER BL']);
 const status=getStatusSafe(r),statusCls=detailStatusClass(status);
 const from=empty(pol)?'Origin not recorded':pol,to=empty(gateway)?'Gateway not recorded':gateway;
 const routeCard='<section class="stv10-route-card">'+
  '<div><span class="stv10-route-label">Origin / loading port</span><strong class="stv10-route-value">'+text(from)+'</strong><small class="stv10-route-meta">Port of loading</small></div>'+
  '<div class="stv10-route-arrow" aria-hidden="true">→</div>'+
  '<div><span class="stv10-route-label">Destination / gateway</span><strong class="stv10-route-value">'+text(to)+'</strong><small class="stv10-route-meta">Gateway port</small></div>'+
 '</section>';
 const identity=[
  ['Container type',read(r,['TYPE','SIZE','CONTAINER TYPE'])],
  ['Master B/L',mbl],
  ['Liner / carrier',read(r,['LINER','LINE','CARRIER'])],
  ['Seal number',read(r,['SEAL NO.','SEAL NO','SEAL NUMBER'])]
 ];
 const routing=[
  ['Vessel & voyage',read(r,['VESSEL & VOY','VESSEL','VESSEL NAME'])],
  ['Transshipment port(s)',read(r,['TRANSSHIPMENT PORT','TRANSHIPMENT PORT','TRANS-SHIPMENT PORT','T/S PORT','TS PORT'])]
 ];
 const milestoneDefs=[
  ['ETD · Planned departure',['ETD']],
  ['ETA · Estimated arrival',['ETA']],
  ['Split date',['SPLIT DATE']],
  ['Inward date',['INWARD DATE','INWARD']],
  ['Port In',['PORT IN']],
  ['Port Out',['PORT OUT']],
  ['CFS In',['CFS IN']],
  ['Destuffing date',['DESTUFFING DATE','DESTUFF DATE']],
  ['Empty return validity',['EMPTY RETURN VALIDITY']],
  ['Container return date',['CONTAINER RETURN DATE','EMPTY RETURN DATE']]
 ];
 const milestones=milestoneDefs.map(([label,keys])=>({label,value:read(r,keys)}));
 let returnValidity=null;
 try{if(typeof getEmptyReturnValidity==='function')returnValidity=getEmptyReturnValidity(r)}catch(_){}
 const returnValid=milestones.find(m=>m.label==='Empty return validity');
 if(returnValid&&empty(returnValid.value)&&returnValidity&&!empty(returnValidity.date))returnValid.value=returnValidity.date+' · '+(returnValidity.label||returnValidity.state||'');
 const timeline=milestones.map(m=>{
  const done=!empty(m.value);
  return '<div class="stv10-timeline-item '+(done?'done':'')+'"><span class="stv10-time-dot">'+(done?'✓':'·')+'</span><div><strong>'+text(m.label)+'</strong><small>'+text(done?prettyDate(m.value):'No date recorded')+'</small></div><span class="stv10-time-status">'+(done?'Recorded':'Pending')+'</span></div>';
 }).join('');
 const timelinePanel='<section class="stv10-panel"><div class="stv10-panel-heading"><h2>Milestones & dates</h2><small>'+milestones.filter(m=>!empty(m.value)).length+' of '+milestones.length+' recorded</small></div><div class="stv10-timeline">'+timeline+'</div></section>';
 const handling=[
  ['CFS depot',read(r,['CFS NAME','CFS'])],
  ['Truck / vehicle',read(r,['TRUCK NO.','TRUCK NO','VEHICLE NO'])],
  ['Driver contact',read(r,['DRIVER CONTACT','DRIVER PHONE'])],
  ['Planning notes',read(r,['PLANNING','PLANNING NOTES'])]
 ];
 let fees=null;try{if(typeof calculateStandardFees==='function')fees=calculateStandardFees(r)}catch(_){}
 const finances=[
  ['Free days',read(r,['FREE DAYS'])],
  ['Terminal LFD',fees?.terminalLFD],
  ['Detention LFD',fees?.detentionLFD],
  ['Port dwell',fees?.portDwell===undefined?'':String(fees.portDwell)+' days'],
  ['Estimated financial exposure',fees&&typeof formatCurrency==='function'?formatCurrency(fees.totalCostUSD):fees?.totalCostUSD]
 ];
 const remark=read(r,['REMARKS','NOTES']);
 const viewer=(()=>{try{return currentUser&&currentUser.role==='Viewer'}catch(_){return false}})();
 const admin=(()=>{try{return currentUser&&currentUser.role==='Admin'}catch(_){return false}})();
 page.innerHTML=
  '<div class="stv10-breadcrumbs"><button type="button" data-stv10-back>‹ Shipments</button><span>/</span><span>Shipment detail</span><span>/</span><strong>'+text(show(cn))+'</strong></div>'+
  '<header class="stv10-header"><div class="stv10-heading-copy"><div class="stv10-eyebrow">SHIPMENT WORKSPACE · RECORD DETAILS</div><div class="stv10-titleline"><h1 class="stv10-title">'+text(show(cn))+'</h1><span class="st9-status '+statusCls+'">'+text(String(status.text||'Status not available').replace(/\s+/g,' ').slice(0,42))+'</span></div><p class="stv10-description">Full container record with stored routing, terminal milestones, handling information, and calculated exposure.</p></div>'+
  '<div class="stv10-header-actions">'+
   '<button type="button" class="stv10-btn" data-stv10-action="map" data-idx="'+Number(idx)+'">↗ Show route</button>'+
   '<button type="button" class="stv10-btn" data-stv10-action="email" data-idx="'+Number(idx)+'">✉ Email</button>'+
   (!viewer?'<button type="button" class="stv10-btn primary" data-stv10-action="edit" data-idx="'+Number(idx)+'">✎ Edit shipment</button>':'')+
  '</div></header>'+
  routeCard+
  '<div class="stv10-page-grid"><div class="stv10-page-column">'+
   fieldPanel('Shipment references','Identifiers recorded for this container',identity)+
   fieldPanel('Routing & voyage','Sailing and transfer details',routing)+
   timelinePanel+
  '</div><div class="stv10-page-column">'+
   fieldPanel('Terminal & delivery','Ground handling and release details',handling)+
   fieldPanel('Financial & LFD','Calculated from current stored milestones',finances)+
   '<section class="stv10-panel"><div class="stv10-panel-heading"><h2>Remarks</h2><small>Stored shipment notes</small></div><div class="stv10-remark">'+text(show(remark))+'</div></section>'+
  '</div></div>'+
  '<footer class="stv10-page-footer"><small>Record index '+Number(idx)+' · Values shown from the current shipment record. Missing values are labelled, not inferred.</small><div class="stv10-header-actions">'+
   '<button type="button" class="stv10-btn" data-stv10-back>‹ Back to shipments</button>'+
   (!viewer?'<button type="button" class="stv10-btn" data-stv10-action="return" data-idx="'+Number(idx)+'">✓ Mark returned</button>':'')+
   (admin?'<button type="button" class="stv10-btn danger" data-stv10-action="delete" data-idx="'+Number(idx)+'">Delete record</button>':'')+
  '</div></footer>';
 page.scrollIntoView({block:'start',behavior:'auto'});
}
function pushHistory(page,idx){
 try{history.pushState({staffWorkspaceV10:true,page,index:idx??null},'',location.pathname+location.search+location.hash)}catch(_){}
}
function go(page,idx,addHistory=true){
 if(addHistory)pushHistory(page,idx);
 if(page==='overview')renderOverviewPage();
 else if(page==='shipments')renderShipmentsPage();
 else if(page==='detail')renderDetailPage(idx);
}
function backToShipments(){
 if(history.state&&history.state.staffWorkspaceV10&&history.state.page==='detail'){history.back();return}
 go('shipments',null,true);
}
function getClickedRecordIndex(target,tr){
 const explicit=target.closest('[data-stv10-detail],[data-st9-detail]');
 if(explicit&&explicit.dataset.stv10Detail!==undefined)return Number(explicit.dataset.stv10Detail);
 if(explicit&&explicit.dataset.st9Detail!==undefined)return Number(explicit.dataset.st9Detail);
 if(tr){
  const d=tr.dataset.row;if(d!==undefined&&Number.isInteger(Number(d)))return Number(d);
  const check=tr.querySelector('input.chk-item');if(check&&Number.isInteger(Number(check.value)))return Number(check.value);
 }
 const card=target.closest('.cards-layout .card-box,.kanban-layout .card-box');
 if(card){
  const d=card.dataset.idx??card.dataset.row;
  if(d!==undefined&&Number.isInteger(Number(d)))return Number(d);
  const check=card.querySelector('input.chk-item');if(check&&Number.isInteger(Number(check.value)))return Number(check.value);
 }
 return null;
}
function handleAction(action,idx){
 const i=Number(idx);
 if(!Number.isInteger(i))return;
 if(action==='edit'){go('shipments',null,true);setTimeout(()=>{if(typeof openModal==='function')openModal(i)},50)}
 else if(action==='map'){
  go('overview',null,true);
  setTimeout(()=>{try{if(typeof setView==='function')setView('cards');if(typeof showShipmentRoute==='function')showShipmentRoute(i);document.querySelector('.staff-map-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){console.warn('Unable to open shipment route',e)}},100);
 }
 else if(action==='email'){try{if(typeof openEmailModal==='function')openEmailModal(i)}catch(e){console.warn(e)}}
 else if(action==='return'){
  try{if(typeof markSingleReturned==='function')markSingleReturned(i);setTimeout(()=>{if(currentPage==='detail')renderDetailPage(i)},250)}catch(e){console.warn(e)}
 }
 else if(action==='delete'){
  try{if(typeof deleteRow==='function')deleteRow(i);setTimeout(()=>{if(currentPage==='detail')go('shipments',null,false)},250)}catch(e){console.warn(e)}
 }
}
function init(){
 const main=byId('opsDashboardView');
 if(!main)return;
 addPage();
 const navHandler=e=>{
  const nav=e.target.closest('#staffReferenceSidebar .staff-side-link[data-staff-nav]');
  if(!nav)return;
  const target=nav.getAttribute('data-staff-nav');
  if(!['dashboard','shipments','tracking'].includes(target))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(target==='dashboard')go('overview',null,true);
  else if(target==='shipments')go('shipments',null,true);
  else{
   go('shipments',null,true);
   setTimeout(()=>{const search=byId('search');search?.focus()},80);
  }
 };
 document.addEventListener('click',navHandler,true);
 const clickHandler=e=>{
  const back=e.target.closest('[data-stv10-back]');
  if(back){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();backToShipments();return}
  const action=e.target.closest('[data-stv10-action]');
  if(action){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();handleAction(action.dataset.stv10Action,action.dataset.idx);return}
  if(currentPage==='detail')return;
  const explicit=e.target.closest('[data-stv10-detail],[data-st9-detail]');
  const isContainerLabel=e.target.closest('.card-cntr-code');
  const tr=e.target.closest('#sheetTableBody tr');
  const card=e.target.closest('.cards-layout .card-box,.kanban-layout .card-box');
  if(!explicit&&!tr&&!card)return;
  if(!explicit&&!isContainerLabel&&e.target.closest('input,textarea,select,label,a,button'))return;
  const idx=getClickedRecordIndex(e.target,tr);
  if(idx===null||!Number.isInteger(idx)||idx<0||idx>=records().length)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  go('detail',idx,true);
 };
 document.addEventListener('click',clickHandler,true);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&currentPage==='detail'){e.preventDefault();backToShipments();return}
  if((e.key==='Enter'||e.key===' ')&&currentPage!=='detail'){
   const tr=e.target.closest('#sheetTableBody tr[tabindex="0"]');
   if(tr){e.preventDefault();const idx=Number(tr.dataset.row);if(Number.isInteger(idx))go('detail',idx,true)}
  }
 },true);
 window.addEventListener('popstate',e=>{
  const st=e.state;
  if(st&&st.staffWorkspaceV10)go(st.page||'overview',st.index,false);
  else go('overview',null,false);
 });
 const observer=new MutationObserver(()=>{
  const signedIn=window.getComputedStyle(main).display!=='none';
  if(signedIn&&!lastSignedIn){lastSignedIn=true;go('overview',null,false)}
  if(!signedIn&&lastSignedIn){lastSignedIn=false;currentPage='overview';currentDetailIndex=null;refreshModeClasses('');}
 });
 observer.observe(main,{attributes:true,attributeFilter:['style']});
 const signedIn=window.getComputedStyle(main).display!=='none';
 if(signedIn){lastSignedIn=true;go('overview',null,false)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v11.js; original order preserved ===== */
/* Keep Leaflet tile sizing aligned when the Control Tower map switches to its corrected layout. */
(function(){
 'use strict';
 function init(){
  const canvas=document.getElementById('staffMapCanvas');
  if(!canvas)return;
  let last='';
  const refresh=()=>{
   const r=canvas.getBoundingClientRect();
   const size=Math.round(r.width)+'x'+Math.round(r.height);
   if(!r.width||!r.height||size===last)return;
   last=size;
   try{
    if(typeof staffMapInstance!=='undefined'&&staffMapInstance&&typeof staffMapInstance.invalidateSize==='function'){
     staffMapInstance.invalidateSize({pan:false});
    }
   }catch(e){console.debug('Map resize deferred',e)}
  };
  if(typeof ResizeObserver!=='undefined'){
   const observer=new ResizeObserver(()=>refresh());
   observer.observe(canvas);
  }
  window.addEventListener('resize',refresh,{passive:true});
  const bodyObserver=new MutationObserver(()=>{if(document.body.classList.contains('staff-overview-page'))setTimeout(refresh,80)});
  bodyObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  setTimeout(refresh,120);
  setTimeout(refresh,450);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v12.js; original order preserved ===== */
/* Control Tower v12. Reorganizes existing live dashboard components into a new overview layout. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
function make(tag,cls,id){const n=document.createElement(tag);if(cls)n.className=cls;if(id)n.id=id;return n}
function init(){
 const main=byId('opsDashboardView');
 const overview=byId('enterpriseOverview');
 if(!main||!overview||byId('staffControlTowerV12'))return;
 const stats=overview.querySelector('.ect-overview-stats');
 const kpis=main.querySelector(':scope > .kpi-row');
 const exceptions=byId('staffExceptionQueue');
 const workspace=main.querySelector('.ect-workspace-grid');
 const map=main.querySelector('.staff-map-panel');
 const status=main.querySelector('.staff-status-panel');
 const recent=byId('ectRecentActivity')?.closest('.ect-rail-panel');
 const quickButton=main.querySelector('.ect-quick-action');
 const quickPanel=quickButton?.closest('.ect-rail-panel');
 const integrity=byId('dataQualityNotice');
 if(!kpis||!exceptions||!workspace||!map||!status||!recent||!quickPanel)return;

 const shell=make('section','st12-overview','staffControlTowerV12');
 shell.setAttribute('aria-label','Control Tower overview');

 const head=make('header','st12-page-head');
 const title=make('div','st12-title-block');
 title.innerHTML='<div class="st12-eyebrow"><span class="st12-eyebrow-dot"></span> GML OPERATIONS / CONTROL TOWER</div><h1 class="st12-page-title">Control Tower</h1><p class="st12-page-desc">Your operational overview: shipment milestones, exceptions, port activity and recent records.</p>';
 const right=make('div','st12-head-right');
 const metrics=make('div','st12-head-metrics','st12HeadMetrics');
 if(stats)metrics.appendChild(stats);
 const openShipments=make('button','st12-head-button primary','st12OpenShipments');
 openShipments.type='button';
 openShipments.innerHTML='View shipments <span aria-hidden="true">→</span>';
 right.append(metrics,openShipments);
 head.append(title,right);

 const kpiRegion=make('section','st12-kpi-region');
 const kpiLabel=make('div','st12-section-label');
 kpiLabel.innerHTML='<span>Operations snapshot</span><small>Calculated from currently loaded records</small>';
 const kpiHost=make('div','st12-kpi-host','st12KpiHost');
 kpiRegion.append(kpiLabel,kpiHost);
 kpiHost.appendChild(kpis);

 const content=make('div','st12-main-grid');
 const worklist=make('div','st12-worklist-slot','st12WorklistSlot');
 worklist.appendChild(exceptions);
 const side=make('aside','st12-side-stack','st12SideStack');
 const statusSlot=make('div','st12-status-slot','st12StatusSlot');statusSlot.appendChild(status);
 const recentSlot=make('div','st12-recent-slot','st12RecentSlot');recentSlot.appendChild(recent);
 side.append(statusSlot,recentSlot);
 const mapBlock=make('section','st12-map-block','st12MapBlock');
 mapBlock.appendChild(map);
 // Clean composition: map, exceptions, status, and recent activity share one responsive grid.
 content.append(mapBlock,worklist,statusSlot,recentSlot);
 side.remove();

 const actionsBlock=make('section','st12-action-block','st12ActionBlock');
 const actionsGrid=make('div','st12-action-grid','st12ActionGrid');
 const actionButtons=[...quickPanel.querySelectorAll('.ect-quick-action')];
 const railHeading=quickPanel.querySelector('.ect-rail-heading');
 if(railHeading)actionsBlock.appendChild(railHeading);
 actionButtons.forEach(btn=>actionsGrid.appendChild(btn));
 actionsBlock.appendChild(actionsGrid);

 const qualitySlot=make('div','st12-integrity-slot','st12IntegritySlot');
 if(integrity)qualitySlot.appendChild(integrity);

 shell.append(head,kpiRegion,content,actionsBlock,qualitySlot);
 main.insertBefore(shell,overview);

 // Keep existing nodes/IDs intact so the original data renderers and action listeners remain connected.
 overview.style.display='none';
 overview.setAttribute('aria-hidden','true');
 const add=()=>document.querySelector('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();
 openShipments.addEventListener('click',add);
 // Avoid leaving the old dashboard grid hosting empty wrappers at overview time; list/detail views reuse it.
 const navToggle=byId('staffSidebarToggle');
 if(navToggle){
  const refreshWidth=()=>{main.style.setProperty('--st12-sidebar-collapsed',document.body.classList.contains('staff-sidebar-collapsed')?'1':'0')};
  navToggle.addEventListener('click',()=>requestAnimationFrame(refreshWidth));
  refreshWidth();
 }
 // Moving the map changes its dimensions; invalidate Leaflet tile layout after the new grid is painted.
 const resizeMap=()=>{
  try{
   if(typeof staffMapInstance!=='undefined'&&staffMapInstance&&typeof staffMapInstance.invalidateSize==='function'){
    staffMapInstance.invalidateSize({pan:false});
   }
  }catch(_){}
 };
 if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(()=>resizeMap());
  observer.observe(mapBlock);
 }
 window.addEventListener('resize',()=>requestAnimationFrame(resizeMap),{passive:true});
 setTimeout(resizeMap,60);setTimeout(resizeMap,250);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v13.js; original order preserved ===== */
/* Control Tower v13 — remove old visual pattern, preserve existing live metrics/events. */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const byId=id=>document.getElementById(id);
let initialized=false;let waitingObserver=null;let attempts=0;
function updateStatusBar(content,bar,totalLabel,summary){
 const total=Number(byId('staffStatusTotal')?.textContent||0)||0;
 const active=Number(byId('staffStatusActive')?.textContent||0)||0;
 const done=Number(byId('staffStatusDone')?.textContent||0)||0;
 const port=Number(byId('staffStatusPort')?.textContent||0)||0;
 const denom=total||Math.max(1,active+done+port);
 const parts=[['active',active],['done',done],['port',port]];
 bar.innerHTML=parts.map(([cls,n])=>'<span class="st13-status-seg '+cls+'" style="width:'+Math.max(0,Math.min(100,n/denom*100))+'%" title="'+n+' shipments"></span>').join('');
 bar.setAttribute('aria-label',active+' in progress, '+done+' completed, '+port+' awaiting port in');
 totalLabel.textContent=String(total);
 summary.textContent='shipments in '+3+' operational states';
}
function init(){
 if(initialized)return;
 const shell=byId('staffControlTowerV12');
 if(!shell){if(attempts++<30)setTimeout(init,100);return}
 const body=document.body;
 if(!body.classList.contains('staff-overview-page')){
  if(!waitingObserver&&typeof MutationObserver!=='undefined'){
   waitingObserver=new MutationObserver(()=>{
    if(body.classList.contains('staff-overview-page')){waitingObserver.disconnect();waitingObserver=null;init()}
   });
   waitingObserver.observe(body,{attributes:true,attributeFilter:['class']});
  }
  return;
 }
 initialized=true;
 // Keep the live elements, but remove the Intelligence Hub call-to-action from the dashboard header.
 shell.querySelectorAll('.eu-launch,#euHubLaunch').forEach(el=>{el.setAttribute('aria-hidden','true');el.tabIndex=-1;el.style.setProperty('display','none','important')});
 // Remove duplicate snapshot label generated by the older stylesheet and rename the real section once.
 const label=shell.querySelector('.st12-section-label');
 if(label){
  const span=label.querySelector('span');if(span)span.textContent='Live workload';
  const small=label.querySelector('small');if(small)small.textContent='Counts from loaded shipment records';
 }
 // Make the heading more useful and unambiguously new.
 const pageTitle=shell.querySelector('.st12-page-title');if(pageTitle)pageTitle.textContent='Operations overview';
 const pageDesc=shell.querySelector('.st12-page-desc');if(pageDesc)pageDesc.textContent='A live workbench for shipment progress, exceptions and port operations.';
 // Reframe map caption without changing its IDs or handlers.
 const mapTitle=shell.querySelector('.staff-map-panel .staff-panel-heading strong');if(mapTitle)mapTitle.textContent='Port network';
 const mapSub=byId('staffMapSummary');if(mapSub)mapSub.textContent='Origin ports and India gateways mapped from loaded shipments';
 // Replace the old donut graphic with a live segmented bar while keeping the original counts/legend.
 const status= shell.querySelector('.staff-status-content');
 if(status&&!status.querySelector('.st13-status-bar')){
  const total= document.createElement('div');total.className='st13-status-total';
  const number=document.createElement('strong');number.textContent=byId('staffStatusTotal')?.textContent||'0';
  const summary=document.createElement('span');summary.textContent='shipments in 3 operational states';
  total.append(number,summary);
  const bar=document.createElement('div');bar.className='st13-status-bar';bar.setAttribute('role','img');
  bar.setAttribute('aria-label','Shipment status distribution');
  status.insertBefore(bar,status.querySelector('.staff-status-legend'));
  status.insertBefore(total,bar);
  const update=()=>updateStatusBar(status,bar,number,summary);
  update();
  const ids=['staffStatusTotal','staffStatusActive','staffStatusDone','staffStatusPort'];
  const observers=ids.map(id=>byId(id)).filter(Boolean);
  if(typeof MutationObserver!=='undefined'){
   const observer=new MutationObserver(update);
   observers.forEach(n=>observer.observe(n,{childList:true,characterData:true,subtree:true}));
  }
 }
 // Ensure map geometry is recalculated after its final position/layout is applied.
 const map=shell.querySelector('#staffMapCanvas');
 const redraw=()=>{try{if(typeof staffMapInstance!=='undefined'&&staffMapInstance&&typeof staffMapInstance.invalidateSize==='function')staffMapInstance.invalidateSize({pan:false})}catch(_){}};
 if(map&&typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(()=>redraw());ro.observe(map)}
 window.addEventListener('resize',()=>requestAnimationFrame(redraw),{passive:true});
 setTimeout(redraw,80);setTimeout(redraw,350);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
;
/* Clean layout bridge: keep the collapse button and content offset in sync. */
(function(){
 'use strict';
 function init(){
  const sidebar=document.getElementById('staffReferenceSidebar');
  const main=document.getElementById('opsDashboardView');
  if(!sidebar||!main)return;
  const sync=()=>{
   const collapsed=sidebar.classList.contains('collapsed');
   document.body.classList.toggle('staff-sidebar-collapsed',collapsed);
   main.style.setProperty('--gml-sidebar',collapsed?'68px':'244px');
  };
  const observer=new MutationObserver(sync);
  observer.observe(sidebar,{attributes:true,attributeFilter:['class']});
  document.getElementById('staffSidebarToggle')?.addEventListener('click',()=>requestAnimationFrame(sync));
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
