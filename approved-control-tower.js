/* Approved Control Tower UI — composition only; reuses the existing live data and handlers. */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getValue(record,keys){try{if(typeof getField==='function'){const v=getField(record,keys);if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}}catch(_){}for(const k of keys){const v=record?.[k];if(v!==undefined&&v!==null&&String(v).trim()!==''&&String(v).trim()!=='—')return v}return ''}
function statusFor(record){try{if(typeof getStatus==='function'){const s=getStatus(record);return String(s?.text||'In transit').replace(/^\p{Extended_Pictographic}\s*/u,'')}}catch(_){}return getValue(record,['STATUS','CURRENT STATUS','STAGE'])||'In transit'}
function getRows(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function createHeader(){
 const tools=$('.header-tools');if(!tools||$('.approved-top-nav'))return;
 const nav=document.createElement('nav');nav.className='approved-top-nav';nav.setAttribute('aria-label','Main navigation');
 const items=[['dashboard','Control Tower'],['shipments','Shipments'],['tracking','Track & Trace'],['documents','Documents'],['reports','Reports']];
 items.forEach(([target,label],i)=>{const b=document.createElement('button');b.type='button';b.dataset.approvedNav=target;b.textContent=label;if(i===0)b.classList.add('active');nav.appendChild(b)});
 const search=document.createElement('label');search.className='approved-header-search';search.innerHTML='<span aria-hidden="true">⌕</span><input type="search" id="approvedGlobalSearch" placeholder="Search shipment, container, BL or port…" aria-label="Search shipment, container, bill of lading or port">';
 const newBtn=document.createElement('button');newBtn.type='button';newBtn.className='approved-new-shipment';newBtn.innerHTML='＋ New shipment';
 tools.insertBefore(nav,tools.firstChild);tools.insertBefore(search,nav.nextSibling);tools.appendChild(newBtn);
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-approved-nav]');if(!b)return;const target=b.dataset.approvedNav;nav.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));if(target==='dashboard')$('#staffReferenceSidebar [data-staff-nav="dashboard"]')?.click();else if(target==='shipments')$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();else if(target==='tracking')$('#staffReferenceSidebar [data-staff-nav="tracking"]')?.click();else if(target==='documents')$('#headerCsnBtn')?.click();else if(target==='reports')$('#openAnalyticsBtn')?.click()});
 search.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Enter'){const input=$('#search');if(input){input.value=e.currentTarget.value;input.dispatchEvent(new Event('input',{bubbles:true}))}}});
 newBtn.addEventListener('click',()=>$('#addBtn')?.click());
}
function buildShipmentPanel(shell){
 if($('.approved-live-shipments',shell))return;
 const panel=document.createElement('section');panel.className='approved-live-shipments';panel.setAttribute('aria-label','Live shipments');
 panel.innerHTML='<div class="approved-panel-head"><div><div class="approved-panel-title">Live shipments</div><div class="approved-panel-subtitle">Latest movements across your loaded shipment records</div></div><div class="approved-panel-actions"><button class="approved-filter-chip active" type="button" data-approved-filter="all">All shipments</button><button class="approved-filter-chip" type="button" data-approved-filter="risk">At risk</button><button class="approved-filter-chip" type="button" data-approved-filter="port">At port</button><button class="approved-filter-chip" type="button" data-approved-view-all>View all →</button></div></div><div class="approved-table-wrap"><table class="approved-shipment-table"><thead><tr><th>Shipment / Container</th><th>Route</th><th>Carrier / Vessel</th><th>ETA</th><th>Status</th></tr></thead><tbody class="approved-shipment-body"><tr><td colspan="5">Loading shipment records…</td></tr></tbody></table></div>';
 const grid=$('.st12-main-grid',shell);if(grid)grid.insertAdjacentElement('afterend',panel);else shell.appendChild(panel);
 const activity=document.createElement('section');activity.className='approved-activity-strip';activity.setAttribute('aria-label','Latest activity');activity.innerHTML='<div class="approved-activity-heading">Latest activity<small>Recent movements recorded in your workspace</small></div><div class="approved-activity-item"><strong>Shipment activity</strong><span>Activity appears as records are loaded</span></div><div class="approved-activity-item"><strong>Milestone updates</strong><span>Based on recorded shipment milestones</span></div><div class="approved-activity-item"><strong>Sync status</strong><span id="approvedSyncSummary">Waiting for workspace data</span></div>';
 panel.insertAdjacentElement('afterend',activity);
 panel.addEventListener('click',e=>{const filter=e.target.closest('[data-approved-filter]');if(filter){panel.querySelectorAll('[data-approved-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderShipments(panel,filter.dataset.approvedFilter);return}if(e.target.closest('[data-approved-view-all]'))$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();const link=e.target.closest('[data-approved-record]');if(link){const i=link.dataset.approvedRecord;const existing=$('#sheetTableBody tr[data-row="'+CSS.escape(i)+'"] [data-st9-detail]');if(existing)existing.click();else{$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();setTimeout(()=>$('#sheetTableBody tr[data-row="'+CSS.escape(i)+'"] [data-st9-detail]')?.click(),250)}}});
 renderShipments(panel,'all');
}
function renderShipments(panel,filter){
 const body=$('.approved-shipment-body',panel);if(!body)return;
 const all=getRows();let indexed=all.map((r,i)=>({r,i})).filter(({r})=>r&&typeof r==='object');
 if(filter==='risk')indexed=indexed.filter(({r})=>/risk|overdue|delay|hold|exception|pending/i.test(statusFor(r)+' '+getValue(r,['REMARKS','NOTES','STATUS'])));
 if(filter==='port')indexed=indexed.filter(({r})=>/port/i.test(statusFor(r)+' '+getValue(r,['GATEWAY PORT','POD','PORT IN'])));
 const shown=indexed.slice(0,5);
 if(!shown.length){body.innerHTML='<tr><td colspan="5">No shipment records are currently available in this view.</td></tr>';return}
 body.innerHTML=shown.map(({r,i})=>{const cn=getValue(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);const pol=getValue(r,['POL','PORT OF LOADING','ORIGIN']);const pod=getValue(r,['GATEWAY PORT','POD','PORT','DESTINATION']);const liner=getValue(r,['LINER','LINE','CARRIER']);const vessel=getValue(r,['VESSEL & VOY','VESSEL','VESSEL NAME']);const eta=getValue(r,['ETA']);const status=statusFor(r);const low=status.toLowerCase();const klass=/risk|overdue|delay|hold|exception/i.test(low)?'risk':/port|await/i.test(low)?'port':/done|return|complete|destuff/i.test(low)?'done':'';return '<tr><td><button type="button" class="approved-record-link" data-approved-record="'+i+'">'+escapeHTML(cn||'Shipment record')+'</button></td><td>'+escapeHTML(pol||'—')+' <span style="color:#90a1b5">→</span> '+escapeHTML(pod||'—')+'</td><td>'+escapeHTML(liner||'—')+(vessel?'<div style="font-size:9px;color:#8194a9;margin-top:3px">'+escapeHTML(vessel)+'</div>':'')+'</td><td>'+escapeHTML(eta||'—')+'</td><td><span class="approved-status-pill '+klass+'">'+escapeHTML(status)+'</span></td></tr>'}).join('');
 const sync=$('#approvedSyncSummary');if(sync)sync.textContent=all.length+' records loaded';
}
function init(){
 createHeader();
 const shell=$('#staffControlTowerV12');if(!shell)return;
 const grid=$('.st12-main-grid',shell),mapBlock=$('.st12-map-block',shell),worklist=$('.st12-worklist-slot',shell),status=$('.st12-status-slot',shell),recent=$('.st12-recent-slot',shell);
 if(grid&&mapBlock&&worklist&&status&&recent){
  const exceptions=$('#staffExceptionQueue',shell);
  grid.replaceChildren();
  grid.append(mapBlock,exceptions||worklist,status,recent);
  if(worklist&&worklist!==exceptions)worklist.remove();
  const side=$('.st12-side-stack',shell);if(side)side.remove();
 }
 buildShipmentPanel(shell);
 const globalSearch=$('#approvedGlobalSearch');
 if(globalSearch)globalSearch.addEventListener('input',()=>{const input=$('#search');if(input){input.value=globalSearch.value;input.dispatchEvent(new Event('input',{bubbles:true}))}});
 const updateNav=()=>{const isList=document.body.classList.contains('staff-shipment-list-page');const isDetail=document.body.classList.contains('staff-shipment-detail-page');const active=isList?'shipments':isDetail?'shipments':'dashboard';$$('.approved-top-nav [data-approved-nav]').forEach(b=>b.classList.toggle('active',b.dataset.approvedNav===active))};
 new MutationObserver(updateNav).observe(document.body,{attributes:true,attributeFilter:['class']});updateNav();
 if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>renderShipments($('.approved-live-shipments'),'all'));const source=$('#sheetTableBody');if(source)observer.observe(source,{childList:true,subtree:true,characterData:true})}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
