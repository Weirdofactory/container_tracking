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

  function ensureStyles1() {
    if (p1('p1Phase1Styles')) return;
    const st = document.createElement('style');
    st.id = 'p1Phase1Styles';
    st.textContent = `
      .p1-subtitle{margin:5px 0 0;color:var(--text-muted);font-size:11px}.p1-csn-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;margin-bottom:12px}.p1-csn-kpi{padding:11px;border:1px solid var(--border);border-radius:10px;background:var(--bg-muted)}.p1-csn-kpi span{display:block;font-size:9px;font-weight:900;color:var(--text-muted)}.p1-csn-kpi strong{display:block;font-size:20px;margin-top:3px}.p1-csn-kpi.good{border-top:3px solid var(--success)}.p1-csn-kpi.warn{border-top:3px solid var(--warning)}.p1-csn-kpi.bad{border-top:3px solid var(--danger)}.p1-csn-toolbar{display:flex;gap:8px;margin-bottom:12px}.p1-csn-toolbar .input{flex:1}.p1-csn-toolbar .select{width:220px}.p1-edit-btn{font-size:10px;padding:5px 8px}.p1-card-title-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}@media(max-width:900px){.p1-csn-kpis{grid-template-columns:repeat(2,1fr)}.p1-csn-toolbar{flex-direction:column}.p1-csn-toolbar .select{width:100%}}
      .p1-panel{margin:18px auto 40px;max-width:1500px;padding:0 18px 30px;box-sizing:border-box}
      .p1-panel-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}
      .p1-panel-head h2{margin:2px 0 4px;font-size:25px}.p1-panel-head p{margin:0;color:var(--text-muted);font-size:12px}
      .p1-eyebrow{font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--primary);text-transform:uppercase}
      .p1-actions{display:flex;gap:8px}.p1-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .p1-kpi{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:13px 14px;box-shadow:var(--shadow-sm)}
      .p1-kpi span{font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase}.p1-kpi strong{display:block;font-size:25px;margin-top:5px}
      .p1-kpi.danger{border-top:3px solid var(--danger)}.p1-kpi.warning{border-top:3px solid var(--warning)}
      .p1-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.p1-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:14px;box-shadow:var(--shadow-sm);overflow:hidden}
      .p1-card-title{font-size:12px;font-weight:900;margin-bottom:10px}.p1-ex-row{display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-bottom:1px solid var(--border);font-size:11px}
      .p1-ex-row:last-child{border-bottom:0}.p1-ex-row b{font-family:'JetBrains Mono',monospace}.p1-table-wrap{overflow:auto}.p1-table{width:100%;border-collapse:collapse;font-size:11px;min-width:850px}
      .p1-table th{text-align:left;color:var(--text-muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;padding:8px;border-bottom:1px solid var(--border)}.p1-table td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
      .p1-link{border:0;background:none;color:var(--primary);font-weight:900;cursor:pointer;padding:0}.p1-status{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;font-size:9px;font-weight:900;border:1px solid transparent}
      .p1-status.good{color:var(--success);background:var(--success-bg)}.p1-status.warn{color:#b45309;background:var(--warning-bg)}.p1-status.bad{color:var(--danger);background:var(--danger-bg)}button.p1-status{cursor:pointer}.p1-empty{padding:14px;color:var(--text-muted);font-size:11px}
      .p1-modal{position:fixed !important;inset:0 !important;background:rgba(2,6,23,.58);backdrop-filter:blur(4px);display:none !important;align-items:center;justify-content:center;z-index:10050;padding:18px;box-sizing:border-box}
      .p1-modal.open{display:flex !important}.p1-modal-box{width:min(760px,96vw);max-height:90vh;overflow:auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:15px;box-shadow:var(--shadow-lg);padding:18px;box-sizing:border-box}
      .p1-modal-box.p1-small{width:min(520px,96vw)}.p1-modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px}.p1-modal-head h3{margin:3px 0 0;font-size:18px}
      .p1-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.p1-meta span{font-size:10px;background:var(--bg-muted);border:1px solid var(--border);border-radius:7px;padding:5px 8px}
      .p1-timeline{position:relative;padding:4px 0 4px 22px}.p1-timeline:before{content:'';position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:var(--border)}
      .p1-event{position:relative;display:flex;gap:12px;padding:10px 0}.p1-dot{position:absolute;left:-22px;width:16px;height:16px;border-radius:50%;background:var(--bg-surface);border:2px solid var(--border);font-size:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted)}
      .p1-event.done .p1-dot{background:var(--success);border-color:var(--success);color:#fff}.p1-event strong{display:block;font-size:11px}.p1-event small{display:block;margin-top:2px;color:var(--text-muted);font-size:10px}
      .p1-form{display:grid;grid-template-columns:1fr 1fr;gap:11px}.p1-form label{font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase}.p1-form label:last-child{grid-column:1/-1}
      .p1-form input,.p1-form select,.p1-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid var(--border);background:var(--bg-muted);color:var(--text-main);border-radius:7px;padding:8px;font:inherit}.p1-form textarea{min-height:90px;resize:vertical}
      .p1-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
      @media(max-width:900px){.p1-kpis{grid-template-columns:repeat(2,1fr)}.p1-grid{grid-template-columns:1fr}.p1-panel-head{flex-direction:column}.p1-actions{width:100%}.p1-form{grid-template-columns:1fr}.p1-form label:last-child{grid-column:auto}}
    `;
    document.head.appendChild(st);
  }

  function ensureUI1() {
    ensureStyles1();
    if (!p1('p1ControlTower')) {
      const main=p1('opsDashboardView');
      const section=document.createElement('section'); section.id='p1ControlTower'; section.className='p1-panel'; section.style.display='none';
      section.innerHTML=`
        <div class="p1-panel-head"><div><div class="p1-eyebrow">CONTAINER OPERATIONS</div><h2>🎯 Control Tower</h2><p>Exceptions and milestones that need action today.</p></div><div class="p1-actions"><button class="btn btn-ghost" id="p1ConfigBtn">⚙️ LFD Settings</button><button class="btn btn-primary" id="p1RefreshBtn">↻ Refresh</button><button class="btn" id="p1CsnOpenBtn">📑 CSN Control Centre</button></div></div>
        <div class="p1-kpis" id="p1Kpis"></div>
        <div class="p1-grid"><div class="p1-card"><div class="p1-card-title">🚨 Action Required</div><div id="p1Exceptions"></div></div><div class="p1-card"><div class="p1-card-title">📊 CSN Status</div><div id="p1CsnStats"></div></div></div>
        <div class="p1-card"><div class="p1-card-title">📦 Container Overview</div><div class="p1-table-wrap"><table class="p1-table"><thead><tr><th>Container</th><th>Vessel</th><th>CSN</th><th>LFD</th><th>Demurrage</th><th>Next Action</th><th>Action</th></tr></thead><tbody id="p1TableBody"></tbody></table></div></div>`;
      main.parentNode.insertBefore(section, main.nextSibling);
    }
    if (!p1('p1TimelineModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1TimelineModal" style="display:none"><div class="p1-modal-box"><div class="p1-modal-head"><div><div class="p1-eyebrow">CONTAINER TIMELINE</div><h3 id="p1TimelineTitle">Container</h3></div><button class="btn btn-ghost" id="p1TimelineClose">✕</button></div><div id="p1TimelineBody"></div></div></div>`);
    }
    if (!p1('p1CsnModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1CsnModal" style="display:none"><div class="p1-modal-box p1-small"><div class="p1-modal-head"><div><div class="p1-eyebrow">SCMTR / CSN CONTROL</div><h3 id="p1CsnTitle">CSN</h3></div><button class="btn btn-ghost" id="p1CsnClose">✕</button></div><div class="p1-form"><label>Status<select id="p1CsnStatus"><option>NOT FILED</option><option>PENDING</option><option>ACCEPTED</option><option>REJECTED</option><option>WRONG DETAILS</option><option>AMENDMENT</option></select></label><label>Filed Date<input type="date" id="p1CsnFiled"></label><label>Response Date<input type="date" id="p1CsnResponse"></label><label>Remarks<textarea id="p1CsnRemarks"></textarea></label></div><div class="p1-modal-foot"><button class="btn" id="p1CsnCancel">Cancel</button><button class="btn btn-primary" id="p1CsnSave">Save CSN Status</button></div></div></div>`);
    }
    if (!p1('p1CsnDashboardModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1CsnDashboardModal" style="display:none"><div class="p1-modal-box" style="width:min(1050px,97vw)"><div class="p1-modal-head"><div><div class="p1-eyebrow">COMPLIANCE CONTROL</div><h3>SCMTR / CSN Control Centre</h3><p class="p1-subtitle">Monitor CSN filing status and open a record to edit its filing details.</p></div><button class="btn btn-ghost" id="p1CsnDashClose">✕</button></div><div id="p1CsnDashBody"></div></div></div>`);
    }
    if (!p1('p1ConfigModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="p1-modal" id="p1ConfigModal" style="display:none"><div class="p1-modal-box p1-small"><div class="p1-modal-head"><div><div class="p1-eyebrow">LFD ENGINE</div><h3>Rules & Rates</h3></div><button class="btn btn-ghost" id="p1CfgClose">✕</button></div><div class="p1-form"><label>Terminal Free Days<input type="number" id="p1CfgFree" min="0"></label><label>Warning Threshold<input type="number" id="p1CfgWarn" min="0"></label><label>Critical Threshold<input type="number" id="p1CfgCrit" min="0"></label><label>20ft Demurrage / Day (USD)<input type="number" id="p1Cfg20" min="0"></label><label>40ft Demurrage / Day (USD)<input type="number" id="p1Cfg40" min="0"></label></div><div class="p1-modal-foot"><button class="btn" id="p1CfgCancel">Cancel</button><button class="btn btn-primary" id="p1CfgSave">Save Rules</button></div></div></div>`);
    }
    const ops=p1('opsControls');
    if (ops && !p1('p1TowerBtn')) { const b=document.createElement('button'); b.id='p1TowerBtn'; b.className='btn btn-primary'; b.textContent='🎯 Control Tower'; b.addEventListener('click',()=>toggleTower1(true)); ops.insertBefore(b,ops.firstChild); }
    const menu=p1('opsMenuDropdown');
    if(menu && !p1('p1CsnMenuBtn')) { const b=document.createElement('button'); b.id='p1CsnMenuBtn'; b.className='dropdown-item'; b.textContent='📑 SCMTR / CSN Control'; b.addEventListener('click',()=>openCsnDashboard1()); menu.insertBefore(b,menu.firstChild); }
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
      return `<tr><td><button class="p1-link" data-timeline="${i}">${esc1(cntr1(r))}</button></td><td>${esc1(vessel1(r))}</td><td><button class="p1-status ${c.cls}" data-csn="${i}">${esc1(c.label)}</button></td><td><span class="p1-status ${l.state==='safe'?'good':l.state==='warning'?'warn':'bad'}">${lfd}${l.daysLeft!==null?` · ${esc1(l.label)}`:''}</span></td><td>${l.overdue?`<span class="p1-status bad">${l.demDays}d · $${Math.round(l.demCost)}</span>`:'—'}</td><td>${esc1(action)}</td><td><button class="btn btn-ghost p1-edit-btn" data-edit="${i}">✏️ Edit</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="p1-empty">No containers available.</td></tr>`;
    p1('p1TableBody').querySelectorAll('[data-timeline]').forEach(b=>b.addEventListener('click',()=>openTimeline1(Number(b.dataset.timeline))));
    p1('p1TableBody').querySelectorAll('[data-csn]').forEach(b=>b.addEventListener('click',()=>openCsn1(Number(b.dataset.csn))));
    p1('p1TableBody').querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{ if(typeof openModal==='function') openModal(Number(b.dataset.edit)); }));
  }

  function renderCsnDashboard1(){
    const all=rows || [];
    const counts={"NOT FILED":0,"PENDING":0,"ACCEPTED":0,"REJECTED":0,"WRONG DETAILS":0,"AMENDMENT":0};
    all.forEach(r=>{const k=csnInfo1(r).key; counts[k]=(counts[k]||0)+1;});
    const cards=Object.entries(counts).map(([k,v])=>`<div class="p1-csn-kpi ${['ACCEPTED'].includes(k)?'good':['NOT FILED','REJECTED','WRONG DETAILS'].includes(k)?'bad':'warn'}"><span>${esc1(k)}</span><strong>${v}</strong></div>`).join('');
    const q=(p1('p1CsnSearch')?.value||'').toLowerCase().trim();
    const status=p1('p1CsnFilter')?.value||'';
    const filtered=all.map((r,i)=>({r,i})).filter(({r})=>{const cn=cntr1(r).toLowerCase(); const v=vessel1(r).toLowerCase(); const c=csnInfo1(r).key; return (!q||cn.includes(q)||v.includes(q))&&(!status||c===status);});
    p1('p1CsnDashBody').innerHTML=`<div class="p1-csn-kpis">${cards}</div><div class="p1-csn-toolbar"><input id="p1CsnSearch" class="input" placeholder="Search container or vessel..." value="${esc1(q)}"><select id="p1CsnFilter" class="select"><option value="">All CSN Status</option>${Object.keys(counts).map(k=>`<option ${status===k?'selected':''}>${esc1(k)}</option>`).join('')}</select></div><div class="p1-table-wrap"><table class="p1-table p1-csn-table"><thead><tr><th>Container</th><th>Vessel / Voyage</th><th>Status</th><th>Filed</th><th>Response</th><th>Remarks</th><th>Action</th></tr></thead><tbody>${filtered.map(({r,i})=>{const c=csnInfo1(r); return `<tr><td><b>${esc1(cntr1(r))}</b></td><td>${esc1(vessel1(r))}</td><td><span class="p1-status ${c.cls}">${esc1(c.label)}</span></td><td>${esc1(fmt1(getField(r,['CSN FILED DATE'])))}</td><td>${esc1(fmt1(getField(r,['CSN RESPONSE DATE'])))}</td><td>${esc1(getField(r,['CSN REMARKS'])||'—')}</td><td><button class="btn btn-primary p1-csn-edit" data-edit-csn="${i}">Edit CSN</button></td></tr>`}).join('')||'<tr><td colspan="7" class="p1-empty">No matching CSN records.</td></tr>'}</tbody></table></div>`;
    p1('p1CsnSearch').oninput=renderCsnDashboard1; p1('p1CsnFilter').onchange=renderCsnDashboard1;
    p1('p1CsnDashBody').querySelectorAll('[data-edit-csn]').forEach(b=>b.addEventListener('click',()=>openCsn1(Number(b.dataset.editCsn))));
  }
  function openCsnDashboard1(){ ensureUI1(); renderCsnDashboard1(); p1('p1CsnDashboardModal').style.display='flex'; p1('p1CsnDashboardModal').classList.add('open'); }
  function openTimeline1(i) {
    const r=rows[i]; if(!r) return; const cn=cntr1(r); p1('p1TimelineTitle').textContent=cn;
    const events=[['Vessel Departed','ETD'],['Vessel Arrived','ETA'],['Port In','PORT IN'],['Port Out','PORT OUT'],['CFS In','CFS IN'],['Destuffing','DESTUFFING DATE'],['Empty Return','CONTAINER RETURN DATE']];
    p1('p1TimelineBody').innerHTML=`<div class="p1-meta"><span>${esc1(vessel1(r))}</span><span>Gateway: ${esc1(getField(r,['GATEWAY PORT'])||'—')}</span><span>CFS: ${esc1(getField(r,['CFS NAME'])||'—')}</span></div><div class="p1-timeline">${events.map(([label,key])=>{const v=getField(r,[key]); return `<div class="p1-event ${v?'done':''}"><div class="p1-dot">${v?'✓':'•'}</div><div><strong>${label}</strong><small>${v?fmt1(v):'Pending'}</small></div></div>`}).join('')}</div>`;
    p1('p1TimelineModal').style.display='flex'; p1('p1TimelineModal').classList.add('open');
  }

  let csnIndex=-1;
  function openCsn1(i){ const r=rows[i]; if(!r) return; csnIndex=i; p1('p1CsnTitle').textContent=`${cntr1(r)} · CSN`; p1('p1CsnStatus').value=csnInfo1(r).key; p1('p1CsnFiled').value=getField(r,['CSN FILED DATE']); p1('p1CsnResponse').value=getField(r,['CSN RESPONSE DATE']); p1('p1CsnRemarks').value=getField(r,['CSN REMARKS']); p1('p1CsnModal').style.display='flex'; p1('p1CsnModal').classList.add('open'); }
  function saveCsn1(){ if(csnIndex<0) return; const r=rows[csnIndex]; r['CSN STATUS']=p1('p1CsnStatus').value; r['CSN FILED DATE']=p1('p1CsnFiled').value; r['CSN RESPONSE DATE']=p1('p1CsnResponse').value; r['CSN REMARKS']=p1('p1CsnRemarks').value.trim(); try{localStorage.setItem('containerRows',JSON.stringify(rows));}catch{} if(typeof saveAndRefresh==='function') saveAndRefresh(); p1('p1CsnModal').classList.remove('open'); p1('p1CsnModal').style.display='none'; renderTower1(); if(typeof toast==='function') toast('CSN status updated'); }
  function openCfg1(){const c=cfg1(); p1('p1CfgFree').value=c.terminalFreeDays;p1('p1CfgWarn').value=c.warningDays;p1('p1CfgCrit').value=c.criticalDays;p1('p1Cfg20').value=c.demRate20;p1('p1Cfg40').value=c.demRate40;p1('p1ConfigModal').style.display='flex'; p1('p1ConfigModal').classList.add('open');}
  function saveCfg1(){saveCfg1Local();p1('p1ConfigModal').classList.remove('open'); p1('p1ConfigModal').style.display='none';renderTower1();if(typeof toast==='function')toast('LFD rules saved');}
  function saveCfg1Local(){persistCfg1({terminalFreeDays:Number(p1('p1CfgFree').value||0),warningDays:Number(p1('p1CfgWarn').value||0),criticalDays:Number(p1('p1CfgCrit').value||0),demRate20:Number(p1('p1Cfg20').value||0),demRate40:Number(p1('p1Cfg40').value||0)});}

  function hook1(){
    ensureUI1();
    p1('p1RefreshBtn').onclick=renderTower1; p1('p1ConfigBtn').onclick=openCfg1; p1('p1CsnOpenBtn').onclick=openCsnDashboard1;
    p1('p1TimelineClose').onclick=()=>{p1('p1TimelineModal').classList.remove('open');p1('p1TimelineModal').style.display='none';};
    p1('p1CsnClose').onclick=p1('p1CsnCancel').onclick=()=>{p1('p1CsnModal').classList.remove('open');p1('p1CsnModal').style.display='none';};
    p1('p1CsnSave').onclick=saveCsn1;
    p1('p1CsnDashClose').onclick=()=>{p1('p1CsnDashboardModal').classList.remove('open');p1('p1CsnDashboardModal').style.display='none';};
    p1('p1CfgClose').onclick=p1('p1CfgCancel').onclick=()=>{p1('p1ConfigModal').classList.remove('open');p1('p1ConfigModal').style.display='none';};
    p1('p1CfgSave').onclick=saveCfg1;
    window.addEventListener('keydown',e=>{if(e.key==='Escape'){['p1TimelineModal','p1CsnModal','p1ConfigModal','p1CsnDashboardModal'].forEach(id=>{const el=p1(id);if(el){el.classList.remove('open');el.style.display='none';}});}});
  }

  // Wrap renderUI so the control tower stays synchronized after edits/imports.
  const originalRenderUI = window.renderUI;
  if (typeof originalRenderUI === 'function') {
    window.renderUI = function(){ originalRenderUI.apply(this, arguments); const panel=p1('p1ControlTower'); if(panel && panel.style.display!=='none') renderTower1(); };
  }

  document.addEventListener('DOMContentLoaded', hook1);
  if (document.readyState !== 'loading') hook1();
})();
