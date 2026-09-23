/* Container Control Tower - Phase 1
 * Container-level only. No HBL/cargo workflow.
 */
(function () {
  'use strict';

  const P1_KEY = 'gml_phase1_config_v1';
  const CSN_FIELDS = ['CSN STATUS', 'CSN FILED DATE', 'CSN RESPONSE DATE', 'CSN REMARKS'];
  const DEFAULT_CONFIG = {
    terminalFreeDays: 3,
    warningDays: 4,
    criticalDays: 2,
    demRate20: 100,
    demRate40: 225
  };

  const p1 = (id) => document.getElementById(id);
  const esc1 = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt1 = (s) => {
    if (!s) return '—';
    const d = parseLocalDate(s);
    return d ? d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : esc1(s);
  };
  const today1 = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const daysBetween1 = (a,b) => Math.floor((b-a)/86400000);
  const cfg1 = () => {
    try { return {...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem(P1_KEY) || '{}'))}; }
    catch { return {...DEFAULT_CONFIG}; }
  };
  const persistCfg1 = (c) => localStorage.setItem(P1_KEY, JSON.stringify(c));
  const cntr1 = r => getField(r, ['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO']) || '—';
  const vessel1 = r => getField(r, ['VESSEL & VOY','VESSEL','VESSEL NAME']) || '—';

  function lfdInfo1(r) {
    const c = cfg1();
    const portIn = parseLocalDate(getField(r, ['PORT IN']));
    const portOut = parseLocalDate(getField(r, ['PORT OUT']));
    if (!portIn) return { lfd:null, daysLeft:null, overdue:false, demDays:0, demCost:0, state:'unknown', label:'LFD —' };
    const lfd = new Date(portIn); lfd.setDate(lfd.getDate() + Number(c.terminalFreeDays || 0));
    const end = portOut || today1();
    const dwell = Math.max(0, daysBetween1(portIn, end));
    const demDays = Math.max(0, dwell - Number(c.terminalFreeDays || 0));
    const type = String(getField(r,['TYPE','SIZE']) || '').toUpperCase();
    const rate = type.includes('20') ? Number(c.demRate20) : Number(c.demRate40);
    const daysLeft = daysBetween1(today1(), lfd);
    let state = 'safe';
    if (daysLeft < 0) state = 'overdue';
    else if (daysLeft <= Number(c.criticalDays)) state = 'critical';
    else if (daysLeft <= Number(c.warningDays)) state = 'warning';
    return { lfd, daysLeft, overdue: demDays > 0, demDays, demCost: demDays * rate, state, label: daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`, dwell, rate };
  }

  function csnInfo1(r) {
    const s = (getField(r,['CSN STATUS']) || '').trim().toUpperCase();
    if (!s) return {key:'NOT FILED', label:'Not Filed', cls:'bad'};
    if (s.includes('ACCEPT')) return {key:'ACCEPTED', label:'Accepted', cls:'good'};
    if (s.includes('REJECT')) return {key:'REJECTED', label:'Rejected', cls:'bad'};
    if (s.includes('WRONG')) return {key:'WRONG DETAILS', label:'Wrong Details', cls:'bad'};
    if (s.includes('AMEND')) return {key:'AMENDMENT', label:'Amendment', cls:'warn'};
    if (s.includes('PENDING')) return {key:'PENDING', label:'Pending', cls:'warn'};
    return {key:s, label:s, cls:'warn'};
  }

  function exceptions1(r) {
    const out=[];
    const csn=csnInfo1(r);
    if (['NOT FILED','REJECTED','WRONG DETAILS'].includes(csn.key)) out.push({key:'CSN',label:`CSN ${csn.label}`,sev:'danger'});
    else if (['PENDING','AMENDMENT'].includes(csn.key)) out.push({key:'CSN',label:`CSN ${csn.label}`,sev:'warning'});
    const l=lfdInfo1(r);
    if (l.overdue) out.push({key:'DEM',label:`Demurrage ${l.demDays}d`,sev:'danger'});
    else if (l.state==='critical') out.push({key:'LFD',label:l.daysLeft===0?'LFD Today':`LFD ${l.daysLeft}d`,sev:'danger'});
    else if (l.state==='warning') out.push({key:'LFD',label:`LFD ${l.daysLeft}d`,sev:'warning'});
    const eta=parseLocalDate(getField(r,['ETA']));
    const portIn=parseLocalDate(getField(r,['PORT IN']));
    const cfsIn=parseLocalDate(getField(r,['CFS IN']));
    const destuff=parseLocalDate(getField(r,['DESTUFFING DATE','DESTUFF DATE']));
    const returned=parseLocalDate(getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']));
    if (eta && eta <= today1() && !portIn) out.push({key:'PORT IN',label:'Port In Pending',sev:'warning'});
    if (portIn && !cfsIn) out.push({key:'CFS',label:'CFS In Pending',sev:'warning'});
    if (cfsIn && !destuff) out.push({key:'DESTUFF',label:'Destuffing Pending',sev:'warning'});
    if (destuff && !returned) out.push({key:'RETURN',label:'Empty Return Pending',sev:'warning'});
    return out;
  }

  function ensureUI1() {
    if (!p1('p1ControlTower')) {
      const main=p1('opsDashboardView');
      const section=document.createElement('section'); section.id='p1ControlTower'; section.className='p1-panel'; section.style.display='none';
      section.innerHTML=`
        <div class="p1-panel-head"><div><div class="p1-eyebrow">CONTAINER OPERATIONS</div><h2>🎯 Control Tower</h2><p>Exceptions and milestones that need action today.</p></div><div class="p1-actions"><button class="btn btn-ghost" id="p1ConfigBtn">⚙️ LFD Settings</button><button class="btn btn-primary" id="p1RefreshBtn">↻ Refresh</button></div></div>
        <div class="p1-kpis" id="p1Kpis"></div>
        <div class="p1-grid"><div class="p1-card"><div class="p1-card-title">🚨 Action Required</div><div id="p1Exceptions"></div></div><div class="p1-card"><div class="p1-card-title">📊 CSN Status</div><div id="p1CsnStats"></div></div></div>
        <div class="p1-card"><div class="p1-card-title">📦 Container Overview</div><div class="p1-table-wrap"><table class="p1-table"><thead><tr><th>Container</th><th>Vessel</th><th>CSN</th><th>LFD</th><th>Demurrage</th><th>Next Action</th></tr></thead><tbody id="p1TableBody"></tbody></table></div></div>`;
      main.parentNode.insertBefore(section, main.nextSibling);
    }
    if (!p1('p1TimelineModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1TimelineModal"><div class="p1-modal-box"><div class="p1-modal-head"><div><div class="p1-eyebrow">CONTAINER TIMELINE</div><h3 id="p1TimelineTitle">Container</h3></div><button class="btn btn-ghost" id="p1TimelineClose">✕</button></div><div id="p1TimelineBody"></div></div></div>`);
    }
    if (!p1('p1CsnModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1CsnModal"><div class="p1-modal-box p1-small"><div class="p1-modal-head"><div><div class="p1-eyebrow">SCMTR / CSN CONTROL</div><h3 id="p1CsnTitle">CSN</h3></div><button class="btn btn-ghost" id="p1CsnClose">✕</button></div><div class="p1-form"><label>Status<select id="p1CsnStatus"><option>NOT FILED</option><option>PENDING</option><option>ACCEPTED</option><option>REJECTED</option><option>WRONG DETAILS</option><option>AMENDMENT</option></select></label><label>Filed Date<input type="date" id="p1CsnFiled"></label><label>Response Date<input type="date" id="p1CsnResponse"></label><label>Remarks<textarea id="p1CsnRemarks"></textarea></label></div><div class="p1-modal-foot"><button class="btn" id="p1CsnCancel">Cancel</button><button class="btn btn-primary" id="p1CsnSave">Save CSN Status</button></div></div></div>`);
    }
    if (!p1('p1ConfigModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1ConfigModal"><div class="p1-modal-box p1-small"><div class="p1-modal-head"><div><div class="p1-eyebrow">LFD ENGINE</div><h3>Rules & Rates</h3></div><button class="btn btn-ghost" id="p1CfgClose">✕</button></div><div class="p1-form"><label>Terminal Free Days<input type="number" id="p1CfgFree" min="0"></label><label>Warning Threshold<input type="number" id="p1CfgWarn" min="0"></label><label>Critical Threshold<input type="number" id="p1CfgCrit" min="0"></label><label>20ft Demurrage / Day (USD)<input type="number" id="p1Cfg20" min="0"></label><label>40ft Demurrage / Day (USD)<input type="number" id="p1Cfg40" min="0"></label></div><div class="p1-modal-foot"><button class="btn" id="p1CfgCancel">Cancel</button><button class="btn btn-primary" id="p1CfgSave">Save Rules</button></div></div></div>`);
    }
    const ops=p1('opsControls');
    if (ops && !p1('p1TowerBtn')) { const b=document.createElement('button'); b.id='p1TowerBtn'; b.className='btn btn-primary'; b.textContent='🎯 Control Tower'; b.addEventListener('click',()=>toggleTower1(true)); ops.insertBefore(b,ops.firstChild); }
    const menu=p1('opsMenuDropdown');
    if(menu && !p1('p1CsnMenuBtn')) { const b=document.createElement('button'); b.id='p1CsnMenuBtn'; b.className='dropdown-item'; b.textContent='📑 SCMTR / CSN Control'; b.addEventListener('click',()=>toggleTower1(true)); menu.insertBefore(b,menu.firstChild); }
  }

  function toggleTower1(show) {
    const panel=p1('p1ControlTower'); const main=p1('opsDashboardView');
    if (!panel || !main) return;
    panel.style.display=show?'block':'none';
    if(show) { main.style.display='none'; renderTower1(); window.scrollTo({top:0,behavior:'smooth'}); }
    else { main.style.display='block'; renderUI(); }
  }

  function renderTower1() {
    ensureUI1();
    const all=rows || [];
    const ex=all.flatMap((r,i)=>exceptions1(r).map(x=>({...x,i,r})));
    const csnCounts={}; all.forEach(r=>{const k=csnInfo1(r).key; csnCounts[k]=(csnCounts[k]||0)+1;});
    const dem=all.filter(r=>lfdInfo1(r).overdue).length;
    const critical=all.filter(r=>['critical','overdue'].includes(lfdInfo1(r).state)).length;
    const csnAction=all.filter(r=>['NOT FILED','REJECTED','WRONG DETAILS','PENDING','AMENDMENT'].includes(csnInfo1(r).key)).length;
    const cfs=all.filter(r=>getField(r,['PORT IN']) && !getField(r,['CFS IN'])).length;
    const dest=all.filter(r=>getField(r,['CFS IN']) && !getField(r,['DESTUFFING DATE','DESTUFF DATE'])).length;
    p1('p1Kpis').innerHTML=[['Exceptions',ex.length,'danger'],['CSN Action',csnAction,'warning'],['LFD Critical',critical,'danger'],['Demurrage',dem,'danger'],['CFS Pending',cfs,'warning'],['Destuff Pending',dest,'warning']].map(x=>`<div class="p1-kpi ${x[2]}"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
    const grouped={}; ex.forEach(x=>{grouped[x.label]=(grouped[x.label]||0)+1;});
    p1('p1Exceptions').innerHTML=Object.entries(grouped).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="p1-ex-row"><span>${esc1(k)}</span><b>${v}</b></div>`).join('') || '<div class="p1-empty">🟢 No exceptions. All containers are within control.</div>';
    p1('p1CsnStats').innerHTML=Object.entries(csnCounts).map(([k,v])=>`<div class="p1-ex-row"><span>${esc1(k)}</span><b>${v}</b></div>`).join('');
    p1('p1TableBody').innerHTML=all.map((r,i)=>{
      const l=lfdInfo1(r), c=csnInfo1(r), e=exceptions1(r);
      const action=e[0]?.label || 'No immediate action';
      const lfd=l.lfd?fmt1(l.lfd.toISOString().slice(0,10)):'—';
      return `<tr><td><button class="p1-link" data-timeline="${i}">${esc1(cntr1(r))}</button></td><td>${esc1(vessel1(r))}</td><td><button class="p1-status ${c.cls}" data-csn="${i}">${esc1(c.label)}</button></td><td><span class="p1-status ${l.state==='safe'?'good':l.state==='warning'?'warn':'bad'}">${lfd}${l.daysLeft!==null?` · ${esc1(l.label)}`:''}</span></td><td>${l.overdue?`<span class="p1-status bad">${l.demDays}d · $${Math.round(l.demCost)}</span>`:'—'}</td><td>${esc1(action)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="p1-empty">No containers available.</td></tr>`;
    p1('p1TableBody').querySelectorAll('[data-timeline]').forEach(b=>b.addEventListener('click',()=>openTimeline1(Number(b.dataset.timeline))));
    p1('p1TableBody').querySelectorAll('[data-csn]').forEach(b=>b.addEventListener('click',()=>openCsn1(Number(b.dataset.csn))));
  }

  function openTimeline1(i) {
    const r=rows[i]; if(!r) return; const cn=cntr1(r); p1('p1TimelineTitle').textContent=cn;
    const events=[['Vessel Departed','ETD'],['Vessel Arrived','ETA'],['Port In','PORT IN'],['Port Out','PORT OUT'],['CFS In','CFS IN'],['Destuffing','DESTUFFING DATE'],['Empty Return','CONTAINER RETURN DATE']];
    p1('p1TimelineBody').innerHTML=`<div class="p1-meta"><span>${esc1(vessel1(r))}</span><span>Gateway: ${esc1(getField(r,['GATEWAY PORT'])||'—')}</span><span>CFS: ${esc1(getField(r,['CFS NAME'])||'—')}</span></div><div class="p1-timeline">${events.map(([label,key])=>{const v=getField(r,[key]); return `<div class="p1-event ${v?'done':''}"><div class="p1-dot">${v?'✓':'•'}</div><div><strong>${label}</strong><small>${v?fmt1(v):'Pending'}</small></div></div>`}).join('')}</div>`;
    p1('p1TimelineModal').classList.add('open');
  }

  let csnIndex=-1;
  function openCsn1(i){ const r=rows[i]; if(!r) return; csnIndex=i; p1('p1CsnTitle').textContent=`${cntr1(r)} · CSN`; p1('p1CsnStatus').value=csnInfo1(r).key; p1('p1CsnFiled').value=getField(r,['CSN FILED DATE']); p1('p1CsnResponse').value=getField(r,['CSN RESPONSE DATE']); p1('p1CsnRemarks').value=getField(r,['CSN REMARKS']); p1('p1CsnModal').classList.add('open'); }
  function saveCsn1(){ if(csnIndex<0) return; const r=rows[csnIndex]; r['CSN STATUS']=p1('p1CsnStatus').value; r['CSN FILED DATE']=p1('p1CsnFiled').value; r['CSN RESPONSE DATE']=p1('p1CsnResponse').value; r['CSN REMARKS']=p1('p1CsnRemarks').value.trim(); try{localStorage.setItem('containerRows',JSON.stringify(rows));}catch{} if(typeof saveAndRefresh==='function') saveAndRefresh(); p1('p1CsnModal').classList.remove('open'); renderTower1(); if(typeof toast==='function') toast('CSN status updated'); }
  function openCfg1(){const c=cfg1(); p1('p1CfgFree').value=c.terminalFreeDays;p1('p1CfgWarn').value=c.warningDays;p1('p1CfgCrit').value=c.criticalDays;p1('p1Cfg20').value=c.demRate20;p1('p1Cfg40').value=c.demRate40;p1('p1ConfigModal').classList.add('open');}
  function saveCfg1(){saveCfg1Local();p1('p1ConfigModal').classList.remove('open');renderTower1();if(typeof toast==='function')toast('LFD rules saved');}
  function saveCfg1Local(){persistCfg1({terminalFreeDays:Number(p1('p1CfgFree').value||0),warningDays:Number(p1('p1CfgWarn').value||0),criticalDays:Number(p1('p1CfgCrit').value||0),demRate20:Number(p1('p1Cfg20').value||0),demRate40:Number(p1('p1Cfg40').value||0)});}

  function hook1(){
    ensureUI1();
    p1('p1RefreshBtn').onclick=renderTower1; p1('p1ConfigBtn').onclick=openCfg1;
    p1('p1TimelineClose').onclick=()=>p1('p1TimelineModal').classList.remove('open');
    p1('p1CsnClose').onclick=p1('p1CsnCancel').onclick=()=>p1('p1CsnModal').classList.remove('open');
    p1('p1CsnSave').onclick=saveCsn1;
    p1('p1CfgClose').onclick=p1('p1CfgCancel').onclick=()=>p1('p1ConfigModal').classList.remove('open');
    p1('p1CfgSave').onclick=saveCfg1;
    window.addEventListener('keydown',e=>{if(e.key==='Escape'){['p1TimelineModal','p1CsnModal','p1ConfigModal'].forEach(id=>p1(id)?.classList.remove('open'));}});
  }

  // Wrap renderUI so the control tower stays synchronized after edits/imports.
  const originalRenderUI = window.renderUI;
  if (typeof originalRenderUI === 'function') {
    window.renderUI = function(){ originalRenderUI.apply(this, arguments); const panel=p1('p1ControlTower'); if(panel && panel.style.display!=='none') renderTower1(); };
  }

  document.addEventListener('DOMContentLoaded', hook1);
  if (document.readyState !== 'loading') hook1();
})();
