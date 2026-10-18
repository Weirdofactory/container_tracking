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