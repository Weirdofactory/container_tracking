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
 content.append(worklist,side);

 const mapBlock=make('section','st12-map-block','st12MapBlock');
 mapBlock.appendChild(map);

 const actionsBlock=make('section','st12-action-block','st12ActionBlock');
 const actionsGrid=make('div','st12-action-grid','st12ActionGrid');
 const actionButtons=[...quickPanel.querySelectorAll('.ect-quick-action')];
 const railHeading=quickPanel.querySelector('.ect-rail-heading');
 if(railHeading)actionsBlock.appendChild(railHeading);
 actionButtons.forEach(btn=>actionsGrid.appendChild(btn));
 actionsBlock.appendChild(actionsGrid);

 const qualitySlot=make('div','st12-integrity-slot','st12IntegritySlot');
 if(integrity)qualitySlot.appendChild(integrity);

 shell.append(head,kpiRegion,content,mapBlock,actionsBlock,qualitySlot);
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