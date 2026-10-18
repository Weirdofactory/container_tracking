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