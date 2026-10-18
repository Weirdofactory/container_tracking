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