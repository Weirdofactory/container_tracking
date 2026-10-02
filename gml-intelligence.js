window.gmlShipmentIntelligence=function(r){
  const f=(names)=>{for(const n of names){const k=Object.keys(r||{}).find(k=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===n.toLowerCase().replace(/[^a-z0-9]/g,'')&&String(r[k]??'').trim());if(k)return String(r[k]).trim()}return''};
  const d=(v)=>{if(!v)return null;const x=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(x)?null:x};
  const fmt=(v)=>{const x=d(v);return x?x.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''};
  const today=new Date();today.setHours(0,0,0,0);
  const etd=f(['ETD']),atd=f(['ATD','ACTUAL DEPARTURE','VESSEL DEPARTURE','DEPARTURE DATE']),eta=f(['ETA']),ata=f(['ATA','ACTUAL ARRIVAL','ARRIVAL DATE']);
  const pin=f(['PORT IN']),pout=f(['PORT OUT']),cfs=f(['CFS IN']),dest=f(['DESTUFFING DATE','DESTUFF DATE']),empty=f(['CONTAINER RETURN DATE','EMPTY RETURN DATE']);
  const pol=f(['POL','PORT OF LOADING'])||'Origin',pod=f(['POD','PORT OF DISCHARGE','DISCHARGE PORT'])||'Destination',cf=f(['CFS NAME','CFS'])||'CFS';
  let title='SHIPMENT IN PROGRESS',eventLabel='Shipment Processing',eventDate='',remark='Shipment is being processed. The next operational milestone is pending confirmation.',next='Next milestone',timeLabel='',place=cf;
  if(empty){title='EMPTY RETURN COMPLETED';eventLabel='Empty Container Returned';eventDate=fmt(empty);place=cf;remark='Empty container return has been recorded. The shipment movement is operationally completed.';next='Tracking completed';}
  else if(dest){title='DE-STUFF COMPLETED';eventLabel='De-stuffing Completed';eventDate=fmt(dest);place=cf;remark='Cargo de-stuffing has been completed. The empty container return is pending confirmation.';next='Empty container return';}
  else if(cfs){title='CARGO AT CFS';eventLabel='CFS In-Gate';eventDate=fmt(cfs);place=cf;remark='Cargo has been received at the CFS and is awaiting de-stuffing.';next='De-stuffing';}
  else if(pout){title='PORT OUT COMPLETED';eventLabel='Port Out';eventDate=fmt(pout);place=cf;remark='Container has moved out of the gateway port and is awaiting CFS in-gate confirmation.';next='CFS in-gate';}
  else if(pin){title='VESSEL ARRIVED AT GATEWAY';eventLabel='Port In';eventDate=fmt(pin);place=f(['GATEWAY PORT','GATEWAY'])||pod;remark='Port-in has been recorded. The container is awaiting the next gateway movement.';next='Port-out / CFS movement';}
  else if(ata){title='VESSEL ARRIVED';eventLabel='Actual Arrival';eventDate=fmt(ata);place=pod;remark=`Vessel arrival at ${pod} has been recorded. The shipment is awaiting the next port/CFS movement.`;next='Inward / discharge processing';}
  else if(atd||etd){
    title='IN TRANSIT';eventLabel=atd?'Actual Departure':'Planned Departure';eventDate=fmt(atd||etd);place=pol;
    const etaDate=d(eta);const late=etaDate&&etaDate<today;
    if(etaDate){const days=Math.round((etaDate-today)/86400000);if(late){timeLabel=`ETA ${fmt(eta)} • ${Math.abs(days)}d overdue`;remark=`Vessel has departed ${pol} and the planned arrival date has passed. Arrival confirmation at ${pod} is pending.`;}else if(days===0){timeLabel=`ETA ${fmt(eta)} • due today`;remark=`Vessel has departed ${pol} and is currently in transit to ${pod}. Planned arrival is due today.`;}else{timeLabel=`ETA ${fmt(eta)} • ${days}d remaining`;remark=`Vessel has departed ${pol} and the shipment is currently in transit to ${pod}.`;}next=late?'Arrival confirmation at POD':`Expected arrival ${fmt(eta)}`;}
    else {remark=`Vessel has departed ${pol} and the shipment is currently in transit to ${pod}. ETA is pending confirmation.`;next='ETA confirmation';}
  }
  else if(eta){
    title='ETA SCHEDULED';eventLabel='Estimated Arrival';eventDate=fmt(eta);place=pod;
    const etaDate=d(eta);const days=etaDate?Math.round((etaDate-today)/86400000):null;
    timeLabel=etaDate?(days===0?'ETA due today':days>0?`ETA ${fmt(eta)} • ${days}d remaining`:`ETA ${fmt(eta)} • ${Math.abs(days)}d overdue`):'';
    remark=`Shipment is scheduled toward ${pod}. Vessel departure from ${pol} is not yet confirmed.`;next='Vessel departure';
  }
  return {title,remark,next,eventLabel,eventDate,place,etaDays:eta&&d(eta)?Math.round((d(eta)-today)/86400000):null,timeLabel};
};

