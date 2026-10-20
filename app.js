const SUPABASE_URL = "https://ykeucqritoexykqrggzz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- COMPANY CONFIGURATION TABLE ---
// Change these values anytime to instantly update the whole app
const COMPANY_CONFIG = {
  supportEmail: "madhan@gmlindia.net",
  whatsappNumber: "919884070344" // Use country code (91) without the '+' or spaces
};

const USD_TO_INR = 84;
let activeCurrency = localStorage.getItem("gml_curr") || "INR";

const COLS = [
  'CONTAINER NO.', 'TYPE', 'MBL NO', 'LINER', 'GATEWAY PORT', 'CFS NAME', 
  'POL', 'TRANSSHIPMENT PORT', 'ETD', 'FREE DAYS', 'SEAL NO.', 'VESSEL & VOY', 
  'ETA', 'SPLIT DATE', 'INWARD DATE', 'PORT IN', 'PORT OUT', 'CFS IN', 'TRUCK NO.', 
  'DRIVER CONTACT', 'PLANNING', 'DESTUFFING DATE', 'EMPTY RETURN VALIDITY', 'CONTAINER RETURN DATE', 'REMARKS'
];
const DATE_COLS = new Set(['ETD', 'ETA', 'SPLIT DATE', 'INWARD DATE', 'PORT IN', 'PORT OUT', 'CFS IN', 'DESTUFFING DATE', 'EMPTY RETURN VALIDITY', 'CONTAINER RETURN DATE']);

let rows = [];
let cloudDatasetUpdatedAt = null;
let cloudDataReady = Promise.resolve();

let currentUser = null;
let selectedIndices = new Set();
let currentView = 'sheet';
let activeQuickFilter = 'all'; 
let editingIndex = -1;
let sortField = 'ETA';
let sortAsc = true;
let routeMapInstance = null;
let activeTruckSlipIndex = -1;
let pendingDelete = null;
let deleteTimeout = null;
let lastEditedId = -1; 

// Pagination variables
let currentPage = 1;
const ITEMS_PER_PAGE = 25;

let auditLogs = [];
try {
  const savedLogs = localStorage.getItem("gml_audit_trail");
  if (savedLogs) auditLogs = JSON.parse(savedLogs);
} catch(e) {}

const PORT_COORDS = {
  "SHEKOU": [22.44, 113.94],
  "HONG KONG": [22.25, 114.12],
  "BUSAN": [35.10, 129.04],
  "SHANGHAI": [31.28, 122.02],
  "NINGBO": [29.93, 122.03],
  "QINGDAO": [36.05, 120.42],
  "TIANJIN": [38.95, 118.02],
  "TAIWAN": [22.55, 120.29],
  "HO CHI MINH CITY": [10.35, 107.08],
  "BANGKOK": [13.10, 100.88],
  "LAEM CHABANG": [13.09, 100.88],
  "SINGAPORE": [1.26, 103.84],
  "PORT KLANG": [3.00, 101.35],
  "COLOMBO": [6.93, 79.85],
  "HAMBURG": [53.95, 8.2],
  "GENOVA": [44.2, 8.6],
  "CCTL": [13.085, 80.298],
  "CITPL": [13.098, 80.305],
  "KATTUPALLI": [13.315, 80.345],
  "ENNORE": [13.250, 80.332],
  "CHENNAI": [13.0827, 80.2707]
};

const el = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function resetToLanding() {
  // The public landing page is customer-only. Staff users should always
  // return to the staff operations dashboard when they click the brand/home.
  if (currentUser) {
    setAccessState(true);
  } else {
    setAccessState(false);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function animateValue(obj, start, end, duration, isCurrency = false) {
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const easeOut = progress * (2 - progress); 
    const currentVal = Math.floor(easeOut * (end - start) + start);
    obj.innerHTML = isCurrency ? formatCurrency(currentVal) : currentVal;
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function formatCurrency(valUSD) {
  if (activeCurrency === "USD") return `$${Math.round(valUSD).toLocaleString()}`;
  return `₹${Math.round(valUSD * USD_TO_INR).toLocaleString()}`;
}

function copyText(txt) {
  if(!txt) return;
  if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(() => toast("Copied!")).catch(() => fallbackCopy(txt));
  } else {
      fallbackCopy(txt);
  }
}

function fallbackCopy(txt) {
  let textArea = document.createElement("textarea");
  textArea.value = txt;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try { document.execCommand('copy'); toast("Copied!"); } catch(err) { }
  textArea.remove();
}

function formatTruckNo(val) {
  let v = String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(v.length > 2) v = v.substring(0,2) + '-' + v.substring(2);
  if(v.length > 5) v = v.substring(0,5) + '-' + v.substring(5);
  if(v.length > 8) v = v.substring(0,8) + '-' + v.substring(8);
  if(v.length > 13) v = v.substring(0,13);
  return v;
}

function openDrawer() { el("filterDrawer").classList.add("open"); el("filterDrawerOverlay").classList.add("open"); }
function closeDrawer() { el("filterDrawer").classList.remove("open"); el("filterDrawerOverlay").classList.remove("open"); }

el("opsMenuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  el("opsMenuDropdown").classList.toggle("show");
});
document.addEventListener("click", () => el("opsMenuDropdown").classList.remove("show"));

el("currencyToggleBtn").addEventListener("click", () => {
  activeCurrency = activeCurrency === "INR" ? "USD" : "INR";
  localStorage.setItem("gml_curr", activeCurrency);
  el("currencyToggleBtn").textContent = `💱 ${activeCurrency}`;
  renderUI();
});
el("currencyToggleBtn").textContent = `💱 ${activeCurrency}`;

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function parseLocalDate(str) {
  if (!str) return null;
  const clean = String(str).trim().replace(/(\\d{1,2})-([A-Za-z]{3})-(\\d{4})/, "$3-$2-$1").slice(0, 10);
  const parts = clean.split("-").map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(clean);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getField(r, names) {
  if (!r) return "";
  for (let name of names) {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let k of Object.keys(r)) {
      const cleanK = k.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanK === cleanName && r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "") {
        return String(r[k]).trim();
      }
    }
  }
  return "";
}

function logAuditEvent(action, containerNo, field, oldVal, newVal) {
  const operator = currentUser ? `${currentUser.id} (${currentUser.role})` : "System / Auto";
  const entry = {
    id: `LOG-${Date.now()}-${Math.floor(Math.random()*1000)}`,
    timestamp: new Date().toISOString(),
    operator,
    action,
    containerNo: containerNo || "—",
    field: field || "—",
    oldVal: String(oldVal ?? "—").trim() || "—",
    newVal: String(newVal ?? "—").trim() || "—"
  };

  auditLogs.unshift(entry);
  if (auditLogs.length > 500) auditLogs.pop();

  try {
    localStorage.setItem("gml_audit_trail", JSON.stringify(auditLogs));
    sb.from('audit_logs').insert([entry]).then(() => {}).catch(() => {});
  } catch(e) {}

  updateAuditBadge();
}

function updateAuditBadge() {
  const badge = el("auditCountBadge");
  if (badge) badge.textContent = auditLogs.length;
}

function renderAuditTable(filteredList = auditLogs) {
  const tbody = el("auditTableBody");
  if (!filteredList.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px; text-align:center; color:var(--text-muted);">No activity recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredList.map(log => {
    const d = new Date(log.timestamp);
    const dateFormatted = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const timeFormatted = d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

    let actionBadge = `<span class="tag-badge" style="background:var(--accent-glow); color:var(--accent); font-weight:800;">${esc(log.action)}</span>`;
    if (log.action.includes("DELETE")) actionBadge = `<span class="tag-badge danger">${esc(log.action)}</span>`;
    if (log.action.includes("DESTUFF") || log.action.includes("RETURN")) actionBadge = `<span class="tag-badge success">${esc(log.action)}</span>`;

    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 10px; font-family:'JetBrains Mono'; white-space:nowrap; color:var(--text-muted);">${dateFormatted} ${timeFormatted}</td>
        <td style="padding:6px 10px; font-weight:700;">${esc(log.operator)}</td>
        <td style="padding:6px 10px;">${actionBadge}</td>
        <td style="padding:6px 10px; font-family:'JetBrains Mono'; font-weight:800; color:var(--accent);">${esc(log.containerNo)}</td>
        <td style="padding:6px 10px; font-weight:600;">${esc(log.field)}</td>
        <td style="padding:6px 10px; font-family:'JetBrains Mono'; font-size:10.5px;">
          <span style="color:var(--text-dim); text-decoration:line-through;">${esc(log.oldVal)}</span>
          <span style="color:var(--text-muted); margin:0 4px;">➔</span>
          <span style="color:var(--success); font-weight:700;">${esc(log.newVal)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

el("openAuditLogBtn").addEventListener("click", () => {
  renderAuditTable();
  el("clearAuditBtn").style.display = (currentUser && currentUser.role === "Admin") ? "inline-block" : "none";
  el("auditModalBg").classList.add("open");
});
el("auditClose").addEventListener("click", () => el("auditModalBg").classList.remove("open"));

el("auditSearchInput").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = auditLogs.filter(l => 
    l.containerNo.toLowerCase().includes(q) || 
    l.operator.toLowerCase().includes(q) || 
    l.field.toLowerCase().includes(q) ||
    l.action.toLowerCase().includes(q)
  );
  renderAuditTable(filtered);
});

el("exportAuditBtn").addEventListener("click", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditLogs), "Audit_Trail");
  XLSX.writeFile(wb, `Operations_Audit_Log_${new Date().toISOString().slice(0,10)}.xlsx`);
});

el("clearAuditBtn").addEventListener("click", () => {
  if (confirm("Permanently clear the local audit trail?")) {
    auditLogs = [];
    localStorage.removeItem("gml_audit_trail");
    renderAuditTable();
    updateAuditBadge();
    toast("Audit trail cleared");
  }
});

function validateISO6346(cntr) {
  if (!cntr) return { isValid: false, message: "Empty code" };
  const clean = String(cntr).trim().toUpperCase();
  if (clean.length !== 11) return { isValid: false, message: "Must be 11 characters" };

  const charValues = {
    'A':10,'B':12,'C':13,'D':14,'E':15,'F':16,'G':17,'H':18,'I':19,'J':20,
    'K':21,'L':23,'M':24,'N':25,'O':26,'P':27,'Q':28,'R':29,'S':30,'T':31,
    'U':32,'V':34,'W':35,'X':36,'Y':37,'Z':38
  };

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = clean[i];
    let val;
    if (c >= '0' && c <= '9') val = parseInt(c, 10);
    else if (charValues[c]) val = charValues[c];
    else return { isValid: false, message: "Invalid character" };
    sum += val * Math.pow(2, i);
  }

  const checkDigit = (sum % 11) % 10;
  const actualCheck = parseInt(clean[10], 10);
  const isValid = checkDigit === actualCheck;

  return { isValid, message: isValid ? "Valid ISO 6346" : `Checksum error (Expected ${checkDigit})` };
}

function getLfdConfig() {
  const defaults = {
    terminalFreeDays: 3,
    portOutFreeDays: 13,
    detentionFreeDays: 14,
    warningDays: 4,
    criticalDays: 2,
    demRate20: 100,
    demRate40: 225,
    detentionRate20: 75,
    detentionRate40: 150
  };
  try {
    return Object.assign({}, defaults, JSON.parse(localStorage.getItem("gml_phase1_config_v2") || "{}"));
  } catch (e) {
    return defaults;
  }
}

function formatDateLocalDateObj(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}-${months[d.getMonth()]}`;
}

function getEmptyReturnValidity(r) {
  const validityRaw = getField(r, ["EMPTY RETURN VALIDITY", "EMPTY VALIDITY", "EMPTY RETURN LAST DATE"]);
  const returnRaw = getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]);
  const validityDate = parseLocalDate(validityRaw);
  const returnDate = parseLocalDate(returnRaw);
  const today = new Date();
  const nowDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (returnDate) return { date: formatDateLocalDateObj(returnDate), daysLeft: null, state: "returned", label: "EMPTY RETURNED" };
  if (!validityDate) return { date: "—", daysLeft: null, state: "not-set", label: "VALIDITY NOT SET" };
  const daysLeft = Math.floor((validityDate - nowDay) / 86400000);
  return { date: formatDateLocalDateObj(validityDate), daysLeft, state: daysLeft < 0 ? "overdue" : daysLeft <= 2 ? "critical" : daysLeft <= 4 ? "warning" : "safe", label: daysLeft < 0 ? Math.abs(daysLeft) + "d OVERDUE" : daysLeft + "d LEFT" };
}

function calculateStandardFees(r) {
  const is20ft = (getField(r, ["TYPE", "SIZE"]) || "").includes("20");
  const cfg = getLfdConfig();

  // Inside-port / terminal clock
  const demRatePerDay = is20ft ? Number(cfg.demRate20) : Number(cfg.demRate40);
  // Outside-port / carrier detention clock
  const detRatePerDay = is20ft ? Number(cfg.detentionRate20) : Number(cfg.detentionRate40);

  const inwardDate = parseLocalDate(getField(r, ["INWARD DATE"]));
  const portInDate = parseLocalDate(getField(r, ["PORT IN"]));
  const portOutDate = parseLocalDate(getField(r, ["PORT OUT"]));
  const returnDate = parseLocalDate(getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]));

  const today = new Date();
  const nowDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let demDays = 0, demOverdue = false, demCostUSD = 0, portDwell = 0;
  let detDays = 0, detOverdue = false, detCostUSD = 0, totalEquipmentDays = 0;

  // Chennai Port Out free-day rule:
  // LFD is calculated from INWARD DATE + 13 calendar days.
  // This is independent of the terminal configuration value.
  const portFreeDays = Math.max(0, Number(cfg.terminalFreeDays ?? 3));
  let terminalLFD = null;
  let terminalDaysLeft = null;

  if (portInDate) {
    terminalLFD = new Date(portInDate);
    terminalLFD.setDate(terminalLFD.getDate() + Number(cfg.terminalFreeDays ?? 3));
    terminalDaysLeft = Math.floor((terminalLFD - nowDay) / 86400000);

    const endPortDate = portOutDate || nowDay;
    portDwell = Math.max(0, Math.floor((endPortDate - portInDate) / 86400000));
    const insideFreeDays = Number(cfg.terminalFreeDays ?? 3);
    if (portDwell > insideFreeDays) {
      demOverdue = true;
      demDays = portDwell - insideFreeDays;
      demCostUSD = demDays * demRatePerDay;
    }
  }

  // Outside-port detention free-days logic has been replaced by
  // per-container Empty Return Validity. No detention fee is calculated here.
  let detentionLFD = null;
  let detentionDaysLeft = null;
  let carrierFreeDays = 0;
  totalEquipmentDays = 0;
  detDays = 0;
  detOverdue = false;
  detCostUSD = 0;

  return {
    is20ft,
    portDwell,
    totalEquipmentDays,
    terminalLFD: terminalLFD ? formatDateLocalDateObj(terminalLFD) : "—",
    terminalDaysLeft,
    detentionLFD: detentionLFD ? formatDateLocalDateObj(detentionLFD) : "—",
    detentionDaysLeft,
    demOverdue,
    demDays,
    demCostUSD,
    detDays,
    detCostUSD,
    totalCostUSD: demCostUSD + detCostUSD,
    isCompleted: isFullyCompleted(r),
    portFreeDays,
    carrierFreeDays,
    demRatePerDay,
    detRatePerDay
  };
}

function generateCleanManifestHtml(containersList) {
  const now = new Date();
  const generatedDate = now.toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
  const clean = v => /^(unverified|unknown|n\/a|na|-)$/i.test(String(v||"").trim()) ? "" : v;
  const fmt = v => v ? formatDate(v).toUpperCase() : "—";
  const splitVesselVoy = value => {
    const raw=String(value||"").trim();
    const m=raw.match(/^(.*?)(?:\s+V(?:OY)?(?:AGE)?\.?\s*)([A-Z0-9-]+)$/i);
    return m ? {vessel:m[1].trim(),voyage:m[2].trim()} : {vessel:raw||"—",voyage:""};
  };
  const renderRow = r => {
    const container=getField(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"])||"—";
    const type=getField(r,["TYPE","SIZE"])||"—";
    const mbl=getField(r,["MBL NO","MBL","MASTER BL"])||"—";
    const liner=getField(r,["LINER","LINE"])||detectLinerFromMBL(mbl)||"—";
    const pol=clean(getField(r,["POL","PORT OF LOADING"]))||"—";
    const gatewayPort=clean(getField(r,["GATEWAY PORT","GATEWAY","PORT"]))||"—";
    const cfs=getField(r,["CFS NAME","CFS"])||"—";
    const eta=getField(r,["ETA","VESSEL ARRIVAL","ARRIVAL DATE"]);
    const portIn=getField(r,["PORT IN"]);
    const splitDate=getField(r,["SPLIT DATE","SPLIT"]);
    const destuff=getField(r,["DESTUFFING DATE","DESTUFF DATE"]);
    const vessel=splitVesselVoy(getField(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
    const st=getStatus(r);
    const status=(splitDate?"SPLIT COMPLETED":isFullyCompleted(r)?"COMPLETED":(st.text||"IN TRANSIT")).replace(/<[^>]+>/g,"").replace(/^[^A-Z0-9]+/i,"").trim().toUpperCase();
    const remarks=isFullyCompleted(r)?"Empty return completed.":destuff?"De-stuff completed; awaiting empty return.":getField(r,["CFS IN"])?"CFS in-gate completed.":portIn?"Port in recorded.":"—";
    const etd=getField(r,["ETD"]);
    return `
      <tr>
        <td><strong>${esc(container)}</strong><small>${esc(type)}</small></td>
        <td><strong>${esc(mbl)}</strong><small>${esc(liner)}</small></td>
        <td><strong>${esc(vessel.vessel)}${vessel.voyage ? " V"+esc(vessel.voyage) : ""}</strong></td>
        <td><strong>${esc(gatewayPort)}</strong></td>
        <td><strong>${esc(pol)}</strong><small>${etd?"ETD: "+esc(fmt(etd)):""}</small></td>
        <td><strong class="rpt-link">${esc(cfs)}</strong></td>
        <td><strong>${esc(fmt(eta))} / ${esc(fmt(portIn))}</strong></td>
        <td><strong>${esc(fmt(destuff))}</strong></td>
        <td><span class="rpt-status">${esc(status)}</span></td>
        <td><strong>${esc(remarks)}</strong></td>
      </tr>`;
  };
  const renderMobileCard = r => {
    const container=getField(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"])||"—";
    const type=getField(r,["TYPE","SIZE"])||"—";
    const mbl=getField(r,["MBL NO","MBL","MASTER BL"])||"—";
    const liner=getField(r,["LINER","LINE"])||detectLinerFromMBL(mbl)||"—";
    const pol=clean(getField(r,["POL","PORT OF LOADING"]))||"—";
    const gatewayPort=clean(getField(r,["GATEWAY PORT","GATEWAY","PORT"]))||"—";
    const cfs=getField(r,["CFS NAME","CFS"])||"—";
    const eta=getField(r,["ETA","VESSEL ARRIVAL","ARRIVAL DATE"]);
    const portIn=getField(r,["PORT IN"]);
    const splitDate=getField(r,["SPLIT DATE","SPLIT"]);
    const destuff=getField(r,["DESTUFFING DATE","DESTUFF DATE"]);
    const portOut=getField(r,["PORT OUT"]);
    const cfsIn=getField(r,["CFS IN"]);
    const emptyReturn=getField(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE","EMPTY RETURN"]);
    const vessel=splitVesselVoy(getField(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
    const st=getStatus(r);
    const status=(st.text||"⏳ PENDING").replace(/<[^>]+>/g,"").replace(/^[^A-Z0-9]+/i,"").trim().toUpperCase();
    const recordedRemarks=getField(r,["REMARKS","REMARK","STATUS REMARKS","OPERATIONAL REMARKS"]);
    const etd=getField(r,["ETD"]);
    const actualRemarks=recordedRemarks || (emptyReturn?"Empty returned on "+fmt(emptyReturn):destuff?"De-stuffing completed on "+fmt(destuff)+"; empty return pending":cfsIn?"CFS in-gate completed on "+fmt(cfsIn):portOut?"Port-out completed on "+fmt(portOut):portIn?"Port-in completed on "+fmt(portIn):getField(r,["ETA"])?"Awaiting port arrival; ETA "+fmt(eta)+(splitDate?" · split recorded "+fmt(splitDate):"")+(etd?" · ETD "+fmt(etd):""):getField(r,["ETD"])?"Vessel departure recorded on "+fmt(etd)+"; arrival pending":splitDate?"Split recorded on "+fmt(splitDate)+"; next operational milestone not recorded":"No operational milestone recorded");
    const multi=containersList.length>1;
    const cell=(label,value)=>'<div style="padding:'+(multi?'9px 12px':'16px 18px')+';background:#f4f8fc;border-radius:10px;min-width:0"><div style="font-size:'+(multi?'11px':'15px')+';font-weight:800;color:#6b7c92;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px">'+label+'</div><div style="font-size:'+(multi?'16px':'23px')+';font-weight:800;color:#1b2c46;overflow-wrap:anywhere;line-height:1.3">'+esc(value||"—")+'</div></div>';
    return '<section style="padding:'+(multi?'14px':'24px')+';margin-top:'+(multi?'10px':'20px')+';border:1px solid #dce6f0;border-radius:14px;break-inside:avoid"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:'+(multi?'10px':'18px')+';border-bottom:1px solid #dce6f0"><div><div style="font-size:'+(multi?'12px':'17px')+';font-weight:900;color:#1188c1;letter-spacing:.06em">CONTAINER</div><div style="font-size:'+(multi?'22px':'31px')+';font-weight:900;color:#10264a;margin-top:4px;overflow-wrap:anywhere">'+esc(container)+'</div></div><div style="font-size:'+(multi?'13px':'18px')+';font-weight:900;color:#205a8b;background:#eaf3fb;border-radius:8px;padding:'+(multi?'8px 10px':'12px 16px')+';text-align:center">'+esc(status)+'</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:'+(multi?'7px':'12px')+';margin-top:'+(multi?'10px':'18px')+'">'+cell("Size / Type",type)+cell("MBL / Line",mbl+" / "+liner)+cell("Vessel / Voyage",vessel.vessel+(vessel.voyage?" V"+vessel.voyage:""))+cell("Gateway Port",gatewayPort)+cell("Port of Loading",pol+(etd?" · ETD "+fmt(etd):""))+cell("CFS",cfs)+cell("ETA / Port In",fmt(eta)+" / "+fmt(portIn))+cell("Destuffing",fmt(destuff))+cell("Operational Remarks",actualRemarks)+'</div></section>';
  };
  const totalTEU=containersList.reduce((sum,r)=>sum+(String(getField(r,["TYPE","SIZE"])||"").includes("40")?2:1),0);
  return `
  <div id="manifestCaptureContainer" style="width:1600px;background:#fff;padding:${containersList.length>1 ? "24px 28px 20px" : "42px 44px 36px"};font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1b2c46;box-sizing:border-box;border:1px solid #d7e0ea;border-radius:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:4px 0 22px;border-bottom:3px solid #15284a">
      <div><div style="font-size:${containersList.length>1 ? "25px" : "32px"};font-weight:900;letter-spacing:.025em;color:#10264a">GREENWICH MERIDIAN LOGISTICS (INDIA) PVT. LTD.</div><div style="font-size:${containersList.length>1 ? "15px" : "20px"};color:#667891;font-weight:700;margin-top:8px">Live Status Report • Chennai Operations Desk</div></div>
      <div style="font-size:${containersList.length>1 ? "15px" : "20px"};color:#1188c1;font-weight:900">${esc(generatedDate)}</div>
    </div>
    <div style="margin-top:${containersList.length>1 ? "6px" : "12px"}">${containersList.map(renderMobileCard).join("")}</div>
    <div style="display:flex;justify-content:flex-end;gap:28px;padding:${containersList.length>1 ? "10px 4px 0" : "18px 4px 0"};font-size:${containersList.length>1 ? "11px" : "13px"};color:#6b7c92;font-weight:800">
      <span>Total Containers: <b style="color:#243955">${containersList.length}</b></span>
      <span>Total TEU: <b style="color:#243955">${totalTEU}</b></span>
    </div>
  </div>`;
}
function downloadMultipleStatusImage(containersList, titleRef = "Status_Report") {
  if (!containersList || !containersList.length) return toast("No containers selected!");
  if (typeof html2canvas !== "function") return toast("Photo engine is not loaded. Please refresh and try again.");

  const overlay = document.createElement("div");
  overlay.className = "skeleton-overlay";
  overlay.innerHTML = "📸 Preparing Status Photo...";
  document.body.appendChild(overlay);

  const tempWrapper = document.createElement("div");
  tempWrapper.style.position = "fixed";
  tempWrapper.style.left = "0";
  tempWrapper.style.top = "0";
  tempWrapper.style.zIndex = "-1";
  tempWrapper.style.pointerEvents = "none";
  tempWrapper.innerHTML = generateCleanManifestHtml(containersList);
  document.body.appendChild(tempWrapper);

  const target = tempWrapper.querySelector("#manifestCaptureContainer");
  if (!target) {
    tempWrapper.remove();
    overlay.remove();
    return toast("Unable to prepare the status photo.");
  }

  requestAnimationFrame(() => {
    setTimeout(() => {
      html2canvas(target, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#f4f4f5",
        logging: false,
        imageTimeout: 15000,
        removeContainer: true
      }).then(canvas => {
        const cleanup = () => {
          if (tempWrapper.parentNode) tempWrapper.parentNode.removeChild(tempWrapper);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
        canvas.toBlob(blob => {
          if (!blob) {
            cleanup();
            return toast("Could not create the photo file.");
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `GML_Status_${titleRef}_${Date.now()}.png`;
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(url);
          }, 1500);
          cleanup();
          toast("Status photo downloaded successfully!");
        }, "image/png", 1);
      }).catch(err => {
        console.error("Status photo render error:", err);
        if (tempWrapper.parentNode) tempWrapper.parentNode.removeChild(tempWrapper);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        toast("Photo generation failed. Please try again.");
      });
    }, 250);
  });
}

/* Staff Login Handlers — preserve existing Supabase access-code authentication */
function setLoginFeedback(message, kind = "info") {
  const feedback = el("loginFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = "staff-login-feedback is-visible is-" + kind;
}
function clearLoginFeedback() {
  const feedback = el("loginFeedback");
  if (feedback) { feedback.textContent = ""; feedback.className = "staff-login-feedback"; }
}
function setLoginBusy(isBusy) {
  const button = el("loginSubmit");
  if (!button) return;
  button.disabled = isBusy;
  button.classList.toggle("is-loading", isBusy);
  button.setAttribute("aria-busy", String(isBusy));
  const label = button.querySelector(".staff-login-submit-label");
  if (label) label.textContent = isBusy ? "Verifying…" : "Sign In";
  else button.textContent = isBusy ? "Verifying…" : "Sign In";
}
function closeStaffLogin() {
  el("loginModalBg").classList.remove("open");
  clearLoginFeedback();
  setLoginBusy(false);
}
function openStaffLogin() {
  if (el("staffEmailInput")) el("staffEmailInput").value = "";
  if (el("staffPasswordInput")) el("staffPasswordInput").value = "";
  clearLoginFeedback();
  el("loginModalBg").classList.add("open");
  setTimeout(() => el("staffEmailInput")?.focus(), 100);
}
["loginBtn", "publicStaffLoginBtn"].forEach(id => el(id)?.addEventListener("click", openStaffLogin));
["staffEmailInput", "staffPasswordInput"].forEach(id => el(id)?.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); el("loginSubmit").click(); }
}));
el("loginClose").addEventListener("click", closeStaffLogin);
el("loginCancel").addEventListener("click", closeStaffLogin);
el("loginModalBg").addEventListener("click", (event) => {
  if (event.target === el("loginModalBg")) closeStaffLogin();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && el("loginModalBg").classList.contains("open")) closeStaffLogin();
});
el("loginSubmit").addEventListener("click", async () => {
  if (el("loginSubmit").disabled) return;
  const email = (el("staffEmailInput")?.value || "").trim().toLowerCase();
  const password = el("staffPasswordInput")?.value || "";
  setLoginBusy(true);
  try {
    if (email && password) {
      setLoginFeedback("Signing in with Supabase Auth…", "info");
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) throw new Error("Invalid email or password.");
      const { data: profile, error: profileError } = await sb.from("staff_profiles")
        .select("display_name, role, is_active").eq("user_id", data.user.id).maybeSingle();
      if (profileError || !profile || !profile.is_active) {
        await sb.auth.signOut();
        throw new Error("This account does not have an active staff profile. Contact an administrator.");
      }
      localStorage.removeItem("gml_auth_code_user");
      currentUser = { id: profile.display_name || data.user.email || data.user.id, role: profile.role, uid: data.user.id, authenticated: true };
      closeStaffLogin(); setAccessState(true); await loadFromCloud(); toast("Signed in securely");
      return;
    }
    setLoginFeedback("Enter your staff email and password to continue.", "error");
    return;
  } catch(err) {
    console.warn("Staff sign-in failed:", err);
    setLoginFeedback(err.message || "Sign-in failed. Check your connection and try again.", "error");
  } finally { setLoginBusy(false); }
});

el("terminalRoutingBtn")?.addEventListener("click", openTerminalRoutingMaster);
el("logoutBtn").addEventListener("click", async () => {
  if (currentUser?.authenticated) await sb.auth.signOut();
  currentUser = null;
  try {
    localStorage.removeItem("gml_auth_code_user");
    localStorage.removeItem("containerRows");
  } catch (e) {}
  rows = [];
  populateFilters();
  renderUI();
  setAccessState(false);
  setCloudDataState("error", "Sign in to access staff records");
  toast("Logged out");
});

async function checkActiveSession() {
  try {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData?.session;
    if (session?.user) {
      const { data: profile, error } = await sb.from("staff_profiles")
        .select("display_name, role, is_active").eq("user_id", session.user.id).maybeSingle();
      if (!error && profile?.is_active) {
        currentUser = {
          id: profile.display_name || session.user.email || session.user.id,
          role: profile.role,
          uid: session.user.id,
          authenticated: true
        };
        localStorage.removeItem("gml_auth_code_user");
        setAccessState(true);
        return true;
      }
      await sb.auth.signOut();
    }
  } catch (error) {
    console.warn("Supabase Auth session check failed:", error);
  }
  // Legacy browser-stored staff objects are not valid authentication credentials.
  currentUser = null;
  try {
    localStorage.removeItem("gml_auth_code_user");
    localStorage.removeItem("containerRows");
  } catch (e) {}
  rows = [];
  setAccessState(false);
  return false;
}

function setAccessState(isStaff) {
  // Set mode classes synchronously before changing view visibility so CSS cannot
  // leave the staff dashboard behind the public landing page.
  document.body.classList.toggle("public-carrier-mode", !isStaff);
  document.body.classList.toggle("staff-reference-mode", !!isStaff);
  const dashboard = el("opsDashboardView");
  const publicView = el("publicLandingView");
  const opsControls = el("opsControls");
  const publicControls = el("publicControls");
  if (opsControls) opsControls.style.display = isStaff ? "flex" : "none";
  if (publicControls) publicControls.style.display = isStaff ? "none" : "flex";

  if (dashboard) {
    dashboard.style.display = isStaff ? "block" : "none";
    dashboard.classList.remove("fade-in");
    void dashboard.offsetWidth;
    if (isStaff) dashboard.classList.add("fade-in");
  }
  if (publicView) {
    publicView.style.display = isStaff ? "none" : "block";
    publicView.classList.remove("fade-in");
    void publicView.offsetWidth;
    if (!isStaff) publicView.classList.add("fade-in");
  }

  const sidebar = el("staffReferenceSidebar");
  if (sidebar) sidebar.style.display = isStaff ? "flex" : "none";

  if (isStaff && currentUser) {
    const userBadge = el("userBadge");
    if (userBadge) userBadge.textContent = `${currentUser.id} (${currentUser.role})`;
    const isViewer = currentUser.role === "Viewer";
    document.querySelectorAll(".action-editor-only").forEach(elem => {
      elem.style.display = isViewer ? "none" : "inline-flex";
    });
    try {
      renderUI();
    } catch (error) {
      console.error("Staff dashboard render failed:", error);
      toast("Signed in, but the dashboard failed to render. Refresh and try again.");
    }
  }
}

function resolveCoords(name, defaultCoord) {
  const upper = String(name || "").toUpperCase();
  for (const [k, coord] of Object.entries(PORT_COORDS)) {
    if (upper.includes(k)) return { name: k, coord };
  }
  return { name: upper || "PORT", coord: defaultCoord };
}

function getCleanVesselName(vsl) {
  return String(vsl || "").replace(/\b(V|VOY|VOYAGE)\.?\s*[0-9A-Z\/\-]+$/i, "").trim();
}

function getVesselFinderUrl(vesselName) {
  const clean = getCleanVesselName(vesselName);
  return clean ? `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(clean)}` : `https://www.vesselfinder.com/`;
}

