/* GML CUSTOMER TRACKING — intelligent customer-facing status engine
   Reads recorded milestones first, then schedule fields. It never treats an ETA
   as an arrival and never labels a shipment "departed" unless departure is recorded.
*/
(function(){
  const value = (r, names) => {
    if (typeof getField === 'function') return getField(r, names) || '';
    return '';
  };
  const clean = v => String(v || '').trim();
  const dateValue = (r, names) => clean(value(r, names));
  const parsed = s => typeof parseLocalDate === 'function' ? parseLocalDate(s) : null;
  const displayDate = s => typeof formatDate === 'function' ? (formatDate(s) || s) : s;
  const escv = s => typeof esc === 'function' ? esc(s) : String(s ?? '');
  const daysFromToday = s => {
    const d = parsed(s); if(!d) return null;
    const now = new Date(); now.setHours(0,0,0,0);
    return Math.round((d-now)/86400000);
  };
  const place = r => clean(value(r,["GATEWAY PORT","GATEWAY","POD","PORT OF DISCHARGE","DISCHARGE PORT"])) || clean(value(r,["POL","PORT OF LOADING"]));

  function intelligence(r){
    const etd = dateValue(r,["ETD"]);
    const atd = dateValue(r,["ATD","ACTUAL DEPARTURE","VESSEL DEPARTURE","DEPARTURE DATE"]);
    const eta = dateValue(r,["ETA"]);
    const ata = dateValue(r,["ATA","ACTUAL ARRIVAL","ARRIVAL DATE"]);
    const inward = dateValue(r,["INWARD DATE","INWARD"]);
    const portIn = dateValue(r,["PORT IN"]);
    const portOut = dateValue(r,["PORT OUT"]);
    const cfsIn = dateValue(r,["CFS IN"]);
    const destuff = dateValue(r,["DESTUFFING DATE","DESTUFF DATE"]);
    const empty = dateValue(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE"]);
    const vessel = clean(value(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
    const pol = clean(value(r,["POL","PORT OF LOADING"]));
    const pod = clean(value(r,["POD","PORT OF DISCHARGE","DISCHARGE PORT"])) || place(r);
    const cfs = clean(value(r,["CFS NAME","CFS"]));
    const today = new Date(); today.setHours(0,0,0,0);
    const etaDays = daysFromToday(eta);
    const etaPassed = etaDays !== null && etaDays < 0;
    const route = pol && pod ? `${pol} to ${pod}` : (pod || pol || 'the destination');

    let headline='Shipment in progress';
    let remark='Shipment details are available and the next operational milestone is pending confirmation.';
    let next='Next operational milestone pending';
    let currentDate='';
    let currentPlace=place(r);
    let stage='pending';

    if(empty){
      headline='Shipment movement completed';
      remark=`Empty container return was recorded on ${displayDate(empty)}. The shipment movement is completed.`;
      next='No further shipment milestone recorded'; currentDate=empty; stage='completed';
    } else if(destuff){
      headline='Cargo de-stuffing completed';
      remark=`Cargo was de-stuffed on ${displayDate(destuff)}${cfs ? ` at ${cfs}` : ''}. Empty container return is still pending.`;
      next='Empty container return'; currentDate=destuff; currentPlace=cfs || currentPlace; stage='destuffed';
    } else if(cfsIn){
      headline='Cargo received at CFS';
      remark=`Cargo entered ${cfs || 'the CFS'} on ${displayDate(cfsIn)}. De-stuffing is the next recorded operational step.`;
      next='De-stuffing'; currentDate=cfsIn; currentPlace=cfs || currentPlace; stage='cfs';
    } else if(portOut){
      headline='Container moved out of port';
      remark=`Port-out was recorded on ${displayDate(portOut)}. The container is awaiting CFS in-gate confirmation.`;
      next='CFS in-gate'; currentDate=portOut; stage='portout';
    } else if(portIn || ata){
      const d=portIn || ata;
      headline='Vessel arrival recorded';
      remark=`Vessel arrival at ${pod || currentPlace || 'destination port'} was recorded on ${displayDate(d)}. Port-out / onward movement is pending.`;
      next='Port-out / onward movement'; currentDate=d; currentPlace=pod || currentPlace; stage='arrived';
    } else if(inward){
      headline='Inward processing recorded';
      remark=`Inward processing was recorded on ${displayDate(inward)}. Vessel arrival at the destination port is still pending confirmation.`;
      next='Vessel arrival'; currentDate=inward; stage='inward';
    } else if(atd){
      headline='Shipment is in transit';
      remark=`Vessel ${vessel ? vessel+' ' : ''}departed ${pol ? `from ${pol} ` : ''}on ${displayDate(atd)} and the shipment is currently in transit${pod ? ` to ${pod}` : ''}.`;
      if(eta){
        if(etaPassed) remark += ` The planned arrival date of ${displayDate(eta)} has passed and arrival confirmation is still pending.`;
        else if(etaDays===0) remark += ` ETA is today (${displayDate(eta)}).`;
        else remark += ` ETA is ${displayDate(eta)}${etaDays!==null ? ` (${etaDays} day${etaDays===1?'':'s'} remaining)` : ''}.`;
      }
      next='Destination port arrival'; currentDate=atd; currentPlace=pol || currentPlace; stage='transit';
    } else if(etd){
      const d=parsed(etd);
      if(d && d < today){
        headline='Departure confirmation pending';
        remark=`The planned departure date was ${displayDate(etd)}, but an actual vessel departure has not been recorded yet. ETA information should be treated as schedule data until departure is confirmed.`;
        next='Actual vessel departure'; currentDate=etd; stage='departure-pending';
      } else {
        headline='Shipment scheduled for departure';
        remark=`The shipment is scheduled to depart ${pol ? `from ${pol} ` : ''}on ${displayDate(etd)}. Actual vessel departure has not yet been recorded.`;
        next='Vessel departure'; currentDate=etd; currentPlace=pol || currentPlace; stage='scheduled';
      }
    } else if(eta){
      headline='Arrival schedule available';
      remark=`An ETA of ${displayDate(eta)} is available${pod ? ` for ${pod}` : ''}, but no actual departure or arrival milestone has been recorded.`;
      next='Actual departure / movement update'; currentDate=eta; stage='eta-only';
    }

    return {headline,remark,next,currentDate,currentPlace,stage,eta,etaDays,vessel,pol,pod,cfs,etd,atd,ata,inward,portIn,portOut,cfsIn,destuff,empty,route};
  }

  window.gmlShipmentIntelligence = intelligence;

  window.generatePublicShipmentReportHtml = function(r){
    const v = names => value(r,names);
    const cntr=v(["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]);
    const mbl=v(["MBL NO","MBL","MASTER BL"]);
    const liner=v(["LINER","LINE","SHIPPING LINE"]);
    const vessel=v(["VESSEL & VOY","VESSEL","VESSEL NAME"]);
    const type=v(["TYPE","EQUIPMENT TYPE","CONTAINER TYPE","SIZE"]);
    const pol=v(["POL","PORT OF LOADING"]);
    const pod=v(["POD","PORT OF DISCHARGE","DISCHARGE PORT"]);
    const receipt=v(["PLACE OF RECEIPT","RECEIPT PLACE"]) || pol;
    const delivery=v(["PLACE OF DELIVERY","DELIVERY PLACE"]);
    const terminal=(typeof getGatewayPortInfo==='function' ? getGatewayPortInfo(r).name : '') || '';
    const i=intelligence(r);
    const fmt=s=>displayDate(s)||'—';
    const milestones=[
      ['DEPARTURE',i.atd||i.etd,'Actual',!!i.atd],
      ['INWARD',i.inward,'Actual',!!i.inward],
      ['PORT ARRIVAL',i.portIn||i.ata,'Actual',!!(i.portIn||i.ata)],
      ['PORT OUT',i.portOut,'Actual',!!i.portOut],
      ['CFS IN',i.cfsIn,'Actual',!!i.cfsIn],
      ['DE-STUFF',i.destuff,'Actual',!!i.destuff],
      ['EMPTY RETURN',i.empty,'Actual',!!i.empty]
    ];
    const complete=milestones.filter(x=>x[3]).length;
    const progress=Math.round(complete/milestones.length*100);
    const etaLabel=i.ata ? 'ARRIVAL ACTUAL' : 'ETA';
    const etaValue=i.ata || i.eta;
    const etaMeta=i.ata ? 'Actual arrival recorded' : (i.etaDays===null?'Schedule date':(i.etaDays<0?'Planned date passed':i.etaDays===0?'Due today':`${i.etaDays} days remaining`));
    const generated=new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<article class="customer-report-v4">
      <header class="cr4-head"><div class="cr4-brand"><b>GML</b><div><strong>GREENWICH MERIDIAN LOGISTICS</strong><span>SHIPMENT VISIBILITY</span></div></div><div class="cr4-ref"><span>CONTAINER</span><strong>${escv(cntr||'—')}</strong></div></header>
      <section class="cr4-hero"><div class="cr4-status-block"><span class="cr4-eyebrow">CURRENT SHIPMENT POSITION</span><h1>${escv(i.headline)}</h1><p>${escv(i.remark)}</p><div class="cr4-meta"><span>${escv(i.currentDate ? displayDate(i.currentDate) : 'Latest event date pending')}</span><span>${escv(i.currentPlace || 'Location not recorded')}</span></div></div><div class="cr4-time"><span>${etaLabel}</span><strong>${escv(fmt(etaValue))}</strong><small>${escv(etaMeta)}</small></div></section>
      <section class="cr4-strip"><div><span>ROUTE</span><b>${escv(receipt||'—')} → ${escv(pod||delivery||'Destination pending')}</b></div><div><span>VESSEL / VOYAGE</span><b>${escv(vessel||'—')}</b></div><div><span>LINE / MBL</span><b>${escv(liner||'—')} / ${escv(mbl||'—')}</b></div></section>
      <section class="cr4-route"><div class="cr4-section-title"><span>ROUTE</span><b>SHIPMENT PATH</b></div><div class="cr4-route-line"><div><i class="done"></i><small>ORIGIN</small><strong>${escv(receipt||pol||'—')}</strong></div><em></em><div><i class="${i.atd?'done':''}"></i><small>POL</small><strong>${escv(pol||'—')}</strong></div><em></em><div><i class="${i.portIn||i.ata?'done':''}"></i><small>POD</small><strong>${escv(pod||'Pending')}</strong></div><em></em><div><i class="${i.empty?'done':''}"></i><small>DELIVERY</small><strong>${escv(delivery||'Next stage')}</strong></div></div></section>
      <section class="cr4-timegrid"><div><span>ETA / ATA</span><strong>${escv(fmt(etaValue))}</strong><small>${escv(etaMeta)}</small></div><div><span>ETD</span><strong>${escv(fmt(i.atd||i.etd))}</strong><small>${i.atd?'Actual departure':'Planned departure'}</small></div><div><span>NEXT ACTION</span><strong>${escv(i.next)}</strong><small>Based on recorded milestones</small></div></section>
      <section class="cr4-timeline"><div class="cr4-section-title"><span>MILESTONES</span><b>ACTUAL OPERATIONAL HISTORY</b><small>${complete}/${milestones.length} recorded</small></div><div class="cr4-progress"><i style="width:${progress}%"></i></div><div class="cr4-milestones">${milestones.map((m,idx)=>`<div class="cr4-milestone ${m[3]?'complete':''}"><div class="cr4-dot">${m[3]?'✓':String(idx+1).padStart(2,'0')}</div><div><b>${escv(m[0])}</b><span>${escv(m[1]?fmt(m[1]):'Pending')}</span><small>${m[3]?'RECORDED':'AWAITING UPDATE'}</small></div></div>`).join('')}</div></section>
      <section class="cr4-register"><div class="cr4-section-title"><span>OPERATIONS</span><b>RECORDED DETAILS</b></div><div class="cr4-grid">${[['INWARD',i.inward],['PORT IN',i.portIn],['PORT OUT',i.portOut],['CFS IN',i.cfsIn],['DE-STUFF',i.destuff],['EMPTY RETURN',i.empty],['GATEWAY',terminal],['CFS',i.cfs]].map(x=>`<div><span>${escv(x[0])}</span><b>${escv(x[1]?fmt(x[1]):'—')}</b></div>`).join('')}</div></section>
      <footer class="cr4-foot"><span>Generated ${escv(generated)}</span><span>GML CUSTOMER TRACKING • RECORDED MILESTONES ONLY</span></footer>
    </article>`;
  };
})();