(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const field=(r,n)=>{for(const x of n){const k=Object.keys(r||{}).find(k=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===x.toLowerCase().replace(/[^a-z0-9]/g,'')&&String(r[k]??'').trim());if(k)return String(r[k]).trim()}return''};
  const date=v=>{if(!v)return '';const d=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(d)?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});};
  const short=v=>{if(!v)return 'Pending';const d=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(d)?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});};
  function rowFor(cntr){try{const a=JSON.parse(localStorage.getItem('containerRows')||'[]');return Array.isArray(a)?a.find(r=>norm(field(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO']))===norm(cntr)):null}catch(e){return null}}
  function escAttr(v){return esc(v).replace(/`/g,'&#96;')}

  function loadReferenceStyles(){
    if(document.querySelector('link[data-gml-reference-css]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.dataset.gmlReferenceCss='1';
    link.href='./customer-report-final.css?v=20261002-reference2';
    document.head.appendChild(link);
  }

  function buildReport(r){
    const cntr=field(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO'])||'—';
    const type=field(r,['TYPE','SIZE','CONTAINER TYPE'])||'—';
    const mbl=field(r,['MBL NO','MBL','MASTER BL'])||'—';
    const liner=field(r,['LINER','LINE','SHIPPING LINE'])||'—';
    const vessel=field(r,['VESSEL & VOY','VESSEL','VESSEL NAME'])||'—';
    const pol=field(r,['POL','PORT OF LOADING'])||'Origin';
    const pod=field(r,['POD','PORT OF DISCHARGE','DISCHARGE PORT'])||'Destination';
    const cfs=field(r,['CFS NAME','CFS'])||'—';
    const gw=field(r,['GATEWAY PORT','GATEWAY','PORT'])||'—';
    const etd=field(r,['ETD']),atd=field(r,['ATD','ACTUAL DEPARTURE','VESSEL DEPARTURE','DEPARTURE DATE']);
    const eta=field(r,['ETA']),ata=field(r,['ATA','ACTUAL ARRIVAL','ARRIVAL DATE']);
    const pin=field(r,['PORT IN']),pout=field(r,['PORT OUT']),cfsIn=field(r,['CFS IN']),dest=field(r,['DESTUFFING DATE','DESTUFF DATE']),empty=field(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']);
    const intel=window.gmlShipmentIntelligence(r);
    const late=intel.etaDays!==null&&intel.etaDays<0&&!ata&&!pin;
    const lateDays=late?Math.abs(intel.etaDays):0;
    const statusPill=late?`<span class="gml-ref-alert">● Arriving Late by ${lateDays} Day${lateDays===1?'':'s'}</span>`:`<span class="gml-ref-ok">● ${esc(intel.title)}</span>`;
    const route=`${esc(pol)} → ${esc(pod)}${gw&&gw!=='—'?` (via ${esc(gw)})`:''}`;
    const transitStart=atd||etd, transitEnd=ata||eta;
    let transit='—';
    if(transitStart&&transitEnd){const a=new Date(String(transitStart).slice(0,10)),b=new Date(String(transitEnd).slice(0,10));if(!isNaN(a)&&!isNaN(b)) transit=Math.max(0,Math.round((b-a)/86400000))+' days';}
    const timeline=[
      {label:'Origin',place:field(r,['PLACE OF RECEIPT','RECEIPT PLACE'])||pol,date:field(r,['PLACE OF RECEIPT DATE'])||etd,done:true},
      {label:'Port of Loading',place:pol,date:atd||etd,done:!!(atd||etd)},
      {label:'Vessel Departure',place:pol,date:atd||etd,done:!!(atd||etd)},
      {label:'Port of Discharge',place:pod,date:ata||pin||eta,done:!!(ata||pin)},
      {label:'CFS In-Gate',place:cfs,date:cfsIn,done:!!cfsIn},
      {label:'De-stuff',place:cfs,date:dest,done:!!dest},
      {label:'Empty Return',place:gw,date:empty,done:!!empty}
    ];
    const coords=(name)=>{const s=String(name||'').toUpperCase();if(s.includes('BUSAN'))return [36,76];if(s.includes('SHANGHAI'))return [42,72];if(s.includes('SHEKOU'))return [48,69];if(s.includes('SINGAPORE'))return [65,78];if(s.includes('CHENNAI')||s.includes('CCTL')||s.includes('CITPL'))return [72,86];return [70,82]};
    const a=coords(pol),b=coords(pod);const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
    const svg=`<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="gml-map-sea" d="M0 0H100V100H0Z"/><path class="gml-map-land" d="M0,7 C15,2 22,13 28,18 C34,22 31,32 39,35 C45,38 49,29 55,33 C61,37 58,47 67,51 C76,55 80,46 87,51 C93,55 91,68 100,72 V100 H0Z"/><path class="gml-map-route" d="M${a[0]} ${a[1]} Q ${mx-8} ${my-15} ${mx} ${my} T ${b[0]} ${b[1]}"/><circle class="gml-map-origin" cx="${a[0]}" cy="${a[1]}" r="1.8"/><circle class="gml-map-dest" cx="${b[0]}" cy="${b[1]}" r="2.2"/><circle class="gml-map-live" cx="${mx}" cy="${my}" r="2.4"/></svg>`;
    const steps=timeline.map((x,i)=>`<div class="gml-ref-event ${x.done?'done':''}"><div class="gml-ref-event-time">${x.date?esc(short(x.date)):'—'}</div><div class="gml-ref-event-line"><i>${x.done?'✓':i+1}</i></div><div class="gml-ref-event-copy"><strong>${esc(x.label)}</strong><span>${esc(x.place||'Pending')}</span>${x.date?`<small>${esc(date(x.date))}</small>`:'<small>Pending confirmation</small>'}</div></div>`).join('');
    const operational=[['IGM Split',field(r,['SPLIT DATE','SPLIT'])],['Inward',field(r,['INWARD DATE','INWARD'])],['Port In',pin],['Port Out',pout],['CFS In',cfsIn],['De-stuff',dest],['Empty Return',empty],['Gateway',gw]];
    return `<article class="customer-report-v3 gml-ref-report">
      <header class="gml-ref-header"><div class="gml-ref-brand"><span class="gml-ref-logo">GML</span><div><strong>GREENWICH MERIDIAN LOGISTICS</strong><small>CONTAINER TRACKING &amp; TRACE</small></div></div><div class="gml-ref-head-actions"><button type="button" onclick="window.print()">⇩ &nbsp;Download</button><button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href)">↗ &nbsp;Share</button><button type="button">文 &nbsp;English⌄</button></div></header>
      <section class="gml-ref-identity"><div class="gml-ref-back">←</div><div class="gml-ref-title"><div class="gml-ref-title-line"><h1>Container: ${esc(cntr)}</h1>${statusPill}</div><p>${route}</p></div></section>
      <section class="gml-ref-summary">
        <div class="gml-ref-card gml-ref-arrival"><span>Arrival at Destination</span><strong>${ata?date(ata):eta?'Predicted: '+date(eta):'Pending'}</strong><small>${ata?'Actual arrival recorded':eta?'Initial: '+date(eta):'No arrival schedule'} ${late?`<b>+${lateDays} day${lateDays===1?'':'s'}</b>`:''}</small></div>
        <div class="gml-ref-card"><span>Transit Time</span><strong>${transit}</strong><small>Contractual: ${transit}</small><a>View Details</a></div>
        <div class="gml-ref-card"><span>B/L Number</span><strong>${esc(mbl)}</strong><a>See Related Shipments</a></div>
        <div class="gml-ref-card"><span>Carrier &amp; Latest Vessel</span><strong>${esc(liner)} <em>(${esc(vessel)})</em></strong><a>See All Shipments on Vessel</a></div>
      </section>
      <nav class="gml-ref-tabs"><button class="active">Detailed Events</button><button>Custom Data</button><button>Contract Data</button><button>D&amp;D</button><button>Terminal Details</button><button>Conversations</button></nav>
      <section class="gml-ref-workspace">
        <div class="gml-ref-timeline"><div class="gml-ref-panel-title"><strong>Detailed Events</strong><span>${esc(intel.title)}</span></div><div class="gml-ref-events">${steps}</div><div class="gml-ref-intel"><label>Operational Intelligence</label><strong>${esc(intel.remark)}</strong><span>Next action: ${esc(intel.next)}${intel.timeLabel?' · '+esc(intel.timeLabel):''}</span></div></div>
        <div class="gml-ref-map-panel"><div class="gml-ref-map-head"><strong>Shipment Route</strong><span>${esc(vessel)}</span></div><div class="gml-ref-map">${svg}<div class="gml-map-label gml-map-pol" style="left:${a[0]}%;top:${a[1]}%">POL · ${esc(pol)}</div><div class="gml-map-label gml-map-pod" style="left:${b[0]}%;top:${b[1]}%">POD · ${esc(pod)}</div><div class="gml-map-live-label" style="left:${mx}%;top:${my}%">Current shipment</div><div class="gml-map-legend"><span><i class="origin"></i> Origin</span><span><i class="path"></i> Planned / Actual Path</span><span><i class="live"></i> Shipment Position</span></div></div><div class="gml-ref-map-foot"><span>From <b>${esc(pol)}</b></span><span>To <b>${esc(pod)}</b></span><button type="button" onclick="openRouteMap('${escAttr(pol)}','${escAttr(pod)}','${escAttr(vessel)}')">Open Route</button></div></div>
      </section>
      <section class="gml-ref-ledger"><div class="gml-ref-panel-title"><strong>Operational Details</strong><span>Milestone record</span></div><div class="gml-ref-ledger-grid">${operational.map(x=>`<div><small>${esc(x[0])}</small><strong>${esc(x[1]?date(x[1]):'Pending')}</strong></div>`).join('')}</div></section>
      <footer class="gml-ref-footer"><span>GREENWICH MERIDIAN LOGISTICS · CUSTOMER TRACKING</span><span>Generated ${new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span></footer>
    </article>`;
  }

  function render(){
    loadReferenceStyles();
    document.querySelectorAll('.customer-report-v3').forEach(report=>{
      if(report.classList.contains('gml-ref-ready'))return;
      const cntr=report.querySelector('.cr3-container strong')?.textContent?.trim();
      if(!cntr)return;
      const r=rowFor(cntr);if(!r)return;
      report.outerHTML=buildReport(r);
      const fresh=document.querySelector('.gml-ref-report:not(.gml-ref-ready)');if(fresh)fresh.classList.add('gml-ref-ready');
    });
  }
  const boot=()=>setTimeout(render,80);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  const target=document.getElementById('publicResultContainer');
  if(target)new MutationObserver(()=>setTimeout(render,70)).observe(target,{childList:true,subtree:true});
})();