// Upgraded Live AIS Integration
async function openRouteMap(originStr, destStr, vesselStr) {
  const cleanVessel = getCleanVesselName(vesselStr);
  const vfUrl = getVesselFinderUrl(vesselStr);

  el("mapModalTitle").innerHTML = `📡 Live AIS: ${esc(cleanVessel || 'Ocean Vessel')} • ${esc(originStr)} → ${esc(destStr)}`;
  el("mapVesselText").textContent = `Locating ${cleanVessel}...`;

  const vfBtn = el("vesselFinderExternalBtn");
  if (vfBtn) vfBtn.href = vfUrl;

  el("mapModalBg").classList.add("open");

  // Initialize Map if needed
  setTimeout(() => {
    if (!routeMapInstance) {
      routeMapInstance = L.map('leafletMap', { zoomControl: true, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18, subdomains: 'abcd' }).addTo(routeMapInstance);
    } else {
      routeMapInstance.eachLayer(layer => {
        if (layer instanceof L.Polyline || layer instanceof L.Marker) routeMapInstance.removeLayer(layer);
      });
    }
    routeMapInstance.invalidateSize();
  }, 120);

  try {
    // NOTE: Replace this URL with your actual Marine API endpoint (e.g., Datalastic or Spire)
    // Example: `https://api.datalastic.com/api/v0/vessel_history?api-key=YOUR_KEY&name=${cleanVessel}`
    const response = await fetch(`https://api.example-marine.com/vessel?name=${encodeURIComponent(cleanVessel)}`);
    
    if (!response.ok) throw new Error("API limits or vessel out of range");
    const aisData = await response.json();

    // Assuming API returns { lat: 14.5, lon: 82.1, speed: 18.5, course: 210, last_update: '...' }
    const liveCoord = [aisData.lat, aisData.lon];
    const origin = resolveCoords(originStr, [22.48, 113.91]);
    const dest = resolveCoords(destStr, [13.0827, 80.2707]);

    // Draw Live Route
    const seaPath = L.polyline([origin.coord, liveCoord, dest.coord], { 
      color: '#38bdf8', weight: 2.5, dashArray: '4, 6', opacity: 0.85 
    }).addTo(routeMapInstance);

    // Plot Markers
    L.marker(origin.coord, { icon: L.divIcon({ html: `<div style="background:#0284c7; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800; font-size:9px;">${origin.name}</div>` }) }).addTo(routeMapInstance);
    L.marker(dest.coord, { icon: L.divIcon({ html: `<div style="background:#10b981; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800; font-size:9px;">⚓ ${dest.name}</div>` }) }).addTo(routeMapInstance);
    
    // Plot Live Vessel
    L.marker(liveCoord, { icon: L.divIcon({ html: `<div style="background:#2563eb; color:#fff; padding:2px 6px; border-radius:6px; font-weight:800; font-size:9.5px;">🚢 ${esc(cleanVessel)} (${aisData.speed}kn)</div>` }) }).addTo(routeMapInstance);

    routeMapInstance.fitBounds(seaPath.getBounds(), { padding: [30, 30] });
    el("mapVesselText").textContent = `Speed: ${aisData.speed}kn | Heading: ${aisData.course}° | Last Ping: ${aisData.last_update}`;

  } catch (error) {
    // Fallback to simulated route if vessel is in deep ocean / API fails
    el("mapVesselText").textContent = `Live AIS unavailable. Showing simulated route.`;
    const origin = resolveCoords(originStr, [22.48, 113.91]);
    const dest = resolveCoords(destStr, [13.0827, 80.2707]);
    const waypoints = [origin.coord, [18.5, 115.0], [6.0, 108.0], [1.35, 104.4], dest.coord];
    
    const seaPath = L.polyline(waypoints, { color: '#64748b', weight: 2, dashArray: '4, 6', opacity: 0.5 }).addTo(routeMapInstance);
    L.marker(origin.coord, { icon: L.divIcon({ html: `<div style="background:#0284c7; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800; font-size:9px;">${origin.name}</div>` }) }).addTo(routeMapInstance);
    L.marker(dest.coord, { icon: L.divIcon({ html: `<div style="background:#10b981; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800; font-size:9px;">⚓ ${dest.name}</div>` }) }).addTo(routeMapInstance);
    routeMapInstance.fitBounds(seaPath.getBounds(), { padding: [30, 30] });
  }
}

el("mapCloseBtn").addEventListener("click", () => el("mapModalBg").classList.remove("open"));

function openEmailModal(idx) {
  const r = rows[idx];
  const cntr = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]);
  const liner = getField(r, ["LINER"]) || detectLinerFromMBL(getField(r, ["MBL NO", "MBL", "MASTER BL"])) || "Shipping Line";
  const gwPort = getGatewayPortInfo(r).name;
  const cfs = getField(r, ["CFS NAME", "CFS"]) || "Designated CFS";
  const st = getStatus(r).text;

  el("emailSubject").value = `Status Update: ${cntr} - ${st.replace(/[^\w\s-]/g, '').trim()}`;
  const body = `Dear Customer,\n\nStatus for Container ${cntr} (${getField(r, ["TYPE", "SIZE"]) || "40' HC"}):\n` +
    `• Line: ${liner}\n• MBL: ${getField(r, ["MBL NO", "MBL", "MASTER BL"]) || 'N/A'}\n• Vessel: ${getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || 'N/A'}\n` +
    `• Port: ${gwPort} (In: ${formatDate(r["PORT IN"]) || 'Pending'} | Out: ${formatDate(r["PORT OUT"]) || 'Pending'})\n` +
    `• CFS: ${cfs}\n• Truck: ${getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]) || 'Pending Assignment'}\n• Status: ${st.replace(/[^\w\s-]/g, '').trim()}\n\nSupport: ${COMPANY_CONFIG.supportEmail}`;

  el("emailBody").value = body;
  el("sendMailtoBtn").href = `mailto:?subject=${encodeURIComponent(el("emailSubject").value)}&body=${encodeURIComponent(body)}`;
  el("emailModalBg").classList.add("open");
}

el("emailModalClose").addEventListener("click", () => el("emailModalBg").classList.remove("open"));
el("copyEmailBtn").addEventListener("click", () => copyText(el("emailBody").value));

function openTerminalRoutingMaster() {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const list = getTerminalRoutingMaster();
  const overlay = document.createElement("div");
  overlay.id = "terminalRoutingOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div style="background:var(--bg-card,#fff);width:min(900px,96vw);max-height:90vh;overflow:auto;border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div><h3 style="margin:0">🧭 Terminal Routing Master</h3><small style="color:var(--text-muted)">Primary rule: Carrier/Liner + Vessel/Service → Terminal</small></div>
        <button class="btn btn-ghost" id="closeTerminalRouting">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.5fr 150px auto;gap:7px;margin-bottom:10px;">
        <input id="trCarrier" class="input" placeholder="Carrier / Liner">
        <input id="trVessel" class="input" placeholder="Vessel / Service">
        <select id="trTerminal" class="select"><option>CCTL</option><option>CITPL</option><option>Kattupalli</option><option>Ennore</option></select>
        <button class="btn btn-primary" id="addTerminalRoute">+ Add</button>
      </div>
      <div id="terminalRoutingRows"></div>
    </div>`;
  document.body.appendChild(overlay);
  const render=()=> {
    const current=getTerminalRoutingMaster();
    overlay.querySelector("#terminalRoutingRows").innerHTML=current.length ? current.map((m,i)=>`
      <div style="display:grid;grid-template-columns:1fr 1.5fr 150px auto;gap:7px;align-items:center;padding:8px;border-bottom:1px solid var(--border);">
        <div>${esc(m.carrier||"ANY")}</div><div>${esc(m.vessel||"ANY")}</div><strong>${esc(m.terminal)}</strong>
        <button class="btn btn-ghost" data-del="${i}">🗑️</button>
      </div>`).join("") : '<div style="padding:20px;text-align:center;color:var(--text-muted)">No routing rules yet. Add your carrier/vessel mappings.</div>';
    overlay.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{const a=getTerminalRoutingMaster();a.splice(Number(b.dataset.del),1);saveTerminalRoutingMaster(a);render();});
  };
  overlay.querySelector("#closeTerminalRouting").onclick=()=>overlay.remove();
  overlay.querySelector("#addTerminalRoute").onclick=()=>{
    const carrier=overlay.querySelector("#trCarrier").value.trim();
    const vessel=overlay.querySelector("#trVessel").value.trim();
    const terminal=overlay.querySelector("#trTerminal").value;
    if(!carrier && !vessel) return alert("Enter carrier or vessel/service.");
    const a=getTerminalRoutingMaster();
    a.push({carrier,vessel,terminal});
    saveTerminalRoutingMaster(a); render();
    toast("Terminal routing added");
  };
  render();
}
el("openAnalyticsBtn").addEventListener("click", () => {
  const completed = rows.filter(r => isFullyCompleted(r));
  let totalTransitDays = 0, countTransit = 0;

  completed.forEach(r => {
    const originDate = parseLocalDate(getField(r, ["ETD"]) || getField(r, ["ETA"]));
    const retDate = parseLocalDate(getField(r, ["CONTAINER RETURN DATE"])) || parseLocalDate(getField(r, ["DESTUFFING DATE"]));
    if (originDate && retDate) {
      const days = Math.floor((retDate - originDate) / (1000 * 60 * 60 * 24));
      if (days >= 0) { totalTransitDays += days; countTransit++; }
    }
  });

  const avgTransit = countTransit > 0 ? (totalTransitDays / countTransit).toFixed(1) : "—";
  const terminalBreakdown = {};
  rows.forEach(r => {
    const t = getGatewayPortInfo(r).name;
    terminalBreakdown[t] = (terminalBreakdown[t] || 0) + 1;
  });

  el("analyticsBody").innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
      <div class="kpi-card">
        <small>Average Turnaround</small>
        <strong>${avgTransit} Days</strong>
      </div>
      <div class="kpi-card">
        <small>Completed Units</small>
        <strong style="color:var(--success);">${completed.length}</strong>
      </div>
    </div>
    <div style="background:var(--bg-elevated); padding:12px; border-radius:8px; border:1px solid var(--border);">
      <div style="font-size:10.5px; font-weight:800; text-transform:uppercase; margin-bottom:8px;">Terminal Distribution</div>
      ${Object.entries(terminalBreakdown).map(([term, num]) => `
        <div style="margin-bottom:6px; display:flex; justify-content:space-between; font-size:11.5px; font-weight:600;">
          <span>${esc(term)}</span>
          <span>${num} units</span>
        </div>
      `).join("")}
    </div>
  `;
  el("analyticsModalBg").classList.add("open");
});
el("analyticsModalClose").addEventListener("click", () => el("analyticsModalBg").classList.remove("open"));

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const target = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", target);
  localStorage.setItem("gml_theme", target);
  el("themeBtn").textContent = target === "dark" ? "☀️" : "🌙";
  el("publicThemeBtn").textContent = target === "dark" ? "☀️" : "🌙";
}
el("themeBtn").addEventListener("click", toggleTheme);
el("publicThemeBtn").addEventListener("click", toggleTheme);
const savedTheme = localStorage.getItem("gml_theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);
el("themeBtn").textContent = savedTheme === "dark" ? "☀️" : "🌙";
el("publicThemeBtn").textContent = savedTheme === "dark" ? "☀️" : "🌙";

function formatDate(val) {
  const s = String(val ?? "").trim();
  if(!s || ["-","—","na","n/a","null"].includes(s.toLowerCase())) return "";
  let d = parseLocalDate(s);
  if (!d) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}`;
}

function validDate(val) {
  const s = String(val ?? "").trim();
  return s && !["-","—","na","n/a","null"].includes(s.toLowerCase()) && !isNaN(Date.parse(s));
}

function getStatus(r) {
  if (validDate(getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]))) return { text: "🔄 EMPTY RETURNED", class: "completed" };
  if (validDate(getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]))) return { text: "📦 DE-STUFF COMPLETED", class: "completed" };
  if (validDate(getField(r, ["CFS IN"]))) return { text: "🏢 CFS IN", class: "progress" };
  if (validDate(getField(r, ["PORT OUT"]))) return { text: "🚚 PORT OUT", class: "progress" };
  if (validDate(getField(r, ["PORT IN"]))) return { text: "⚓ PORT IN", class: "progress" };
  if (validDate(getField(r, ["INWARD DATE", "INWARD"]))) return { text: "📥 INWARD", class: "progress" };
  if (validDate(getField(r, ["ETA"]))) return { text: "⏳ ETA SCHEDULED", class: "progress" };
  if (validDate(getField(r, ["ETD"]))) return { text: "🚢 ETD DEPARTED", class: "progress" };
  return { text: "⏳ PENDING", class: "progress" };
}

function isFullyCompleted(r) {
  return validDate(getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]));
}

function detectLinerFromMBL(mbl) {
  const s = String(mbl || "").trim().toUpperCase();
  if (/^(027|WHLC|WHL)/.test(s)) return "WAN HAI";
  if (/^(274|MAEU|MSK)/.test(s)) return "MAERSK";
  if (/^(MEDU|MSCU)/.test(s)) return "MSC";
  if (/^(ONEY|ONE)/.test(s)) return "ONE";
  if (/^(CMDU|CMA)/.test(s)) return "CMA CGM";
  if (/^(HLCU|HL)/.test(s)) return "HAPAG-LLOYD";
  if (/^(EGLV|EGL)/.test(s)) return "EVERGREEN";
  if (/^(COSU|COS)/.test(s)) return "COSCO";
  if (/^(SNK|SIT)/.test(s)) return "SITC / PAREKH";
  return "";
}

function getCarrierTrackingUrl(r) {
  const liner = (getField(r, ["LINER"]) || "").toLowerCase();
  const ref = encodeURIComponent((getField(r, ["MBL NO", "MBL", "MASTER BL"]) || getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]) || "").trim());
  if (liner.includes("wan hai")) return `https://www.wanhai.com/views/cargo/CargoTracking.xhtml?q_cargo_type=B&q_ref_no=${ref}`;
  if (liner.includes("maersk")) return `https://www.maersk.com/tracking/${ref}`;
  if (liner.includes("msc")) return `https://www.msc.com/en/track-a-shipment?query=${ref}`;
  if (liner.includes("one") || liner.includes("ocean network")) return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?ctrac-field=${ref}`;
  if (liner.includes("cma")) return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=BL&Search=${ref}`;
  return `https://www.google.com/search?q=${encodeURIComponent(liner + ' tracking ' + ref)}`;
}

// Terminal routing master: operationally the terminal is determined primarily
// from carrier/liner + vessel/service. Container number is never used as the
// primary terminal signal.
const TERMINAL_ROUTING_MASTER_KEY = "gml_terminal_routing_master_v1";
const DEFAULT_TERMINAL_ROUTING = [
  // Add your live carrier/vessel mappings here or through the Staff Dashboard.
  // { carrier: "MSC", vessel: "VESSEL NAME", terminal: "CITPL" }
];

function normalizeRoutingText(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
function getTerminalRoutingMaster() {
  try {
    const saved = JSON.parse(localStorage.getItem(TERMINAL_ROUTING_MASTER_KEY) || "null");
    return Array.isArray(saved) ? saved : [...DEFAULT_TERMINAL_ROUTING];
  } catch(e) { return [...DEFAULT_TERMINAL_ROUTING]; }
}
function saveTerminalRoutingMaster(list) {
  localStorage.setItem(TERMINAL_ROUTING_MASTER_KEY, JSON.stringify(list));
}
// Chennai Port arrival schedule mapping.
// Source: Chennai Port Authority expected-arrival vessel schedule.
// CTB1-CTB4 = CCTL; SCB1-SCB3 = CITPL.
const CHENNAI_ARRIVAL_VESSEL_TERMINALS = {
  "SERENE INGRID": "CITPL",
  "SNL HAIKOU": "CCTL",
  "KMTC DELHI": "CITPL",
  "OCEAN GRACE": "CCTL",
  "CAPE HELLAS": "CITPL",
  "MTT SAISUNEE": "CITPL",
  "TS HOCHIMINH": "CCTL",
  "INTERASIA PROGRESS": "CCTL",
  "RACHA BHUM": "CITPL",
  "WAN HAI 501": "CCTL",
  "SITC PENANG": "CCTL",
  "BLPL FAITH": "CCTL",
  "TCI PRABHU": "CITPL",
  "ARTABAZ": "CITPL",
  "VIRA BHUM": "CITPL",
  "XIN TIAN JIN": "CITPL",
  "EVER BRAVE": "CITPL",
  "INTERASIA FORWARD": "CCTL",
  "JIN YU FU TONG": "CITPL",
  "HAN HUI": "CCTL",
  "HIRANYA BHUM": "CITPL",
  "WAN HAI 366": "CCTL",
  "INTERASIA HORIZON": "CITPL",
  "XIN WEN ZHOU": "CITPL",
  "SINAR SIANTAR": "CCTL",
  "WAN HAI 323": "CITPL",
  "INTERASIA CATALYST": "CITPL",
  "SEASPAN SYDNEY": "CITPL",
  "XO LUCKY": "CITPL"
};

function detectTerminalFromChennaiArrival(r) {
  const raw = normalizeRoutingText(getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]));
  if (!raw) return { key:"UNKNOWN", status:"UNVERIFIED", evidence:[] };
  const entries = Object.entries(CHENNAI_ARRIVAL_VESSEL_TERMINALS)
    .filter(([v]) => raw === normalizeRoutingText(v) || raw.startsWith(normalizeRoutingText(v) + " "));
  const keys = [...new Set(entries.map(x => x[1]))];
  if (keys.length === 1) return { key:keys[0], status:"CHENNAI_ARRIVAL", evidence:entries.map(x => x[0]) };
  if (keys.length > 1) return { key:"UNKNOWN", status:"CONFLICT", evidence:entries.map(x => x[0]) };
  return { key:"UNKNOWN", status:"UNVERIFIED", evidence:[] };
}

function detectTerminalFromVessel(r) {
  const mbl = getField(r, ["MBL NO", "MBL", "MASTER BL"]);
  const mappedCarrier = getField(r, ["LINER", "CARRIER", "SHIPPING LINE"]) || detectLinerFromMBL(mbl);
  const carrier = normalizeRoutingText(mappedCarrier);
  const vesselRaw = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
  const vessel = normalizeRoutingText(vesselRaw);
  if (!carrier && !vessel) return { key: "UNKNOWN", status: "UNVERIFIED", evidence: [] };

  const matches = getTerminalRoutingMaster().filter(m => {
    const mc = normalizeRoutingText(m.carrier);
    const mv = normalizeRoutingText(m.vessel);
    if (mc && carrier !== mc) return false;
    if (mv && !(vessel === mv || vessel.includes(mv) || mv.includes(vessel))) return false;
    return ["CCTL","CITPL","Kattupalli","Ennore"].includes(m.terminal);
  });
  const keys = [...new Set(matches.map(m => m.terminal))];
  if (keys.length === 1) return { key: keys[0], status: "AUTO", evidence: matches };
  if (keys.length > 1) return { key: "UNKNOWN", status: "CONFLICT", evidence: matches };
  return { key: "UNKNOWN", status: "UNVERIFIED", evidence: [] };
}

// Vessel Master: keeps the latest resolved terminal call at vessel/voyage level.
const VESSEL_BERTHING_KEY = "gml_vessel_berthing_v1";
function getBerthingRecords(){
  try{const v=JSON.parse(localStorage.getItem(VESSEL_BERTHING_KEY)||"[]");return Array.isArray(v)?v:[];}catch(e){return [];}
}
function saveBerthingRecords(v){localStorage.setItem(VESSEL_BERTHING_KEY,JSON.stringify(v));}
function normalizeBerthingRecord(x){
  return {
    vessel:String(x.vessel||"").trim(),
    voyage:String(x.voyage||"").trim().toUpperCase(),
    terminal:String(x.terminal||"").trim(),
    berth:String(x.berth||"").trim(),
    eta:String(x.eta||"").trim(),
    etb:String(x.etb||"").trim(),
    source:String(x.source||"").trim(),
    updatedAt:x.updatedAt||new Date().toISOString()
  };
}
function upsertBerthingRecord(x){
  const n=normalizeBerthingRecord(x); if(!n.vessel)return;
  const a=getBerthingRecords();
  const k=normalizeVesselKey(n.vessel)+"|"+n.voyage;
  const i=a.findIndex(v=>normalizeVesselKey(v.vessel)+"|"+String(v.voyage||"").toUpperCase()===k);
  if(i>=0)a[i]={...a[i],...n};else a.push(n);
  saveBerthingRecords(a);
}
function matchBerthingToContainer(r){
  const {vessel,voyage}=getVesselVoyageParts(r), vk=normalizeVesselKey(vessel);
  if(!vk)return null;
  const a=getBerthingRecords().filter(x=>{const xv=normalizeVesselKey(x.vessel);return xv&&(vk===xv||vk.includes(xv)||xv.includes(vk))&&(!x.voyage||!voyage||String(x.voyage).toUpperCase()===voyage);});
  return a.sort((x,y)=>new Date(y.updatedAt||0)-new Date(x.updatedAt||0))[0]||null;
}

