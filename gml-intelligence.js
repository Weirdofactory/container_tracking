window.gmlShipmentIntelligence=function(r){
  const f=(names)=>{for(const n of names){const k=Object.keys(r||{}).find(k=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===n.toLowerCase().replace(/[^a-z0-9]/g,'')&&String(r[k]??'').trim());if(k)return String(r[k]).trim()}return''};
  const d=(v)=>{if(!v)return null;const x=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(x)?null:x};
  const fmt=(v)=>{const x=d(v);return x?x.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''};
  const today=new Date();today.setHours(0,0,0,0);
  const etd=f(['ETD']),atd=f(['ATD','ACTUAL DEPARTURE','VESSEL DEPARTURE','DEPARTURE DATE']),eta=f(['ETA']),ata=f(['ATA','ACTUAL ARRIVAL','ARRIVAL DATE']);
  const pin=f(['PORT IN']),pout=f(['PORT OUT']),cfs=f(['CFS IN']),dest=f(['DESTUFFING DATE','DESTUFF DATE']),empty=f(['CONTAINER RETURN DATE','EMPTY RETURN DATE']);
  const pol=f(['POL','PORT OF LOADING'])||'origin',pod=f(['POD','PORT OF DISCHARGE','DISCHARGE PORT'])||'destination',cf=f(['CFS NAME','CFS'])||'CFS';
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