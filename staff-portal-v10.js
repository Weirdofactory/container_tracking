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
  '<div class="stv10-route-state"><span class="stv10-route-label">Current milestone</span><strong class="stv10-route-value"><span class="st9-status '+statusCls+'">'+text(String(status.text||'Status not available').replace(/\s+/g,' ').slice(0,42))+'</span></strong><small class="stv10-route-meta">'+text('Based on recorded shipment milestones')+'</small></div>'+
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