const VESSEL_MASTER_KEY = "gml_vessel_master_v1";
function renderExceptionQueue() {
  const listNode = el("staffExceptionList");
  const countNode = el("staffExceptionCount");
  const footNode = el("staffExceptionFoot");
  if (!listNode || !countNode) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const parseDay = value => {
    const raw = String(value || "").trim();
    if (!raw || !validDate(raw)) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const daysAgo = value => {
    const day = parseDay(value);
    return day === null ? null : Math.floor((today - day) / 86400000);
  };
  const fmtDay = value => {
    if (!value) return "Date not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  const exceptions = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (!row || typeof row !== "object" || isFullyCompleted(row)) return;
    const container = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NUMBER"]);
    const mbl = getField(row, ["MBL NO", "MBL", "MASTER BL"]);
    const vessel = getField(row, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
    const remarks = getField(row, ["REMARKS", "STATUS", "OPERATIONAL REMARKS"]);
    const eta = getField(row, ["ETA"]);
    const portIn = getField(row, ["PORT IN"]);
    const portOut = getField(row, ["PORT OUT"]);
    const destuff = getField(row, ["DESTUFFING DATE", "DESTUFF DATE"]);
    const returned = getField(row, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]);
    const lfd = getField(row, ["EMPTY RETURN VALIDITY", "EMPTY RETURN LFD", "DETENTION LFD"]);
    const remarkMatch = remarks.match(/\b(hold|damage|damaged|delay|delayed|rollover|customs|not moved|pending|exception|short landed)\b/i);
    let issue = null;

    if (remarkMatch) {
      const term = remarkMatch[0].toLowerCase();
      const critical = /hold|damage|damaged|customs|rollover|short landed/i.test(term);
      issue = { title: "Review operational remarks", detail: remarks, severity: critical ? "high" : "medium", age: null };
    }
    const etaAge = daysAgo(eta);
    if (!issue && !portIn && etaAge !== null && etaAge > 0) {
      issue = { title: "ETA passed · port-in not recorded", detail: "ETA " + fmtDay(eta), severity: etaAge > 2 ? "high" : "medium", age: etaAge };
    }
    const portInAge = daysAgo(portIn);
    if (!issue && portIn && !portOut && portInAge !== null && portInAge >= 2) {
      issue = { title: "Port-out milestone overdue", detail: "Port-in " + fmtDay(portIn), severity: portInAge >= 4 ? "high" : "medium", age: portInAge };
    }
    const portOutAge = daysAgo(portOut);
    if (!issue && portOut && !destuff && portOutAge !== null && portOutAge >= 2) {
      issue = { title: "Destuffing milestone overdue", detail: "Port-out " + fmtDay(portOut), severity: portOutAge >= 4 ? "high" : "medium", age: portOutAge };
    }
    const lfdDays = daysAgo(lfd);
    if (!issue && !returned && lfd && lfdDays !== null && lfdDays >= -2) {
      issue = { title: lfdDays >= 0 ? "Empty-return validity passed" : "Empty-return deadline approaching", detail: "Validity " + fmtDay(lfd), severity: lfdDays >= 0 ? "high" : "medium", age: lfdDays };
    }
    if (!issue) return;
    exceptions.push({ index, container: container || mbl || "Shipment row " + (index + 1), mbl, vessel, ...issue });
  });

  exceptions.sort((a, b) => {
    const severity = (b.severity === "high" ? 1 : 0) - (a.severity === "high" ? 1 : 0);
    if (severity) return severity;
    return (b.age ?? -999) - (a.age ?? -999);
  });
  countNode.textContent = String(exceptions.length);
  if (!exceptions.length) {
    listNode.innerHTML = '<div class="staff-exception-empty">No rule-based exceptions detected in the loaded open shipments. Continue monitoring new milestone updates.</div>';
  } else {
    listNode.innerHTML = exceptions.slice(0, 8).map(item =>
      '<article class="staff-exception-item" data-severity="' + item.severity + '">' +
        '<span class="staff-exception-bar" aria-hidden="true"></span>' +
        '<div class="staff-exception-main"><div class="staff-exception-title">' + esc(item.title) +
          '<span class="staff-exception-tag">' + (item.severity === "high" ? "High priority" : "Review") + '</span></div>' +
          '<div class="staff-exception-ref">' + esc(item.container) + (item.mbl ? " · MBL " + esc(item.mbl) : "") + '</div>' +
          '<div class="staff-exception-meta">' + esc(item.detail) + (item.vessel ? " · " + esc(item.vessel) : "") + '</div></div>' +
        '<button type="button" class="staff-exception-open" data-exception-index="' + item.index + '">Open shipment →</button></article>'
    ).join("");
  }
  if (footNode) footNode.textContent = exceptions.length > 8
    ? "Showing 8 of " + exceptions.length + " flagged open shipments. Based on loaded records, not a live carrier feed."
    : "Based on the latest loaded records; not a live carrier feed.";

  listNode.querySelectorAll("[data-exception-index]").forEach(button => {
    button.addEventListener("click", () => {
      const row = rows[Number(button.dataset.exceptionIndex)];
      if (!row) return;
      const reference = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NUMBER"]) ||
        getField(row, ["MBL NO", "MBL", "MASTER BL"]) ||
        getField(row, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
      const search = el("search");
      if (search) search.value = reference;
      activeQuickFilter = "all";
      document.querySelectorAll(".chip").forEach(chip => chip.classList.toggle("active", chip.dataset.filter === "all"));
      currentPage = 1;
      currentView = "sheet";
      renderUI();
      const table = el("sheetView");
      if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function searchTokensForDisplay(count) {
  return count + " result" + (count === 1 ? "" : "s");
}

function updateReferenceRail() {
  const active = rows.filter(r => !isFullyCompleted(r));
  const completed = rows.filter(r => isFullyCompleted(r)).length;
  const portInPending = active.filter(r => !validDate(getField(r, ["PORT IN"]))).length;
  let portOutPending = 0, destuffingPending = 0;
  active.forEach(r => {
    const portIn = validDate(getField(r, ["PORT IN"]));
    const portOut = validDate(getField(r, ["PORT OUT"]));
    const destuff = validDate(getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]));
    if (portIn && !portOut) portOutPending++;
    if (portOut && !destuff) destuffingPending++;
  });
  const values = {
    ectRailActive: active.length,
    ectRailCompleted: completed,
    ectRailPortIn: portInPending,
    ectRailPortOut: portOutPending,
    ectRailDestuffing: destuffingPending,
    ectVisibleCount: getFilteredRows().length
  };
  Object.entries(values).forEach(([id,value]) => {
    const node = el(id);
    if (node) node.textContent = Number(value).toLocaleString("en-IN");
  });
  const activity = el("ectRecentActivity");
  if (activity) {
    const latest = rows.slice(-4).reverse();
    activity.innerHTML = latest.length ? latest.map(row => {
      const container = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CONTAINER NUMBER"]) || "Container record";
      const vessel = getField(row, ["VESSEL", "VESSEL NAME", "VESSEL / VOYAGE"]) || "";
      const port = getField(row, ["PORT", "GATEWAY PORT", "POD", "DESTINATION"]) || "";
      const statusInfo = getStatus(row) || {text:"Shipment record"};
      const status = typeof statusInfo === "string" ? statusInfo : statusInfo.text;
      const detail = [vessel, port].filter(Boolean).join(" · ");
      return '<div class="ect-recent-item"><span class="ect-recent-dot"></span><div><strong>' + esc(container) + '</strong><small>' + esc(detail || "Shipment record") + '</small></div><time>' + esc(status) + '</time></div>';
    }).join("") : '<div class="ect-recent-empty">No shipment records are available yet.</div>';
  }
}


let staffMapInstance = null;
let staffMapRouteLayer = null;
let staffSelectedRoutePort = "";
let staffSelectedShipmentIndex = null;
function normalizedPortName(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (PORT_COORDS[raw]) return raw;
  if (raw.includes("CHENNAI")) return "CHENNAI";
  if (raw.includes("KATTUPALLI")) return "KATTUPALLI";
  if (raw.includes("ENNORE")) return "ENNORE";
  if (raw.includes("SHANGHAI")) return "SHANGHAI";
  if (raw.includes("NINGBO")) return "NINGBO";
  if (raw.includes("QINGDAO")) return "QINGDAO";
  if (raw.includes("TIANJIN")) return "TIANJIN";
  if (raw.includes("HONG KONG") || raw.includes("HONGKONG")) return "HONG KONG";
  if (raw.includes("HO CHI MINH") || raw.includes("SAIGON")) return "HO CHI MINH CITY";
  if (raw.includes("BANGKOK")) return "BANGKOK";
  if (raw.includes("LAEM CHABANG")) return "LAEM CHABANG";
  if (raw.includes("COLOMBO")) return "COLOMBO";
  if (raw.includes("HAMBURG")) return "HAMBURG";
  if (raw.includes("GENOVA") || raw.includes("GENOA")) return "GENOVA";
  if (raw.includes("TAIWAN") || raw.includes("KAOHSIUNG") || raw.includes("KEELUNG")) return "TAIWAN";
  if (raw.includes("SHEKOU") || raw.includes("YANTIAN") || raw.includes("SHENZHEN")) return "SHEKOU";
  if (raw.includes("SINGAPORE")) return "SINGAPORE";
  if (raw.includes("BUSAN")) return "BUSAN";
  if (raw.includes("PORT KLANG") || raw.includes("KLANG")) return "PORT KLANG";
  return "";
}
function getTransshipmentPorts(row) {
  const raw = getField(row, ["TRANSSHIPMENT PORT", "TRANSHIPMENT PORT", "TRANS-SHIPMENT PORT", "T/S PORT", "TS PORT", "TRANSSHIPMENT"]);
  if (!raw) return [];
  return [...new Set(String(raw).split(/[;,>→|]+/).map(function (value) {
    return normalizedPortName(value);
  }).filter(Boolean))];
}
const MARITIME_ROUTE_WAYPOINTS = {
  // East China Sea and Taiwan/Luzon passages, then South China Sea, Singapore Strait, Malacca Strait and Bay of Bengal.
  "SHANGHAI": [[30.9,123.0],[28.8,124.1],[26.2,123.5],[24.0,122.3],[22.0,120.8],[20.0,118.0],[17.5,115.0],[15.0,112.5],[12.3,110.0],[9.0,106.8],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "NINGBO": [[29.2,123.0],[27.0,124.1],[24.8,123.4],[22.3,121.0],[20.0,118.0],[17.5,115.0],[15.0,112.5],[12.3,110.0],[9.0,106.8],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "QINGDAO": [[34.5,123.0],[31.8,125.0],[29.1,125.0],[26.5,123.5],[24.0,122.3],[22.0,120.8],[20.0,118.0],[17.5,115.0],[15.0,112.5],[12.3,110.0],[9.0,106.8],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "TIANJIN": [[38.6,119.5],[37.0,121.8],[34.2,124.3],[31.0,125.2],[27.5,124.0],[24.0,122.3],[22.0,120.8],[20.0,118.0],[17.5,115.0],[15.0,112.5],[12.3,110.0],[9.0,106.8],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "BUSAN": [[33.7,129.5],[31.3,128.6],[28.8,126.5],[26.2,124.0],[24.0,122.3],[22.0,120.8],[20.0,118.0],[17.5,115.0],[15.0,112.5],[12.3,110.0],[9.0,106.8],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "TAIWAN": [[21.2,119.5],[18.7,117.2],[15.3,113.6],[12.0,110.4],[9.0,107.0],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "SHEKOU": [[22.2,113.86],[21.8,113.9],[20.4,113.8],[18.4,113.2],[16.1,111.8],[13.5,110.6],[11.0,108.7],[8.0,106.4],[6.0,104.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "HONG KONG": [[22.12,114.05],[21.8,113.9],[20.4,113.8],[18.4,113.2],[15.5,112.0],[13.0,110.4],[10.2,108.0],[7.3,105.5],[4.3,104.1],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "HO CHI MINH CITY": [[9.6,107.0],[8.0,105.8],[5.8,104.7],[3.6,104.0],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "BANGKOK": [[11.7,102.0],[9.0,103.5],[6.0,104.2],[3.5,104.0],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "LAEM CHABANG": [[11.7,102.0],[9.0,103.5],[6.0,104.2],[3.5,104.0],[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "SINGAPORE": [[1.35,103.65],[1.4,102.5],[2.8,100.0],[4.8,97.0],[6.7,93.5],[8.9,88.5],[10.8,84.8],[12.6,81.5],[13.35,80.75]],
  "PORT KLANG": [[2.9,100.5],[3.8,98.5],[5.8,95.0],[8.5,90.3],[10.7,85.0],[12.6,81.5],[13.35,80.75]],
  "COLOMBO": [[6.1,79.6],[5.5,79.8],[5.2,81.0],[6.0,82.2],[8.8,82.4],[11.2,81.7],[13.1,80.8]],
  // Hamburg exits via the Elbe estuary before entering the North Sea; Genoa follows open-water approaches around island coasts.
  "HAMBURG": [[53.7,7.5],[54.2,6.5],[54.0,4.5],[52.5,3.0],[51.3,1.5],[50.5,-1.8],[49.0,-5.0],[45.0,-7.5],[45.0,-7.5],[39.0,-9.5],[36.0,-6.0],[36.0,0.0],[35.0,8.0],[33.8,20.0],[31.3,32.2],[29.9,32.55],[27.0,34.0],[22.0,38.0],[16.0,41.0],[12.8,43.5],[12.0,48.0],[11.0,55.0],[10.0,64.0],[9.3,72.0],[11.0,77.5],[13.35,80.75]],
  "GENOVA": [[43.9,8.4],[42.8,7.5],[41.5,7.2],[39.5,7.5],[37.5,8.6],[36.5,12.5],[35.5,18.0],[33.8,26.0],[31.3,32.2],[29.9,32.55],[27.0,34.0],[22.0,38.0],[16.0,41.0],[12.8,43.5],[12.0,48.0],[11.0,55.0],[10.0,64.0],[9.3,72.0],[11.0,77.5],[13.35,80.75]]
};

function buildMaritimeRoute(origin, destination, startCoords, endCoords, transshipmentPorts = []) {
  const indiaGateways = new Set(["CCTL", "CITPL", "KATTUPALLI", "ENNORE", "CHENNAI"]);
  if (!indiaGateways.has(destination)) return null;

  const baseWaypoints = MARITIME_ROUTE_WAYPOINTS[origin];
  if (!baseWaypoints || !Array.isArray(baseWaypoints)) return null;
  let waypoints = baseWaypoints.map(point => point.slice());
  const via = [...new Set((transshipmentPorts || []).filter(Boolean))];

  // Explicit route via Colombo swings west of Sri Lanka and returns north along its eastern coast.
  if (via.includes("COLOMBO")) {
    const singaporeIndex = waypoints.findIndex(point =>
      Math.abs(point[0] - 1.35) < 1.0 && Math.abs(point[1] - 103.65) < 2.0
    );
    if (singaporeIndex < 0) return null;
    waypoints = waypoints.slice(0, singaporeIndex + 1).concat([
      [1.4,102.5],[2.8,100.0],[4.8,97.0],[6.5,92.5],[8.2,87.0],
      [8.7,83.0],[7.8,81.0],[6.93,79.85],[7.4,79.6],[9.0,79.7],
      [11.0,80.0],[12.2,80.15],[13.25,80.35]
    ]);
  }

  // Explicit southern approach into Hong Kong for East Asian origins before joining the South China Sea corridor.
  if (via.includes("HONG KONG") && ["SHANGHAI","NINGBO","QINGDAO","TIANJIN","BUSAN","TAIWAN"].includes(origin)) {
    const southernIndex = waypoints.findIndex(point => point[0] <= 17.5);
    const approachIndex = waypoints.findIndex(point => point[0] <= 22.1);
    if (southernIndex < 0 || approachIndex < 0) return null;
    waypoints = waypoints.slice(0, approachIndex + 1).concat([
      [21.2,120.2],[20.8,117.8],[21.4,115.8],[22.1,114.6],PORT_COORDS["HONG KONG"]
    ], waypoints.slice(southernIndex));
  }

  // Insert the nominated transfer ports only when they sit close to this known sea corridor.
  // If a transfer port is not on a supported safe corridor, fail closed rather than drawing across land.
  const stopInsertion = [];
  via.forEach(function (port) {
    const coords = PORT_COORDS[port];
    if (!coords) { stopInsertion.push({ unsupported: port }); return; }
    let bestIndex = -1, bestDistance = Infinity;
    waypoints.forEach(function (point, index) {
      const avgLat = ((point[0] + coords[0]) / 2) * Math.PI / 180;
      const dLat = point[0] - coords[0];
      const dLng = (point[1] - coords[1]) * Math.cos(avgLat);
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    if (bestDistance > 2.6) stopInsertion.push({ unsupported: port });
    else stopInsertion.push({ port, coords, index: bestIndex, distance: bestDistance });
  });
  if (stopInsertion.some(item => item.unsupported)) return null;

  stopInsertion.sort((a,b) => a.index - b.index);
  for (let i = stopInsertion.length - 1; i >= 0; i--) {
    const stop = stopInsertion[i];
    if (!stop) continue;
    const current = waypoints[stop.index];
    if (current && Math.abs(current[0] - stop.coords[0]) < 0.08 && Math.abs(current[1] - stop.coords[1]) < 0.08) continue;
    waypoints.splice(stop.index + 1, 0, stop.coords);
  }

  const path = [startCoords, ...waypoints, endCoords];
  const dense = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const steps = Math.max(2, Math.ceil(Math.max(Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1])) / 1.0));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      dense.push([a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]);
    }
  }
  dense.push(path[path.length - 1]);
  return { points: dense, stopPoints: via.map(port => ({port, coords: PORT_COORDS[port]})) };
}

function drawStaffRoutesForPort(port) {
  if (!staffMapInstance || !staffMapRouteLayer || !port) return;
  staffSelectedRoutePort = port;
  staffSelectedShipmentIndex = null;
  staffMapRouteLayer.clearLayers();

  const routeGroups = new Map();
  let incompleteCount = 0;

  rows.forEach(function (row) {
    const origin = normalizedPortName(getField(row, ["POL", "PORT OF LOADING", "ORIGIN"]));
    const destination = normalizedPortName(getField(row, ["GATEWAY PORT", "POD", "PORT", "DESTINATION"]));
    const transshipmentPorts = getTransshipmentPorts(row);
    if (origin !== port && destination !== port && !transshipmentPorts.includes(port)) return;

    const originCoords = PORT_COORDS[origin];
    const destinationCoords = PORT_COORDS[destination];
    if (!origin || !destination || !originCoords || !destinationCoords || origin === destination) {
      incompleteCount++;
      return;
    }

    const key = [origin, ...transshipmentPorts, destination].join("→");
    if (!routeGroups.has(key)) {
      routeGroups.set(key, {
        origin,
        destination,
        originCoords,
        destinationCoords,
        transshipmentPorts,
        containers: [],
        vessels: []
      });
    }
    const group = routeGroups.get(key);
    const container = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CONTAINER NUMBER"]);
    const vessel = getField(row, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
    if (container && !group.containers.includes(container)) group.containers.push(container);
    if (vessel && !group.vessels.includes(vessel)) group.vessels.push(vessel);
  });

  const routeBounds = [];
  let routeUnavailableCount = 0;
  let routesDrawn = 0;
  routeGroups.forEach(function (route) {
    const builtRoute = buildMaritimeRoute(route.origin, route.destination, route.originCoords, route.destinationCoords, route.transshipmentPorts);
    if (!builtRoute) { routeUnavailableCount++; return; }
    const points = builtRoute.points;
    routesDrawn++;
    // Marine route follows explicit sea-lane waypoints instead of a generic land-crossing arc.
    L.polyline(points, {
      color: "#ffffff",
      weight: 8,
      opacity: 0.88,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(staffMapRouteLayer);

    const line = L.polyline(points, {
      color: "#0878e8",
      weight: 4,
      opacity: 0.98,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(staffMapRouteLayer);

    const vesselText = route.vessels.slice(0, 4).join(", ");
    const moreVessels = route.vessels.length > 4 ? " +" + (route.vessels.length - 4) + " more" : "";
    const routeSummary = route.containers.length + " shipment" + (route.containers.length === 1 ? "" : "s");
    const viaText = route.transshipmentPorts.length ? "<br>Via: " + esc(route.transshipmentPorts.join(" → ")) : "";
    const tooltipHtml =
      "<strong>" + esc(route.origin) + " → " + esc(route.destination) + "</strong><br>" +
      esc(routeSummary) + viaText +
      (vesselText ? "<br>" + esc(vesselText + moreVessels) : "");
    line.bindTooltip(tooltipHtml, { sticky: true, direction: "top", opacity: 0.98, className: "staff-route-tooltip" });

    builtRoute.stopPoints.forEach(function (stop, stopIndex) {
      const stopMarker = L.circleMarker(stop.coords, {
        radius: 7, color: "#ffffff", weight: 2, fillColor: "#f59e0b", fillOpacity: 1
      }).bindTooltip("<strong>Transshipment</strong><br>" + esc(stop.port) + "<br>Stop " + (stopIndex + 1), {
        direction: "top", offset: [0, -5], className: "staff-route-tooltip"
      }).addTo(staffMapRouteLayer);
      routeBounds.push(stop.coords);
    });

    const destinationIsIndia = ["CCTL", "CITPL", "CHENNAI", "KATTUPALLI", "ENNORE"].includes(route.destination);
    const originMarker = L.circleMarker(route.originCoords, {
      radius: 5, color: "#ffffff", weight: 2, fillColor: "#0878e8", fillOpacity: 1
    }).bindTooltip(esc(route.origin), { direction: "top", offset: [0, -5] }).addTo(staffMapRouteLayer);
    const destinationMarker = L.circleMarker(route.destinationCoords, {
      radius: 5, color: "#ffffff", weight: 2,
      fillColor: destinationIsIndia ? "#19b875" : "#f59e0b", fillOpacity: 1
    }).bindTooltip(esc(route.destination), { direction: "top", offset: [0, -5] }).addTo(staffMapRouteLayer);

    // Direction marker along the route is illustrative only; it is not a live AIS position.
    const arrowIndex = Math.min(points.length - 2, Math.max(1, Math.floor(points.length * 0.64)));
    const before = points[arrowIndex - 1];
    const after = points[arrowIndex + 1];
    const latitudeScale = Math.cos(points[arrowIndex][0] * Math.PI / 180);
    const angle = Math.atan2(-(after[0] - before[0]), (after[1] - before[1]) * latitudeScale) * 180 / Math.PI;
    const arrowIcon = L.divIcon({
      className: "staff-route-direction-wrap",
      html: '<span class="staff-route-direction" style="transform:rotate(' + angle.toFixed(1) + 'deg)" aria-label="Route direction">➤</span>',
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    });
    L.marker(points[arrowIndex], { icon: arrowIcon, interactive: false, keyboard: false }).addTo(staffMapRouteLayer);

    // Vessel glyph identifies the route visually; the app does not claim a current ship position.
    const vesselIcon = L.divIcon({
      className: "staff-route-vessel-wrap",
      html: '<span class="staff-route-vessel" title="Route indicator only — live AIS position not connected" aria-label="Vessel route indicator">🚢</span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    const shipIndex = Math.floor(points.length * 0.48);
    L.marker(points[shipIndex], { icon: vesselIcon, interactive: false, keyboard: false }).addTo(staffMapRouteLayer);

    routeBounds.push(route.originCoords, route.destinationCoords);
  });

  const status = el("staffMapRouteStatus");
  if (status) {
    const routeCount = routesDrawn;
    if (routeCount) {
      status.textContent = routeCount + " sea-lane route path" + (routeCount === 1 ? "" : "s") +
        " from " + port + " · schematic corridor, not live AIS" +
        (routeUnavailableCount ? " · " + routeUnavailableCount + " route pair(s) need a sea-lane definition" : "") +
        (incompleteCount ? " · " + incompleteCount + " record(s) need mapped port details" : "");
    } else if (routeUnavailableCount) {
      status.textContent = "Found shipment records for " + port + ", but no sea-lane definition is available for those route pairs. No line was drawn across land.";
    } else if (incompleteCount) {
      status.textContent = "Found " + incompleteCount + " shipment record(s) for " + port +
        ", but their origin/destination pair is incomplete or not mapped.";
    } else {
      status.textContent = "No complete shipment routes found for " + port + " in the current records.";
    }
  }

  if (routeBounds.length) {
    staffMapInstance.fitBounds(routeBounds, { padding: [36, 36], maxZoom: 4, animate: true });
  }
}

function showShipmentRoute(index) {
  if (!Number.isInteger(Number(index)) || !rows[Number(index)]) {
    toast("Shipment record not found.");
    return;
  }
  const idx = Number(index);
  if (!staffMapInstance || !staffMapRouteLayer) renderStaffAnalytics();
  if (!staffMapInstance || !staffMapRouteLayer || typeof L === "undefined") {
    toast("Map is unavailable. Please try again when the map loads.");
    return;
  }

  const row = rows[idx];
  const container = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CONTAINER NUMBER"]) || ("Shipment " + (idx + 1));
  const rawOrigin = getField(row, ["POL", "PORT OF LOADING", "ORIGIN"]);
  const origin = normalizedPortName(rawOrigin);
  const rawGateway = getField(row, ["GATEWAY PORT", "GATEWAY", "POD", "PORT", "DESTINATION"]);
  const gatewayInfo = getGatewayPortInfo(row);
  const destination = normalizedPortName(gatewayInfo && gatewayInfo.key) || normalizedPortName(rawGateway);
  const transshipmentPorts = getTransshipmentPorts(row);
  const vessel = getField(row, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "Vessel not recorded";
  const originCoords = PORT_COORDS[origin];
  const destinationCoords = PORT_COORDS[destination];

  staffSelectedShipmentIndex = idx;
  staffSelectedRoutePort = "";
  staffMapRouteLayer.clearLayers();

  const status = el("staffMapRouteStatus");
  const summary = el("staffMapSummary");
  const portCount = el("staffMapPortCount");
  if (summary) summary.textContent = "Selected shipment · " + container;
  if (portCount) portCount.textContent = (1 + transshipmentPorts.length + (destination ? 1 : 0)) + " route stop(s)";

  if (!origin || !destination || !originCoords || !destinationCoords) {
    if (status) status.textContent = "Cannot draw " + container + " yet: confirm the POL and final gateway port, and ensure both are mapped.";
    if (el("staffMapCanvas")) el("staffMapCanvas").scrollIntoView({behavior:"smooth",block:"center"});
    return;
  }

  const route = buildMaritimeRoute(origin, destination, originCoords, destinationCoords, transshipmentPorts);
  if (!route || !Array.isArray(route.points) || route.points.length < 2) {
    if (status) status.textContent = "No supported sea-lane definition is available for " + container + "'s route via " + (transshipmentPorts.join(" → ") || "direct") + ". No line was drawn across land.";
    if (el("staffMapCanvas")) el("staffMapCanvas").scrollIntoView({behavior:"smooth",block:"center"});
    return;
  }

  L.polyline(route.points, {
    color:"#ffffff", weight:9, opacity:.94, lineCap:"round", lineJoin:"round", interactive:false
  }).addTo(staffMapRouteLayer);
  const line = L.polyline(route.points, {
    color:"#0878e8", weight:4.5, opacity:1, lineCap:"round", lineJoin:"round"
  }).addTo(staffMapRouteLayer);
  const routeLabel = [origin, ...transshipmentPorts, destination].join(" → ");
  line.bindTooltip(
    "<strong>" + esc(container) + "</strong><br>" + esc(routeLabel) + "<br>" + esc(vessel),
    {sticky:true,direction:"top",opacity:.98,className:"staff-route-tooltip"}
  );

  const bounds = [originCoords, destinationCoords];
  L.circleMarker(originCoords,{radius:7,color:"#fff",weight:2,fillColor:"#0878e8",fillOpacity:1})
    .bindTooltip("<strong>POL</strong><br>"+esc(origin),{direction:"top",className:"staff-route-tooltip"})
    .addTo(staffMapRouteLayer);
  route.stopPoints.forEach(function(stop, stopIndex) {
    L.circleMarker(stop.coords,{radius:7,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:1})
      .bindTooltip("<strong>Transshipment "+(stopIndex+1)+"</strong><br>"+esc(stop.port),{direction:"top",className:"staff-route-tooltip"})
      .addTo(staffMapRouteLayer);
    bounds.push(stop.coords);
  });
  L.circleMarker(destinationCoords,{radius:7,color:"#fff",weight:2,fillColor:"#19b875",fillOpacity:1})
    .bindTooltip("<strong>Final gateway</strong><br>"+esc(destination),{direction:"top",className:"staff-route-tooltip"})
    .addTo(staffMapRouteLayer);

  const arrowIndex = Math.min(route.points.length-2,Math.max(1,Math.floor(route.points.length*.63)));
  const before=route.points[arrowIndex-1], after=route.points[arrowIndex+1];
  const latScale=Math.cos(route.points[arrowIndex][0]*Math.PI/180);
  const angle=Math.atan2(-(after[0]-before[0]),(after[1]-before[1])*latScale)*180/Math.PI;
  const arrowIcon=L.divIcon({
    className:"staff-route-direction-wrap",
    html:'<span class="staff-route-direction" style="transform:rotate('+angle.toFixed(1)+'deg)" aria-label="Route direction">➤</span>',
    iconSize:[25,25],iconAnchor:[12,12]
  });
  L.marker(route.points[arrowIndex],{icon:arrowIcon,interactive:false,keyboard:false}).addTo(staffMapRouteLayer);

  const shipIcon=L.divIcon({
    className:"staff-route-vessel-wrap",
    html:'<span class="staff-route-vessel" title="Schematic route marker — not a live AIS position" aria-label="Vessel route marker">🚢</span>',
    iconSize:[30,30],iconAnchor:[15,15]
  });
  L.marker(route.points[Math.floor(route.points.length*.48)],{icon:shipIcon,interactive:false,keyboard:false}).addTo(staffMapRouteLayer);

  if (status) status.textContent = container + " · " + routeLabel + " · route shown for this shipment only (schematic, not live AIS).";
  if (el("staffMapCanvas")) el("staffMapCanvas").scrollIntoView({behavior:"smooth",block:"center"});
  staffMapInstance.fitBounds(bounds,{padding:[36,36],maxZoom:4,animate:true});
}

function renderStaffAnalytics() {
  const active = rows.filter(r => !isFullyCompleted(r));
  const completed = rows.filter(r => isFullyCompleted(r));
  const portPending = active.filter(r => !validDate(getField(r, ["PORT IN"])));
  const inProgress = active.length - portPending.length;
  const total = rows.length;
  if (el("staffStatusTotal")) el("staffStatusTotal").textContent = total.toLocaleString("en-IN");
  [["staffStatusActive",inProgress],["staffStatusDone",completed.length],["staffStatusPort",portPending.length]].forEach(pair => { if(el(pair[0])) el(pair[0]).textContent=pair[1].toLocaleString("en-IN"); });
  [["staffStatusActivePct",inProgress],["staffStatusDonePct",completed.length],["staffStatusPortPct",portPending.length]].forEach(pair => { if(el(pair[0])) el(pair[0]).textContent=(total?Math.round(pair[1]*100/total):0)+"%"; });
  const denominator = inProgress+completed.length+portPending.length;
  const pct1=denominator?inProgress*100/denominator:0;
  const pct2=denominator?(inProgress+completed.length)*100/denominator:100;
  const donut=el("staffStatusDonut");
  if(donut) donut.style.background="conic-gradient(#1677f2 0 "+pct1+"%,#20bf6b "+pct1+"% "+pct2+"%,#ff8a00 "+pct2+"% 100%)";
  const portCounts=new Map();
  rows.forEach(row=>{
    const origin=normalizedPortName(getField(row,["POL","PORT OF LOADING","ORIGIN"]));
    const dest=normalizedPortName(getField(row,["GATEWAY PORT","POD","PORT","DESTINATION"]));
    const via=getTransshipmentPorts(row);
    [...new Set([origin,dest,...via].filter(Boolean))].forEach(p=>portCounts.set(p,(portCounts.get(p)||0)+1));
  });
  if(el("staffMapPortCount")) el("staffMapPortCount").textContent=portCounts.size+" mapped ports";
  if(el("staffMapSummary")) el("staffMapSummary").textContent=portCounts.size?"Locations matched from existing shipment records":"No recognised port names found in the current records";
  const mapNode=el("staffMapCanvas");
  if(!mapNode) return;
  if(typeof L==="undefined"){mapNode.innerHTML='<div class="staff-map-empty">Map service unavailable. Port data remains available in the shipment table.</div>';return;}
  if(!staffMapInstance){
    mapNode.innerHTML="";
    staffMapInstance=L.map(mapNode,{scrollWheelZoom:false,zoomControl:true,attributionControl:true}).setView([24,75],3);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:12,attribution:"© OpenStreetMap"}).addTo(staffMapInstance);
    staffMapRouteLayer = L.layerGroup().addTo(staffMapInstance);
    const refresh=el("staffMapRefresh");
    if(refresh && !refresh.dataset.bound) { refresh.dataset.bound="1"; refresh.addEventListener("click",()=>{renderStaffAnalytics();setTimeout(()=>staffMapInstance&&staffMapInstance.invalidateSize(),100);}); }
    const showMap=el("staffMapShow");
    if(showMap && !showMap.dataset.bound) { showMap.dataset.bound="1"; showMap.addEventListener("click",()=>{ const panel=showMap.closest(".staff-map-panel"); if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"}); setTimeout(()=>staffMapInstance&&staffMapInstance.invalidateSize(),180); }); }
  }
  if(staffMapInstance._staffMarkers) staffMapInstance._staffMarkers.forEach(marker=>marker.remove());
  staffMapInstance._staffMarkers=[];
  if (staffMapRouteLayer) staffMapRouteLayer.clearLayers();
  const bounds=[];
  portCounts.forEach((shipmentCount,port)=>{
    const coords=PORT_COORDS[port];
    if (!coords) return;
    const isIndia=["CCTL","CITPL","CHENNAI","KATTUPALLI","ENNORE"].includes(port);
    const marker=L.circleMarker(coords,{radius:7,weight:2,color:isIndia?"#20bf6b":"#1677f2",fillColor:isIndia?"#20bf6b":"#1677f2",fillOpacity:.96});
    marker.bindPopup("<strong>"+esc(port)+"</strong><br>"+shipmentCount+" shipment reference(s)<br><small>Click this port to show connected route(s), including transshipments</small>");
    marker.on("click",function(){ drawStaffRoutesForPort(port); });
    marker.addTo(staffMapInstance);
    staffMapInstance._staffMarkers.push(marker);
    bounds.push(coords);
  });
  if(bounds.length) staffMapInstance.fitBounds(bounds,{padding:[24,24],maxZoom:4});
  else staffMapInstance.setView([24,75],2);
  if (staffSelectedShipmentIndex !== null && rows[staffSelectedShipmentIndex]) {
    showShipmentRoute(staffSelectedShipmentIndex);
  } else if (staffSelectedRoutePort && portCounts.has(staffSelectedRoutePort)) {
    drawStaffRoutesForPort(staffSelectedRoutePort);
  } else {
    staffSelectedRoutePort = "";
    if (el("staffMapRouteStatus")) el("staffMapRouteStatus").textContent = "Select Map on a shipment row/card to show its own route, or click a port to see related shipments.";
  }
  setTimeout(()=>staffMapInstance&&staffMapInstance.invalidateSize(),100);
}


function renderMinimalShipmentTable(items) {
  const body = el("sheetTableBody");
  if (!body) return;
  const list = Array.isArray(items) ? items : [];
  const visible = list.slice(0, 25);
  body.innerHTML = visible.map(function (item, idx) {
    const row = item && item.r && typeof item.r === "object" ? item.r : {};
    const rowIndex = item && Number.isInteger(item.i) ? item.i : idx;
    const cn = getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"]) || "—";
    const type = getField(row, ["TYPE", "SIZE", "CONTAINER TYPE"]) || "—";
    const mbl = getField(row, ["MBL NO", "MBL", "MASTER BL"]) || "—";
    const liner = getField(row, ["LINER", "LINE", "CARRIER"]) || "—";
    const port = getField(row, ["GATEWAY PORT", "POD", "PORT", "DESTINATION"]) || "—";
    const transshipment = getField(row, ["TRANSSHIPMENT PORT", "TRANSHIPMENT PORT", "TRANS-SHIPMENT PORT", "T/S PORT", "TS PORT"]) || "—";
    const portIn = getField(row, ["PORT IN"]) || "—";
    const portOut = getField(row, ["PORT OUT"]) || "—";
    const cfs = getField(row, ["CFS NAME", "CFS"]) || "—";
    const truck = getField(row, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]) || "—";
    const destuff = getField(row, ["DESTUFFING DATE", "DESTUFF DATE"]) || "—";
    const returned = getField(row, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]) || "—";
    const remarks = getField(row, ["REMARKS", "NOTES"]) || "—";
    return "<tr><td><input type='checkbox' class='chk-item' value='" + rowIndex + "'></td>" +
      "<td><strong>" + esc(cn) + "</strong></td><td>" + esc(type) + "</td><td>" + esc(mbl) +
      "</td><td>" + esc(liner) + "</td><td>" + esc(port) + "</td><td>" + esc(transshipment) + "</td><td>" + esc(portIn) +
      "</td><td>" + esc(portOut) + "</td><td>" + esc(cfs) + "</td><td>" + esc(truck) +
      "</td><td>" + esc(destuff) + "</td><td>" + esc(returned) + "</td><td>—</td><td>—</td><td>—</td><td>" +
      esc(remarks) + "</td><td><div class='staff-recovery-actions'><button class='btn staff-shipment-map-btn' type='button' onclick='showShipmentRoute(" + rowIndex + ")'>🗺️ Map</button><button class='btn' type='button' onclick='openModal(" + rowIndex + ")'>View / Edit</button></div></td></tr>";
  }).join("") || "<tr><td colspan=\'18\' style=\'padding:28px;text-align:center;color:#64748b\'>No shipment records are loaded. Check the Sync status above and retry the cloud connection.</td></tr>";
  const pager = el("paginationWrapper");
  if (pager) pager.textContent = list.length > 25 ? "Showing first 25 of " + list.length + " records (recovery view)" : "Recovery view · " + list.length + " records";
}


// Shipment rows are never restored from browser storage before staff authentication.
try { localStorage.removeItem("containerRows"); } catch(e) {}
rows = [];
populateFilters();
cloudDataReady = (async () => {
  const authenticatedStaff = await checkActiveSession();
  if (authenticatedStaff) {
    await loadFromCloud();
    return;
  }
  rows = [];
  populateFilters();
  renderUI();
  setCloudDataState("error", "Sign in to access staff records");
})();
updateAuditBadge();

activeQuickFilter = 'all';
document.querySelectorAll(".chip").forEach(c => {
  c.classList.toggle("active", c.dataset.filter === 'all');
});
renderUI();


function normalizeVesselKey(v) {
  return normalizeRoutingText(String(v || "").replace(/\\b(V\s*\d+[A-Z]?)\\b/gi, ""));
}
function getVesselMaster() {
  try {
    const v = JSON.parse(localStorage.getItem(VESSEL_MASTER_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch(e) { return []; }
}
function saveVesselMaster(v) {
  localStorage.setItem(VESSEL_MASTER_KEY, JSON.stringify(v));
}
function getVesselVoyageParts(r) {
  const raw = String(getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "").trim();
  const m = raw.match(/^(.*?)(?:\\s+V(?:OY)?[\\s-]*)?([0-9]{3,4}[A-Z])$/i);
  return {
    raw,
    vessel: (m ? m[1] : raw).trim(),
    voyage: (m ? m[2] : "").toUpperCase()
  };
}
function findVesselMasterMatch(r) {
  const {vessel,voyage}=getVesselVoyageParts(r);
  const vk=normalizeVesselKey(vessel);
  if (!vk) return null;
  const matches=getVesselMaster().filter(x => {
    const xv=normalizeVesselKey(x.vessel);
    if (!xv || !(vk===xv || vk.includes(xv) || xv.includes(vk))) return false;
    return !x.voyage || !voyage || String(x.voyage).toUpperCase()===voyage;
  });
  if (!matches.length) return null;
  return matches.sort((a,b)=>(new Date(b.updatedAt||0))-(new Date(a.updatedAt||0)))[0];
}
function upsertVesselMasterFromDetection(r, info) {
  if (!info || !info.key || info.key==="UNKNOWN" || info.detectionStatus==="MANUAL_OVERRIDE") return;
  const {vessel,voyage}=getVesselVoyageParts(r);
  if (!vessel) return;
  const list=getVesselMaster();
  const vk=normalizeVesselKey(vessel);
  const idx=list.findIndex(x => normalizeVesselKey(x.vessel)===vk && String(x.voyage||"").toUpperCase()===voyage);
  const entry={vessel,voyage,terminal:info.key,source:info.detectionStatus,updatedAt:new Date().toISOString()};
  if(idx>=0) list[idx]={...list[idx],...entry}; else list.push(entry);
  saveVesselMaster(list);
}

function getGatewayPortInfo(r) {
  const urls = {
    CCTL: "https://122.252.230.102/DPWCCTTracking/Index.php",
    CITPL: "https://cp.citpl.co.in/enquiry/ctrHist",
    Kattupalli: "https://www.adaniports.com/",
    Ennore: "https://timetocargo.com/"
  };
  const names = { CCTL: "CCTL", CITPL: "CITPL", Kattupalli: "Kattupalli", Ennore: "Ennore" };

  // IMPORTANT: Never use the stored GATEWAY PORT value as an automatic
  // selector. Old/imported CCTL values may be stale. Terminal selection must
  // come from the carrier + vessel routing master.
  const arrival = detectTerminalFromChennaiArrival(r);
  if (arrival.key !== "UNKNOWN") {
    return { name: names[arrival.key], url: urls[arrival.key], key: arrival.key,
      detectionStatus: arrival.status, evidence: arrival.evidence };
  }

  const route = detectTerminalFromVessel(r);
  if (route.key !== "UNKNOWN") {
    const master = findVesselMasterMatch(r);
    if (master && master.terminal !== route.key) {
      return { name:names[route.key], url:urls[route.key], key:route.key,
        detectionStatus:"CONFLICT", evidence:[{master:master.terminal}, ...route.evidence] };
    }
    upsertVesselMasterFromDetection(r, route);
    return { name: names[route.key], url: urls[route.key], key: route.key,
      detectionStatus: route.status, evidence: route.evidence };
  }
  const master = findVesselMasterMatch(r);
  if (master && names[master.terminal]) {
    return { name:names[master.terminal], url:urls[master.terminal], key:master.terminal,
      detectionStatus:"VESSEL_MASTER", evidence:[master] };
  }

  // Preserve any existing terminal only as reference evidence; do NOT let it
  // silently become the selected terminal.
  const existing = String(getField(r, ["GATEWAY PORT", "GATEWAY"]) || "").trim().toUpperCase();
  const manualOverride = String(r.__terminalOverride || "").trim();
  const overrideKey = manualOverride.toUpperCase();
  if (["CCTL","CITPL","KATTUPALLI","ENNORE"].includes(overrideKey)) {
    const key = overrideKey === "KATTUPALLI" ? "Kattupalli" : overrideKey === "ENNORE" ? "Ennore" : overrideKey;
    return { name:names[key], url:urls[key], key, detectionStatus:"MANUAL_OVERRIDE", evidence:[{field:"Manual Override",value:key}] };
  }
  return {
    name: "Unverified",
    url: "",
    key: "UNKNOWN",
    detectionStatus: route.status,
    evidence: existing ? [{ field: "Existing GATEWAY PORT", value: existing }] : []
  };
}

function getCfsDepotInfo(cfsName) {
  const name = (cfsName || "").toUpperCase();
  if (name.includes("ECCT")) return { name: "ECCT CFS", url: "http://ecctcfs.com/containerTrackAndTrace.jsp" };
  if (name.includes("TRIWAY")) return { name: "Triway CFS", url: "https://www.triway.in/" };
  return { name: name || "CFS", url: `https://www.google.com/search?q=${encodeURIComponent(cfsName + ' cfs chennai')}` };
}

function setGatewayPort(idx, val) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const old = rows[idx]["GATEWAY PORT"];
  rows[idx]["GATEWAY PORT"] = val;
  rows[idx].__terminalOverride = val;
  logAuditEvent("PORT_CHANGE", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "GATEWAY PORT", old, val);
  lastEditedId = idx;
  saveAndRefresh();
  toast(`Port: ${val}`);
}

el("bulkDestuffBtn").addEventListener("click", () => {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  if (!selectedIndices.size) return alert("Select containers first.");
  const todayStr = new Date().toISOString().slice(0, 10);
  
  if (confirm(`Mark ${selectedIndices.size} containers as Destuffed today?`)) {
    selectedIndices.forEach(idx => {
      const oldVal = rows[idx]["DESTUFFING DATE"];
      rows[idx]["DESTUFFING DATE"] = todayStr;
      if (!rows[idx]["REMARKS"]) rows[idx]["REMARKS"] = "DE-STUFF COMPLETED";
      logAuditEvent("BULK_DESTUFF", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "DESTUFFING DATE", oldVal, todayStr);
    });
    saveAndRefresh();
    selectedIndices.clear();
    toast(`Marked destuffed`);
  }
});

// Upgraded WhatsApp Composer to handle Bulk Arrays
function openWhatsAppComposer(idx = -1, selectedArr = null) {
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let text = "";

  if (idx !== -1) {
    const r = rows[idx];
    const fees = calculateStandardFees(r);
    const cntr = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]);
    text = `📦 *SHIPMENT TRACKING UPDATE* • ${dateStr}\n` +
           `━━━━━━━━━━━━━━━━━━━━━━\n` +
           `*Container:* ${cntr} (${getField(r, ["TYPE", "SIZE"]) || "40' DC"})\n` +
           `*Line / MBL:* ${getField(r, ["LINER"]) || '-'} | ${getField(r, ["MBL NO", "MBL", "MASTER BL"]) || '-'}\n` +
           `*Vessel:* ${getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || '-'}\n` +
           (r["INWARD DATE"] ? `*Inward Date:* ${formatDate(r["INWARD DATE"])}\n` : '') +
           `*Port In:* ${formatDate(r["PORT IN"]) || 'Pending'} | *Port Out:* ${formatDate(r["PORT OUT"]) || 'Pending'}\n` +
           `*CFS Depot:* ${getField(r, ["CFS NAME", "CFS"]) || '-'}\n` +
           (getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]) ? `*Truck No:* ${getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"])}\n` : '') +
           `*Status:* ${getStatus(r).text.replace(/[^\w\s-]/g, '').trim()}\n` +
           `*Free Days:* Terminal (${fees.terminalDaysLeft !== null ? fees.terminalDaysLeft + 'd' : '—'}) | Detention (${fees.detentionDaysLeft !== null ? fees.detentionDaysLeft + 'd' : '—'})\n` +
           (r["REMARKS"] ? `*Remark:* ${r["REMARKS"]}\n` : '') +
           `━━━━━━━━━━━━━━━━━━━━━━\nInquiries: ${COMPANY_CONFIG.supportEmail}`;
  } else {
    // Aggregates all selected containers into one broadcast list
    const active = selectedArr ? selectedArr.map(i => rows[i]) : rows.filter(r => !isFullyCompleted(r));
    text = `🚢 *GREENWICH MERIDIAN LOGISTICS*\n` +
           `📋 *BULK DISPATCH BRIEF* • ${dateStr}\n` +
           `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    active.forEach((r, i) => {
      text += `${i + 1}. *${getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"])}* (${getField(r, ["TYPE", "SIZE"]) || "40' DC"})\n` +
              `   • Status: ${getStatus(r).text.replace(/[^\w\s-]/g, '').trim()} | CFS: ${getField(r, ["CFS NAME", "CFS"]) || '-'}\n` +
              `   • Port In: ${formatDate(r["PORT IN"]) || 'Pending'} | Port Out: ${formatDate(r["PORT OUT"]) || 'Pending'}\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━━━\nInquiries: ${COMPANY_CONFIG.supportEmail}`;
  }

  el("whatsappComposerText").value = text;
  el("openDirectWhatsAppBtn").href = `https://wa.me/${COMPANY_CONFIG.whatsappNumber}?text=${encodeURIComponent(text)}`;
  el("whatsappComposerModalBg").classList.add("open");
}

el("whatsappComposerClose").addEventListener("click", () => el("whatsappComposerModalBg").classList.remove("open"));
el("copyComposerTextBtn").addEventListener("click", () => copyText(el("whatsappComposerText").value));

// Bind the Broadcast button to pass ALL selected containers
el("bulkWhatsAppBtn").addEventListener("click", () => {
  if (!selectedIndices.size) return alert("Select at least one container!");
  openWhatsAppComposer(-1, Array.from(selectedIndices));
});

// Snapshot button is bound once above. Do not attach a second click handler here.

function getFilteredRows() {
  const q = el("search").value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const vf = el("vesselFilter").value;
  const gw = el("gatewayFilter").value;
  const cf = el("cfsFilter").value;
  const todayStr = new Date().toISOString().slice(0, 10);

  let filtered = rows.map((r, i) => ({r, i})).filter(({r}) => {
    const rawCntr = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]);
    const cntr = rawCntr.toLowerCase().replace(/[^a-z0-9]/g, '');
    const vsl = (getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "").toLowerCase();
    const mbl = (getField(r, ["MBL NO", "MBL", "MASTER BL"]) || "").toLowerCase().replace(/[^a-z0-9]/g, '');
    const truck = (getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]) || "").toLowerCase().replace(/[^a-z0-9]/g, '');
    const completed = isFullyCompleted(r);
    const fees = calculateStandardFees(r);

    if (q && !cntr.includes(q) && !vsl.includes(q) && !mbl.includes(q) && !truck.includes(q)) return false;
    if (vf && getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) !== vf) return false;
    if (gw && !(getField(r, ["GATEWAY PORT", "PORT"]) || "").toLowerCase().includes(gw.toLowerCase())) return false;
    if (cf && getField(r, ["CFS NAME", "CFS"]) !== cf) return false;

    // Shipment stages are mutually exclusive. A container belongs to the
    // first stage it has not yet completed, so updating a milestone moves it
    // automatically to the next filter.
    const hasPortIn = validDate(getField(r, ["PORT IN"]));
    const hasPortOut = validDate(getField(r, ["PORT OUT"]));
    const hasCfsIn = validDate(getField(r, ["CFS IN"]));
    const hasDestuff = validDate(getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]));
    const hasEmptyReturn = validDate(getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]));

    if (activeQuickFilter === "active" && hasPortIn) return false;
    if (activeQuickFilter === "port_in" && !(hasPortIn && !hasPortOut)) return false;
    if (activeQuickFilter === "port_out" && !(hasPortOut && !hasCfsIn)) return false;
    if (activeQuickFilter === "cfs_in" && !(hasCfsIn && !hasDestuff)) return false;
    if (activeQuickFilter === "empty_pending" && !(hasDestuff && !hasEmptyReturn)) return false;
    if (activeQuickFilter === "completed" && !hasEmptyReturn) return false;

    return true;
  });

  // Default operations order: earliest ETA first. Containers without ETA
  // are kept at the bottom so missing data never jumps ahead of scheduled cargo.
  // Manual table sorting still overrides this when another sort field is selected.
  if (sortField === "ETA") {
    filtered.sort((a, b) => {
      const da = parseLocalDate(getField(a.r, ["ETA"]));
      const db = parseLocalDate(getField(b.r, ["ETA"]));
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      const diff = da.getTime() - db.getTime();
      return sortAsc ? diff : -diff;
    });
  } else if (sortField) {
    filtered.sort((a, b) => {
      const vA = (a.r[sortField] || "").toLowerCase();
      const vB = (b.r[sortField] || "").toLowerCase();
      return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
  }

  return filtered;
}

function updateDataQualityNotice() {
  const box = el("dataQualityNotice");
  if (!box) return;
  const list = Array.isArray(rows) ? rows : [];
  const normalize = value => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const seen = new Map();
  let missingContainer = 0;
  let emptyRows = 0;
  list.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length === 0) {
      emptyRows++;
      return;
    }
    const cn = normalize(getField(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"]));
    if (!cn) { missingContainer++; return; }
    if (!seen.has(cn)) seen.set(cn, []);
    seen.get(cn).push(index);
  });
  const duplicateGroups = [...seen.entries()].filter(([,indices]) => indices.length > 1);
  const duplicateRows = duplicateGroups.reduce((sum,[,indices]) => sum + indices.length - 1, 0);
  const issueCount = duplicateGroups.length + missingContainer + emptyRows;
  if (!list.length) {
    box.hidden = false;
    box.className = "data-quality-notice has-issues";
    box.innerHTML = '<span class="data-quality-icon" aria-hidden="true">!</span><div class="data-quality-copy"><strong class="data-quality-title">Shipment data not loaded</strong><span class="data-quality-meta">No shipment rows are currently available. Check the cloud connection before editing or importing records.</span></div>';
    return;
  }
  if (!issueCount) {
    box.hidden = false;
    box.className = "data-quality-notice";
    box.innerHTML = '<span class="data-quality-icon" aria-hidden="true">✓</span><div class="data-quality-copy"><strong class="data-quality-title">Data integrity check</strong><span class="data-quality-meta">' + list.length + ' records checked · no missing container numbers, empty rows or repeated container identifiers detected. This is a client-side structural check, not a server audit.</span></div>';
    return;
  }
  const parts = [];
  if (duplicateGroups.length) parts.push(duplicateGroups.length + " repeated container number(s) affecting " + duplicateRows + " extra row(s)");
  if (missingContainer) parts.push(missingContainer + " row(s) missing container number");
  if (emptyRows) parts.push(emptyRows + " empty or invalid row(s)");
  box.hidden = false;
  box.className = "data-quality-notice has-issues";
  box.innerHTML = '<span class="data-quality-icon" aria-hidden="true">!</span><div class="data-quality-copy"><strong class="data-quality-title">Review data before release</strong><span class="data-quality-meta">' + parts.map(esc).join(" · ") + '. No records were changed or removed automatically. Check whether repeated container numbers are legitimate before correcting them.</span></div>';
}

function updateKPIs() {
  const active = rows.filter(r => !isFullyCompleted(r));
  let portOutPending = 0;
  let destuffingPending = 0;
  let totalExposureUSD = 0;

  active.forEach(r => {
    const fees = calculateStandardFees(r);
    totalExposureUSD += fees.totalCostUSD;

    const hasPortIn = validDate(getField(r, ["PORT IN"]));
    const hasPortOut = validDate(getField(r, ["PORT OUT"]));
    const hasDestuff = validDate(getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]));

    if (hasPortIn && !hasPortOut) portOutPending++;
    if (hasPortOut && !hasDestuff) destuffingPending++;
  });

  // Animate metrics on render
  animateValue(el("kActive"), 0, active.length, 800);
  animateValue(el("kCompleted"), 0, rows.filter(r => isFullyCompleted(r)).length, 800);
  animateValue(el("kPortInPending"), 0, active.filter(r => !validDate(getField(r, ["PORT IN"]))).length, 800);
  animateValue(el("kPortOutPending"), 0, portOutPending, 800);
  animateValue(el("kDestuffingPending"), 0, destuffingPending, 800);
  animateValue(el("kTotalExposure"), 0, totalExposureUSD, 1000, true);
}


function renderUI() {
  const viewElements = { cards: el("cardsView"), sheet: el("sheetView"), kanban: el("kanbanView") };
  if (!Object.prototype.hasOwnProperty.call(viewElements, currentView) || !viewElements[currentView]) currentView = "sheet";

  // Set the selected panel visible before running optional charts or diagnostics.
  Object.entries(viewElements).forEach(([mode, node]) => {
    if (!node) return;
    const active = mode === currentView;
    node.style.display = active ? (mode === "sheet" ? "block" : "grid") : "none";
    if (active) node.classList.add("fade-in");
  });
  document.querySelectorAll(".view-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === currentView));

  let filtered = [];
  try {
    filtered = getFilteredRows();
  } catch (error) {
    console.error("Shipment filtering failed; showing the original records in recovery view.", error);
    filtered = Array.isArray(rows) ? rows.map((r, i) => ({ r: r || {}, i: i })) : [];
  }

  const countNode = el("searchResultCount");
  if (countNode) countNode.textContent = searchTokensForDisplay(filtered.length);
  const overviewCount = el("ectVisibleCount");
  if (overviewCount) overviewCount.textContent = filtered.length.toLocaleString("en-IN");

  try {
    if (currentView === "cards") renderCards(filtered);
    else if (currentView === "sheet") renderSheet(filtered);
    else renderKanban(filtered);
  } catch (error) {
    console.error("Full shipment view failed; falling back to a read-only data table.", error);
    currentView = "sheet";
    Object.entries(viewElements).forEach(([mode, node]) => {
      if (node) node.style.display = mode === "sheet" ? "block" : "none";
    });
    document.querySelectorAll(".view-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === "sheet"));
    renderMinimalShipmentTable(filtered);
  }

  // Optional dashboard panels must never prevent the actual shipment table/cards from rendering.
  try { updateKPIs(); } catch (error) { console.warn("KPI refresh failed.", error); }
  try { renderExceptionQueue(); } catch (error) { console.warn("Exception queue refresh failed.", error); }
  try { updateDataQualityNotice(); } catch (error) { console.warn("Data integrity notice failed.", error); }
  try { updateReferenceRail(); } catch (error) { console.warn("Recent shipments summary failed.", error); }
  try {
    renderStaffAnalytics();
  } catch (error) {
    console.warn("Map or chart could not render; shipment data remains available.", error);
    const mapNode = el("staffMapCanvas");
    if (mapNode && !mapNode.querySelector(".staff-map-empty")) {
      mapNode.innerHTML = '<div class="staff-map-empty">The map is temporarily unavailable. Shipment records remain available in the table below.</div>';
    }
  }

  const count = selectedIndices.size;
  const selection = el("selectionNotice");
  if (selection) selection.textContent = count + " selected";
  const selectCount = el("btnSelectCount");
  if (selectCount) selectCount.textContent = count;
  const actionBar = el("floatingActionBar");
  if (actionBar) actionBar.classList.toggle("show", count > 0);
}

function getLfdHtml(daysLeft, isOverdue, label, totalDays) {
  if (isOverdue) return `<div class="lfd-wrap danger"><div class="lfd-label">${label}: OVERDUE</div><div class="lfd-bar"><div class="lfd-fill" style="width:100%"></div></div></div>`;
  if (daysLeft === null) return '';
  
  const maxDays = totalDays || 14; 
  const daysConsumed = Math.max(0, maxDays - daysLeft);
  const pct = Math.max(5, Math.min(100, (daysConsumed / maxDays) * 100));
  
  let state = 'success';
  if (daysLeft <= 2) state = 'danger pulse';
  else if (daysLeft <= 4) state = 'warning';
  
  return `<div class="lfd-wrap ${state}">
            <div class="lfd-label">${label}: ${daysLeft}d Left</div>
            <div class="lfd-bar"><div class="lfd-fill" style="width:${pct}%"></div></div>
          </div>`;
}

function renderCards(items) {
  const isViewer = currentUser && currentUser.role === "Viewer";

  if (!items.length) {
    el("cardsView").innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-muted); display:flex; flex-direction:column; align-items:center;">
          <div style="font-size:48px; margin-bottom:16px;">📭</div>
          <h3 style="color:var(--text-main); margin-bottom:8px;">No Containers Found</h3>
          <p>Try adjusting your search or filter criteria.</p>
      </div>`;
    return;
  }

  el("cardsView").innerHTML = items.map(({r, i}, loopIdx) => {
    const st = getStatus(r);
    const isChecked = selectedIndices.has(i) ? "checked" : "";
    const cntrNo = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]) || "UNKNOWN";
    const mblNo = getField(r, ["MBL NO", "MBL", "MASTER BL"]);
    const vesselVoy = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "—";
    const containerType = getField(r, ["TYPE", "SIZE", "CONTAINER TYPE"]) || "40' HC";
    const liner = getField(r, ["LINER", "LINE"]) || detectLinerFromMBL(getField(r, ["MBL NO", "MBL", "MASTER BL"])) || "Line";
    const trackUrl = getCarrierTrackingUrl(r);
    const fees = calculateStandardFees(r);
    const gwPort = getGatewayPortInfo(r);
    const cfsDepot = getCfsDepotInfo(getField(r, ["CFS NAME", "CFS"]));
    const truckNo = getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]);
    const flashClass = lastEditedId === i ? "card-saved" : "";

    return `
      <div class="card-box cascade-item ${flashClass}" style="animation-delay: ${loopIdx * 40}ms">
        <div>
          <div class="card-header-top">
            <div>
              <div class="card-title-group">
                <input type="checkbox" class="chk-item photo-exclude" value="${i}" ${isChecked}>
                <span class="card-cntr-code clickable-copy" onclick="copyText('${esc(cntrNo)}')">${esc(cntrNo)}</span>
              </div>
              <div class="card-vessel">${esc(vesselVoy)} (${esc(containerType)})</div>
              ${mblNo ? `<div class="clickable-copy" onclick="copyText('${esc(mblNo)}')" style="font-size:10.5px; color:var(--text-dim); font-family:'JetBrains Mono'; margin-top:2px; display:inline-block;">MBL: ${esc(mblNo)}</div>` : ''}
            </div>
            <span class="status-pill ${st.class}">${st.text}</span>
          </div>

          <div class="badge-row" style="margin-top:12px;">
            ${!fees.demOverdue && !validDate(r["PORT OUT"]) ? getLfdHtml(fees.terminalDaysLeft, fees.demOverdue, 'Terminal LFD', fees.portFreeDays) : ''}
            ${!fees.detOverdue && !fees.isCompleted ? getLfdHtml(fees.detentionDaysLeft, fees.detOverdue, 'Carrier LFD', fees.carrierFreeDays) : ''}
            ${fees.demOverdue ? `<div class="lfd-wrap danger"><div class="lfd-label">Port Demurrage</div><div style="font-family:'JetBrains Mono'; font-weight:800;">+${fees.demDays}d / ${formatCurrency(fees.demCostUSD)}</div></div>` : ''}
            ${fees.detOverdue ? `<div class="lfd-wrap danger"><div class="lfd-label">Line Detention</div><div style="font-family:'JetBrains Mono'; font-weight:800;">+${fees.detDays}d / ${formatCurrency(fees.detCostUSD)}</div></div>` : ''}
            ${!fees.demOverdue && !fees.detOverdue && fees.terminalDaysLeft > 4 && fees.detentionDaysLeft > 4 ? `<span class="tag-badge success">Free Time Clear</span>` : ''}
          </div>

          <div class="badge-links-group">
            <a href="${trackUrl}" target="_blank" class="link-pill">🌐 ${esc(liner)} ↗</a>
            <a href="${gwPort.url}" target="_blank" class="link-pill">⚓ ${esc(gwPort.name)}</a>
            <a href="${cfsDepot.url}" target="_blank" class="link-pill">🏢 ${esc(cfsDepot.name)}</a>
          </div>
        </div>

        <div class="card-details-grid">
          <div class="detail-item">
            <label>Port In / Out</label>
            <val style="color:var(--warning)">${formatDate(getField(r, ["PORT IN"])) || "—"} / ${formatDate(getField(r, ["PORT OUT"])) || "—"}</val>
          </div>
          <div class="detail-item">
            <label>Inside-Port LFD / Dwell</label>
            <val style="${fees.demOverdue ? 'color:var(--danger)' : ''}">${fees.terminalLFD} (${fees.portDwell}d / Free ${fees.portFreeDays}d)</val>
          </div>
          <div class="detail-item">
            <label>CFS Depot / Truck</label>
            <val style="color:var(--accent);">${esc(getField(r, ["CFS NAME", "CFS"]) || "—")} / <span class="clickable-copy" onclick="copyText('${esc(truckNo)}')"><span style="color:var(--text-main);">${esc(truckNo || "No Truck")}</span></span></val>
          </div>
          <div class="detail-item">
            <label>Empty Return Validity / Countdown</label>
            <val>${(() => {
              const ev = getEmptyReturnValidity(r);
              const c = ev.state === "overdue" ? "var(--danger)" : ev.state === "warning" || ev.state === "critical" ? "var(--warning)" : ev.state === "returned" ? "var(--success)" : "var(--text-main)";
              return `<span style="color:${c};font-weight:800">${ev.date} · ${ev.label}</span>`;
            })()}</val>
          </div>
        </div>

        ${fees.totalCostUSD > 0 ? `
          <div class="fee-breakdown-box">
            <span style="font-weight:700; color:var(--danger)">⚠️ Total Surcharges</span>
            <strong style="font-family:'JetBrains Mono'; color:var(--danger); font-size:12px;">${formatCurrency(fees.totalCostUSD)}</strong>
          </div>
        ` : ''}

        <div>
          <input type="text" class="input" style="width:100%; margin-bottom:6px; height:32px;" value="${esc(r["REMARKS"] || "")}" placeholder="Remark..." onchange="updateRemark(${i}, this.value)" ${isViewer ? 'readonly' : ''}>
          <div class="card-footer-btns photo-exclude">
            <button class="btn" style="padding:4px 8px;" onclick="openEmailModal(${i})">✉️ Email</button>
            ${!isViewer ? `<button class="btn" style="padding:4px 8px;" onclick="openModal(${i})">✏️ Edit</button>` : ''}
            ${currentUser && currentUser.role === 'Admin' ? `<button class="btn btn-danger" style="padding:4px 8px;" onclick="deleteRow(${i})">🗑️</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join("");
  bindCheckboxes();
  lastEditedId = -1; // reset flash
}

function renderSheet(items) {
  const isViewer = currentUser && currentUser.role === "Viewer";
  
  const editableAttrText = isViewer ? 'readonly' : 'readonly ondblclick="this.readOnly=false; this.focus();" onblur="this.readOnly=true;"';
  const editableAttrSelect = isViewer ? 'disabled' : 'disabled ondblclick="this.disabled=false; this.focus();" onblur="this.disabled=true;"';

  if (!items.length) {
    el("sheetTableBody").innerHTML = `<tr><td colspan="18" style="text-align:center; padding:40px; color:var(--text-muted);">No records found.</td></tr>`;
    el("paginationWrapper").innerHTML = "";
    return;
  }

  // Pagination Logic
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  el("sheetTableBody").innerHTML = paginatedItems.map(({r, i}, loopIdx) => {
    const isChecked = selectedIndices.has(i) ? "checked" : "";
    const gwPort = getGatewayPortInfo(r);
    const fees = calculateStandardFees(r);
    const cntrNo = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]) || "";
    const isoStatus = validateISO6346(cntrNo);
    const flashClass = lastEditedId === i ? "row-saved" : "";

    return `
      <tr data-row="${i}" class="cascade-item ${flashClass}" style="animation-delay: ${loopIdx * 20}ms">
        <td><input type="checkbox" class="chk-item" value="${i}" ${isChecked}></td>
        <td data-label="Container No.">
          <input class="cell-input" style="font-family:'JetBrains Mono'; font-weight:700; color:var(--accent);" value="${esc(cntrNo)}" title="${isoStatus.message}" onchange="inlineEditContainerNo(${i}, this.value)" ${editableAttrText}>
        </td>
        <td data-label="Type"><input class="cell-input" style="width:45px;" value="${esc(getField(r, ["TYPE", "SIZE"]) || "40' DC")}" onchange="inlineEdit(${i}, 'TYPE', this.value)" ${editableAttrText}></td>
        <td data-label="MBL No"><input class="cell-input" style="width:85px;" value="${esc(getField(r, ["MBL NO", "MBL", "MASTER BL"]) || "")}" onchange="inlineEditMBL(${i}, this.value)" ${editableAttrText}></td>
        <td data-label="Liner"><input class="cell-input" style="width:75px;" value="${esc(getField(r, ["LINER", "LINE"]) || "")}" onchange="inlineEdit(${i}, 'LINER', this.value)" ${editableAttrText}></td>
        <td data-label="Port">
          <select class="cell-select" style="width:80px;" onchange="setGatewayPort(${i}, this.value)" ${editableAttrSelect}>
            <option value="CITPL" ${gwPort.key === 'CITPL' ? 'selected' : ''}>CITPL</option>
            <option value="CCTL" ${gwPort.key === 'CCTL' ? 'selected' : ''}>CCTL</option>
            <option value="Kattupalli" ${gwPort.key === 'Kattupalli' ? 'selected' : ''}>Kattupalli</option>
            <option value="Ennore" ${gwPort.key === 'Ennore' ? 'selected' : ''}>Ennore</option>
          </select>
        </td>
        <td data-label="Port In"><input class="cell-input" type="date" value="${getField(r, ["PORT IN"]) || ""}" onchange="inlineEdit(${i}, 'PORT IN', this.value)" ${editableAttrText}></td>
        <td data-label="Port Out"><input class="cell-input" type="date" value="${getField(r, ["PORT OUT"]) || ""}" onchange="inlineEdit(${i}, 'PORT OUT', this.value)" ${editableAttrText}></td>
        <td data-label="CFS Depot"><input class="cell-input" style="width:80px;" value="${esc(getField(r, ["CFS NAME", "CFS"]) || "")}" onchange="inlineEdit(${i}, 'CFS NAME', this.value)" ${editableAttrText}></td>
        <td data-label="Truck No"><input class="cell-input" style="width:90px; font-family:'JetBrains Mono';" value="${esc(getField(r, ["TRUCK NO.", "TRUCK NO", "VEHICLE NO"]) || "")}" placeholder="Vehicle" oninput="this.value=formatTruckNo(this.value)" onchange="inlineEdit(${i}, 'TRUCK NO.', this.value)" ${editableAttrText}></td>
        <td data-label="Destuffed"><input class="cell-input" type="date" value="${getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]) || ""}" onchange="inlineEdit(${i}, 'DESTUFFING DATE', this.value)" ${editableAttrText}></td>
        <td data-label="Empty Return"><input class="cell-input" type="date" value="${getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]) || ""}" onchange="inlineEdit(${i}, 'CONTAINER RETURN DATE', this.value)" ${editableAttrText}></td>
        <td data-label="Terminal LFD" style="font-weight:700; color:${fees.demOverdue ? 'var(--danger)' : 'var(--text-muted)'};">${fees.terminalLFD}</td>
        <td data-label="Detention LFD" style="font-weight:700; color:${fees.detOverdue ? 'var(--danger)' : 'var(--text-muted)'};">${fees.detentionLFD}</td>
        <td data-label="Exposure" style="font-weight:800; font-family:'JetBrains Mono'; color:${fees.totalCostUSD > 0 ? 'var(--danger)' : 'var(--success)'};">${formatCurrency(fees.totalCostUSD)}</td>
        <td data-label="Remarks"><input class="cell-input" value="${esc(r["REMARKS"] || "")}" onchange="inlineEdit(${i}, 'REMARKS', this.value)" ${editableAttrText}></td>
        <td data-label="Actions">
          <div style="display:flex; gap:3px;">
            ${!isViewer ? `<button class="btn" style="padding:2px 5px; color:var(--accent)" title="Mark Returned" onclick="markSingleReturned(${i})">🔄</button>` : ''}
            ${currentUser && currentUser.role === 'Admin' ? `<button class="btn btn-danger" style="padding:2px 5px;" onclick="deleteRow(${i})">🗑️</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  el("paginationWrapper").innerHTML = `
    <div style="display:flex; justify-content:space-between; padding:12px 16px; border-top:1px solid var(--border); align-items:center; background:var(--bg-elevated);">
      <span style="font-size:11px; font-weight:700; color:var(--text-muted)">Showing ${startIdx + 1}-${Math.min(startIdx + ITEMS_PER_PAGE, items.length)} of ${items.length} records</span>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-ghost" onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''}>&larr; Previous</button>
        <button class="btn btn-ghost" onclick="changePage(1)" ${currentPage === totalPages ? 'disabled' : ''}>Next &rarr;</button>
      </div>
    </div>
  `;

  bindCheckboxes();
  lastEditedId = -1; // reset flash
}

// Ensure changePage is globally available
window.changePage = function(direction) {
  currentPage += direction;
  renderUI();
  el("sheetView").scrollTo({ top: 0, behavior: 'smooth' });
};

function inlineEditContainerNo(idx, val) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const oldVal = getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]);
  const newVal = val.trim().toUpperCase();
  rows[idx]["CONTAINER NO."] = newVal;
  logAuditEvent("CONTAINER_RENAME", oldVal, "CONTAINER NO.", oldVal, newVal);
  lastEditedId = idx;
  saveAndRefresh();
}

function markSingleReturned(idx) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const today = new Date().toISOString().slice(0, 10);
  const oldVal = rows[idx]["CONTAINER RETURN DATE"];
  rows[idx]["CONTAINER RETURN DATE"] = today;
  if (!rows[idx]["REMARKS"]) rows[idx]["REMARKS"] = "Empty container returned to depot";
  logAuditEvent("EMPTY_RETURN", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "CONTAINER RETURN DATE", oldVal, today);
  lastEditedId = idx;
  saveAndRefresh();
  toast("Marked Container Returned");
}

function renderKanban(items) {
  const lanes = { "Terminal In": [], "Port Out / CFS": [], "Destuffed": [], "Completed Return": [] };
  items.forEach(({r, i}) => {
    const st = getStatus(r);
    const cntrNo = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]) || "";
    const vesselVoy = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "—";
    const cfsName = getField(r, ["CFS NAME", "CFS"]) || "—";

    if (st.text.includes("EMPTY RETURNED")) lanes["Completed Return"].push({r, i, cntrNo, vesselVoy, cfsName});
    else if (st.text.includes("DE-STUFF")) lanes["Destuffed"].push({r, i, cntrNo, vesselVoy, cfsName});
    else if (st.text.includes("CFS IN") || st.text.includes("PORT OUT")) lanes["Port Out / CFS"].push({r, i, cntrNo, vesselVoy, cfsName});
    else lanes["Terminal In"].push({r, i, cntrNo, vesselVoy, cfsName});
  });

  el("kanbanView").innerHTML = Object.entries(lanes).map(([title, list], laneIdx) => `
    <div class="kanban-column">
      <div class="kanban-header-strip">
        <span>${title}</span>
        <span class="status-pill progress">${list.length}</span>
      </div>
      <div class="kanban-body-list" data-lane="${title}" id="kanban-lane-${laneIdx}">
        ${list.map(({i, cntrNo, vesselVoy, cfsName}, loopIdx) => {
          const flashClass = lastEditedId === i ? "card-saved" : "";
          return `
          <div class="card-box cascade-item ${flashClass}" style="padding:10px; cursor:grab; animation-delay: ${loopIdx * 30}ms" data-idx="${i}">
            <div style="display:flex; justify-content:space-between;">
              <span class="card-cntr-code" style="font-size:12.5px;">${esc(cntrNo)}</span>
            </div>
            <div class="card-vessel" style="font-size:10px;">${esc(vesselVoy)}</div>
            <div style="font-size:10px; color:var(--accent); margin-top:2px;">${esc(cfsName)}</div>
          </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  if (currentUser && currentUser.role !== "Viewer" && typeof Sortable !== 'undefined') {
    document.querySelectorAll('.kanban-body-list').forEach(listEl => {
      new Sortable(listEl, {
        group: 'kanban',
        animation: 150,
        ghostClass: 'kanban-ghost',
        onEnd: function(evt) {
          const newLane = evt.to.dataset.lane;
          const oldLane = evt.from.dataset.lane;
          if(newLane !== oldLane) {
            const rIdx = evt.item.dataset.idx;
            handleKanbanDrop(rIdx, newLane);
          }
        }
      });
    });
  }
  lastEditedId = -1; // reset flash
}

function handleKanbanDrop(idx, newLane) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const r = rows[idx];
  
  if (newLane === "Port Out / CFS") {
    if(!r["PORT OUT"]) r["PORT OUT"] = todayStr;
    if(!r["CFS IN"]) r["CFS IN"] = todayStr;
  } else if (newLane === "Destuffed") {
    if(!r["DESTUFFING DATE"]) r["DESTUFFING DATE"] = todayStr;
  } else if (newLane === "Completed Return") {
    if(!r["CONTAINER RETURN DATE"]) r["CONTAINER RETURN DATE"] = todayStr;
  }
  
  logAuditEvent("KANBAN_MOVE", getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "STATUS", "Moved", newLane);
  lastEditedId = parseInt(idx, 10);
  saveAndRefresh();
  toast(`Moved to ${newLane}`);
}

function bindCheckboxes() {
  document.querySelectorAll(".chk-item").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const idx = Number(e.target.value);
      if (e.target.checked) selectedIndices.add(idx);
      else selectedIndices.delete(idx);
      
      const count = selectedIndices.size;
      const sn = el("selectionNotice");
      if(sn) sn.textContent = `${count} selected`;
      const bc = el("btnSelectCount");
      if(bc) bc.textContent = count;
      
      const fab = el("floatingActionBar");
      if(fab) {
        if(count > 0) fab.classList.add("show");
        else fab.classList.remove("show");
      }
    });
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function sortSheet(field) {
  if (sortField === field) sortAsc = !sortAsc;
  else { sortField = field; sortAsc = true; }
  renderUI();
}

function inlineEdit(idx, field, val) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const oldVal = rows[idx][field];
  const newVal = val.trim();
  if (oldVal !== newVal) logAuditEvent("INLINE_EDIT", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), field, oldVal, newVal);
  rows[idx][field] = newVal;
  lastEditedId = idx;
  saveAndRefresh();
}

function inlineEditMBL(idx, val) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const oldMBL = rows[idx]["MBL NO"];
  const newMBL = val.trim();
  rows[idx]["MBL NO"] = newMBL;
  logAuditEvent("MBL_EDIT", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "MBL NO", oldMBL, newMBL);
  const detected = detectLinerFromMBL(val);
  if (detected && !rows[idx]["LINER"]) rows[idx]["LINER"] = detected;
  lastEditedId = idx;
  saveAndRefresh();
}

function updateRemark(idx, val) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const oldVal = rows[idx]["REMARKS"];
  const newVal = val.trim();
  rows[idx]["REMARKS"] = newVal;
  logAuditEvent("REMARK_UPDATE", getField(rows[idx], ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "REMARKS", oldVal, newVal);
  lastEditedId = idx;
  saveAndRefresh();
  toast("Remark saved");
}

function finalizeDelete() {
  if (!pendingDelete) return;
  logAuditEvent("DELETE_UNIT", getField(pendingDelete.row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), "ALL", JSON.stringify(pendingDelete.row), "DELETED");
  pendingDelete = null;
  el("undoToast").classList.remove("show");
}

function undoDelete() {
  if (!pendingDelete) return;
  clearTimeout(deleteTimeout);
  rows.splice(pendingDelete.idx, 0, pendingDelete.row);
  lastEditedId = pendingDelete.idx;
  pendingDelete = null;
  el("undoToast").classList.remove("show");
  saveAndRefresh();
  toast("Restored Record");
}

function deleteRow(idx) {
  if (!currentUser || currentUser.role !== "Admin") return alert("Admin only.");
  if (pendingDelete) finalizeDelete(); 
  
  pendingDelete = { row: rows[idx], idx: idx };
  rows.splice(idx, 1);
  selectedIndices.clear(); 
  saveAndRefresh();
  
  el("undoToast").classList.add("show");
  deleteTimeout = setTimeout(finalizeDelete, 5000);
}

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeQuickFilter = chip.dataset.filter;
    currentPage = 1; // Reset to page 1 on filter
    renderUI();
  });
});

async function saveAndRefresh() {
  if (!currentUser?.authenticated) {
    setCloudDataState("error", "Sign in required to save shipment data");
    toast("Sign in with an active staff account before saving changes.");
    return;
  }
  renderUI();
  try {
    if (currentUser?.authenticated) {
      const { data, error } = await sb.functions.invoke("operations-data", { body: { action: "write", data: rows, expectedUpdatedAt: cloudDatasetUpdatedAt } });
      if (error || !data?.saved) throw new Error(data?.error || error?.message || "Secure save failed");
      cloudDatasetUpdatedAt = data.updatedAt || cloudDatasetUpdatedAt;
      localStorage.setItem("containerRows", JSON.stringify(rows));
      setCloudDataState("connected", "Secure cloud sync · " + rows.length + " records");
    } else {
      throw new Error("Authenticated staff session required to save shipment data.");
    }
  } catch (err) {
    console.warn("Cloud sync notice:", err);
    if (currentUser?.authenticated) {
      setCloudDataState("error", err.message || "Secure save failed");
      toast(err.message || "Secure save failed. Your edits were not synced.");
    }
  }
}


function setCloudDataState(state, message) {
  const node = el("ectCloudState");
  if (node) {
    node.dataset.state = state;
    node.innerHTML = '<span class="ect-source-dot" aria-hidden="true"></span>' + esc(message);
    node.title = message;
  }
  const retry = el("ectCloudRetry");
  if (retry) retry.hidden = !(state === "error" || state === "offline");
}

async function loadFromCloud() {
  cloudDatasetUpdatedAt = null;
  setCloudDataState("loading", "Loading cloud data…");
  try {
    let data, error;
    if (currentUser?.authenticated) {
      const result = await sb.functions.invoke("operations-data", { body: { action: "read" } });
      data = result.data ? { data: result.data.data, updatedAt: result.data.updatedAt } : null;
      error = result.error || (Array.isArray(data?.data) ? null : new Error(result.data?.error || "Secure data read failed"));
    } else {
      rows = [];
      try { localStorage.removeItem("containerRows"); } catch (e) {}
      populateFilters();
      renderUI();
      setCloudDataState("error", "Sign in to access staff records");
      return;
    }
    if (error) {
      console.warn("Container data cloud read failed:", error);
      const cached = localStorage.getItem("containerRows");
      setCloudDataState(cached ? "offline" : "error", cached ? "Saved records · offline" : "Cloud read failed"); return;
    }
    cloudDatasetUpdatedAt = data?.updatedAt || null;
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      rows = data.data.map(item => ({ "PORT OUT": "", "CONTAINER RETURN DATE": "", "TRUCK NO.": "", "DRIVER CONTACT": "", ...item }));
      try { localStorage.setItem("containerRows", JSON.stringify(rows)); } catch (storageError) { console.warn("Could not cache shipment records:", storageError); }
      populateFilters();
      setCloudDataState("connected", (currentUser?.authenticated ? "Secure cloud sync · " : "Cloud synced · ") + rows.length + " records");
      renderUI(); return;
    }
    const cached = localStorage.getItem("containerRows");
    setCloudDataState(cached ? "offline" : "error", cached ? "Saved records · cloud dataset empty" : "No cloud records returned");
  } catch (err) {
    console.warn("Container data cloud load failed:", err);
    const cached = localStorage.getItem("containerRows");
    setCloudDataState(cached ? "offline" : "error", cached ? "Saved records · offline" : "Cloud connection failed");
  }
}
function populateFilters() {
  const vSet = new Set(), cSet = new Set();
  rows.forEach(r => {
    const vsl = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
    const cfs = getField(r, ["CFS NAME", "CFS"]);
    if (vsl) vSet.add(vsl.trim());
    if (cfs) cSet.add(cfs.trim());
  });
  el("vesselFilter").innerHTML = `<option value="">All Vessels</option>` + [...vSet].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el("cfsFilter").innerHTML = `<option value="">All CFS</option>` + [...cSet].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
}

function setView(mode) {
  currentView = mode;
  document.querySelectorAll(".view-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === mode));
  
  // Clear displays to reset animation
  ['cardsView', 'sheetView', 'kanbanView'].forEach(id => {
    el(id).style.display = 'none';
    el(id).classList.remove('fade-in');
  });

  const activeViewId = mode === 'cards' ? 'cardsView' : mode === 'sheet' ? 'sheetView' : 'kanbanView';
  el(activeViewId).style.display = mode === 'cards' || mode === 'kanban' ? 'grid' : 'block';
  
  // Trigger reflow to restart CSS animation, then add class
  void el(activeViewId).offsetWidth;
  el(activeViewId).classList.add('fade-in');
  
  renderUI();
}
document.querySelectorAll(".view-btn").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

function setModalDate(id, offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const localDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
  el(id).value = localDate;
}

function openModal(idx = -1) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  editingIndex = idx;
  el("modalTitle").textContent = idx === -1 ? "Add Container" : "Edit Container";
  const r = idx === -1 ? {} : rows[idx];
  
  el("modalForm").innerHTML = COLS.map(c => {
    if (c === 'GATEWAY PORT') {
      const info = getGatewayPortInfo(r);
      const curKey = info.key; 
      return `
        <div>
          <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Gateway Port</label>
          <select id="modal_GATEWAY_PORT" class="select" style="width:100%; margin-top:4px;" data-field="${c}">
            <option value="" ${!["CCTL","CITPL","Kattupalli","Ennore"].includes(curKey) ? "selected" : ""}>AUTO — detect from shipment data</option>
            <option value="CCTL" ${curKey === "CCTL" ? "selected" : ""}>CCTL (DP World)</option>
            <option value="CITPL" ${curKey === "CITPL" ? "selected" : ""}>CITPL (PSA)</option>
            <option value="Kattupalli" ${curKey === "Kattupalli" ? "selected" : ""}>Kattupalli Port</option>
            <option value="Ennore" ${curKey === "Ennore" ? "selected" : ""}>Ennore Port</option>
          </select>
          <div style="font-size:9px;color:var(--text-muted);margin-top:4px;">
            ${info.detectionStatus === "AUTO" ? "🟢 Automatically detected" : info.detectionStatus === "CONFLICT" ? "🟠 Conflicting terminal evidence" : "⚪ No reliable terminal evidence yet"}
          </div>
        </div>
      `;
    }
    
    const domId = `modal_${c.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const isDate = DATE_COLS.has(c);
    
    return `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:0;">${c}</label>
          ${isDate ? `
            <div style="display:flex; gap:4px;">
              <button type="button" class="btn btn-ghost" style="padding:1px 5px; font-size:9px;" onclick="setModalDate('${domId}', -1)">Yest</button>
              <button type="button" class="btn btn-ghost" style="padding:1px 5px; font-size:9px;" onclick="setModalDate('${domId}', 0)">Today</button>
            </div>
          ` : ''}
        </div>
        <input type="${isDate ? 'date' : 'text'}" 
               id="${domId}"
               class="input" style="width:100%; margin-top:4px;" 
               data-field="${c}" 
               value="${esc(r[c] || '')}">
      </div>
    `;
  }).join("");

  const cntrInp = document.getElementById("modal_CONTAINER_NO_");
  if (cntrInp) {
    cntrInp.addEventListener("input", (e) => {
      const iso = validateISO6346(e.target.value);
      cntrInp.style.borderColor = iso.isValid ? "#10b981" : "#ef4444";
      cntrInp.title = iso.message;
    });
  }

  const mblInp = document.getElementById("modal_MBL_NO");
  const linerInp = document.getElementById("modal_LINER");
  if (mblInp && linerInp) {
    mblInp.addEventListener("input", (e) => {
      const detected = detectLinerFromMBL(e.target.value);
      if (detected) linerInp.value = detected;
    });
  }

  el("modalBg").classList.add("open");
}
el("modalClose").addEventListener("click", () => el("modalBg").classList.remove("open"));
el("modalCancel").addEventListener("click", () => el("modalBg").classList.remove("open"));

el("modalSave").addEventListener("click", () => {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  
  const item = {};
  el("modalForm").querySelectorAll("[data-field]").forEach(input => { item[input.dataset.field] = input.value.trim(); });
  if (!item["CONTAINER NO."]) return alert("Container number required.");
  
  // Date Chronology Validation
  const pIn = item["PORT IN"] ? new Date(item["PORT IN"]) : null;
  const pOut = item["PORT OUT"] ? new Date(item["PORT OUT"]) : null;
  const cfsIn = item["CFS IN"] ? new Date(item["CFS IN"]) : null;
  const destuff = item["DESTUFFING DATE"] ? new Date(item["DESTUFFING DATE"]) : null;
  const rtn = item["CONTAINER RETURN DATE"] ? new Date(item["CONTAINER RETURN DATE"]) : null;

  if (pIn && pOut && pOut < pIn) return alert("Validation Error: Port Out cannot be before Port In.");
  if (pOut && cfsIn && cfsIn < pOut) return alert("Validation Error: CFS In cannot be before Port Out.");
  if (cfsIn && destuff && destuff < cfsIn) return alert("Validation Error: Destuffing cannot occur before CFS In.");
  if (destuff && rtn && rtn < destuff) return alert("Validation Error: Return Date cannot be before Destuffing Date.");

  item["CONTAINER NO."] = item["CONTAINER NO."].toUpperCase();
  // Gateway Port selection in the edit modal is an explicit manual override.
  // Choosing AUTO clears the override and returns control to berthing detection.
  if (["CCTL","CITPL","Kattupalli","Ennore"].includes(item["GATEWAY PORT"])) {
    item.__terminalOverride = item["GATEWAY PORT"];
  } else {
    delete item.__terminalOverride;
  }
  if (!item["LINER"] && item["MBL NO"]) item["LINER"] = detectLinerFromMBL(item["MBL NO"]);
  item["TRUCK NO."] = formatTruckNo(item["TRUCK NO."]);

  if (editingIndex === -1) {
    rows.unshift(item);
    logAuditEvent("CREATE_UNIT", item["CONTAINER NO."], "ALL", "NEW", JSON.stringify(item));
    lastEditedId = 0; // The new item will be at index 0
  } else {
    const old = rows[editingIndex];
    rows[editingIndex] = item;
    logAuditEvent("MODAL_UPDATE", item["CONTAINER NO."], "RECORD", JSON.stringify(old), JSON.stringify(item));
    lastEditedId = editingIndex;
  }
  
  saveAndRefresh();
  el("modalBg").classList.remove("open");
  toast("Saved & Synced");
});

el("addBtn").addEventListener("click", () => openModal(-1));

el("dailyDispatchBtn").addEventListener("click", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const activeToday = rows.filter(r => !isFullyCompleted(r) && (r["ETA"] === todayStr || r["PORT IN"] === todayStr || r["PORT OUT"] === todayStr));
  
  if (!activeToday.length) return alert("No active shipments scheduled for today.");

  let summary = `📋 *DAILY DISPATCH BRIEF*\nTotal: *${activeToday.length}*\n━━━━━━━━━━━━━━\n`;
  activeToday.forEach((r, idx) => {
    summary += `${idx + 1}. *${getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"])}* | ${getField(r, ["CFS NAME", "CFS"]) || '-'} | ${getStatus(r).text.replace(/[^\w\s-]/g, '').trim()}\n`;
  });
  window.open("https://wa.me/?text=" + encodeURIComponent(summary), "_blank");
});

el("vesselEditBtn").addEventListener("click", () => {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const vSet = new Set();
  rows.forEach(r => { 
    const vsl = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
    if(vsl) vSet.add(vsl.trim()); 
  });
  el("targetVesselSelect").innerHTML = [...vSet].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el("vesselModalBg").classList.add("open");
});
el("vesselModalClose").addEventListener("click", () => el("vesselModalBg").classList.remove("open"));
el("vesselModalCancel").addEventListener("click", () => el("vesselModalBg").classList.remove("open"));
el("vesselModalSave").addEventListener("click", () => {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  const vsl = el("targetVesselSelect").value;
  const fld = el("targetFieldSelect").value;
  const val = el("targetNewValue").value.trim();
  rows.forEach(r => { 
    const currentVsl = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
    if (currentVsl === vsl) {
      logAuditEvent("BULK_VESSEL_UPDATE", getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]), `${vsl}:${fld}`, r[fld], val);
      r[fld] = val; 
    }
  });
  saveAndRefresh();
  el("vesselModalBg").classList.remove("open");
  toast("Schedule updated");
});

el("sheetSelectAll").addEventListener("change", (e) => {
  // Only selects filtered rows
  if (e.target.checked) getFilteredRows().forEach(({i}) => selectedIndices.add(i));
  else selectedIndices.clear();
  
  const count = selectedIndices.size;
  const sn = el("selectionNotice");
  if(sn) sn.textContent = `${count} selected`;
  const bc = el("btnSelectCount");
  if(bc) bc.textContent = count;
  
  const fab = el("floatingActionBar");
  if(fab) {
    if(count > 0) fab.classList.add("show");
    else fab.classList.remove("show");
  }
  
  renderUI();
});

el("search").addEventListener("input", debounce(() => { currentPage = 1; renderUI(); }, 250));
el("vesselFilter").addEventListener("change", () => { currentPage = 1; renderUI(); });
el("gatewayFilter").addEventListener("change", () => { currentPage = 1; renderUI(); });
el("cfsFilter").addEventListener("change", () => { currentPage = 1; renderUI(); });

// Clear Selection Button Logic
el("clearSelectionBtn").addEventListener("click", () => {
  selectedIndices.clear();
  
  // Uncheck the master "Select All" toggle in the table view if it's checked
  const sheetSelectAll = el("sheetSelectAll");
  if (sheetSelectAll) sheetSelectAll.checked = false;
  
  // Re-render UI to wipe all individual checkmarks and hide the FAB
  renderUI();
});

el("exportBtn").addEventListener("click", () => {
  const wb = XLSX.utils.book_new();
  const exportData = rows.map(r => {
    const fees = calculateStandardFees(r);
    return {
      ...r,
      "PORT DWELL (DAYS)": fees.portDwell,
      "TERMINAL LFD": fees.terminalLFD,
      "DEMURRAGE (USD)": fees.demCostUSD,
      "TOTAL EQUIPMENT DWELL (DAYS)": fees.totalEquipmentDays,
      "DETENTION LFD": fees.detentionLFD,
      "DETENTION (USD)": fees.detCostUSD,
      "TOTAL EXPOSURE (USD)": fees.totalCostUSD,
      "TOTAL EXPOSURE (INR)": Math.round(fees.totalCostUSD * USD_TO_INR)
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), "Tracking & Surcharge");
  XLSX.writeFile(wb, `Containers_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
});

// Centralized Excel Parser for Input & Drag/Drop
function processExcelFile(file) {
  if (currentUser && currentUser.role === "Viewer") return alert("Read-only access.");
  if (!file) return;
  
  const overlay = el("dragDropOverlay");
  overlay.innerHTML = `<div class="btn-loading" style="width:50px; height:50px; margin-bottom:16px;"></div>Processing Import...`;
  overlay.classList.add("open");

  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, {type: 'array', cellDates: true});
      let imported = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: ""});
      
      rows = imported.map(r => {
        const out = {};
        Object.keys(r).forEach(k => {
          let val = r[k];
          if (val instanceof Date) val = val.toISOString().split('T')[0];
          const cleanKey = k.trim().toUpperCase();
          out[cleanKey] = String(val ?? "").trim();
        });

        if (!out["CONTAINER NO."] && (out["CONTAINER"] || out["CONTAINER NO"] || out["CNTR NO"])) {
          out["CONTAINER NO."] = out["CONTAINER"] || out["CONTAINER NO"] || out["CNTR NO"];
        }
        if (!out["MBL NO"] && (out["MBL"] || out["MASTER BL"])) {
          out["MBL NO"] = out["MBL"] || out["MASTER BL"];
        }
        if (!out["LINER"] && out["LINE"]) {
          out["LINER"] = out["LINE"];
        }
        if (!out["VESSEL & VOY"] && (out["VESSEL"] || out["VESSEL NAME"])) {
          out["VESSEL & VOY"] = out["VESSEL"] || out["VESSEL NAME"];
        }
        if (!out["CFS NAME"] && out["CFS"]) {
          out["CFS NAME"] = out["CFS"];
        }
        if (!out["TRUCK NO."] && (out["TRUCK NO"] || out["VEHICLE NO"])) {
          out["TRUCK NO."] = formatTruckNo(out["TRUCK NO"] || out["VEHICLE NO"]);
        }
        if (!out["LINER"] && out["MBL NO"]) out["LINER"] = detectLinerFromMBL(out["MBL NO"]);
        return out;
      });

      logAuditEvent("BULK_EXCEL_IMPORT", "ALL", "SHEET_DATA", "N/A", `${rows.length} units imported`);
      populateFilters();
      saveAndRefresh();
      toast(`Imported ${rows.length} records!`);
    } catch(err) {
      alert("Invalid Excel File.");
    } finally {
      overlay.classList.remove("open");
      // Reset overlay html
      setTimeout(() => {
        overlay.innerHTML = `<div style="font-size:64px; margin-bottom:16px;">📥</div>Drop Excel File to Import<div style="font-size:12px; font-weight:600; margin-top:8px; opacity:0.8;">Updates records automatically</div>`;
      }, 300);
    }
  };
  reader.readAsArrayBuffer(file);
}

el("excelInput").addEventListener("change", e => processExcelFile(e.target.files[0]));

// Duplicate legacy initialization removed. Secure startup is handled once above.



/* Dashboard search UX helpers — intentionally isolated from existing listeners. */
(() => {
  const searchInput = document.getElementById("search");
  const clearButton = document.getElementById("searchClearBtn");
  const syncSearchChrome = () => {
    if (!searchInput || !clearButton) return;
    clearButton.style.display = searchInput.value.trim() ? "inline-flex" : "none";
  };
  if (searchInput && clearButton) {
    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      currentPage = 1;
      renderUI();
      searchInput.focus();
      syncSearchChrome();
    });
    searchInput.addEventListener("input", syncSearchChrome);
    syncSearchChrome();
  }
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping = target && ["INPUT","TEXTAREA","SELECT"].includes(target.tagName);
    if (event.key === "/" && !isTyping && searchInput) {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape" && document.activeElement === searchInput && searchInput.value) {
      searchInput.value = "";
      currentPage = 1;
      renderUI();
      syncSearchChrome();
    }
  });
})();


// Reference-inspired staff sidebar shortcuts. Each action delegates to existing controls.
(function bindReferenceStaffUI() {
  const sidebar = document.getElementById("staffReferenceSidebar");
  const dashboard = document.getElementById("opsDashboardView");
  const publicView = document.getElementById("publicLandingView");
  function syncSidebarVisibility() {
    if (!sidebar) return;
    const isStaff = dashboard && dashboard.style.display !== "none" && dashboard.style.display !== "";
    sidebar.style.display = isStaff ? "flex" : "none";
    document.body.classList.toggle("staff-reference-mode", isStaff);
  }
  syncSidebarVisibility();

  const sidebarToggle = document.getElementById("staffSidebarToggle");
  const sidebarStorageKey = "gmlStaffSidebarCollapsed";
  function applySidebarState(collapsed) {
    document.body.classList.toggle("staff-sidebar-collapsed", !!collapsed);
    if (!sidebarToggle) return;
    sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
    sidebarToggle.title = collapsed ? "Expand navigation" : "Collapse navigation";
    const icon = sidebarToggle.querySelector("span[aria-hidden='true']");
    if (icon) icon.textContent = collapsed ? "›" : "‹";
    const label = sidebarToggle.querySelector(".staff-sidebar-toggle-label");
    if (label) label.textContent = collapsed ? "Expand menu" : "Collapse menu";
  }
  let sidebarInitiallyCollapsed = false;
  try { sidebarInitiallyCollapsed = window.localStorage.getItem(sidebarStorageKey) === "1"; } catch (_) {}
  applySidebarState(sidebarInitiallyCollapsed);
  if (sidebarToggle) sidebarToggle.addEventListener("click", function () {
    const collapsed = !document.body.classList.contains("staff-sidebar-collapsed");
    applySidebarState(collapsed);
    try { window.localStorage.setItem(sidebarStorageKey, collapsed ? "1" : "0"); } catch (_) {}
  });

  const observer = new MutationObserver(syncSidebarVisibility);
  if (dashboard) observer.observe(dashboard, { attributes: true, attributeFilter: ["style"] });
  if (publicView) observer.observe(publicView, { attributes: true, attributeFilter: ["style"] });

  document.querySelectorAll("[data-staff-nav]").forEach(button => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-staff-nav");
      const actions = {
        dashboard: null,
        shipments: null,
        tracking: null,
        scmtr: "headerCsnBtn",
        lfd: "headerLfdBtn",
        terminal: "terminalRoutingBtn",
        add: "addBtn",
        import: "excelInput",
        audit: "openAuditLogBtn",
        dispatch: "dailyDispatchBtn",
        analytics: "openAnalyticsBtn",
        vessel: "vesselEditBtn",
        export: "exportBtn"
      };
      if (button.classList.contains("staff-side-link")) document.querySelectorAll(".staff-side-link").forEach(link => link.classList.toggle("active", link === button));
      if (target === "dashboard") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (target === "shipments") {
        document.getElementById("controlTray")?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelector(".control-tray")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (target === "tracking") {
        const search = document.getElementById("staffTopSearch") || document.getElementById("search");
        search?.focus();
        search?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const action = actions[target];
      if (action) document.getElementById(action)?.click();
    });
  });
})();


(function bindStaffTopSearch() {
  const top = document.getElementById("staffTopSearch");
  const button = document.getElementById("staffTopSearchBtn");
  const existing = document.getElementById("search");
  if (!top || !existing) return;
  const syncToMain = () => {
    existing.value = top.value;
    existing.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof renderUI === "function") renderUI();
  };
  top.addEventListener("input", syncToMain);
  if (button) button.addEventListener("click", syncToMain);
  existing.addEventListener("input", () => { if (top.value !== existing.value) top.value = existing.value; });
})();


(function bindCloudRetry() {
  const button = el("ectCloudRetry");
  if (!button) return;
  button.addEventListener("click", async function () {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Retrying…";
    try {
      await loadFromCloud();
      renderUI();
    } catch (error) {
      console.warn("Manual cloud retry failed.", error);
    } finally {
      button.disabled = false;
      button.textContent = "Retry";
    }
  });
})();

/* --- Combined from phase1.js --- */
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
    const inwardDate=dateVal(getField(r,['INWARD DATE']));
    const portIn=dateVal(getField(r,['PORT IN']));
    const portOut=dateVal(getField(r,['PORT OUT']));
    const returned=dateVal(getField(r,['CONTAINER RETURN DATE','EMPTY RETURN DATE']));
    const emptyValidity=dateVal(getField(r,['EMPTY RETURN VALIDITY','EMPTY VALIDITY','EMPTY RETURN LAST DATE']));
    // Port Out free-day rule: configurable calendar days from Inward Date.
    const insidePortFreeDays=Math.max(0,Number(c.terminalFreeDays ?? 3));

    // Two separate clocks:
    // 1) Port Out / inside-port LFD starts at Inward Date and gives 13 calendar days.
    // 2) Detention LFD starts at Inward Date and ends when the empty is returned.
    const size=String(getField(r,['TYPE','SIZE'])||'').toUpperCase();
    const portRate=size.includes('20')?Number(c.demRate20):Number(c.demRate40);
    const outsideRate=size.includes('20')?Number(c.detentionRate20):Number(c.detentionRate40);

    let portLfd=null, portDaysLeft=null, portState='unknown', demDays=0, demCost=0;
    if(portIn){
      portLfd=new Date(portIn);
      portLfd.setDate(portLfd.getDate()+insidePortFreeDays);
      const clockEnd=portOut || today();
      const dwell=Math.max(0,dayDiff(portIn,clockEnd));
      demDays=Math.max(0,dwell-insidePortFreeDays);
      demCost=demDays*portRate;
      if(portOut){
        portState=demDays>0?'overdue':'complete';
        portDaysLeft=dayDiff(portOut,portLfd);
      }else{
        portDaysLeft=dayDiff(today(),portLfd);
        portState=portDaysLeft<0?'overdue':portDaysLeft<=Number(c.criticalDays)?'critical':portDaysLeft<=Number(c.warningDays)?'warning':'safe';
      }
    }

    // Empty return validity is entered per container. It is a hard return deadline,
    // not a detention-free-days clock.
    let outsideLfd=null, outsideDaysLeft=null, outsideState='unknown', detentionDaysOver=0, detentionCost=0;
    if(emptyValidity){
      outsideLfd=new Date(emptyValidity);
      if(returned){
        outsideDaysLeft=dayDiff(returned,outsideLfd);
        outsideState='complete';
      }else{
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
      demDays, cost:demCost, detentionDays:0, detentionDaysOver, detentionCost, returned:!!returned, portRate, outsideRate
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

      if(l.outsideState==='overdue') out.push({label:'Empty Return Validity Expired',sev:'bad',key:'LFD_OUTSIDE'});
      else if(l.outsideState==='critical') out.push({label:l.outsideDaysLeft===0?'Empty Return Validity Today':'Empty Return Validity '+l.outsideDaysLeft+'d',sev:'bad',key:'LFD_OUTSIDE'});
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
      modal.innerHTML=`<div class="p1v2-box"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">VESSEL INTELLIGENCE</div><h2>🚢 Vessel Master</h2><p>Latest vessel / voyage terminal resolution history</p></div><button class="btn btn-ghost" id="vmClose">✕</button></div><div class="p1v2-modal-body"><div class="p1v2-toolbar"><input class="input" id="vmSearch" placeholder="Search vessel, voyage or terminal..."></div><div class="p1v2-table-wrap"><table class="p1v2-table"><thead><tr><th>Vessel</th><th>Voyage</th><th>Terminal</th><th>Berth</th><th>ETA</th><th>ETB</th><th>Source</th><th>Updated</th></tr></thead><tbody id="vmBody"></tbody></table></div></div></div>`;
      document.body.appendChild(modal);
      $('vmClose').onclick=()=>modal.classList.remove('open');
      $('vmSearch').oninput=renderVesselMaster;
    }
    function renderVesselMaster(){
      const q=String($('vmSearch')?.value||'').toUpperCase().trim();
      const master=(typeof getVesselMaster==='function'?getVesselMaster():[]); const berth=(typeof getBerthingRecords==='function'?getBerthingRecords():[]); const merged=master.map(x=>({...x,...(berth.find(b=>normalizeVesselKey(b.vessel)===normalizeVesselKey(x.vessel)&&String(b.voyage||'').toUpperCase()===String(x.voyage||'').toUpperCase())||{})})); berth.forEach(b=>{if(!merged.some(x=>normalizeVesselKey(x.vessel)===normalizeVesselKey(b.vessel)&&String(x.voyage||'').toUpperCase()===String(b.voyage||'').toUpperCase()))merged.push(b);}); const data=merged.filter(x=>(String(x.vessel||'')+' '+String(x.voyage||'')+' '+String(x.terminal||'')+' '+String(x.berth||'')).toUpperCase().includes(q)).sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
      $('vmBody').innerHTML=data.map(x=>`<tr><td><b>${escP(x.vessel||'—')}</b></td><td>${escP(x.voyage||'—')}</td><td><span class="p1v2-pill good">${escP(x.terminal||'—')}</span></td><td>${escP(x.berth||'—')}</td><td>${escP(x.eta||'—')}</td><td>${escP(x.etb||'—')}</td><td>${escP(x.source||'AUTO')}</td><td>${escP(x.updatedAt?new Date(x.updatedAt).toLocaleString('en-IN'):'—')}</td></tr>`).join('')||'<tr><td colspan="8" class="p1v2-empty">No vessel master records yet. Records appear when vessel terminal detection resolves.</td></tr>';
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
      document.body.insertAdjacentHTML('beforeend',`<div class="p1v2-modal" id="p1v2LfdModal"><div class="p1v2-box small"><div class="p1v2-modal-head"><div><div class="p1v2-eyebrow">LFD ENGINE</div><h2>Inside-Port LFD & Empty Return Rules</h2></div><button class="btn btn-ghost" id="p1v2LfdX">✕</button></div><div class="p1v2-modal-body"><div class="p1v2-form"><label>Inside-Port Free Days (From Port In)<input type="number" id="p1v2Free" min="0"></label><label>Empty Return Validity<input type="text" value="Enter per container in Edit" readonly></label><label>Warning Threshold<input type="number" id="p1v2Warn" min="0"></label><label>Critical Threshold<input type="number" id="p1v2Crit" min="0"></label><label>Inside-Port / 20ft Demurrage / Day (USD)<input type="number" id="p1v2R20" min="0"></label><label>Inside-Port / 40ft Demurrage / Day (USD)<input type="number" id="p1v2R40" min="0"></label></div></div><div class="p1v2-foot"><button class="btn" id="p1v2LfdCancel">Cancel</button><button class="btn btn-primary" id="p1v2LfdSave">Save Rules</button></div></div></div>`);
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
      const lfdText=l.lfd?fmt(`${l.lfd.getFullYear()}-${String(l.lfd.getMonth()+1).padStart(2,'0')}-${String(l.lfd.getDate()).padStart(2,'0')}`):'—';
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
    $('p1v2Free').value=c.terminalFreeDays ?? 3;$('p1v2Warn').value=c.warningDays;$('p1v2Crit').value=c.criticalDays;$('p1v2R20').value=c.demRate20;$('p1v2R40').value=c.demRate40;
    $('p1v2LfdModal').classList.add('open');
  }
  function saveLfd(){
    const terminalFreeDays=Math.max(0,Number($('p1v2Free').value||0));
    const cfg={terminalFreeDays,warningDays:Math.max(0,Number($('p1v2Warn').value||0)),criticalDays:Math.max(0,Number($('p1v2Crit').value||0)),demRate20:Math.max(0,Number($('p1v2R20').value||0)),demRate40:Math.max(0,Number($('p1v2R40').value||0))};
    saveConfig(cfg);
    $('p1v2Free').value=terminalFreeDays;
    $('p1v2LfdModal').classList.remove('open');
    renderTower();
    if(typeof renderUI==='function')renderUI();
    if(typeof toast==='function')toast('LFD rules saved — Port In + free days; Empty Return Validity per container');
  }

  function bind(){
    ensureUI();
    if($('p1v2TowerBtn')) $('p1v2TowerBtn').onclick=window.openControlTower;
    if($('headerCsnBtn')) $('headerCsnBtn').onclick=window.openScmtrCentre;
    if($('headerLfdBtn')) $('headerLfdBtn').onclick=window.openLfdRules;
    $('p1v2Back').onclick=()=>showTower(false);
    $('p1v2Refresh').onclick=renderTower;
    $('p1v2VesselMaster').onclick=openVesselMaster;
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

/* --- Combined from phase2.js --- */
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

/* --- Combined from enterprise-upgrade.js --- */
/* Enterprise operations upgrade: derived read-only intelligence over existing shipment records.
   No shipment mutations, schema changes, or authentication changes are performed here. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const auditKey = "gml_ops_hub_session_audit_v1";
  const tabs = [
    ["integrity","Data integrity","◈"],["alerts","Exceptions & alerts","⚠"],
    ["shipment360","Shipment 360°","▣"],["search","Advanced search","⌕"],
    ["scmtr","SCMTR / CSN","▤"],["finance","Finance & LFD","₹"],["audit","Audit trail","◷"]
  ];
  let activeTab = "integrity";
  let selectedIndex = -1;
  let hubSearch = "";
  function safeRows(){ try { return Array.isArray(rows) ? rows.filter(Boolean) : []; } catch (_) { return []; } }
  function field(r,names){ try { return typeof getField==="function" ? getField(r,names) : ""; } catch(_){ return ""; } }
  function escHtml(v){ return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function norm(v){ return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,""); }
  function container(r){ return field(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO","CONTAINER NUMBER"]); }
  function date(v){ if(!v)return null; try { if(typeof parseLocalDate==="function")return parseLocalDate(v); const d=new Date(v);return isNaN(d)?null:d; } catch(_){return null;} }
  function dateText(v){ if(!v)return "Not recorded"; const d=date(v);return d&&!isNaN(d)?d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):String(v); }
  function completed(r){ try{return typeof isFullyCompleted==="function"&&isFullyCompleted(r);}catch(_){return false;} }
  function fees(r){ try{return typeof calculateStandardFees==="function"?calculateStandardFees(r):null;}catch(_){return null;} }
  function audit(message,detail){ let list=[];try{list=JSON.parse(localStorage.getItem(auditKey)||"[]");}catch(_){} list.unshift({at:new Date().toISOString(),message,detail:detail||""});try{localStorage.setItem(auditKey,JSON.stringify(list.slice(0,100)));}catch(_){} }
  function duplicateGroups(list){const map=new Map();list.forEach((r,i)=>{const cn=norm(container(r));if(!cn)return;if(!map.has(cn))map.set(cn,[]);map.get(cn).push({r,i});});return [...map.entries()].filter(([,items])=>items.length>1);}
  function checks(list){
    const dup=duplicateGroups(list), noContainer=list.map((r,i)=>({r,i})).filter(x=>!container(x.r));
    const missingVessel=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
    const missingEta=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["ETA"]));
    const missingPol=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["POL","PORT OF LOADING"]));
    const missingHbl=list.map((r,i)=>({r,i})).filter(x=>!field(x.r,["HBL NO","HBL","HOUSE BL","HOUSE BILL OF LADING"]));
    return {dup,noContainer,missingVessel,missingEta,missingPol,missingHbl,total:list.length};
  }
  function exceptions(list){
    const now=new Date();now.setHours(0,0,0,0);
    const result=[];
    list.forEach((r,i)=>{
      const cn=container(r)||"Record "+(i+1), eta=date(field(r,["ETA"])), pi=!!date(field(r,["PORT IN"]));
      if(eta && eta<now && !pi && !completed(r))result.push({level:"high",kind:"ETA overdue",cn,i,detail:"ETA "+dateText(field(r,["ETA"]))+" · Port In not recorded"});
      const f=fees(r);
      if(f && Number.isFinite(f.terminalDaysLeft) && f.terminalDaysLeft<=3 && f.terminalDaysLeft>=0 && !completed(r))result.push({level:f.terminalDaysLeft===0?"high":"medium",kind:"Terminal LFD approaching",cn,i,detail:f.terminalDaysLeft+" day(s) left · LFD "+(f.terminalLFD||"—")});
      if(f && f.terminalDaysLeft<0 && !completed(r))result.push({level:"high",kind:"Terminal LFD passed",cn,i,detail:Math.abs(f.terminalDaysLeft)+" day(s) past LFD"});
      if(!field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]))result.push({level:"low",kind:"Missing vessel",cn,i,detail:"Confirm vessel/voyage before relying on ETA"});
    });
    return result.sort((a,b)=>({high:0,medium:1,low:2}[a.level]-({high:0,medium:1,low:2}[b.level])));
  }
  function money(n){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n)||0);}
  function statusPill(text,kind){return '<span class="eu-pill '+(kind||"")+'">'+escHtml(text)+'</span>';}
  function table(headers,rowsHtml){return '<div class="eu-table-wrap"><table class="eu-table"><thead><tr>'+headers.map(h=>'<th>'+escHtml(h)+'</th>').join("")+'</tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="'+headers.length+'" class="eu-empty">No matching records found.</td></tr>')+'</tbody></table></div>';}
  function rowButton(i,label,cls){return '<button type="button" class="eu-btn '+(cls||"")+'" data-eu-row="'+i+'">'+escHtml(label)+'</button>';}
  function openHub(tab){if(tab&&tabs.some(t=>t[0]===tab))activeTab=tab;const modal=$("euHub");if(!modal)return;modal.classList.add("open");document.body.classList.add("eu-hub-open");render();audit("Opened operations hub",activeTab);}
  function closeHub(){const modal=$("euHub");if(modal)modal.classList.remove("open");document.body.classList.remove("eu-hub-open");}
  function renderIntegrity(list){
    const c=checks(list),cards=[["Records checked",c.total,"blue"],["Duplicate container IDs",c.dup.length,c.dup.length?"red":"green"],["Missing container numbers",c.noContainer.length,c.noContainer.length?"red":"green"],["Missing vessel",c.missingVessel.length,c.missingVessel.length?"amber":"green"],["Missing ETA",c.missingEta.length,c.missingEta.length?"amber":"green"],["Missing HBL",c.missingHbl.length,c.missingHbl.length?"amber":"green"]];
    let rowsHtml="";
    c.dup.forEach(([cn,items])=>rowsHtml+='<tr><td>'+escHtml(cn)+'</td><td>'+items.length+'</td><td>'+items.map(x=>escHtml(container(x.r)||"—")).join(", ")+'</td><td>'+rowButton(items[0].i,"Open shipment")+'</td></tr>');
    c.noContainer.forEach(x=>rowsHtml+='<tr><td>Missing container</td><td>1</td><td>Record '+(x.i+1)+'</td><td>'+rowButton(x.i,"Inspect")+'</td></tr>');
    return '<div class="eu-kpi-grid">'+cards.map(c=>'<div class="eu-kpi '+c[2]+'"><small>'+c[0]+'</small><strong>'+c[1]+'</strong></div>').join("")+'</div><div class="eu-note">Read-only structural checks against the currently loaded shipment dataset. Duplicate identifiers are flagged for review, never deleted automatically. This is not a server-side audit.</div><h3>Integrity findings</h3>'+table(["Finding / container","Count","Records","Action"],rowsHtml);
  }
  function renderAlerts(list){
    const a=exceptions(list);
    const high=a.filter(x=>x.level==="high").length,med=a.filter(x=>x.level==="medium").length;
    const body=a.map(x=>'<tr><td>'+statusPill(x.level.toUpperCase(),x.level)+'</td><td>'+escHtml(x.kind)+'</td><td><strong>'+escHtml(x.cn)+'</strong><small class="eu-sub">'+escHtml(x.detail)+'</small></td><td>'+rowButton(x.i,"Shipment 360°")+'</td></tr>').join("");
    return '<div class="eu-kpi-grid"><div class="eu-kpi red"><small>High priority</small><strong>'+high+'</strong></div><div class="eu-kpi amber"><small>Needs attention</small><strong>'+med+'</strong></div><div class="eu-kpi blue"><small>Total alerts</small><strong>'+a.length+'</strong></div></div><div class="eu-note">Alerts are calculated from existing ETA, Port In, completion and configured terminal LFD fields. No email/SMS alerts are sent by this interface.</div>'+table(["Priority","Alert","Shipment / reason","Action"],body);
  }
  function renderShipment(list){
    let idx=selectedIndex>=0&&list[selectedIndex]?selectedIndex:(list.length?0:-1);
    if(idx<0)return '<div class="eu-empty">No shipment records are loaded yet. Check the cloud sync status and retry before using Shipment 360°.</div>';
    selectedIndex=idx;const r=list[idx],cn=container(r)||"Container number missing";
    const items=[
      ["Container",cn],["HBL",field(r,["HBL NO","HBL","HOUSE BL"])||"—"],["MBL",field(r,["MBL NO","MBL","MASTER BL"])||"—"],
      ["Booking",field(r,["BOOKING NO","BOOKING","BOOKING REF"])||"—"],["Vessel / voyage",field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—"],
      ["POL",field(r,["POL","PORT OF LOADING"])||"—"],["Transshipment",field(r,["TRANSHIPMENT PORT","TRANSHIPMENT","TRANSSHIPMENT PORT","T/S PORT","TS PORT"])||"Not recorded"],
      ["Gateway",field(r,["GATEWAY PORT","POD","PORT OF DISCHARGE","DESTINATION"])||"—"],["ETA",dateText(field(r,["ETA"]))],
      ["Port In",dateText(field(r,["PORT IN"]))],["Port Out",dateText(field(r,["PORT OUT"]))],["CFS In",dateText(field(r,["CFS IN"]))],
      ["Destuffed",dateText(field(r,["DESTUFFING DATE","DESTUFF DATE"]))],["Empty return",dateText(field(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE"]))],
      ["Remarks",field(r,["REMARKS","NOTES","REMARK"])||"—"]
    ];
    const opts=list.map((x,i)=>'<option value="'+i+'" '+(i===idx?"selected":"")+'>'+escHtml((container(x)||"Record "+(i+1))+" · "+(field(x,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"Vessel not recorded"))+'</option>').join("");
    return '<div class="eu-detail-toolbar"><label for="euShipmentSelect">Select shipment</label><select id="euShipmentSelect" class="eu-select">'+opts+'</select>'+rowButton(idx,"Show on map","primary")+'</div><div class="eu-detail-title"><div><span class="eu-eyebrow">SHIPMENT 360°</span><h3>'+escHtml(cn)+'</h3><p>'+escHtml(field(r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"Vessel not recorded")+'</p></div>'+statusPill(completed(r)?"COMPLETED":"IN PROGRESS",completed(r)?"green":"blue")+'</div><div class="eu-detail-grid">'+items.map(it=>'<div class="eu-detail-cell"><small>'+escHtml(it[0])+'</small><strong>'+escHtml(it[1])+'</strong></div>').join("")+'</div><div class="eu-note">This panel reads the current shipment record. To change data, use the existing authorised shipment edit workflow.</div>';
  }
  function renderSearch(list){
    const q=norm(hubSearch),filtered=q?list.map((r,i)=>({r,i})).filter(x=>norm(Object.entries(x.r).map(([k,v])=>k+" "+String(v??"")).join(" ")).includes(q)):list.map((r,i)=>({r,i}));
    return '<div class="eu-searchbar"><input id="euSearchInput" class="eu-input" value="'+escHtml(hubSearch)+'" placeholder="Search container, HBL, MBL, booking, vessel, truck or any recorded field"><button class="eu-btn primary" id="euSearchGo">Search</button><button class="eu-btn" id="euSearchClear">Clear</button></div><div class="eu-note">Search scans all currently loaded record fields and does not alter shipment data or the main table filters.</div>'+table(["Container","HBL / MBL","Vessel","Gateway","ETA","Action"],filtered.slice(0,100).map(x=>'<tr><td><strong>'+escHtml(container(x.r)||"—")+'</strong></td><td>'+escHtml(field(x.r,["HBL NO","HBL"])||"—")+'<small class="eu-sub">'+escHtml(field(x.r,["MBL NO","MBL"])||"")+'</small></td><td>'+escHtml(field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—")+'</td><td>'+escHtml(field(x.r,["GATEWAY PORT","POD","DESTINATION"])||"—")+'</td><td>'+escHtml(dateText(field(x.r,["ETA"])))+'</td><td>'+rowButton(x.i,"Open 360°")+'</td></tr>').join(""))+'<div class="eu-footnote">Showing '+Math.min(filtered.length,100)+' of '+filtered.length+' matching records.</div>';
  }
  function renderScmtr(list){
    const records=list.map((r,i)=>({r,i})).map(x=>{
      const missing=[];
      if(!field(x.r,["HBL NO","HBL","HOUSE BL"]))missing.push("HBL");
      if(!field(x.r,["MBL NO","MBL","MASTER BL"]))missing.push("MBL");
      if(!field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"]))missing.push("Vessel");
      if(!field(x.r,["POL","PORT OF LOADING"]))missing.push("POL");
      if(!field(x.r,["ETA","ETD","ATD"]))missing.push("ETA/ETD");
      const csn=field(x.r,["CSN STATUS","SCMTR STATUS","CSN FILING STATUS","SCMTR FILING STATUS"]);
      return {...x,missing,csn};
    });
    const ready=records.filter(x=>!x.missing.length).length,needs=records.length-ready;
    return '<div class="eu-kpi-grid"><div class="eu-kpi blue"><small>Records checked</small><strong>'+records.length+'</strong></div><div class="eu-kpi green"><small>Required fields present</small><strong>'+ready+'</strong></div><div class="eu-kpi amber"><small>Needs review</small><strong>'+needs+'</strong></div></div><div class="eu-note">Readiness is a field-completeness aid only. It does not confirm an actual CSN submission, statutory compliance or filing acceptance. A stored filing status is displayed only when present in the record.</div>'+table(["Container","Vessel","CSN status in record","Missing fields","Action"],records.filter(x=>x.missing.length||x.csn).slice(0,150).map(x=>'<tr><td>'+escHtml(container(x.r)||"—")+'</td><td>'+escHtml(field(x.r,["VESSEL & VOY","VESSEL","VESSEL NAME"])||"—")+'</td><td>'+escHtml(x.csn||"Not recorded")+'</td><td>'+escHtml(x.missing.join(", ")||"—")+'</td><td>'+rowButton(x.i,"Inspect")+'</td></tr>').join(""))+'<div class="eu-footnote">Only existing shipment fields are read; no filing status is written or inferred as submitted.</div>';
  }
  function renderFinance(list){
    let total=0,overdue=0,near=0,known=0;
    const rowsHtml=list.map((r,i)=>{const f=fees(r);if(!f)return "";known++;const cost=Number(f.totalCostUSD)||0;total+=cost;if(f.demOverdue)overdue++;if(Number.isFinite(f.terminalDaysLeft)&&f.terminalDaysLeft<=3)near++;if(!cost&&f.terminalDaysLeft==null)return "";return '<tr><td>'+escHtml(container(r)||"—")+'</td><td>'+escHtml(f.terminalLFD||"—")+'</td><td>'+escHtml(f.terminalDaysLeft==null?"—":f.terminalDaysLeft<0?Math.abs(f.terminalDaysLeft)+" days overdue":f.terminalDaysLeft+" days left")+'</td><td>'+money(cost)+'</td><td>'+rowButton(i,"Open 360°")+'</td></tr>';}).join("");
    return '<div class="eu-kpi-grid"><div class="eu-kpi blue"><small>Records evaluated</small><strong>'+known+'</strong></div><div class="eu-kpi amber"><small>LFD within 3 days / overdue</small><strong>'+near+'</strong></div><div class="eu-kpi red"><small>Demurrage records flagged</small><strong>'+overdue+'</strong></div><div class="eu-kpi green"><small>Calculated charges</small><strong>'+money(total)+'</strong></div></div><div class="eu-note">Amounts use the existing configured fee calculation and recorded milestone dates. They are estimates, not confirmed invoices; blank or unavailable charge data is not treated as zero due.</div>'+table(["Container","Terminal LFD","Deadline","Estimated charges","Action"],rowsHtml);
  }
  function renderAudit(){
    let list=[];try{list=JSON.parse(localStorage.getItem(auditKey)||"[]");}catch(_){}
    return '<div class="eu-note eu-warning">Audit history in this initial UI is stored in this browser only. It is not a tamper-resistant server audit and does not yet record authoritative before/after changes. A server-backed audit table and write policy must be configured before this is used for compliance evidence.</div>'+table(["Time","Hub activity","Details"],list.map(x=>'<tr><td>'+escHtml(new Date(x.at).toLocaleString("en-IN"))+'</td><td>'+escHtml(x.message)+'</td><td>'+escHtml(x.detail||"—")+'</td></tr>').join(""))+'<div class="eu-actions"><button class="eu-btn" id="euAuditClear">Clear local hub history</button></div>';
  }
  function render(){
    const list=safeRows(),root=$("euHubBody"),nav=$("euHubTabs"),title=$("euHubTitle");
    if(!root||!nav)return;
    nav.innerHTML=tabs.map(t=>'<button type="button" class="eu-tab '+(activeTab===t[0]?"active":"")+'" data-eu-tab="'+t[0]+'"><span>'+t[2]+'</span>'+t[1]+'</button>').join("");
    title.textContent=(tabs.find(t=>t[0]===activeTab)||tabs[0])[1];
    const renderers={integrity:renderIntegrity,alerts:renderAlerts,shipment360:renderShipment,search:renderSearch,scmtr:renderScmtr,finance:renderFinance,audit:renderAudit};
    root.innerHTML=renderers[activeTab](list);
    nav.querySelectorAll("[data-eu-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.euTab;render();audit("Viewed operations hub",activeTab);}));
    root.querySelectorAll("[data-eu-row]").forEach(b=>b.addEventListener("click",()=>{
      const idx=Number(b.dataset.euRow);if(!Number.isInteger(idx)||!list[idx])return;
      selectedIndex=idx;
      if(activeTab==="integrity"||activeTab==="alerts"||activeTab==="search"||activeTab==="scmtr"||activeTab==="finance")activeTab="shipment360";
      if(b.textContent.toLowerCase().includes("map")){
        closeHub();try{if(typeof showShipmentRoute==="function")showShipmentRoute(idx);}catch(_){}
      }else render();
      audit("Opened shipment record",container(list[idx]));
    }));
    const select=$("euShipmentSelect");if(select)select.addEventListener("change",()=>{selectedIndex=Number(select.value);render();});
    const search=$("euSearchInput"),go=$("euSearchGo"),clear=$("euSearchClear");
    if(search){search.addEventListener("input",()=>{hubSearch=search.value;});search.addEventListener("keydown",e=>{if(e.key==="Enter"){hubSearch=search.value;render();}});}
    if(go)go.addEventListener("click",()=>{hubSearch=(search&&search.value)||"";render();audit("Ran advanced search",hubSearch);});
    if(clear)clear.addEventListener("click",()=>{hubSearch="";render();});
    const auditClear=$("euAuditClear");if(auditClear)auditClear.addEventListener("click",()=>{try{localStorage.removeItem(auditKey);}catch(_){}render();});
  }
  function mount(){
    if(!$("opsDashboardView")||$("euHub"))return;
    const nav=document.querySelector('.staff-reference-sidebar [data-staff-nav="audit"]');
    if(nav){const b=document.createElement("button");b.type="button";b.className="staff-side-link";b.dataset.staffNav="intelligence";b.innerHTML='<span>✦</span> Operations Intelligence';nav.parentNode.insertBefore(b,nav);}
    const top=document.createElement("button");top.type="button";top.className="eu-launch";top.id="euHubLaunch";top.innerHTML='<span>✦</span> Intelligence Hub';
    const overview=document.querySelector("#opsDashboardView .ect-overview-stats");if(overview)overview.appendChild(top);
    const modal=document.createElement("div");modal.id="euHub";modal.className="eu-modal";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-labelledby","euHubTitle");
    modal.innerHTML='<div class="eu-dialog"><header class="eu-header"><div><span class="eu-eyebrow">GML OPERATIONS · INTELLIGENCE</span><h2 id="euHubTitle">Data integrity</h2><p>Derived operational views · existing shipment data remains unchanged</p></div><button type="button" class="eu-close" id="euHubClose" aria-label="Close">×</button></header><nav class="eu-tabs" id="euHubTabs" aria-label="Operations intelligence sections"></nav><main class="eu-body" id="euHubBody"></main><footer class="eu-footer"><span>Read-only analytics · no records modified</span><button type="button" class="eu-btn" id="euHubCloseBottom">Close</button></footer></div>';
    document.body.appendChild(modal);
    top.addEventListener("click",()=>openHub("integrity"));
    modal.querySelector("#euHubClose").addEventListener("click",closeHub);modal.querySelector("#euHubCloseBottom").addEventListener("click",closeHub);
    modal.addEventListener("click",e=>{if(e.target===modal)closeHub();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeHub();});
    document.querySelectorAll('[data-staff-nav="intelligence"]').forEach(b=>b.addEventListener("click",()=>openHub("integrity")));
    document.querySelectorAll('[data-staff-nav="audit"]').forEach(b=>b.addEventListener("dblclick",()=>openHub("audit")));
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
  window.openOperationsIntelligence=openHub;
})();

/* --- Combined from staff-portal.js --- */
;
/* ===== Consolidated from staff-portal-v8.js; original order preserved ===== */
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

;
/* ===== Consolidated from staff-portal-v9.js; original order preserved ===== */
/* Shipment workspace v9: compact register + detail drawer using existing records/actions */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const isEmpty=v=>v===undefined||v===null||String(v).trim()===''||['—','-','N/A','NA','NULL'].includes(String(v).trim().toUpperCase());
const escText=v=>typeof esc==='function'?esc(String(v??'')):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function val(record,keys){try{return typeof getField==='function'?getField(record,keys)||'':(keys.map(k=>record?.[k]).find(v=>!isEmpty(v))||'')}catch(_){return ''}}
function display(v){return isEmpty(v)?'—':String(v).trim()}
function date(v){if(isEmpty(v))return '—';const s=String(v).trim();const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return s;const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
function recordStatus(r){try{const s=typeof getStatus==='function'?getStatus(r):null;return {text:(s?.text||'REVIEW').replace(/^\p{Extended_Pictographic}\s*/u,''),klass:s?.class||'progress'}}catch(_){return {text:'REVIEW',klass:'progress'}}}
function currentRecords(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function chosenIndices(){
 const body=byId('sheetTableBody');if(!body)return [];
 return [...body.querySelectorAll('tr')].map(tr=>Number(tr.dataset.row??tr.querySelector('input.chk-item')?.value)).filter(i=>Number.isInteger(i)&&i>=0);
}
function renderCompactTable(){
 const table=byId('sheetView'),tbody=byId('sheetTableBody');if(!table||!tbody||!document.body.classList.contains('staff-table-mode'))return;
 const records=currentRecords(),idxs=chosenIndices();
 const headers=['','Shipment','MBL No.','Liner','Gateway / Terminal','Vessel & Voyage','ETA','Port In','Port Out','CFS Depot','Current stage'];
 const thead=table.querySelector('thead');if(thead)thead.innerHTML='<tr>'+headers.map((h,i)=>'<th scope="col"'+(i===0?' aria-label="Select shipments"':'')+'>'+(i===0?'<input type="checkbox" id="staffTableSelectAll" aria-label="Select all shipments">':escText(h))+'</th>').join('')+'</tr>';
 const oldRows=[...tbody.querySelectorAll('tr')];
 const html=[];
 oldRows.forEach(tr=>{
   let i=Number(tr.dataset.row??tr.querySelector('input.chk-item')?.value);
   if(!Number.isInteger(i)||i<0||i>=records.length){
     const text=tr.textContent.trim();
     if(text){html.push('<tr class="st9-empty-row"><td colspan="12">'+escText(text)+'</td></tr>')}
     return;
   }
   const r=records[i]||{},status=recordStatus(r);
   const cn=val(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);
   const type=val(r,['TYPE','SIZE','CONTAINER TYPE']);
   const mbl=val(r,['MBL NO','MBL','MASTER BL']);
   const liner=val(r,['LINER','LINE','CARRIER']);
   const gw=val(r,['GATEWAY PORT','POD','PORT','DESTINATION']);
   const vessel=val(r,['VESSEL & VOY','VESSEL','VESSEL NAME']);
   const eta=val(r,['ETA']);
   const portIn=val(r,['PORT IN']),portOut=val(r,['PORT OUT']);
   const cfs=val(r,['CFS NAME','CFS']);
   const isChecked=(()=>{try{return selectedIndices.has(i)}catch(_){return false}})();
   const cls=['completed','done','returned'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'completed':(['warning','overdue','pending','delay','danger'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'warning':'progress');
   html.push('<tr data-row="'+i+'" tabindex="0" role="button" aria-label="Open shipment '+escText(cn)+'">'+
    '<td class="st9-checkbox-cell"><input type="checkbox" class="chk-item st9-row-check" value="'+i+'" '+(isChecked?'checked':'')+' aria-label="Select '+escText(cn)+'"></td>'+
    '<td><button type="button" class="st9-container-link" data-st9-detail="'+i+'">'+escText(display(cn))+'<span class="st9-container-sub">'+escText(display(type))+'</span></button></td>'+
    '<td>'+escText(display(mbl))+'</td><td>'+escText(display(liner))+'</td><td>'+escText(display(gw))+'</td><td>'+escText(display(vessel))+'</td>'+
    '<td>'+escText(date(eta))+'</td><td>'+escText(date(portIn))+'</td><td>'+escText(date(portOut))+'</td><td>'+escText(display(cfs))+'</td>'+
    '<td><span class="st9-status '+cls+'" title="'+escText(status.text)+'">'+escText(status.text.replace(/\s+/g,' ').slice(0,26))+'</span></td>'+
   '</tr>');
 });
 if(html.length)tbody.innerHTML=html.join('');
 const all=byId('staffTableSelectAll');
 if(all){const boxes=[...tbody.querySelectorAll('.chk-item')];all.checked=boxes.length>0&&boxes.every(b=>b.checked);all.indeterminate=boxes.some(b=>b.checked)&&!all.checked;all.addEventListener('change',()=>{boxes.forEach(b=>{b.checked=all.checked;b.dispatchEvent(new Event('change',{bubbles:true}))})})}
 if(typeof bindCheckboxes==='function')bindCheckboxes();
 const count=byId('searchResultCount');const n=idxs.length;if(count&&!count.textContent.trim())count.textContent=n+' shipments';
}
function addDetailShell(){
 if(byId('staffShipmentDetailOverlay'))return;
 const overlay=document.createElement('div');overlay.className='st9-detail-overlay';overlay.id='staffShipmentDetailOverlay';
 overlay.innerHTML='<aside class="st9-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="st9DetailTitle"><div class="st9-drawer-topbar"><div class="st9-drawer-brand"><span class="st9-drawer-brand-mark">⚓</span> GML · SHIPMENT DETAILS</div><button type="button" class="st9-drawer-close" data-st9-close aria-label="Close shipment details">×</button></div><div class="st9-detail-scroll" id="st9DetailContent"></div><div class="st9-detail-actions" id="st9DetailActions"></div></aside>';
 document.body.appendChild(overlay);
 overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-st9-close]'))closeStaffShipmentDetail()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeStaffShipmentDetail()});
}
function fieldBlock(label,value){if(isEmpty(value))return '';return '<div class="st9-info-field"><small>'+escText(label)+'</small><strong>'+escText(display(value))+'</strong></div>'}
function infoSection(title,sub,fields){
 const content=fields.map(([label,value])=>fieldBlock(label,value)).join('');
 if(!content)return '';
 return '<section class="st9-detail-section"><div class="st9-detail-section-head"><h3>'+escText(title)+'</h3><small>'+escText(sub||'')+'</small></div><div class="st9-info-grid">'+content+'</div></section>'
}
function openStaffShipmentDetail(i){
 const records=currentRecords(),r=records[Number(i)];if(!r)return;
 addDetailShell();const overlay=byId('staffShipmentDetailOverlay'),content=byId('st9DetailContent'),actions=byId('st9DetailActions');
 const cn=val(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']),type=val(r,['TYPE','SIZE','CONTAINER TYPE']),mbl=val(r,['MBL NO','MBL','MASTER BL']),liner=val(r,['LINER','LINE','CARRIER']),pol=val(r,['POL','PORT OF LOADING','ORIGIN']),gateway=val(r,['GATEWAY PORT','POD','PORT','DESTINATION']),vessel=val(r,['VESSEL & VOY','VESSEL','VESSEL NAME']),status=recordStatus(r);
 const gwInfo=(()=>{try{return typeof getGatewayPortInfo==='function'?getGatewayPortInfo(r):{key:gateway}}catch(_){return {key:gateway}}})();
 const overview=[
  ['Container type',type],['Master B/L',mbl],['Liner / Carrier',liner],['Vessel & Voyage',vessel],
  ['Port of Loading',pol],['Transshipment Port(s)',val(r,['TRANSSHIPMENT PORT','TRANSHIPMENT PORT','TRANS-SHIPMENT PORT','T/S PORT','TS PORT'])],
  ['Gateway / Terminal',gwInfo?.key||gateway],['CFS Depot',val(r,['CFS NAME','CFS'])],['Seal Number',val(r,['SEAL NO.','SEAL NO','SEAL NUMBER'])],['Free Days',val(r,['FREE DAYS'])]
 ];
 const handling=[
  ['Truck / Vehicle',val(r,['TRUCK NO.','TRUCK NO','VEHICLE NO'])],['Driver Contact',val(r,['DRIVER CONTACT','DRIVER PHONE'])],
  ['Planning Notes',val(r,['PLANNING','PLANNING NOTES'])],['Remarks',val(r,['REMARKS','NOTES'])]
 ];
 const milestoneDefs=[
  ['ETD · Planned departure',['ETD']],['ETA · Estimated arrival',['ETA']],['Inward date',['INWARD DATE']],
  ['Port In',['PORT IN']],['Port Out',['PORT OUT']],['CFS In',['CFS IN']],
  ['Destuffing',['DESTUFFING DATE','DESTUFF DATE']],['Container return',['CONTAINER RETURN DATE','EMPTY RETURN DATE']]
 ];
 const milestones=milestoneDefs.map(([label,keys])=>({label,value:val(r,keys)}));
 const progress=milestones.filter(m=>!isEmpty(m.value)).length;
 const timeline=milestones.map((m,k)=>{const done=!isEmpty(m.value);return '<div class="st9-timeline-row '+(done?'done':'')+'"><span class="st9-timeline-dot">'+(done?'✓':'·')+'</span><div><div class="st9-timeline-label">'+escText(m.label)+'</div><div class="st9-timeline-date">'+escText(done?date(m.value):'Not recorded')+'</div></div><span class="st9-timeline-state">'+(done?'Recorded':'Pending')+'</span></div>'}).join('');
 let finance='';try{const f=typeof calculateStandardFees==='function'?calculateStandardFees(r):null;if(f)finance=infoSection('LFD & financial exposure','Calculated from stored milestones',[
  ['Terminal LFD',f.terminalLFD],['Detention LFD',f.detentionLFD],['Estimated exposure',typeof formatCurrency==='function'?formatCurrency(f.totalCostUSD):f.totalCostUSD]
 ])}catch(_){}
 const from=pol||'Origin not recorded',to=gateway||'Gateway not recorded';
 content.innerHTML='<section class="st9-detail-hero"><div class="st9-detail-eyebrow">SHIPMENT RECORD · '+escText('DETAILS')+'</div><div class="st9-detail-title-row"><div><h2 class="st9-detail-title" id="st9DetailTitle">'+escText(display(cn))+'</h2><div class="st9-detail-subtitle">'+escText(display(mbl))+' · '+escText(display(liner))+'</div></div><span class="st9-status '+(['completed','returned','done'].some(t=>(status.klass+' '+status.text).toLowerCase().includes(t))?'completed':'progress')+'">'+escText(status.text.replace(/\s+/g,' ').slice(0,27))+'</span></div><div class="st9-route-summary"><div class="st9-route-end"><small>Port of loading</small><strong>'+escText(display(from))+'</strong></div><div class="st9-route-arrow" aria-hidden="true">→</div><div class="st9-route-end"><small>Gateway / terminal</small><strong>'+escText(display(to))+'</strong></div></div></section>'+
 infoSection('Shipment information','Core routing & booking data',overview)+
 '<section class="st9-detail-section"><div class="st9-detail-section-head"><h3>Operational milestones</h3><small>'+progress+' of '+milestones.length+' dates recorded</small></div><div class="st9-timeline">'+timeline+'</div></section>'+
 infoSection('Handling & delivery','Last-mile information',handling)+finance;
 const viewer=(()=>{try{return currentUser&&currentUser.role==='Viewer'}catch(_){return false}})();
 const admin=(()=>{try{return currentUser&&currentUser.role==='Admin'}catch(_){return false}})();
 actions.innerHTML='<button type="button" class="primary" data-st9-action="edit" data-idx="'+Number(i)+'" '+(viewer?'disabled':'')+'>Edit shipment</button><button type="button" data-st9-action="map" data-idx="'+Number(i)+'">Show route</button>'+
 (!viewer?'<button type="button" data-st9-action="return" data-idx="'+Number(i)+'">Mark returned</button>':'')+
 (admin?'<button type="button" class="danger" data-st9-action="delete" data-idx="'+Number(i)+'">Delete</button>':'');
 actions.querySelectorAll('[data-st9-action]').forEach(btn=>btn.addEventListener('click',()=>{
  const idx=Number(btn.dataset.idx),action=btn.dataset.st9Action;
  if(action==='edit'){closeStaffShipmentDetail();if(typeof openModal==='function')openModal(idx)}
  else if(action==='map'){closeStaffShipmentDetail();if(typeof setView==='function')setView('cards');if(typeof showShipmentRoute==='function')showShipmentRoute(idx);document.querySelector('.staff-map-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}
  else if(action==='return'){closeStaffShipmentDetail();if(typeof markSingleReturned==='function')markSingleReturned(idx)}
  else if(action==='delete'){closeStaffShipmentDetail();if(typeof deleteRow==='function')deleteRow(idx)}
 }));
 overlay.classList.add('open');document.body.style.overflow='hidden';
 const close=overlay.querySelector('[data-st9-close]');if(close)close.focus();
}
function closeStaffShipmentDetail(){const o=byId('staffShipmentDetailOverlay');if(o)o.classList.remove('open');document.body.style.overflow='';}
window.openStaffShipmentDetail=openStaffShipmentDetail;window.closeStaffShipmentDetail=closeStaffShipmentDetail;
function configureHeading(){
 const intro=document.querySelector('#opsDashboardView .staff-table-intro');if(!intro)return;
 const copy=intro.querySelector('.staff-table-intro-copy'),h=copy?.querySelector('h1'),p=copy?.querySelector('p');
 if(h&&h.textContent!=='Shipments')h.textContent='Shipments';
 if(p)p.textContent='Manage containers, port milestones and empty returns from one register.';
 if(copy&&!copy.querySelector('.staff-table-intro-breadcrumb')){
  const bc=document.createElement('div');bc.className='staff-table-intro-breadcrumb';bc.innerHTML='<span>Dashboard</span><span aria-hidden="true">/</span><strong>Shipments</strong>';
  copy.insertBefore(bc,copy.firstChild);
 }
 const mark=intro.querySelector('.staff-table-intro-mark');if(mark)mark.textContent='SH';
}
function enhance(){
 configureHeading();addDetailShell();
 if(!document.body.classList.contains('staff-table-mode'))return;
 renderCompactTable();
}
function init(){
 const original=window.renderUI;
 if(typeof original==='function'){
  window.renderUI=function(){const result=original.apply(this,arguments);try{enhance()}catch(e){console.warn('Shipment UI enhancement skipped',e)}return result};
 }
 const dashboard=byId('opsDashboardView'),sheet=byId('sheetView'),tbody=byId('sheetTableBody');
 const observer=new MutationObserver(()=>{try{enhance()}catch(e){console.warn('Shipment table refresh skipped',e)}});
 [dashboard,sheet,document.body].filter(Boolean).forEach(el=>observer.observe(el,{attributes:true,attributeFilter:el===document.body?['class']:['style','class']}));
 document.addEventListener('click',e=>{const b=e.target.closest('[data-st9-detail]');if(b){e.preventDefault();openStaffShipmentDetail(Number(b.dataset.st9Detail));return;}const tr=e.target.closest('#sheetTableBody tr[data-row]');if(tr&&!e.target.closest('input,button,a,select,label'))openStaffShipmentDetail(Number(tr.dataset.row))});
 document.addEventListener('keydown',e=>{const tr=e.target.closest('#sheetTableBody tr[data-row]');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openStaffShipmentDetail(Number(tr.dataset.row))}});
 document.addEventListener('click',e=>{if(e.target.closest('.view-btn'))setTimeout(enhance,0)});
 setTimeout(enhance,0);setTimeout(enhance,300);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v10.js; original order preserved ===== */
/* Staff workspace v10 — overview, shipments, and full-page shipment details.
   Presentation/navigation only: uses existing in-memory records and existing actions. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const body=document.body;
let currentPage='overview';
let currentDetailIndex=null;
let lastSignedIn=false;
const empty=v=>v===undefined||v===null||String(v).trim()===''||['—','-','N/A','NA','NULL'].includes(String(v).trim().toUpperCase());
const text=v=>typeof esc==='function'?esc(String(v??'')):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function records(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function read(r,keys){try{return typeof getField==='function'?(getField(r,keys)||''):(keys.map(k=>r?.[k]).find(v=>!empty(v))||'')}catch(_){return ''}}
function show(v){return empty(v)?'Not recorded':String(v).trim()}
function prettyDate(v){
 if(empty(v))return 'Not recorded';
 const s=String(v).trim(),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
 if(!m)return s;
 const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
 return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function getStatusSafe(r){try{return typeof getStatus==='function'?getStatus(r):{text:'Status not available',class:'progress'}}catch(_){return {text:'Status not available',class:'progress'}}}
function detailStatusClass(st){
 const t=String(st?.class||'')+' '+String(st?.text||'');
 if(/complete|returned|done/i.test(t))return 'completed';
 if(/overdue|warning|pending|danger|delay/i.test(t))return 'warning';
 return 'progress';
}
function addPage(){
 let page=byId('staffShipmentDetailPage');
 if(page)return page;
 const main=byId('opsDashboardView');
 if(!main)return null;
 page=document.createElement('section');
 page.id='staffShipmentDetailPage';
 page.setAttribute('aria-live','polite');
 page.setAttribute('aria-label','Shipment details');
 main.appendChild(page);
 return page;
}
function setActiveNav(target){
 document.querySelectorAll('#staffReferenceSidebar .staff-side-link').forEach(el=>{
  el.classList.toggle('active',el.getAttribute('data-staff-nav')===target);
 });
}
function setViewSafe(view){
 try{
  if(typeof setView==='function')setView(view);
  else document.querySelector('#opsDashboardView .view-btn[data-view="'+view+'"]')?.click();
 }catch(e){console.warn('Could not switch shipment list view',e)}
}
function refreshModeClasses(page){
 body.classList.remove('staff-overview-page','staff-shipment-list-page','staff-shipment-detail-page');
 if(page==='overview')body.classList.add('staff-overview-page');
 if(page==='shipments')body.classList.add('staff-shipment-list-page');
 if(page==='detail')body.classList.add('staff-shipment-detail-page');
}
function renderOverviewPage(){
 currentPage='overview';currentDetailIndex=null;refreshModeClasses('overview');setActiveNav('dashboard');
 setViewSafe('cards');
 const main=byId('opsDashboardView');if(main)main.scrollIntoView({block:'start',behavior:'auto'});
}
function renderShipmentsPage(){
 currentPage='shipments';currentDetailIndex=null;refreshModeClasses('shipments');setActiveNav('shipments');
 const intro=document.querySelector('#opsDashboardView .staff-table-intro');
 if(intro){
  const copy=intro.querySelector('.staff-table-intro-copy'),h=copy?.querySelector('h1'),p=copy?.querySelector('p');
  if(h)h.textContent='Shipments';
  if(p)p.textContent='Search, filter, and open a container to review the complete shipment record.';
  if(copy&&!copy.querySelector('.staff-table-intro-breadcrumb')){
   const bc=document.createElement('div');bc.className='staff-table-intro-breadcrumb';
   bc.innerHTML='<span>Workspace</span><span aria-hidden="true">/</span><strong>Shipments</strong>';
   copy.insertBefore(bc,copy.firstChild);
  }
  const mark=intro.querySelector('.staff-table-intro-mark');if(mark)mark.textContent='SH';
 }
 body.classList.add('staff-table-mode');
 setViewSafe('sheet');
 setTimeout(()=>{if(currentPage==='shipments'){body.classList.add('staff-table-mode');try{if(typeof renderUI==='function')renderUI()}catch(_){} }},0);
 const main=byId('opsDashboardView');if(main)main.scrollIntoView({block:'start',behavior:'auto'});
}
function field(label,value,opts={}){
 const cls=empty(value)?' is-empty':'';
 const shown=opts.raw?show(value):(opts.date?prettyDate(value):show(value));
 return '<div class="stv10-field"><span class="stv10-field-label">'+text(label)+'</span><strong class="stv10-field-value'+cls+'">'+text(shown)+'</strong></div>';
}
function fieldPanel(title,subtitle,items){
 const contents=items.filter(it=>it&&it.length>=2).map(it=>field(it[0],it[1],it[2]||{})).join('');
 if(!contents)return '';
 return '<section class="stv10-panel"><div class="stv10-panel-heading"><h2>'+text(title)+'</h2><small>'+text(subtitle||'')+'</small></div><div class="stv10-fields">'+contents+'</div></section>';
}
function renderDetailPage(idx){
 const data=records(),r=data[Number(idx)];
 if(!r){renderShipmentsPage();return}
 currentPage='detail';currentDetailIndex=Number(idx);refreshModeClasses('detail');setActiveNav('shipments');
 const page=addPage();if(!page)return;
 const cn=read(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);
 const pol=read(r,['POL','PORT OF LOADING','ORIGIN']);
 const gwInfo=(()=>{try{return typeof getGatewayPortInfo==='function'?getGatewayPortInfo(r):null}catch(_){return null}})();
 const gateway=gwInfo?.name||gwInfo?.key||read(r,['GATEWAY PORT','POD','PORT','DESTINATION']);
 const mbl=read(r,['MBL NO','MBL','MASTER BL']);
 const status=getStatusSafe(r),statusCls=detailStatusClass(status);
 const from=empty(pol)?'Origin not recorded':pol,to=empty(gateway)?'Gateway not recorded':gateway;
 const routeCard='<section class="stv10-route-card">'+
  '<div><span class="stv10-route-label">Origin / loading port</span><strong class="stv10-route-value">'+text(from)+'</strong><small class="stv10-route-meta">Port of loading</small></div>'+
  '<div class="stv10-route-arrow" aria-hidden="true">→</div>'+
  '<div><span class="stv10-route-label">Destination / gateway</span><strong class="stv10-route-value">'+text(to)+'</strong><small class="stv10-route-meta">Gateway port</small></div>'+
 '</section>';
 const identity=[
  ['Container type',read(r,['TYPE','SIZE','CONTAINER TYPE'])],
  ['Master B/L',mbl],
  ['Liner / carrier',read(r,['LINER','LINE','CARRIER'])],
  ['Seal number',read(r,['SEAL NO.','SEAL NO','SEAL NUMBER'])]
 ];
 const routing=[
  ['Vessel & voyage',read(r,['VESSEL & VOY','VESSEL','VESSEL NAME'])],
  ['Transshipment port(s)',read(r,['TRANSSHIPMENT PORT','TRANSHIPMENT PORT','TRANS-SHIPMENT PORT','T/S PORT','TS PORT'])]
 ];
 const milestoneDefs=[
  ['ETD · Planned departure',['ETD']],
  ['ETA · Estimated arrival',['ETA']],
  ['Split date',['SPLIT DATE']],
  ['Inward date',['INWARD DATE','INWARD']],
  ['Port In',['PORT IN']],
  ['Port Out',['PORT OUT']],
  ['CFS In',['CFS IN']],
  ['Destuffing date',['DESTUFFING DATE','DESTUFF DATE']],
  ['Empty return validity',['EMPTY RETURN VALIDITY']],
  ['Container return date',['CONTAINER RETURN DATE','EMPTY RETURN DATE']]
 ];
 const milestones=milestoneDefs.map(([label,keys])=>({label,value:read(r,keys)}));
 let returnValidity=null;
 try{if(typeof getEmptyReturnValidity==='function')returnValidity=getEmptyReturnValidity(r)}catch(_){}
 const returnValid=milestones.find(m=>m.label==='Empty return validity');
 if(returnValid&&empty(returnValid.value)&&returnValidity&&!empty(returnValidity.date))returnValid.value=returnValidity.date+' · '+(returnValidity.label||returnValidity.state||'');
 const timeline=milestones.map(m=>{
  const done=!empty(m.value);
  return '<div class="stv10-timeline-item '+(done?'done':'')+'"><span class="stv10-time-dot">'+(done?'✓':'·')+'</span><div><strong>'+text(m.label)+'</strong><small>'+text(done?prettyDate(m.value):'No date recorded')+'</small></div><span class="stv10-time-status">'+(done?'Recorded':'Pending')+'</span></div>';
 }).join('');
 const timelinePanel='<section class="stv10-panel"><div class="stv10-panel-heading"><h2>Milestones & dates</h2><small>'+milestones.filter(m=>!empty(m.value)).length+' of '+milestones.length+' recorded</small></div><div class="stv10-timeline">'+timeline+'</div></section>';
 const handling=[
  ['CFS depot',read(r,['CFS NAME','CFS'])],
  ['Truck / vehicle',read(r,['TRUCK NO.','TRUCK NO','VEHICLE NO'])],
  ['Driver contact',read(r,['DRIVER CONTACT','DRIVER PHONE'])],
  ['Planning notes',read(r,['PLANNING','PLANNING NOTES'])]
 ];
 let fees=null;try{if(typeof calculateStandardFees==='function')fees=calculateStandardFees(r)}catch(_){}
 const finances=[
  ['Free days',read(r,['FREE DAYS'])],
  ['Terminal LFD',fees?.terminalLFD],
  ['Detention LFD',fees?.detentionLFD],
  ['Port dwell',fees?.portDwell===undefined?'':String(fees.portDwell)+' days'],
  ['Estimated financial exposure',fees&&typeof formatCurrency==='function'?formatCurrency(fees.totalCostUSD):fees?.totalCostUSD]
 ];
 const remark=read(r,['REMARKS','NOTES']);
 const viewer=(()=>{try{return currentUser&&currentUser.role==='Viewer'}catch(_){return false}})();
 const admin=(()=>{try{return currentUser&&currentUser.role==='Admin'}catch(_){return false}})();
 page.innerHTML=
  '<div class="stv10-breadcrumbs"><button type="button" data-stv10-back>‹ Shipments</button><span>/</span><span>Shipment detail</span><span>/</span><strong>'+text(show(cn))+'</strong></div>'+
  '<header class="stv10-header"><div class="stv10-heading-copy"><div class="stv10-eyebrow">SHIPMENT WORKSPACE · RECORD DETAILS</div><div class="stv10-titleline"><h1 class="stv10-title">'+text(show(cn))+'</h1><span class="st9-status '+statusCls+'">'+text(String(status.text||'Status not available').replace(/\s+/g,' ').slice(0,42))+'</span></div><p class="stv10-description">Full container record with stored routing, terminal milestones, handling information, and calculated exposure.</p></div>'+
  '<div class="stv10-header-actions">'+
   '<button type="button" class="stv10-btn" data-stv10-action="map" data-idx="'+Number(idx)+'">↗ Show route</button>'+
   '<button type="button" class="stv10-btn" data-stv10-action="email" data-idx="'+Number(idx)+'">✉ Email</button>'+
   (!viewer?'<button type="button" class="stv10-btn primary" data-stv10-action="edit" data-idx="'+Number(idx)+'">✎ Edit shipment</button>':'')+
  '</div></header>'+
  routeCard+
  '<div class="stv10-page-grid"><div class="stv10-page-column">'+
   fieldPanel('Shipment references','Identifiers recorded for this container',identity)+
   fieldPanel('Routing & voyage','Sailing and transfer details',routing)+
   timelinePanel+
  '</div><div class="stv10-page-column">'+
   fieldPanel('Terminal & delivery','Ground handling and release details',handling)+
   fieldPanel('Financial & LFD','Calculated from current stored milestones',finances)+
   '<section class="stv10-panel"><div class="stv10-panel-heading"><h2>Remarks</h2><small>Stored shipment notes</small></div><div class="stv10-remark">'+text(show(remark))+'</div></section>'+
  '</div></div>'+
  '<footer class="stv10-page-footer"><small>Record index '+Number(idx)+' · Values shown from the current shipment record. Missing values are labelled, not inferred.</small><div class="stv10-header-actions">'+
   '<button type="button" class="stv10-btn" data-stv10-back>‹ Back to shipments</button>'+
   (!viewer?'<button type="button" class="stv10-btn" data-stv10-action="return" data-idx="'+Number(idx)+'">✓ Mark returned</button>':'')+
   (admin?'<button type="button" class="stv10-btn danger" data-stv10-action="delete" data-idx="'+Number(idx)+'">Delete record</button>':'')+
  '</div></footer>';
 page.scrollIntoView({block:'start',behavior:'auto'});
}
function pushHistory(page,idx){
 try{history.pushState({staffWorkspaceV10:true,page,index:idx??null},'',location.pathname+location.search+location.hash)}catch(_){}
}
function go(page,idx,addHistory=true){
 if(addHistory)pushHistory(page,idx);
 if(page==='overview')renderOverviewPage();
 else if(page==='shipments')renderShipmentsPage();
 else if(page==='detail')renderDetailPage(idx);
}
function backToShipments(){
 if(history.state&&history.state.staffWorkspaceV10&&history.state.page==='detail'){history.back();return}
 go('shipments',null,true);
}
function getClickedRecordIndex(target,tr){
 const explicit=target.closest('[data-stv10-detail],[data-st9-detail]');
 if(explicit&&explicit.dataset.stv10Detail!==undefined)return Number(explicit.dataset.stv10Detail);
 if(explicit&&explicit.dataset.st9Detail!==undefined)return Number(explicit.dataset.st9Detail);
 if(tr){
  const d=tr.dataset.row;if(d!==undefined&&Number.isInteger(Number(d)))return Number(d);
  const check=tr.querySelector('input.chk-item');if(check&&Number.isInteger(Number(check.value)))return Number(check.value);
 }
 const card=target.closest('.cards-layout .card-box,.kanban-layout .card-box');
 if(card){
  const d=card.dataset.idx??card.dataset.row;
  if(d!==undefined&&Number.isInteger(Number(d)))return Number(d);
  const check=card.querySelector('input.chk-item');if(check&&Number.isInteger(Number(check.value)))return Number(check.value);
 }
 return null;
}
function handleAction(action,idx){
 const i=Number(idx);
 if(!Number.isInteger(i))return;
 if(action==='edit'){go('shipments',null,true);setTimeout(()=>{if(typeof openModal==='function')openModal(i)},50)}
 else if(action==='map'){
  go('overview',null,true);
  setTimeout(()=>{try{if(typeof setView==='function')setView('cards');if(typeof showShipmentRoute==='function')showShipmentRoute(i);document.querySelector('.staff-map-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){console.warn('Unable to open shipment route',e)}},100);
 }
 else if(action==='email'){try{if(typeof openEmailModal==='function')openEmailModal(i)}catch(e){console.warn(e)}}
 else if(action==='return'){
  try{if(typeof markSingleReturned==='function')markSingleReturned(i);setTimeout(()=>{if(currentPage==='detail')renderDetailPage(i)},250)}catch(e){console.warn(e)}
 }
 else if(action==='delete'){
  try{if(typeof deleteRow==='function')deleteRow(i);setTimeout(()=>{if(currentPage==='detail')go('shipments',null,false)},250)}catch(e){console.warn(e)}
 }
}
function init(){
 const main=byId('opsDashboardView');
 if(!main)return;
 addPage();
 const navHandler=e=>{
  const nav=e.target.closest('#staffReferenceSidebar .staff-side-link[data-staff-nav]');
  if(!nav)return;
  const target=nav.getAttribute('data-staff-nav');
  if(!['dashboard','shipments','tracking'].includes(target))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(target==='dashboard')go('overview',null,true);
  else if(target==='shipments')go('shipments',null,true);
  else{
   go('shipments',null,true);
   setTimeout(()=>{const search=byId('search');search?.focus()},80);
  }
 };
 document.addEventListener('click',navHandler,true);
 const clickHandler=e=>{
  const back=e.target.closest('[data-stv10-back]');
  if(back){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();backToShipments();return}
  const action=e.target.closest('[data-stv10-action]');
  if(action){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();handleAction(action.dataset.stv10Action,action.dataset.idx);return}
  if(currentPage==='detail')return;
  const explicit=e.target.closest('[data-stv10-detail],[data-st9-detail]');
  const isContainerLabel=e.target.closest('.card-cntr-code');
  const tr=e.target.closest('#sheetTableBody tr');
  const card=e.target.closest('.cards-layout .card-box,.kanban-layout .card-box');
  if(!explicit&&!tr&&!card)return;
  if(!explicit&&!isContainerLabel&&e.target.closest('input,textarea,select,label,a,button'))return;
  const idx=getClickedRecordIndex(e.target,tr);
  if(idx===null||!Number.isInteger(idx)||idx<0||idx>=records().length)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  go('detail',idx,true);
 };
 document.addEventListener('click',clickHandler,true);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&currentPage==='detail'){e.preventDefault();backToShipments();return}
  if((e.key==='Enter'||e.key===' ')&&currentPage!=='detail'){
   const tr=e.target.closest('#sheetTableBody tr[tabindex="0"]');
   if(tr){e.preventDefault();const idx=Number(tr.dataset.row);if(Number.isInteger(idx))go('detail',idx,true)}
  }
 },true);
 window.addEventListener('popstate',e=>{
  const st=e.state;
  if(st&&st.staffWorkspaceV10)go(st.page||'overview',st.index,false);
  else go('overview',null,false);
 });
 const observer=new MutationObserver(()=>{
  const signedIn=window.getComputedStyle(main).display!=='none';
  if(signedIn&&!lastSignedIn){lastSignedIn=true;go('overview',null,false)}
  if(!signedIn&&lastSignedIn){lastSignedIn=false;currentPage='overview';currentDetailIndex=null;refreshModeClasses('');}
 });
 observer.observe(main,{attributes:true,attributeFilter:['style']});
 const signedIn=window.getComputedStyle(main).display!=='none';
 if(signedIn){lastSignedIn=true;go('overview',null,false)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

;
/* ===== Consolidated from staff-portal-v11.js; original order preserved ===== */
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

;
/* ===== Consolidated from staff-portal-v12.js; original order preserved ===== */
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

;
/* ===== Consolidated from staff-portal-v13.js; original order preserved ===== */
/* Control Tower v13 — remove old visual pattern, preserve existing live metrics/events. */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const byId=id=>document.getElementById(id);
let initialized=false;let waitingObserver=null;let attempts=0;
function updateStatusBar(content,bar,totalLabel,summary){
 const total=Number(byId('staffStatusTotal')?.textContent||0)||0;
 const active=Number(byId('staffStatusActive')?.textContent||0)||0;
 const done=Number(byId('staffStatusDone')?.textContent||0)||0;
 const port=Number(byId('staffStatusPort')?.textContent||0)||0;
 const denom=total||Math.max(1,active+done+port);
 const parts=[['active',active],['done',done],['port',port]];
 bar.innerHTML=parts.map(([cls,n])=>'<span class="st13-status-seg '+cls+'" style="width:'+Math.max(0,Math.min(100,n/denom*100))+'%" title="'+n+' shipments"></span>').join('');
 bar.setAttribute('aria-label',active+' in progress, '+done+' completed, '+port+' awaiting port in');
 totalLabel.textContent=String(total);
 summary.textContent='shipments in '+3+' operational states';
}
function init(){
 if(initialized)return;
 const shell=byId('staffControlTowerV12');
 if(!shell){if(attempts++<30)setTimeout(init,100);return}
 const body=document.body;
 if(!body.classList.contains('staff-overview-page')){
  if(!waitingObserver&&typeof MutationObserver!=='undefined'){
   waitingObserver=new MutationObserver(()=>{
    if(body.classList.contains('staff-overview-page')){waitingObserver.disconnect();waitingObserver=null;init()}
   });
   waitingObserver.observe(body,{attributes:true,attributeFilter:['class']});
  }
  return;
 }
 initialized=true;
 // Keep the live elements, but remove the Intelligence Hub call-to-action from the dashboard header.
 shell.querySelectorAll('.eu-launch,#euHubLaunch').forEach(el=>{el.setAttribute('aria-hidden','true');el.tabIndex=-1;el.style.setProperty('display','none','important')});
 // Remove duplicate snapshot label generated by the older stylesheet and rename the real section once.
 const label=shell.querySelector('.st12-section-label');
 if(label){
  const span=label.querySelector('span');if(span)span.textContent='Live workload';
  const small=label.querySelector('small');if(small)small.textContent='Counts from loaded shipment records';
 }
 // Make the heading more useful and unambiguously new.
 const pageTitle=shell.querySelector('.st12-page-title');if(pageTitle)pageTitle.textContent='Operations overview';
 const pageDesc=shell.querySelector('.st12-page-desc');if(pageDesc)pageDesc.textContent='A live workbench for shipment progress, exceptions and port operations.';
 // Reframe map caption without changing its IDs or handlers.
 const mapTitle=shell.querySelector('.staff-map-panel .staff-panel-heading strong');if(mapTitle)mapTitle.textContent='Port network';
 const mapSub=byId('staffMapSummary');if(mapSub)mapSub.textContent='Origin ports and India gateways mapped from loaded shipments';
 // Replace the old donut graphic with a live segmented bar while keeping the original counts/legend.
 const status= shell.querySelector('.staff-status-content');
 if(status&&!status.querySelector('.st13-status-bar')){
  const total= document.createElement('div');total.className='st13-status-total';
  const number=document.createElement('strong');number.textContent=byId('staffStatusTotal')?.textContent||'0';
  const summary=document.createElement('span');summary.textContent='shipments in 3 operational states';
  total.append(number,summary);
  const bar=document.createElement('div');bar.className='st13-status-bar';bar.setAttribute('role','img');
  bar.setAttribute('aria-label','Shipment status distribution');
  status.insertBefore(bar,status.querySelector('.staff-status-legend'));
  status.insertBefore(total,bar);
  const update=()=>updateStatusBar(status,bar,number,summary);
  update();
  const ids=['staffStatusTotal','staffStatusActive','staffStatusDone','staffStatusPort'];
  const observers=ids.map(id=>byId(id)).filter(Boolean);
  if(typeof MutationObserver!=='undefined'){
   const observer=new MutationObserver(update);
   observers.forEach(n=>observer.observe(n,{childList:true,characterData:true,subtree:true}));
  }
 }
 // Ensure map geometry is recalculated after its final position/layout is applied.
 const map=shell.querySelector('#staffMapCanvas');
 const redraw=()=>{try{if(typeof staffMapInstance!=='undefined'&&staffMapInstance&&typeof staffMapInstance.invalidateSize==='function')staffMapInstance.invalidateSize({pan:false})}catch(_){}};
 if(map&&typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(()=>redraw());ro.observe(map)}
 window.addEventListener('resize',()=>requestAnimationFrame(redraw),{passive:true});
 setTimeout(redraw,80);setTimeout(redraw,350);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
;
/* Clean layout bridge: keep the collapse button and content offset in sync. */
(function(){
 'use strict';
 function init(){
  const sidebar=document.getElementById('staffReferenceSidebar');
  const main=document.getElementById('opsDashboardView');
  if(!sidebar||!main)return;
  const sync=()=>{
   const collapsed=sidebar.classList.contains('collapsed');
   document.body.classList.toggle('staff-sidebar-collapsed',collapsed);
   main.style.setProperty('--gml-sidebar',collapsed?'68px':'244px');
  };
  const observer=new MutationObserver(sync);
  observer.observe(sidebar,{attributes:true,attributeFilter:['class']});
  document.getElementById('staffSidebarToggle')?.addEventListener('click',()=>requestAnimationFrame(sync));
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* --- Combined from approved-control-tower.js --- */
/* Approved Control Tower UI — composition only; reuses the existing live data and handlers. */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getValue(record,keys){try{if(typeof getField==='function'){const v=getField(record,keys);if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}}catch(_){}for(const k of keys){const v=record?.[k];if(v!==undefined&&v!==null&&String(v).trim()!==''&&String(v).trim()!=='—')return v}return ''}
function statusFor(record){try{if(typeof getStatus==='function'){const s=getStatus(record);return String(s?.text||'In transit').replace(/^\p{Extended_Pictographic}\s*/u,'')}}catch(_){}return getValue(record,['STATUS','CURRENT STATUS','STAGE'])||'In transit'}
function getRows(){try{return Array.isArray(rows)?rows:[]}catch(_){return []}}
function createHeader(){
 const tools=$('.header-tools');if(!tools||$('.approved-top-nav'))return;
 const nav=document.createElement('nav');nav.className='approved-top-nav';nav.setAttribute('aria-label','Main navigation');
 const items=[['dashboard','Control Tower'],['shipments','Shipments'],['tracking','Track & Trace'],['documents','Documents'],['reports','Reports']];
 items.forEach(([target,label],i)=>{const b=document.createElement('button');b.type='button';b.dataset.approvedNav=target;b.textContent=label;if(i===0)b.classList.add('active');nav.appendChild(b)});
 const search=document.createElement('label');search.className='approved-header-search';search.innerHTML='<span aria-hidden="true">⌕</span><input type="search" id="approvedGlobalSearch" placeholder="Search shipment, container, BL or port…" aria-label="Search shipment, container, bill of lading or port">';
 const newBtn=document.createElement('button');newBtn.type='button';newBtn.className='approved-new-shipment';newBtn.innerHTML='＋ New shipment';
 tools.insertBefore(nav,tools.firstChild);tools.insertBefore(search,nav.nextSibling);tools.appendChild(newBtn);
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-approved-nav]');if(!b)return;const target=b.dataset.approvedNav;nav.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));if(target==='dashboard')$('#staffReferenceSidebar [data-staff-nav="dashboard"]')?.click();else if(target==='shipments')$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();else if(target==='tracking')$('#staffReferenceSidebar [data-staff-nav="tracking"]')?.click();else if(target==='documents')$('#headerCsnBtn')?.click();else if(target==='reports')$('#openAnalyticsBtn')?.click()});
 search.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Enter'){const input=$('#search');if(input){input.value=e.currentTarget.value;input.dispatchEvent(new Event('input',{bubbles:true}))}}});
 newBtn.addEventListener('click',()=>$('#addBtn')?.click());
}
function buildShipmentPanel(shell){
 if($('.approved-live-shipments',shell))return;
 const panel=document.createElement('section');panel.className='approved-live-shipments';panel.setAttribute('aria-label','Live shipments');
 panel.innerHTML='<div class="approved-panel-head"><div><div class="approved-panel-title">Live shipments</div><div class="approved-panel-subtitle">Latest movements across your loaded shipment records</div></div><div class="approved-panel-actions"><button class="approved-filter-chip active" type="button" data-approved-filter="all">All shipments</button><button class="approved-filter-chip" type="button" data-approved-filter="risk">At risk</button><button class="approved-filter-chip" type="button" data-approved-filter="port">At port</button><button class="approved-filter-chip" type="button" data-approved-view-all>View all →</button></div></div><div class="approved-table-wrap"><table class="approved-shipment-table"><thead><tr><th>Shipment / Container</th><th>Route</th><th>Carrier / Vessel</th><th>ETA</th><th>Status</th></tr></thead><tbody class="approved-shipment-body"><tr><td colspan="5">Loading shipment records…</td></tr></tbody></table></div>';
 const grid=$('.st12-main-grid',shell);if(grid)grid.insertAdjacentElement('afterend',panel);else shell.appendChild(panel);
 const activity=document.createElement('section');activity.className='approved-activity-strip';activity.setAttribute('aria-label','Latest activity');activity.innerHTML='<div class="approved-activity-heading">Latest activity<small>Recent movements recorded in your workspace</small></div><div class="approved-activity-item"><strong>Shipment activity</strong><span>Activity appears as records are loaded</span></div><div class="approved-activity-item"><strong>Milestone updates</strong><span>Based on recorded shipment milestones</span></div><div class="approved-activity-item"><strong>Sync status</strong><span id="approvedSyncSummary">Waiting for workspace data</span></div>';
 panel.insertAdjacentElement('afterend',activity);
 panel.addEventListener('click',e=>{const filter=e.target.closest('[data-approved-filter]');if(filter){panel.querySelectorAll('[data-approved-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderShipments(panel,filter.dataset.approvedFilter);return}if(e.target.closest('[data-approved-view-all]'))$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();const link=e.target.closest('[data-approved-record]');if(link){const i=link.dataset.approvedRecord;const existing=$('#sheetTableBody tr[data-row="'+CSS.escape(i)+'"] [data-st9-detail]');if(existing)existing.click();else{$('#staffReferenceSidebar [data-staff-nav="shipments"]')?.click();setTimeout(()=>$('#sheetTableBody tr[data-row="'+CSS.escape(i)+'"] [data-st9-detail]')?.click(),250)}}});
 renderShipments(panel,'all');
}
function renderShipments(panel,filter){
 const body=$('.approved-shipment-body',panel);if(!body)return;
 const all=getRows();let indexed=all.map((r,i)=>({r,i})).filter(({r})=>r&&typeof r==='object');
 if(filter==='risk')indexed=indexed.filter(({r})=>/risk|overdue|delay|hold|exception|pending/i.test(statusFor(r)+' '+getValue(r,['REMARKS','NOTES','STATUS'])));
 if(filter==='port')indexed=indexed.filter(({r})=>/port/i.test(statusFor(r)+' '+getValue(r,['GATEWAY PORT','POD','PORT IN'])));
 const shown=indexed.slice(0,5);
 if(!shown.length){body.innerHTML='<tr><td colspan="5">No shipment records are currently available in this view.</td></tr>';return}
 body.innerHTML=shown.map(({r,i})=>{const cn=getValue(r,['CONTAINER NO.','CONTAINER','CONTAINER NO','CNTR NO','CONTAINER NUMBER']);const pol=getValue(r,['POL','PORT OF LOADING','ORIGIN']);const pod=getValue(r,['GATEWAY PORT','POD','PORT','DESTINATION']);const liner=getValue(r,['LINER','LINE','CARRIER']);const vessel=getValue(r,['VESSEL & VOY','VESSEL','VESSEL NAME']);const eta=getValue(r,['ETA']);const status=statusFor(r);const low=status.toLowerCase();const klass=/risk|overdue|delay|hold|exception/i.test(low)?'risk':/port|await/i.test(low)?'port':/done|return|complete|destuff/i.test(low)?'done':'';return '<tr><td><button type="button" class="approved-record-link" data-approved-record="'+i+'">'+escapeHTML(cn||'Shipment record')+'</button></td><td>'+escapeHTML(pol||'—')+' <span style="color:#90a1b5">→</span> '+escapeHTML(pod||'—')+'</td><td>'+escapeHTML(liner||'—')+(vessel?'<div style="font-size:9px;color:#8194a9;margin-top:3px">'+escapeHTML(vessel)+'</div>':'')+'</td><td>'+escapeHTML(eta||'—')+'</td><td><span class="approved-status-pill '+klass+'">'+escapeHTML(status)+'</span></td></tr>'}).join('');
 const sync=$('#approvedSyncSummary');if(sync)sync.textContent=all.length+' records loaded';
}
function init(){
 createHeader();
 const shell=$('#staffControlTowerV12');if(!shell)return;
 const grid=$('.st12-main-grid',shell),mapBlock=$('.st12-map-block',shell),worklist=$('.st12-worklist-slot',shell),status=$('.st12-status-slot',shell),recent=$('.st12-recent-slot',shell);
 if(grid&&mapBlock&&worklist&&status&&recent){
  const exceptions=$('#staffExceptionQueue',shell);
  grid.replaceChildren();
  grid.append(mapBlock,exceptions||worklist,status,recent);
  if(worklist&&worklist!==exceptions)worklist.remove();
  const side=$('.st12-side-stack',shell);if(side)side.remove();
 }
 buildShipmentPanel(shell);
 const globalSearch=$('#approvedGlobalSearch');
 if(globalSearch)globalSearch.addEventListener('input',()=>{const input=$('#search');if(input){input.value=globalSearch.value;input.dispatchEvent(new Event('input',{bubbles:true}))}});
 const updateNav=()=>{const isList=document.body.classList.contains('staff-shipment-list-page');const isDetail=document.body.classList.contains('staff-shipment-detail-page');const active=isList?'shipments':isDetail?'shipments':'dashboard';$$('.approved-top-nav [data-approved-nav]').forEach(b=>b.classList.toggle('active',b.dataset.approvedNav===active))};
 new MutationObserver(updateNav).observe(document.body,{attributes:true,attributeFilter:['class']});updateNav();
 if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>renderShipments($('.approved-live-shipments'),'all'));const source=$('#sheetTableBody');if(source)observer.observe(source,{childList:true,subtree:true,characterData:true})}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
