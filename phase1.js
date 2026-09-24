/* Phase 1 — Container Operations Control Tower
 * Container-level only. HBL/cargo workflows intentionally excluded.
 */
(function () {
  'use strict';

  const KEY = 'gml_phase1_config_v2';
  const DEFAULTS = {
    terminalFreeDays: 3,
    detentionFreeDays: 14,
    warningDays: 4,
    criticalDays: 2,
    demRate20: 100,
    demRate40: 225,
    detentionRate20: 75,
    detentionRate40: 150
  };

  const $ = id => document.getElementById(id);
  const escP = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getCn = r => getField(r, ['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO']) || '—';
  const getVessel = r => getField(r, ['VESSEL & VOY','VESSEL','VESSEL NAME']) || '—';
  const dateVal = key => key ? parseLocalDate(key) : null;
  const fmt = v => {
    if (!v) return '—';
    const d = parseLocalDate(v);
    return d ? d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : String(v);
  };
  const today = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); };
  const dayDiff = (a,b) => Math.floor((b-a)/86400000);

  function config() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { return Object.assign({}, DEFAULTS); }
  }
  function saveConfig(c) { localStorage.setItem(KEY, JSON.stringify(c)); }

  function lfd(r) {
    const c=config();
    const portIn=dateVal(getField(r,['PORT IN']));
    const portOut=dateVal(getField(r,['PORT OUT']));
    const returned=dateVal(getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']));
    const terminalDays=Number(c.terminalFreeDays||0);
    const detentionDays=Number(getField(r,['FREE DAYS'])||c.detentionFreeDays||0);

    // Two separate clocks:
    // 1) Port / inside-port LFD starts at Port In and ends when Port Out occurs.
    // 2) Outside-port / detention LFD starts at Port Out and ends when the empty is returned.
    const size=String(getField(r,['TYPE','SIZE'])||'').toUpperCase();
    const portRate=size.includes('20')?Number(c.demRate20):Number(c.demRate40);
    const outsideRate=size.includes('20')?Number(c.detentionRate20):Number(c.detentionRate40);

    let portLfd=null, portDaysLeft=null, portState='unknown', demDays=0, demCost=0;
    if(portIn){
      portLfd=new Date(portIn);
      portLfd.setDate(portLfd.getDate()+terminalDays);
      if(portOut){
        const dwell=Math.max(0,dayDiff(portIn,portOut));
        demDays=Math.max(0,dwell-terminalDays);
        demCost=demDays*rate;
        portState=demDays>0?'overdue':'complete';
        portDaysLeft=dayDiff(portOut,portLfd);
      }else{
        portDaysLeft=dayDiff(today(),portLfd);
        portState=portDaysLeft<0?'overdue':portDaysLeft<=Number(c.criticalDays)?'critical':portDaysLeft<=Number(c.warningDays)?'warning':'safe';
      }
    }

    let outsideLfd=null, outsideDaysLeft=null, outsideState='unknown', detentionDaysOver=0, detentionCost=0;
    if(portOut){
      outsideLfd=new Date(portOut);
      outsideLfd.setDate(outsideLfd.getDate()+detentionDays);
      if(returned){
        outsideDaysLeft=dayDiff(returned,outsideLfd);
        outsideState='complete';
      }else{
        const outsideDwell=Math.max(0,dayDiff(portOut,today()));
        detentionDaysOver=Math.max(0,outsideDwell-detentionDays);
        detentionCost=detentionDaysOver*outsideRate;
        outsideDaysLeft=dayDiff(today(),outsideLfd);
        outsideState=outsideDaysLeft<0?'overdue':outsideDaysLeft<=Number(c.criticalDays)?'critical':outsideDaysLeft<=Number(c.warningDays)?'warning':'safe';
      }
    }

    const activeState=returned?'complete':(!portOut?portState:outsideState);
    const activeDaysLeft=returned?null:(!portOut?portDaysLeft:outsideDaysLeft);
    const activeLfd=returned?null:(!portOut?portLfd:outsideLfd);
    const label=returned?'Completed':activeDaysLeft===null?'Not started':activeDaysLeft<0?Math.abs(activeDaysLeft)+'d overdue':activeDaysLeft+'d left';

    return {
      lfd:activeLfd, daysLeft:activeDaysLeft, state:activeState, label,
      portLfd, portDaysLeft, portState, outsideLfd, outsideDaysLeft, outsideState,
      demDays, cost:demCost, detentionDays, detentionDaysOver, detentionCost, returned:!!returned, portRate, outsideRate
    };
  }

  function csn(r) {
    const s=(getField(r,['CSN STATUS'])||'NOT FILED').trim().toUpperCase();
    if(s.includes('ACCEPT')) return {key:'ACCEPTED',label:'Accepted',cls:'good'};
    if(s.includes('REJECT')) return {key:'REJECTED',label:'Rejected',cls:'bad'};
    if(s.includes('WRONG')) return {key:'WRONG DETAILS',label:'Wrong Details',cls:'bad'};
    if(s.includes('AMEND')) return {key:'AMENDMENT',label:'Amendment',cls:'warn'};
    if(s.includes('PENDING')) return {key:'PENDING',label:'Pending',cls:'warn'};
    return {key:'NOT FILED',label:'Not Filed',cls:'bad'};
  }

  function exceptions(r) {
    const out=[];
    const c=csn(r);
    if(c.key==='NOT FILED'||c.key==='REJECTED'||c.key==='WRONG DETAILS') out.push({label:'CSN '+c.label,sev:'bad',key:'CSN'});
    else if(c.key==='PENDING'||c.key==='AMENDMENT') out.push({label:'CSN '+c.label,sev:'warn',key:'CSN'});
    const l=lfd(r);
    // A returned container has completed both LFD clocks; never raise an LFD exception for it.
    if(!l.returned){
      if(l.portState==='overdue' && l.demDays>0) out.push({label:'Port LFD / Demurrage '+l.demDays+'d',sev:'bad',key:'DEM'});
      else if(l.portState==='overdue') out.push({label:'Port LFD Expired',sev:'bad',key:'LFD_PORT'});
      else if(l.portState==='critical') out.push({label:l.portDaysLeft===0?'Port LFD Today':'Port LFD '+l.portDaysLeft+'d',sev:'bad',key:'LFD_PORT'});
      else if(l.portState==='warning') out.push({label:'Port LFD '+l.portDaysLeft+'d',sev:'warn',key:'LFD_PORT'});

      if(l.outsideState==='overdue') out.push({label:'Outside Port LFD / Detention Expired',sev:'bad',key:'LFD_OUTSIDE'});
      else if(l.outsideState==='critical') out.push({label:l.outsideDaysLeft===0?'Outside Port LFD Today':'Outside Port LFD '+l.outsideDaysLeft+'d',sev:'bad',key:'LFD_OUTSIDE'});
      else if(l.outsideState==='warning') out.push({label:'Outside Port LFD '+l.outsideDaysLeft+'d',sev:'warn',key:'LFD_OUTSIDE'});
    }
    const eta=dateVal(getField(r,['ETA']));
    const portIn=dateVal(getField(r,['PORT IN']));
    const cfs=dateVal(getField(r,['CFS IN']));
    const dest=dateVal(getField(r,['DESTUFFING DATE','DESTUFF DATE']));
    const ret=dateVal(getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']));
    if(eta && eta<=today() && !portIn) out.push({label:'Port In Pending',sev:'warn',key:'PORT'});
    if(portIn && !cfs) out.push({label:'CFS In Pending',sev:'warn',key:'CFS'});
    if(cfs && !dest) out.push({label:'Destuffing Pending',sev:'warn',key:'DESTUFF'});
    if(dest && !ret) out.push({label:'Empty Return Pending',sev:'warn',key:'RETURN'});
    return out;
  }

  function openVesselMaster() {
    ensureUI();
    let modal=$('vesselMasterModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='vesselMasterModal';
      modal.className='p1v2-modal';
      modal.innerHTML=`<div class="p1v2-box"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">VESSEL INTELLIGENCE</div><h2>🚢 Vessel Master</h2><p>Latest vessel / voyage terminal resolution history</p></div><button class="btn btn-ghost" id="vmClose">✕</button></div><div class="p1v2-modal-body"><div class="p1v2-toolbar"><input class="input" id="vmSearch" placeholder="Search vessel, voyage or terminal..."></div><div class="p1v2-table-wrap"><table class="p1v2-table"><thead><tr><th>Vessel</th><th>Voyage</th><th>Terminal</th><th>Source</th><th>Updated</th></tr></thead><tbody id="vmBody"></tbody></table></div></div></div>`;
      document.body.appendChild(modal);
      $('vmClose').onclick=()=>modal.classList.remove('open');
      $('vmSearch').oninput=renderVesselMaster;
    }
    function renderVesselMaster(){
      const q=String($('vmSearch')?.value||'').toUpperCase().trim();
      const data=(typeof getVesselMaster==='function'?getVesselMaster():[]).filter(x=>(String(x.vessel||'')+' '+String(x.voyage||'')+' '+String(x.terminal||'')).toUpperCase().includes(q)).sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
      $('vmBody').innerHTML=data.map(x=>`<tr><td><b>${escP(x.vessel||'—')}</b></td><td>${escP(x.voyage||'—')}</td><td><span class="p1v2-pill good">${escP(x.terminal||'—')}</span></td><td>${escP(x.source||'AUTO')}</td><td>${escP(x.updatedAt?new Date(x.updatedAt).toLocaleString('en-IN'):'—')}</td></tr>`).join('')||'<tr><td colspan="5" class="p1v2-empty">No vessel master records yet. Records appear when vessel terminal detection resolves.</td></tr>';
    }
    modal.classList.add('open');
    renderVesselMaster();
  }
  window.openVesselMaster=openVesselMaster;

  function injectStyles() {
    if($('p1v2Styles')) return;
    const s=document.createElement('style');
    s.id='p1v2Styles';
    s.textContent=`
      .p1v2{max-width:1500px;margin:0 auto;padding:20px 20px 50px;box-sizing:border-box}
      .p1v2-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:18px}
      .p1v2-eyebrow{font-size:9px;font-weight:900;letter-spacing:.16em;color:var(--primary);text-transform:uppercase}
      .p1v2-head h1{margin:5px 0 3px;font-size:28px;letter-spacing:-.03em}
      .p1v2-head p{margin:0;color:var(--text-muted);font-size:12px}
      .p1v2-actions{display:flex;gap:7px;flex-wrap:wrap}
      .p1v2-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
      .p1v2-kpi{background:var(--bg-surface);border:1px solid var(--border);border-radius:13px;padding:14px;box-shadow:var(--shadow-sm)}
      .p1v2-kpi small{font-size:9px;text-transform:uppercase;font-weight:900;color:var(--text-muted)}
      .p1v2-kpi strong{display:block;font-size:26px;margin-top:5px}
      .p1v2-kpi.bad{border-top:3px solid var(--danger)}.p1v2-kpi.warn{border-top:3px solid var(--warning)}.p1v2-kpi.good{border-top:3px solid var(--success)}
      .p1v2-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-bottom:12px}
      .p1v2-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:13px;padding:15px;box-shadow:var(--shadow-sm)}
      .p1v2-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;font-weight:900}
      .p1v2-list{display:flex;flex-direction:column}
      .p1v2-row{display:flex;justify-content:space-between;align-items:center;padding:9px 2px;border-bottom:1px solid var(--border);font-size:11px}
      .p1v2-row:last-child{border-bottom:0}
      .p1v2-count{font-family:'JetBrains Mono';font-weight:900}
      .p1v2-table-wrap{overflow:auto}
      .p1v2-table{width:100%;border-collapse:collapse;min-width:980px;font-size:11px}
      .p1v2-table th{text-align:left;padding:9px 8px;color:var(--text-muted);font-size:9px;text-transform:uppercase;border-bottom:1px solid var(--border)}
      .p1v2-table td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
      .p1v2-link{border:0;background:none;color:var(--accent);font-family:'JetBrains Mono';font-weight:900;cursor:pointer;padding:0}
      .p1v2-pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:900}
      .p1v2-pill.good{color:var(--success);background:var(--success-bg)}.p1v2-pill.warn{color:#b45309;background:var(--warning-bg)}.p1v2-pill.bad{color:var(--danger);background:var(--danger-bg)}
      .p1v2-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.62);backdrop-filter:blur(5px);z-index:12000;box-sizing:border-box}
      .p1v2-modal.open{display:flex!important}
      .p1v2-box{width:min(980px,97vw);max-height:90vh;overflow:auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow-lg)}
      .p1v2-box.small{width:min(540px,97vw)}
      .p1v2-modal-head{padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;background:var(--bg-elevated)}
      .p1v2-modal-head h2{margin:4px 0 0;font-size:18px}.p1v2-modal-body{padding:18px}
      .p1v2-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px}
      .p1v2-csn-card{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg-muted)}
      .p1v2-csn-card small{font-size:8px;font-weight:900;color:var(--text-muted);display:block}.p1v2-csn-card b{display:block;font-size:19px;margin-top:3px}
      .p1v2-toolbar{display:flex;gap:8px;margin-bottom:10px}.p1v2-toolbar .input{flex:1}.p1v2-toolbar select{width:210px}
      .p1v2-form{display:grid;grid-template-columns:1fr 1fr;gap:11px}.p1v2-form label{font-size:9px;font-weight:900;color:var(--text-muted);text-transform:uppercase}.p1v2-form input,.p1v2-form select,.p1v2-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid var(--border);background:var(--bg-muted);color:var(--text-main);border-radius:8px;padding:9px;font:inherit}.p1v2-form textarea{min-height:90px;resize:vertical}.p1v2-form .full{grid-column:1/-1}
      .p1v2-foot{padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;background:var(--bg-elevated)}
      .p1v2-timeline{padding:8px 10px 8px 28px;position:relative}.p1v2-timeline:before{content:'';position:absolute;left:14px;top:10px;bottom:10px;width:2px;background:var(--border)}
      .p1v2-event{position:relative;padding:10px 0}.p1v2-dot{position:absolute;left:-21px;top:11px;width:14px;height:14px;border-radius:50%;background:var(--bg-surface);border:2px solid var(--border)}.p1v2-event.done .p1v2-dot{background:var(--success);border-color:var(--success)}
      .p1v2-event b{font-size:11px}.p1v2-event small{display:block;color:var(--text-muted);margin-top:2px;font-size:10px}
      .p1v2-empty{padding:20px;text-align:center;color:var(--text-muted);font-size:11px}
      .public-result-card .p1v2-public-shell{padding:0}
      .p1v2-public-hero{padding:26px;background:linear-gradient(135deg,var(--bg-surface),var(--bg-elevated));border-bottom:1px solid var(--border)}
      .p1v2-public-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 26px}.p1v2-public-stat{padding:14px;border-radius:13px;border:1px solid var(--border);background:var(--bg-elevated)}.p1v2-public-stat small{display:block;font-size:8px;text-transform:uppercase;font-weight:900;color:var(--text-dim)}.p1v2-public-stat b{display:block;margin-top:5px;font-size:12px}
      @media(max-width:1000px){.p1v2-kpis{grid-template-columns:repeat(3,1fr)}.p1v2-grid{grid-template-columns:1fr}.p1v2-cards{grid-template-columns:repeat(3,1fr)}.p1v2-public-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:600px){.p1v2-kpis{grid-template-columns:repeat(2,1fr)}.p1v2-cards{grid-template-columns:repeat(2,1fr)}.p1v2-public-grid{grid-template-columns:1fr}.p1v2-head{align-items:flex-start;flex-direction:column}.p1v2-toolbar{flex-direction:column}.p1v2-toolbar select{width:100%}.p1v2-form{grid-template-columns:1fr}.p1v2-form .full{grid-column:auto}}
    `;
    document.head.appendChild(s);
  }

  function ensureUI() {
    injectStyles();
    if(!$('p1v2Tower')) {
      const section=document.createElement('section');
      section.id='p1v2Tower'; section.className='p1v2'; section.style.display='none';
      section.innerHTML=`
        <div class="p1v2-head">
          <div><div class="p1v2-eyebrow">STAFF OPERATIONS</div><h1>🎯 Container Control Tower</h1><p>Operational exceptions, deadlines and container actions. Compliance is managed separately in the CSN Centre.</p></div>
          <div class="p1v2-actions"><button class="btn" id="p1v2Back">← Container Tracking</button><button class="btn btn-primary" id="p1v2Csn">📑 CSN Centre</button><button class="btn btn-ghost" id="p1v2Lfd">⏱️ LFD Rules</button><button class="btn btn-ghost" id="p1v2Refresh">↻ Refresh</button><button class="btn btn-ghost" id="p1v2VesselMaster">🚢 Vessel Master</button></div>
        </div>
        <div class="p1v2-kpis" id="p1v2Kpis"></div>
        <div class="p1v2-grid">
          <div class="p1v2-card"><div class="p1v2-title"><span>🚨 Operational Exceptions</span><span style="font-size:9px;color:var(--text-muted)">CSN excluded from this list</span></div><div class="p1v2-list" id="p1v2Exceptions"></div></div>
          <div class="p1v2-card"><div class="p1v2-title"><span>📦 Movement Pipeline</span><span style="font-size:9px;color:var(--text-muted)">Container milestones</span></div><div class="p1v2-list" id="p1v2Pipeline"></div></div>
        </div>
        <div class="p1v2-card"><div class="p1v2-title"><span>⚠️ Containers Requiring Action</span><button class="btn btn-ghost" id="p1v2All">Show All</button></div><div class="p1v2-table-wrap"><table class="p1v2-table"><thead><tr><th>Container</th><th>Vessel</th><th>Status</th><th>Port LFD</th><th>Outside Port LFD</th><th>Demurrage</th><th>Next Action</th><th>Actions</th></tr></thead><tbody id="p1v2Body"></tbody></table></div></div>`;
      $('opsDashboardView').parentNode.insertBefore(section,$('opsDashboardView').nextSibling);
    }
    if(!$('p1v2Timeline')) {
      document.body.insertAdjacentHTML('beforeend',`<div class="p1v2-modal" id="p1v2Timeline"><div class="p1v2-box small"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">CONTAINER TIMELINE</div><h2 id="p1v2TimelineTitle">Container</h2></div><button class="btn btn-ghost" id="p1v2TimelineX">✕</button></div><div class="p1v2-modal-body" id="p1v2TimelineBody"></div></div></div>`);
    }
    if(!$('p1v2CsnModal')) {
      document.body.insertAdjacentHTML('beforeend',`<div class="p1v2-modal" id="p1v2CsnModal"><div class="p1v2-box"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">COMPLIANCE CENTRE</div><h2>SCMTR / CSN Control</h2><p class="p1v2-subtitle">Dedicated filing control — separate from the operational Control Tower.</p></div><button class="btn btn-ghost" id="p1v2CsnX">✕</button></div><div class="p1v2-modal-body" id="p1v2CsnBody"></div></div></div>`);
    }
    if(!$('p1v2CsnEdit')) {
      document.body.insertAdjacentHTML('beforeend',`<div class="p1v2-modal" id="p1v2CsnEdit"><div class="p1v2-box small"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">CSN RECORD</div><h2 id="p1v2CsnEditTitle">Container</h2></div><button class="btn btn-ghost" id="p1v2CsnEditX">✕</button></div><div class="p1v2-modal-body"><div class="p1v2-form"><label>Status<select id="p1v2CsnStatus"><option>NOT FILED</option><option>PENDING</option><option>ACCEPTED</option><option>REJECTED</option><option>WRONG DETAILS</option><option>AMENDMENT</option></select></label><label>Filed Date<input type="date" id="p1v2CsnFiled"></label><label>Response Date<input type="date" id="p1v2CsnResponse"></label><label class="full">Remarks<textarea id="p1v2CsnRemarks"></textarea></label></div></div><div class="p1v2-foot"><button class="btn" id="p1v2CsnCancel">Cancel</button><button class="btn btn-primary" id="p1v2CsnSave">Save CSN</button></div></div></div>`);
    }
    if(!$('p1v2LfdModal')) {
      document.body.insertAdjacentHTML('beforeend',`<div class="p1v2-modal" id="p1v2LfdModal"><div class="p1v2-box small"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">LFD ENGINE</div><h2>Port & Outside-Port Rules</h2></div><button class="btn btn-ghost" id="p1v2LfdX">✕</button></div><div class="p1v2-modal-body"><div class="p1v2-form"><label>Port / Terminal Free Days<input type="number" id="p1v2Free" min="0"></label><label>Outside Port / Detention Free Days<input type="number" id="p1v2DetFree" min="0"></label><label>Warning Threshold<input type="number" id="p1v2Warn" min="0"></label><label>Critical Threshold<input type="number" id="p1v2Crit" min="0"></label><label>Inside-Port / 20ft Demurrage / Day (USD)<input type="number" id="p1v2R20" min="0"></label><label>Inside-Port / 40ft Demurrage / Day (USD)<input type="number" id="p1v2R40" min="0"></label><label>Outside-Port / 20ft Detention / Day (USD)<input type="number" id="p1v2DR20" min="0"></label><label>Outside-Port / 40ft Detention / Day (USD)<input type="number" id="p1v2DR40" min="0"></label></div></div><div class="p1v2-foot"><button class="btn" id="p1v2LfdCancel">Cancel</button><button class="btn btn-primary" id="p1v2LfdSave">Save Rules</button></div></div></div>`);
    }
    if(!$('p1v2TowerBtn')) {
      const b=document.createElement('button'); b.id='p1v2TowerBtn'; b.className='btn btn-primary'; b.textContent='🎯 Control Tower'; b.onclick=()=>showTower(true);
      $('opsControls').insertBefore(b,$('opsControls').firstChild);
    }
  }

  function showTower(show) {
    ensureUI();
    const tower=$('p1v2Tower'), main=$('opsDashboardView');
    if(!tower || !main) return;
    tower.style.display=show?'block':'none';
    main.style.display=show?'none':'block';
    if(show){ renderTower(); window.scrollTo({top:0,behavior:'smooth'}); }
    else if(typeof renderUI==='function') renderUI();
  }

  window.openControlTower = () => showTower(true);
  window.openScmtrCentre = () => {
    ensureUI();
    renderCsn();
    $('p1v2CsnModal')?.classList.add('open');
  };
  window.openLfdRules = () => {
    ensureUI();
    openLfd();
  };

  function renderTower() {
    ensureUI();
    const all=rows||[];
    const operational=all.map((r,i)=>({r,i,ex:exceptions(r).filter(x=>x.key!=='CSN')}));
    const actionRows=operational.filter(x=>x.ex.length);
    const lfdCritical=all.filter(r=>['critical','overdue'].includes(lfd(r).state)).length;
    const dem=all.filter(r=>lfd(r).demDays>0).length;
    const cfs=all.filter(r=>getField(r,['PORT IN'])&&!getField(r,['CFS IN'])).length;
    const dest=all.filter(r=>getField(r,['CFS IN'])&&!getField(r,['DESTUFFING DATE','DESTUFF DATE'])).length;
    const ret=all.filter(r=>getField(r,['DESTUFFING DATE','DESTUFF DATE'])&&!getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE'])).length;
    const active=all.filter(r=>!isFullyCompleted(r)).length;
    $('p1v2Kpis').innerHTML=[
      ['Active Containers',active,'good'],['Operational Exceptions',actionRows.length,'bad'],['LFD Critical',lfdCritical,'bad'],['Demurrage',dem,'bad'],['CFS Pending',cfs,'warn']
    ].map(x=>`<div class="p1v2-kpi ${x[2]}"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('');
    const grouped={};
    actionRows.forEach(x=>x.ex.forEach(e=>grouped[e.label]=(grouped[e.label]||0)+1));
    $('p1v2Exceptions').innerHTML=Object.entries(grouped).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="p1v2-row"><span>${escP(k)}</span><b class="p1v2-count">${v}</b></div>`).join('')||'<div class="p1v2-empty">🟢 No operational exceptions.</div>';
    const pipeline=[
      ['Port In Pending',all.filter(r=>!getField(r,['PORT IN'])&&dateVal(getField(r,['ETA']))).length],
      ['CFS In Pending',cfs],['Destuffing Pending',dest],['Empty Return Pending',ret],['Completed / Returned',all.filter(isFullyCompleted).length]
    ];
    $('p1v2Pipeline').innerHTML=pipeline.map(([k,v])=>`<div class="p1v2-row"><span>${k}</span><b class="p1v2-count">${v}</b></div>`).join('');
    const display=actionRows.length?actionRows:all.map((r,i)=>({r,i,ex:[]}));
    $('p1v2Body').innerHTML=display.map(({r,i,ex})=>{
      const l=lfd(r), st=getStatus(r);
      const next=ex[0]?.label||'Monitor';
      const lfdText=l.lfd?fmt(l.lfd.toISOString().slice(0,10)):'—';
      const lfdClass=l.state==='safe'?'good':l.state==='warning'?'warn':'bad';
      return `<tr><td><button class="p1v2-link" data-timeline="${i}">${escP(getCn(r))}</button></td><td>${escP(getVessel(r))}</td><td>${escP(st.text)}</td><td><span class="p1v2-pill ${lfdClass}">${lfdText}${l.daysLeft!==null?' · '+escP(l.label):''}</span></td><td>${l.demDays?'<span class="p1v2-pill bad">'+l.demDays+'d · $'+Math.round(l.cost)+'</span>':'—'}</td><td>${escP(next)}</td><td><button class="btn btn-primary" data-edit="${i}">✏️ Edit</button> <button class="btn btn-ghost" data-time="${i}">Timeline</button></td></tr>`;
    }).join('')||'<tr><td colspan="7" class="p1v2-empty">No containers available.</td></tr>';
    $('p1v2Body').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{if(currentUser?.role==='Viewer')return alert('Read-only access.');openModal(Number(b.dataset.edit));});
    $('p1v2Body').querySelectorAll('[data-timeline],[data-time]').forEach(b=>b.onclick=()=>openTimeline(Number(b.dataset.timeline||b.dataset.time)));
  }

  function renderCsn() {
    const all=rows||[];
    const counts={ 'NOT FILED':0,PENDING:0,ACCEPTED:0,REJECTED:0,'WRONG DETAILS':0,AMENDMENT:0 };
    all.forEach(r=>{const k=csn(r).key;counts[k]=(counts[k]||0)+1;});
    const q=($('p1v2CsnSearch')?.value||'').toLowerCase().trim();
    const f=$('p1v2CsnFilter')?.value||'';
    const list=all.map((r,i)=>({r,i})).filter(({r})=>{const qv=(getCn(r)+' '+getVessel(r)).toLowerCase();return(!q||qv.includes(q))&&(!f||csn(r).key===f);});
    const cards=Object.entries(counts).map(([k,v])=>`<div class="p1v2-csn-card"><small>${k}</small><b>${v}</b></div>`).join('');
    $('p1v2CsnBody').innerHTML=`<div class="p1v2-cards">${cards}</div><div class="p1v2-toolbar"><input id="p1v2CsnSearch" class="input" placeholder="Search container or vessel..." value="${escP(q)}"><select id="p1v2CsnFilter"><option value="">All CSN Status</option>${Object.keys(counts).map(k=>`<option value="${escP(k)}" ${f===k?'selected':''}>${escP(k)}</option>`).join('')}</select></div><div class="p1v2-table-wrap"><table class="p1v2-table"><thead><tr><th>Container</th><th>Vessel / Voyage</th><th>CSN Status</th><th>Filed</th><th>Response</th><th>Remarks</th><th>Action</th></tr></thead><tbody>${list.map(({r,i})=>{const c=csn(r);return `<tr><td><b>${escP(getCn(r))}</b></td><td>${escP(getVessel(r))}</td><td><span class="p1v2-pill ${c.cls}">${escP(c.label)}</span></td><td>${escP(fmt(getField(r,['CSN FILED DATE'])))}</td><td>${escP(fmt(getField(r,['CSN RESPONSE DATE'])))}</td><td>${escP(getField(r,['CSN REMARKS'])||'—')}</td><td><button class="btn btn-primary" data-csn-edit="${i}">✏️ Edit CSN</button></td></tr>`}).join('')||'<tr><td colspan="7" class="p1v2-empty">No matching records.</td></tr>'}</tbody></table></div>`;
    $('p1v2CsnSearch').oninput=renderCsn;$('p1v2CsnFilter').onchange=renderCsn;
    $('p1v2CsnBody').querySelectorAll('[data-csn-edit]').forEach(b=>b.onclick=()=>openCsnEdit(Number(b.dataset.csnEdit)));
  }

  let csnIdx=-1;
  function openCsnEdit(i){
    const r=rows[i];if(!r)return;csnIdx=i;
    $('p1v2CsnEditTitle').textContent=getCn(r)+' · CSN';
    $('p1v2CsnStatus').value=csn(r).key;
    $('p1v2CsnFiled').value=getField(r,['CSN FILED DATE']);
    $('p1v2CsnResponse').value=getField(r,['CSN RESPONSE DATE']);
    $('p1v2CsnRemarks').value=getField(r,['CSN REMARKS']);
    $('p1v2CsnEdit').classList.add('open');
  }
  function saveCsn(){
    if(csnIdx<0)return;
    if(currentUser?.role==='Viewer')return alert('Read-only access.');
    const r=rows[csnIdx];
    const fields=[['CSN STATUS',$('p1v2CsnStatus').value],['CSN FILED DATE',$('p1v2CsnFiled').value],['CSN RESPONSE DATE',$('p1v2CsnResponse').value],['CSN REMARKS',$('p1v2CsnRemarks').value.trim()]];
    fields.forEach(([k,v])=>{const old=r[k]||'';r[k]=v;if(old!==v&&typeof logAuditEvent==='function')logAuditEvent('CSN_UPDATE',getCn(r),k,old,v);});
    if(typeof saveAndRefresh==='function')saveAndRefresh();else localStorage.setItem('containerRows',JSON.stringify(rows));
    $('p1v2CsnEdit').classList.remove('open');renderCsn();renderTower();
    if(typeof toast==='function')toast('CSN record updated');
  }

  function openTimeline(i){
    const r=rows[i];if(!r)return;
    $('p1v2TimelineTitle').textContent=getCn(r);
    const events=[['Vessel Departed','ETD'],['Vessel Arrived','ETA'],['Port In','PORT IN'],['Port Out','PORT OUT'],['CFS In','CFS IN'],['Destuffing','DESTUFFING DATE'],['Empty Return','CONTAINER RETURN DATE']];
    $('p1v2TimelineBody').innerHTML=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px"><span class="p1v2-pill good">${escP(getVessel(r))}</span><span class="p1v2-pill">${escP(getField(r,['GATEWAY PORT'])||'—')}</span><span class="p1v2-pill">${escP(getField(r,['CFS NAME'])||'—')}</span></div><div class="p1v2-timeline">${events.map(([label,key])=>{const v=getField(r,[key]);return `<div class="p1v2-event ${v?'done':''}"><span class="p1v2-dot"></span><b>${label}</b><small>${v?fmt(v):'Pending'}</small></div>`}).join('')}</div><div class="p1v2-foot" style="margin:18px -18px -18px"><button class="btn btn-primary" id="p1v2TimelineEdit">✏️ Edit Container</button></div>`;
    $('p1v2TimelineEdit').onclick=()=>{ $('p1v2Timeline').classList.remove('open'); if(currentUser?.role!=='Viewer')openModal(i); };
    $('p1v2Timeline').classList.add('open');
  }

  function openLfd(){
    const c=config();
    $('p1v2Free').value=c.terminalFreeDays;$('p1v2DetFree').value=c.detentionFreeDays;$('p1v2Warn').value=c.warningDays;$('p1v2Crit').value=c.criticalDays;$('p1v2R20').value=c.demRate20;$('p1v2R40').value=c.demRate40;$('p1v2DR20').value=c.detentionRate20;$('p1v2DR40').value=c.detentionRate40;
    $('p1v2LfdModal').classList.add('open');
  }
  function saveLfd(){
    saveConfig({terminalFreeDays:Number($('p1v2Free').value||0),detentionFreeDays:Number($('p1v2DetFree').value||0),warningDays:Number($('p1v2Warn').value||0),criticalDays:Number($('p1v2Crit').value||0),demRate20:Number($('p1v2R20').value||0),demRate40:Number($('p1v2R40').value||0),detentionRate20:Number($('p1v2DR20').value||0),detentionRate40:Number($('p1v2DR40').value||0)});
    $('p1v2LfdModal').classList.remove('open');renderTower();if(typeof renderUI==='function')renderUI();if(typeof toast==='function')toast('LFD rules saved');
  }

  function bind(){
    ensureUI();
    if($('p1v2TowerBtn')) $('p1v2TowerBtn').onclick=window.openControlTower;
    if($('headerCsnBtn')) $('headerCsnBtn').onclick=window.openScmtrCentre;
    if($('headerLfdBtn')) $('headerLfdBtn').onclick=window.openLfdRules;
    $('p1v2Back').onclick=()=>showTower(false);
    $('p1v2Refresh').onclick=renderTower;\n    $('p1v2VesselMaster').onclick=openVesselMaster;
    $('p1v2All').onclick=()=>{ const main=$('opsDashboardView'); $('p1v2Tower').style.display='none'; main.style.display='block'; renderUI(); };
    $('p1v2Csn').onclick=()=>{renderCsn();$('p1v2CsnModal').classList.add('open');};
    $('p1v2Lfd').onclick=openLfd;
    $('p1v2TimelineX').onclick=()=>$('p1v2Timeline').classList.remove('open');
    $('p1v2CsnX').onclick=()=>$('p1v2CsnModal').classList.remove('open');
    $('p1v2CsnEditX').onclick=()=>$('p1v2CsnEdit').classList.remove('open');
    $('p1v2CsnCancel').onclick=()=>$('p1v2CsnEdit').classList.remove('open');
    $('p1v2CsnSave').onclick=saveCsn;
    $('p1v2LfdX').onclick=()=>$('p1v2LfdModal').classList.remove('open');
    $('p1v2LfdCancel').onclick=()=>$('p1v2LfdModal').classList.remove('open');
    $('p1v2LfdSave').onclick=saveLfd;
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.p1v2-modal.open').forEach(x=>x.classList.remove('open'));});
  }

  // Keep staff navigation on the staff operations page. The public landing page is customer-only.
  const baseAccessState=window.setAccessState;
  if(typeof baseAccessState==='function'){
    window.setAccessState=function(isStaff){
      baseAccessState.apply(this,arguments);
      const tower=$('p1v2Tower');
      if(tower && !isStaff) tower.style.display='none';
      if(tower && isStaff) { tower.style.display='none'; $('opsDashboardView').style.display='block'; }
    };
  }
  window.resetToLanding=function(){
    if(currentUser){
      if($('p1v2Tower')) $('p1v2Tower').style.display='none';
      $('opsDashboardView').style.display='block';
      if(typeof renderUI==='function') renderUI();
    }else if(typeof setAccessState==='function'){
      setAccessState(false);
    }
    window.scrollTo({top:0,behavior:'smooth'});
  };

  const baseRender=window.renderUI;
  if(typeof baseRender==='function'){
    window.renderUI=function(){baseRender.apply(this,arguments);if($('p1v2Tower')&&$('p1v2Tower').style.display!=='none')renderTower();};
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
  if(document.readyState!=='loading')bind();
})();