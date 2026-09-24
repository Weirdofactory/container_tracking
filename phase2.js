/* Phase 2 — Exception Management, My Tasks & Follow-ups
 * Adds a lightweight operations work queue on top of the Phase 1 Control Tower.
 * Task data is stored locally for now; the structure is ready for Supabase persistence later.
 */
(function () {
  'use strict';

  const TASK_KEY = 'gml_phase2_tasks_v1';
  const $ = id => document.getElementById(id);
  const esc2 = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cn = r => getField(r, ['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO']) || '—';
  const vessel = r => getField(r, ['VESSEL & VOY','VESSEL','VESSEL NAME']) || '—';
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const parseDate = v => typeof parseLocalDate === 'function' ? parseLocalDate(v) : (v ? new Date(v) : null);
  const dateKey = d => { if(!d) return ''; const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); return x.toISOString().slice(0,10); };
  const fmtDate = v => { if(!v) return '—'; const d=parseDate(v); return d ? d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : String(v); };

  function loadTasks(){
    try { return JSON.parse(localStorage.getItem(TASK_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveTasks(list){ localStorage.setItem(TASK_KEY, JSON.stringify(list)); }

  function currentOwner(){
    return currentUser?.id || currentUser?.name || 'Unassigned';
  }

  function lfdInfo(r){
    let cfg={terminalFreeDays:3,warningDays:4,criticalDays:2,demRate20:100,demRate40:225};
    try { cfg=Object.assign(cfg,JSON.parse(localStorage.getItem('gml_phase1_config_v2')||'{}')); } catch(e){}
    const p=parseDate(getField(r,['PORT IN']));
    if(!p) return {state:'unknown',daysLeft:null,demDays:0,cost:0};
    const lfd=new Date(p); lfd.setDate(lfd.getDate()+Number(cfg.terminalFreeDays||0));
    const end=parseDate(getField(r,['PORT OUT']))||today();
    const dwell=Math.max(0,Math.floor((end-p)/86400000));
    const demDays=Math.max(0,dwell-Number(cfg.terminalFreeDays||0));
    const size=String(getField(r,['TYPE','SIZE'])||'').toUpperCase();
    const rate=size.includes('20')?Number(cfg.demRate20):Number(cfg.demRate40);
    const daysLeft=Math.floor((lfd-today())/86400000);
    let state='safe';
    if(daysLeft<0)state='overdue'; else if(daysLeft<=Number(cfg.criticalDays))state='critical'; else if(daysLeft<=Number(cfg.warningDays))state='warning';
    return {state,daysLeft,demDays,cost:demDays*rate};
  }

  function candidates(){
    const out=[];
    (rows||[]).forEach((r,i)=>{
      const container=cn(r);
      const l=lfdInfo(r);
      const portIn=getField(r,['PORT IN']), cfs=getField(r,['CFS IN']);
      const dest=getField(r,['DESTUFFING DATE','DESTUFF DATE']);
      const ret=getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']);
      const eta=parseDate(getField(r,['ETA']));
      if(l.demDays>0) out.push({i,container,exceptionKey:'DEM',title:'Demurrage exposure',severity:'CRITICAL',detail:l.demDays+' demurrage day(s) · $'+Math.round(l.cost)});
      else if(l.state==='overdue') out.push({i,container,exceptionKey:'LFD',title:'LFD expired',severity:'CRITICAL',detail:Math.abs(l.daysLeft)+' day(s) overdue'});
      else if(l.state==='critical') out.push({i,container,exceptionKey:'LFD',title:'LFD critical',severity:'HIGH',detail:l.daysLeft===0?'LFD today':l.daysLeft+' day(s) left'});
      else if(l.state==='warning') out.push({i,container,exceptionKey:'LFD',title:'LFD warning',severity:'MEDIUM',detail:l.daysLeft+' day(s) left'});
      if(eta && eta<=today() && !portIn) out.push({i,container,exceptionKey:'PORT',title:'Port In pending',severity:'HIGH',detail:'ETA passed without Port In'});
      if(portIn && !cfs) out.push({i,container,exceptionKey:'CFS',title:'CFS In pending',severity:'MEDIUM',detail:'Container has Port In but no CFS In'});
      if(cfs && !dest) out.push({i,container,exceptionKey:'DESTUFF',title:'Destuffing pending',severity:'MEDIUM',detail:'CFS In completed'});
      if(dest && !ret) out.push({i,container,exceptionKey:'RETURN',title:'Empty return pending',severity:'HIGH',detail:'Destuffing completed'});
    });
    return out;
  }

  function severityClass(s){ return s==='CRITICAL'?'bad':s==='HIGH'?'warn':'good'; }
  function defaultDue(severity){
    const d=today(); d.setDate(d.getDate()+(severity==='CRITICAL'?0:severity==='HIGH'?1:severity==='MEDIUM'?2:3)); return dateKey(d);
  }

  function ensureUI(){
    if(!$('p2Styles')){
      const s=document.createElement('style'); s.id='p2Styles'; s.textContent=`
        .p2bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
        .p2-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:12px}
        .p2-stat{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:12px}
        .p2-stat small{display:block;color:var(--text-muted);font-size:8px;text-transform:uppercase;font-weight:900}.p2-stat b{display:block;font-size:22px;margin-top:4px}
        .p2-board{background:var(--bg-surface);border:1px solid var(--border);border-radius:13px;padding:14px;margin-bottom:12px;box-shadow:var(--shadow-sm)}
        .p2-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.p2-head b{font-size:12px}
        .p2-table{width:100%;border-collapse:collapse;min-width:930px;font-size:11px}.p2-table th{text-align:left;padding:8px;color:var(--text-muted);font-size:9px;text-transform:uppercase;border-bottom:1px solid var(--border)}.p2-table td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
        .p2-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900}.p2-pill.bad{background:var(--danger-bg);color:var(--danger)}.p2-pill.warn{background:var(--warning-bg);color:#b45309}.p2-pill.good{background:var(--success-bg);color:var(--success)}
        .p2-empty{text-align:center;padding:18px;color:var(--text-muted);font-size:11px}
        .p2-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.62);backdrop-filter:blur(5px);z-index:13000;box-sizing:border-box}.p2-modal.open{display:flex!important}
        .p2-box{width:min(700px,97vw);max-height:90vh;overflow:auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow-lg)}
        .p2-mhead{padding:15px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;background:var(--bg-elevated)}.p2-mhead h2{font-size:17px;margin:4px 0 0}
        .p2-body{padding:18px}.p2-form{display:grid;grid-template-columns:1fr 1fr;gap:11px}.p2-form label{font-size:9px;font-weight:900;text-transform:uppercase;color:var(--text-muted)}.p2-form input,.p2-form select,.p2-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid var(--border);background:var(--bg-muted);color:var(--text-main);border-radius:8px;padding:9px;font:inherit}.p2-form textarea{min-height:85px;resize:vertical}.p2-full{grid-column:1/-1}.p2-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border);background:var(--bg-elevated)}
        .p2-overdue{box-shadow:inset 3px 0 0 var(--danger)}.p2-due{box-shadow:inset 3px 0 0 var(--warning)}
        @media(max-width:800px){.p2-summary{grid-template-columns:repeat(2,1fr)}.p2-form{grid-template-columns:1fr}.p2-full{grid-column:auto}}
      `; document.head.appendChild(s);
    }

    const tower=$('p1v2Tower');
    if(tower && !$('p2WorkArea')){
      const area=document.createElement('div'); area.id='p2WorkArea';
      area.innerHTML=`
        <div class="p2bar">
          <button class="btn btn-primary" id="p2TasksBtn">📋 My Tasks</button>
          <button class="btn btn-ghost" id="p2Generate">⚡ Create Missing Exception Tasks</button>
          <span style="font-size:10px;color:var(--text-muted)">Operational follow-ups • Viewer remains read-only</span>
        </div>
        <div class="p2-summary" id="p2Summary"></div>
        <div class="p2-board">
          <div class="p2-head"><b>🚨 Exception Work Queue</b><span style="font-size:9px;color:var(--text-muted)">Assign ownership and follow-up dates</span></div>
          <div style="overflow:auto"><table class="p2-table"><thead><tr><th>Container</th><th>Exception</th><th>Severity</th><th>Detail</th><th>Task</th><th>Action</th></tr></thead><tbody id="p2ExceptionBody"></tbody></table></div>
        </div>`;
      tower.appendChild(area);
    }

    if(!$('p2TaskModal')) document.body.insertAdjacentHTML('beforeend',`
      <div class="p2-modal" id="p2TaskModal"><div class="p2-box">
        <div class="p2-mhead"><div><div style="font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--primary)">OPERATIONS TASK</div><h2 id="p2TaskTitle">Exception Follow-up</h2></div><button class="btn btn-ghost" id="p2TaskX">✕</button></div>
        <div class="p2-body"><div class="p2-form">
          <label>Container<input id="p2Container" readonly></label><label>Exception<input id="p2Exception" readonly></label>
          <label>Severity<select id="p2Severity"><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>NORMAL</option></select></label>
          <label>Status<select id="p2Status"><option>OPEN</option><option>IN PROGRESS</option><option>RESOLVED</option><option>ESCALATED</option></select></label>
          <label>Assigned To<input id="p2Owner" placeholder="Operator / team"></label><label>Due Date<input id="p2Due" type="date"></label>
          <label>Follow-up Date<input id="p2Followup" type="date"></label>
          <label class="p2-full">Remarks / Follow-up<textarea id="p2Remarks" placeholder="Next action, client follow-up, document pending, etc."></textarea></label>
        </div></div>
        <div class="p2-foot"><button class="btn" id="p2Cancel">Cancel</button><button class="btn btn-primary" id="p2Save">Save Task</button></div>
      </div></div>`);

    if(!$('p2TaskListModal')) document.body.insertAdjacentHTML('beforeend',`
      <div class="p2-modal" id="p2TaskListModal"><div class="p2-box" style="width:min(1100px,98vw)">
        <div class="p2-mhead"><div><div style="font-size:9px;font-weight:900;letter-spacing:.14em;color:var(--primary)">WORK QUEUE</div><h2>📋 My Tasks & Follow-ups</h2></div><button class="btn btn-ghost" id="p2ListX">✕</button></div>
        <div class="p2-body">
          <div class="p2bar"><select id="p2Filter" class="select"><option value="ALL">All Tasks</option><option value="OPEN">Open</option><option value="MINE">My Tasks</option><option value="OVERDUE">Overdue</option><option value="TODAY">Due Today</option><option value="RESOLVED">Resolved</option></select><input id="p2Search" class="input" style="flex:1" placeholder="Search container / exception / owner..."></div>
          <div style="overflow:auto"><table class="p2-table"><thead><tr><th>Container</th><th>Exception</th><th>Owner</th><th>Status</th><th>Due</th><th>Follow-up</th><th>Remarks</th><th>Action</th></tr></thead><tbody id="p2TaskBody"></tbody></table></div>
        </div>
      </div></div>`);
  }

  let editId=null;
  let selectedCandidate=null;

  function upsertTask(candidate){
    const list=loadTasks();
    const existing=list.find(t=>t.containerNo===candidate.container && t.exceptionKey===candidate.exceptionKey);
    if(existing){editId=existing.id; openTask(existing); return;}
    selectedCandidate=candidate; editId=null;
    openTask({containerNo:candidate.container,exceptionKey:candidate.exceptionKey,title:candidate.title,severity:candidate.severity,status:'OPEN',assignedTo:currentOwner(),dueDate:defaultDue(candidate.severity),followUpDate:'',remarks:''});
  }

  function openTask(task){
    ensureUI();
    $('p2TaskTitle').textContent=(task.containerNo||'Container')+' · '+(task.title||task.exceptionKey||'Exception');
    $('p2Container').value=task.containerNo||'';
    $('p2Exception').value=task.title||task.exceptionKey||'';
    $('p2Severity').value=task.severity||'MEDIUM';
    $('p2Status').value=task.status||'OPEN';
    $('p2Owner').value=task.assignedTo||'Unassigned';
    $('p2Due').value=task.dueDate||'';
    $('p2Followup').value=task.followUpDate||'';
    $('p2Remarks').value=task.remarks||'';
    $('p2TaskModal').classList.add('open');
  }

  function saveTask(){
    if(currentUser?.role==='Viewer'){alert('Read-only access.');return;}
    const list=loadTasks();
    const candidate=selectedCandidate || {};
    const id=editId || ('TASK-'+Date.now()+'-'+Math.floor(Math.random()*1000));
    const task={
      id,containerNo:$('p2Container').value.trim(),exceptionKey:candidate.exceptionKey || (list.find(t=>t.id===editId)||{}).exceptionKey || 'GENERAL',
      title:$('p2Exception').value.trim(),severity:$('p2Severity').value,status:$('p2Status').value,
      assignedTo:$('p2Owner').value.trim()||'Unassigned',dueDate:$('p2Due').value,followUpDate:$('p2Followup').value,
      remarks:$('p2Remarks').value.trim(),updatedAt:new Date().toISOString()
    };
    const idx=list.findIndex(t=>t.id===id);
    if(idx>=0) list[idx]=Object.assign({},list[idx],task); else list.unshift(Object.assign({createdAt:new Date().toISOString(),createdBy:currentOwner()},task));
    saveTasks(list);
    if(typeof logAuditEvent==='function') logAuditEvent(idx>=0?'TASK_UPDATE':'TASK_CREATE',task.containerNo,'TASK',idx>=0?'Existing':'—',task.status+' / '+task.assignedTo);
    $('p2TaskModal').classList.remove('open');selectedCandidate=null;editId=null;renderAll();
    if(typeof toast==='function')toast(idx>=0?'Task updated':'Task created');
  }

  function generateMissing(){
    if(currentUser?.role==='Viewer'){alert('Read-only access.');return;}
    const list=loadTasks(); const existing=new Set(list.map(t=>t.containerNo+'|'+t.exceptionKey)); let added=0;
    candidates().forEach(c=>{
      const key=c.container+'|'+c.exceptionKey;
      if(existing.has(key))return;
      list.unshift({id:'TASK-'+Date.now()+'-'+Math.floor(Math.random()*100000),containerNo:c.container,exceptionKey:c.exceptionKey,title:c.title,severity:c.severity,status:'OPEN',assignedTo:'Unassigned',dueDate:defaultDue(c.severity),followUpDate:'',remarks:c.detail,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:currentOwner()});
      existing.add(key);added++;
    });
    saveTasks(list); renderAll();
    if(typeof toast==='function')toast(added+' exception task(s) created');
  }

  function renderSummary(){
    const list=loadTasks(), now=today(), key=dateKey(now);
    const open=list.filter(t=>t.status!=='RESOLVED').length;
    const mine=list.filter(t=>t.status!=='RESOLVED' && t.assignedTo===currentOwner()).length;
    const overdue=list.filter(t=>t.status!=='RESOLVED' && t.dueDate && t.dueDate<key).length;
    const todayCount=list.filter(t=>t.status!=='RESOLVED' && t.dueDate===key).length;
    $('p2Summary').innerHTML=[
      ['Open Tasks',open,'bad'],['My Tasks',mine,'warn'],['Overdue',overdue,'bad'],['Due Today',todayCount,'warn']
    ].map(x=>'<div class="p2-stat"><small>'+x[0]+'</small><b class="'+x[2]+'">'+x[1]+'</b></div>').join('');
  }

  function renderQueue(){
    const tasks=loadTasks(), byKey=new Map(tasks.map(t=>[t.containerNo+'|'+t.exceptionKey,t]));
    const list=candidates();
    $('p2ExceptionBody').innerHTML=list.map(c=>{
      const t=byKey.get(c.container+'|'+c.exceptionKey);
      const status=t ? '<span class="p2-pill '+(t.status==='RESOLVED'?'good':t.status==='ESCALATED'?'bad':'warn')+'">'+esc2(t.status)+'</span>' : '<span class="p2-pill bad">NOT ASSIGNED</span>';
      return '<tr><td><b>'+esc2(c.container)+'</b><div style="font-size:9px;color:var(--text-muted)">'+esc2(vessel(rows[c.i]))+'</div></td><td>'+esc2(c.title)+'</td><td><span class="p2-pill '+severityClass(c.severity)+'">'+c.severity+'</span></td><td>'+esc2(c.detail)+'</td><td>'+status+'</td><td><button class="btn btn-primary" data-p2-task="'+c.i+'" data-p2-key="'+esc2(c.exceptionKey)+'">'+(t?'✏️ Manage':'➕ Create Task')+'</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="p2-empty">🟢 No current operational exceptions.</td></tr>';
    $('p2ExceptionBody').querySelectorAll('[data-p2-task]').forEach(b=>b.onclick=()=>{
      const c=candidates()[Number(b.dataset.p2Task)];
      if(c)upsertTask(c);
    });
  }

  function renderTaskList(){
    const filter=$('p2Filter')?.value||'ALL', q=($('p2Search')?.value||'').toLowerCase().trim();
    const now=dateKey(today()), me=currentOwner();
    let list=loadTasks().filter(t=>{
      if(filter==='OPEN' && t.status==='RESOLVED')return false;
      if(filter==='MINE' && t.assignedTo!==me)return false;
      if(filter==='OVERDUE' && !(t.status!=='RESOLVED'&&t.dueDate&&t.dueDate<now))return false;
      if(filter==='TODAY' && !(t.status!=='RESOLVED'&&t.dueDate===now))return false;
      if(filter==='RESOLVED' && t.status!=='RESOLVED')return false;
      const blob=(t.containerNo+' '+t.title+' '+t.assignedTo+' '+t.remarks).toLowerCase();
      return !q||blob.includes(q);
    });
    $('p2TaskBody').innerHTML=list.map(t=>{
      const overdue=t.status!=='RESOLVED'&&t.dueDate&&t.dueDate<now, due=t.status!=='RESOLVED'&&t.dueDate===now;
      return '<tr class="'+(overdue?'p2-overdue':due?'p2-due':'')+'"><td><b>'+esc2(t.containerNo)+'</b></td><td>'+esc2(t.title)+'</td><td>'+esc2(t.assignedTo||'Unassigned')+'</td><td><span class="p2-pill '+(t.status==='RESOLVED'?'good':t.status==='ESCALATED'?'bad':'warn')+'">'+esc2(t.status)+'</span></td><td>'+fmtDate(t.dueDate)+(overdue?' <span class="p2-pill bad">OVERDUE</span>':'')+'</td><td>'+fmtDate(t.followUpDate)+'</td><td style="max-width:260px">'+esc2(t.remarks||'—')+'</td><td><button class="btn btn-primary" data-p2-edit="'+esc2(t.id)+'">✏️</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="p2-empty">No tasks match this view.</td></tr>';
    $('p2TaskBody').querySelectorAll('[data-p2-edit]').forEach(b=>b.onclick=()=>{
      const t=loadTasks().find(x=>x.id===b.dataset.p2Edit); if(t){editId=t.id;openTask(t);}
    });
  }

  function renderAll(){
    ensureUI(); renderSummary(); renderQueue();
    if($('p2TaskListModal')?.classList.contains('open'))renderTaskList();
  }

  function bind(){
    ensureUI();
    $('p2TasksBtn').onclick=()=>{$('p2TaskListModal').classList.add('open');renderTaskList();};
    $('p2Generate').onclick=generateMissing;
    $('p2TaskX').onclick=()=>{$('p2TaskModal').classList.remove('open');selectedCandidate=null;editId=null;};
    $('p2Cancel').onclick=()=>{$('p2TaskModal').classList.remove('open');selectedCandidate=null;editId=null;};
    $('p2Save').onclick=saveTask;
    $('p2ListX').onclick=()=>$('p2TaskListModal').classList.remove('open');
    $('p2Filter').onchange=renderTaskList; $('p2Search').oninput=renderTaskList;
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.p2-modal.open').forEach(x=>x.classList.remove('open'));});
    renderAll();
  }

  // Phase 1 creates the Control Tower UI. Bind after it has done so.
  document.addEventListener('DOMContentLoaded',bind);
  if(document.readyState!=='loading')bind();

  const oldRender=window.renderUI;
  if(typeof oldRender==='function'){
    window.renderUI=function(){oldRender.apply(this,arguments); if($('p1v2Tower')?.style.display!=='none')renderAll();};
  }
})();
