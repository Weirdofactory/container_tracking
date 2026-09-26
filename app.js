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
  'POL', 'ETD', 'FREE DAYS', 'SEAL NO.', 'VESSEL & VOY', 
  'ETA', 'SPLIT DATE', 'INWARD DATE', 'PORT IN', 'PORT OUT', 'CFS IN', 'TRUCK NO.', 
  'DRIVER CONTACT', 'PLANNING', 'DESTUFFING DATE', 'EMPTY RETURN VALIDITY', 'CONTAINER RETURN DATE', 'REMARKS'
];
const DATE_COLS = new Set(['ETD', 'ETA', 'SPLIT DATE', 'INWARD DATE', 'PORT IN', 'PORT OUT', 'CFS IN', 'DESTUFFING DATE', 'EMPTY RETURN VALIDITY', 'CONTAINER RETURN DATE']);

const DEFAULT_ROWS = [
  {
    "CONTAINER NO.": "SKHU9422886", "TYPE": "40' DC", "MBL NO": "SNK003C260801543", "LINER": "PAREKH", 
    "GATEWAY PORT": "CCTL", "CFS NAME": "ECCT", "POL": "SHEKOU", "ETD": "2026-08-26", "FREE DAYS": "14", "SEAL NO.": "ML-99824",
    "VESSEL & VOY": "TS QINGDAO V 2618W", "ETA": "2026-09-04", "SPLIT DATE": "2026-09-03", "INWARD DATE": "2026-09-04", 
    "PORT IN": "2026-09-04", "PORT OUT": "2026-09-05", "CFS IN": "2026-09-05", "TRUCK NO.": "TN-04-AR-8821",
    "DRIVER CONTACT": "Ravi Kumar (98401XXXXX)", "PLANNING": "", "DESTUFFING DATE": "2026-09-05", "CONTAINER RETURN DATE": "", "REMARKS": ""
  },
  {
    "CONTAINER NO.": "SKHU6385027", "TYPE": "40' DC", "MBL NO": "SNK003C260801543", "LINER": "PAREKH", 
    "GATEWAY PORT": "CCTL", "CFS NAME": "ECCT", "POL": "SHEKOU", "ETD": "2026-08-26", "FREE DAYS": "14", "SEAL NO.": "ML-99825",
    "VESSEL & VOY": "TS QINGDAO V 2618W", "ETA": "2026-09-04", "SPLIT DATE": "", "INWARD DATE": "", 
    "PORT IN": "2026-09-04", "PORT OUT": "", "CFS IN": "", "TRUCK NO.": "",
    "DRIVER CONTACT": "", "PLANNING": "", "DESTUFFING DATE": "", "CONTAINER RETURN DATE": "", "REMARKS": "NOT MOVED"
  },
  {
    "CONTAINER NO.": "IAAU1753030", "TYPE": "40' DC", "MBL NO": "A56GX21515", "LINER": "IAL",
    "GATEWAY PORT": "CCTL", "CFS NAME": "ECCT", "POL": "SHANGHAI", "ETD": "2026-08-18", "FREE DAYS": "14", "SEAL NO.": "IAL-44120",
    "VESSEL & VOY": "REN JIAN 23 V 2633W", "ETA": "2026-09-13", "SPLIT DATE": "2026-09-12", "INWARD DATE": "2026-09-14",
    "PORT IN": "", "PORT OUT": "", "CFS IN": "", "TRUCK NO.": "",
    "DRIVER CONTACT": "", "PLANNING": "", "DESTUFFING DATE": "", "CONTAINER RETURN DATE": "", "REMARKS": ""
  }
];

let rows = [...DEFAULT_ROWS];

let currentUser = null;
let selectedIndices = new Set();
let currentView = 'cards';
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
  "SHEKOU": [22.48, 113.91], "BUSAN": [35.10, 129.04], "SHANGHAI": [31.23, 121.47],
  "NINGBO": [29.86, 121.54], "QINGDAO": [36.06, 120.38], "SINGAPORE": [1.29, 103.85],
  "PORT KLANG": [3.00, 101.40], "CCTL": [13.085, 80.298], "CITPL": [13.098, 80.305],
  "KATTUPALLI": [13.315, 80.345], "ENNORE": [13.250, 80.332], "CHENNAI": [13.0827, 80.2707]
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

function generatePublicVoyageTimelineHtml(r) {
  const mblNo = esc(getField(r, ["MBL NO", "MBL", "MASTER BL"]) || "—");
  const vesselName = esc(getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "—");
  const cfsName = esc(getField(r, ["CFS NAME", "CFS"]) || "—");
  const liner = esc(getField(r, ["LINER", "LINE"]) || detectLinerFromMBL(mblNo) || "—");
  const pol = esc(getField(r, ["POL", "PORT OF LOADING"]) || "—");
  const eta = formatDate(getField(r, ["ETA"])) || 'Pending';

  const igmSplit = formatDate(getField(r, ["SPLIT DATE", "SPLIT"]));
  const inward = formatDate(getField(r, ["INWARD DATE", "INWARD"]));
  const berthedPort = formatDate(getField(r, ["PORT IN"]));
  const portOut = formatDate(getField(r, ["PORT OUT"]));
  const cfsIn = formatDate(getField(r, ["CFS IN"]));
  const destuffed = formatDate(getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]));
  const containerReturned = formatDate(getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]));

  // Current Status only — milestones are intentionally not rendered here.
  let currentStatusTxt = "Pending Arrival";
  let nextStepTxt = inward ? "Vessel Berthing" : "Inward Granted";
  let statusColor = "var(--warning)";
  let statusIcon = "⏳";

  if (containerReturned) { currentStatusTxt = "Empty Returned"; nextStepTxt = "Tracking Complete"; statusColor = "var(--success)"; statusIcon = "✓"; }
  else if (destuffed) { currentStatusTxt = "Destuffed"; nextStepTxt = "Empty Return to Depot"; statusColor = "var(--success)"; statusIcon = "📦"; }
  else if (cfsIn) { currentStatusTxt = "Gated into CFS"; nextStepTxt = "Destuffing"; statusColor = "var(--accent)"; statusIcon = "🏭"; }
  else if (portOut) { currentStatusTxt = "Port Discharged"; nextStepTxt = "CFS In-Gate"; statusColor = "var(--accent)"; statusIcon = "⚓"; }
  else if (berthedPort) { currentStatusTxt = "Vessel Berthed"; nextStepTxt = "Port Discharge"; statusColor = "var(--accent)"; statusIcon = "🚢"; }
  else if (inward) { currentStatusTxt = "Inward Granted"; nextStepTxt = "Vessel Berthing"; statusColor = "var(--warning)"; statusIcon = "🛃"; }

  return `
    <div class="public-status-result">
      <div class="current-status-card" style="--status-color:${statusColor};">
        <div class="current-status-main">
          <div class="current-status-icon">${statusIcon}</div>
          <div class="current-status-copy">
            <div class="current-status-eyebrow">CURRENT STATUS</div>
            <div class="current-status-title">${currentStatusTxt}</div>
          </div>
        </div>
        <div class="current-status-next">
          <span>AWAITING NEXT</span>
          <strong>${nextStepTxt}</strong>
        </div>
      </div>
      <div class="info-panel shipment-info-panel">
        <div class="info-item"><label>Line / MBL</label><val>${liner} • ${mblNo}</val></div>
        <div class="info-item"><label>Vessel & Voyage</label><val>${vesselName}</val></div>
        <div class="info-item"><label>Estimated Arrival</label><val>${eta}</val></div>
        <div class="info-item"><label>Port of Loading</label><val>${pol}</val></div>
        <div class="info-item"><label>Designated CFS</label><val>${cfsName}</val></div>
        <div class="info-item"><label>Equipment Size</label><val>${esc(getField(r, ["TYPE", "SIZE"]) || "40' DC")}</val></div>
        ${igmSplit ? `<div class="info-item"><label>IGM Split</label><val>${igmSplit}</val></div>` : ''}
      </div>
    </div>
  `;

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
  const reportDate = now.toLocaleDateString("en-IN", { weekday:"short", day:"2-digit", month:"short", year:"numeric" });
  const items = containersList || [];

  const value = (r, keys, fallback = "—") => getField(r, keys) || fallback;
  const date = (v) => v ? formatDate(v) : "—";
  const teuFor = (type) => {
    const t = String(type || "").toUpperCase();
    return t.includes("40") || t.includes("45") ? 2 : 1;
  };
  const status = (r) => {
    const s = isFullyCompleted(r) ? "DE-STUFF COMPLETED" : String(getStatus(r).text || "PENDING").replace(/[^\w\s/-]/g,"").trim().toUpperCase();
    return s || "PENDING";
  };

  const row = (r) => {
    const container = value(r, ["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]);
    const type = value(r, ["TYPE","SIZE"]);
    const mbl = value(r, ["MBL NO","MBL","MASTER BL"]);
    const liner = value(r, ["LINER","LINE"]) || detectLinerFromMBL(mbl) || "—";
    const vessel = value(r, ["VESSEL & VOY","VESSEL","VESSEL NAME"]);
    const pod = getGatewayPortInfo(r).name || "—";
    const pol = value(r, ["POL","PORT OF LOADING"]);
    const cfs = value(r, ["CFS NAME","CFS"]);
    const eta = date(value(r, ["ETA"], ""));
    const portIn = date(value(r, ["PORT IN"], ""));
    const destuff = date(value(r, ["DESTUFFING DATE","DESTUFF DATE"], ""));
    const remarks = value(r, ["REMARKS","REMARK","NOTES","NOTE"]);
    const etd = date(value(r, ["ETD"], ""));
    const st = status(r);
    const done = /COMPLETED|RETURNED|DELIVERED/.test(st);

    return '<tr>'
      + '<td><div class="cn">' + esc(container) + '</div><div class="sub">' + esc(type) + '</div></td>'
      + '<td><div class="main">' + esc(mbl) + '</div><div class="sub">' + esc(liner) + '</div></td>'
      + '<td><div class="main">' + esc(vessel) + '</div></td>'
      + '<td><div class="main">' + esc(pod) + '</div></td>'
      + '<td><div class="main">' + esc(pol) + '</div><div class="sub">ETD: ' + esc(etd) + '</div></td>'
      + '<td><div class="main cfs">' + esc(cfs) + '</div></td>'
      + '<td><div class="main">' + esc(eta) + ' /</div><div class="date2">' + esc(portIn) + '</div></td>'
      + '<td><div class="main">' + esc(destuff) + '</div></td>'
      + '<td><span class="status ' + (done ? 'done' : 'pending') + '">' + (done ? '📦 ' : '') + esc(st) + '</span></td>'
      + '<td><div class="remarks">' + esc(remarks) + '</div></td>'
      + '</tr>';
  };

  const totalTeu = items.reduce((sum,r) => sum + teuFor(value(r, ["TYPE","SIZE"], "")), 0);

  return '<div id="manifestCaptureContainer" data-report-version="2026-09-25-V7" style="width:1600px;background:#fff;border:1px solid #cfd8e3;border-radius:14px;padding:34px 40px 22px;font-family:Arial,Helvetica,sans-serif;color:#10213f;box-sizing:border-box;">'
    + '<style>'
    + '#manifestCaptureContainer .report-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #17233b;padding-bottom:20px;margin-bottom:20px;}'
    + '#manifestCaptureContainer .brand{font-size:28px;font-weight:900;letter-spacing:.01em;color:#10213f;}'
    + '#manifestCaptureContainer .desk{font-size:15px;font-weight:700;color:#68778d;margin-top:8px;}'
    + '#manifestCaptureContainer .rdate{font-family:Consolas,monospace;font-size:19px;font-weight:900;color:#1688be;white-space:nowrap;}'
    + '#manifestCaptureContainer table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12px;}'
    + '#manifestCaptureContainer th{background:#111b31;color:#fff;text-align:left;padding:13px 11px;font-size:12px;font-weight:900;letter-spacing:.01em;border-right:1px solid #2c3850;}'
    + '#manifestCaptureContainer th:first-child{border-radius:4px 0 0 0;}'
    + '#manifestCaptureContainer th:last-child{border-radius:0 4px 0 0;border-right:0;}'
    + '#manifestCaptureContainer td{padding:15px 11px 13px;border-bottom:1px solid #dfe5ec;vertical-align:top;height:70px;}'
    + '#manifestCaptureContainer .cn{font-family:Consolas,monospace;font-size:14px;font-weight:900;color:#1187bd;letter-spacing:.02em;overflow-wrap:anywhere;word-break:break-word;}'
    + '#manifestCaptureContainer .main{font-size:12.5px;font-weight:800;color:#1d2b43;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;}'
    + '#manifestCaptureContainer .sub{font-size:11px;font-weight:700;color:#7a8799;margin-top:5px;overflow-wrap:anywhere;word-break:break-word;}'
    + '#manifestCaptureContainer .date2{font-size:14px;font-weight:900;color:#1688be;margin-top:4px;}'
    + '#manifestCaptureContainer .cfs{color:#1688be;}'
    + '#manifestCaptureContainer .status{display:inline-block;border-radius:6px;padding:7px 10px;font-size:10px;font-weight:900;white-space:normal;line-height:1.25;text-align:center;}'
    + '#manifestCaptureContainer .status.done{background:#dff7e8;color:#20844a;}'
    + '#manifestCaptureContainer .status.pending{background:#eaf2fb;color:#235b8c;}'
    + '#manifestCaptureContainer .remarks{font-size:11px;font-weight:700;color:#34445d;line-height:1.4;overflow-wrap:anywhere;word-break:break-word;}'
    + '#manifestCaptureContainer .summary{display:flex;justify-content:flex-end;gap:24px;margin-top:14px;font-size:12px;color:#68778d;font-weight:700;}'
    + '#manifestCaptureContainer .summary b{color:#17233b;}'
    + '</style>'
    + '<div class="report-head">'
    + '<div><div class="brand">GREENWICH MERIDIAN LOGISTICS (INDIA) PVT. LTD.</div><div class="desk">Live Status Report • Chennai Operations Desk</div></div>'
    + '<div class="rdate">' + esc(reportDate) + '</div>'
    + '</div>'
    + '<table>'
    + '<colgroup><col style="width:10%"><col style="width:10%"><col style="width:16%"><col style="width:7%"><col style="width:10%"><col style="width:7%"><col style="width:10%"><col style="width:8%"><col style="width:10%"><col style="width:12%"></colgroup>'
    + '<thead><tr><th>CONTAINER NO</th><th>MBL / LINE</th><th>VESSEL</th><th>PORT</th><th>POL</th><th>CFS</th><th>ETA / PORT IN</th><th>DESTUFF</th><th>STATUS</th><th>REMARKS</th></tr></thead>'
    + '<tbody>' + (items.length ? items.map(row).join("") : '<tr><td colspan="10" style="text-align:center;padding:30px;color:#7a8799;font-weight:700;">No containers selected.</td></tr>') + '</tbody>'
    + '</table>'
    + '<div class="summary"><span>Total Containers: <b>' + items.length + '</b></span><span>Total TEU: <b>' + totalTeu + '</b></span></div>'
    + '</div>';
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
        scale: 1.25,
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

/* Staff Login Handlers */
function executeSuccessfulLogin(userObj) {
  currentUser = userObj;
  localStorage.setItem("gml_auth_code_user", JSON.stringify(currentUser));
  el("loginModalBg").classList.remove("open");
  el("loginSubmit").textContent = "Sign In";
  setAccessState(true);
  toast(`Logged in as ${currentUser.id}`);
}

el("loginBtn").addEventListener("click", () => {
  el("loginCodeInput").value = "";
  el("loginModalBg").classList.add("open");
  setTimeout(() => el("loginCodeInput").focus(), 100);
});
el("loginClose").addEventListener("click", () => el("loginModalBg").classList.remove("open"));
el("loginCancel").addEventListener("click", () => el("loginModalBg").classList.remove("open"));

el("loginCodeInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") el("loginSubmit").click();
});

el("loginSubmit").addEventListener("click", async () => {
  const code = el("loginCodeInput").value.trim().toLowerCase();
  if (!code) return alert("Please enter your Access Code.");

  const originalBtnText = el("loginSubmit").textContent;
  el("loginSubmit").textContent = "Verifying...";

  try {
    const { data, error } = await Promise.race([
      sb.from('user_roles').select('user_id, role, username').eq('access_code', code).single(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000))
    ]);

    if (error || !data) {
      alert("Invalid Access Code.");
      el("loginSubmit").textContent = originalBtnText;
    } else {
      executeSuccessfulLogin({ id: data.username || code, role: data.role || "Operator", uid: data.user_id });
    }
  } catch(err) {
    console.warn("Supabase auth error:", err);
    alert("Database connection slow or failed. Please try again.");
    el("loginSubmit").textContent = originalBtnText;
  }
});

el("terminalRoutingBtn")?.addEventListener("click", openTerminalRoutingMaster);
el("logoutBtn").addEventListener("click", () => {
  currentUser = null;
  localStorage.removeItem("gml_auth_code_user");
  setAccessState(false);
  toast("Logged out");
});

function checkActiveSession() {
  const savedUser = localStorage.getItem("gml_auth_code_user");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      setAccessState(true);
      return;
    } catch(e) { }
  }
  setAccessState(false);
}

function setAccessState(isStaff) {
  el("opsControls").style.display = isStaff ? "flex" : "none";
  el("publicControls").style.display = isStaff ? "none" : "flex";
  
  if (isStaff) {
    el("publicLandingView").style.display = "none";
    el("opsDashboardView").style.display = "block";
    el("opsDashboardView").classList.remove("fade-in");
    void el("opsDashboardView").offsetWidth;
    el("opsDashboardView").classList.add("fade-in");
  } else {
    el("opsDashboardView").style.display = "none";
    el("publicLandingView").style.display = "block";
    el("publicLandingView").classList.remove("fade-in");
    void el("publicLandingView").offsetWidth;
    el("publicLandingView").classList.add("fade-in");
  }

  if (isStaff && currentUser) {
    el("userBadge").textContent = `${currentUser.id} (${currentUser.role})`;
    const isViewer = currentUser.role === "Viewer";
    document.querySelectorAll(".action-editor-only").forEach(elem => {
      elem.style.display = isViewer ? "none" : "inline-flex";
    });
    renderUI();
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

function getSkeletonHTML() {
  return `
    <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:18px; padding:24px; margin-bottom:20px; box-shadow:var(--shadow-lg);">
      <div style="display:flex; justify-content:space-between; margin-bottom:24px;">
        <div>
          <div class="skeleton-box" style="width:100px; height:12px; margin-bottom:8px;"></div>
          <div class="skeleton-box" style="width:180px; height:24px;"></div>
        </div>
        <div class="skeleton-box" style="width:120px; height:32px; border-radius:20px;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:30px; position:relative;">
        <div class="skeleton-box" style="position:absolute; top:13px; left:0; right:0; height:2px;"></div>
        ${[1,2,3,4,5,6].map(() => `
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px; z-index:2;">
            <div class="skeleton-box" style="width:28px; height:28px; border-radius:50%; border:2px solid var(--border);"></div>
            <div class="skeleton-box" style="width:70px; height:10px;"></div>
            <div class="skeleton-box" style="width:50px; height:10px;"></div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function performPublicSearch() {
  const rawInput = el("publicSearchInput").value.trim();
  const container = el("publicResultContainer");
  const btn = el("publicSearchBtn");
  
  if (!rawInput) {
    toast("Please enter a Container or MBL Number!");
    el("publicSearchInput").focus();
    return;
  }

  // Trigger Realistic Loading Skeleton
  btn.classList.add("btn-loading");
  container.style.display = "block";
  container.innerHTML = getSkeletonHTML();
  container.classList.add("fade-in");
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setTimeout(() => {
    btn.classList.remove("btn-loading");
    const queries = rawInput.split(/[\s,]+/).filter(Boolean).map(q => q.toLowerCase().replace(/[^a-z0-9]/g, ''));

    const publicSearchResults = rows.filter(r => {
      const cntr = (getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]) || "").toLowerCase().replace(/[^a-z0-9]/g, '');
      const mbl = (getField(r, ["MBL NO", "MBL", "MASTER BL"]) || "").toLowerCase().replace(/[^a-z0-9]/g, '');
      return queries.some(q => q && (cntr === q || mbl === q || cntr.includes(q) || mbl.includes(q)));
    });

    if (!publicSearchResults.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--danger);">
          <div style="font-size:36px; margin-bottom:10px;">🔍</div>
          <strong style="font-size:16px;">No shipment records found for "${esc(rawInput)}"</strong>
          <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">
            Try searching test units: <code>SKHU9422886</code>, <code>IAAU1753030</code>, or MBL <code>A56GX21515</code>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="public-status-header">
        <div style="font-size:9px;font-weight:900;color:var(--accent);text-transform:uppercase;letter-spacing:.12em;">CUSTOMER SHIPMENT VISIBILITY</div>
        <div style="font-size:22px;font-weight:900;margin-top:4px;">Your Shipments</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:5px;">Quick overview — click any shipment for details.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 12px;">
        <button class="btn btn-ghost public-list-filter active" data-filter="all" style="padding:7px 12px;font-size:11px;">All (${publicSearchResults.length})</button>
        <button class="btn btn-ghost public-list-filter" data-filter="active" style="padding:7px 12px;font-size:11px;">In Progress</button>
        <button class="btn btn-ghost public-list-filter" data-filter="completed" style="padding:7px 12px;font-size:11px;">Completed</button>
        <button class="btn btn-ghost public-list-filter" data-filter="attention" style="padding:7px 12px;font-size:11px;">Needs Attention</button>
      </div>
      <div style="overflow:auto;border:1px solid var(--border);border-radius:14px;background:#fff;">
        <table class="public-shipment-table" style="width:100%;border-collapse:collapse;min-width:850px;">
          <thead><tr style="background:#10213f;color:#fff;text-align:left;">
            <th style="padding:12px 14px;font-size:10px;">CONTAINER</th>
            <th style="padding:12px 14px;font-size:10px;">VESSEL / VOYAGE</th>
            <th style="padding:12px 14px;font-size:10px;">ETA</th>
            <th style="padding:12px 14px;font-size:10px;">CFS</th>
            <th style="padding:12px 14px;font-size:10px;">CURRENT STATUS</th>
            <th style="padding:12px 14px;font-size:10px;">NEXT STEP</th>
            <th style="padding:12px 14px;font-size:10px;"></th>
          </tr></thead>
          <tbody>
            ${publicSearchResults.map((r, i) => {
              const st = getStatus(r);
              const cntr = getField(r, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO"]);
              const vessel = getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]);
              const eta = formatDate(getField(r, ["ETA"])) || "—";
              const cfsName = getField(r, ["CFS NAME", "CFS"]) || "—";
              const returned = getField(r, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]);
              const destuffed = getField(r, ["DESTUFFING DATE", "DESTUFF DATE"]);
              const cfsIn = getField(r, ["CFS IN"]);
              const portOut = getField(r, ["PORT OUT"]);
              const remarks = getField(r, ["REMARKS", "REMARK", "NOTES", "NOTE"]);
              const next = returned ? "Tracking Complete" : destuffed ? "Empty Return to Depot" : cfsIn ? "Destuffing" : portOut ? "CFS In-Gate" : "Next milestone pending";
              const complete = !!returned || st.class === "completed";
              const attention = /PENDING|NOT|ISSUE|HOLD/i.test(remarks);
              const statusText = returned ? "EMPTY RETURNED" : destuffed ? "DESTUFFED" : cfsIn ? "CFS IN" : portOut ? "PORT OUT" : getField(r, ["PORT IN"]) ? "PORT IN" : (st.text || "PENDING");
              const publicUrl = window.location.href.split('?')[0] + '?cntr=' + encodeURIComponent(cntr);
              const detail = generatePublicVoyageTimelineHtml(r);
              return '<tr class="public-shipment-row" data-status="' + (complete ? "completed" : attention ? "attention" : "active") + '" style="border-top:1px solid var(--border);cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\\'table-row\\'?\\'none\\':\\'table-row\\'">'
                + '<td style="padding:13px 14px;"><div style="font-family:monospace;font-weight:900;color:var(--accent);">' + esc(cntr) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + esc(getField(r,["TYPE","SIZE"]) || "") + '</div></td>'
                + '<td style="padding:13px 14px;font-weight:800;font-size:12px;">' + esc(vessel || "—") + '</td>'
                + '<td style="padding:13px 14px;font-weight:800;font-size:12px;">' + esc(eta) + '</td>'
                + '<td style="padding:13px 14px;font-weight:800;font-size:12px;">' + esc(cfsName) + '</td>'
                + '<td style="padding:13px 14px;"><span style="display:inline-block;border-radius:14px;padding:6px 9px;font-size:10px;font-weight:900;background:' + (complete ? "#e7f6ec" : "#eef6ff") + ';color:' + (complete ? "#137333" : "#245b8a") + ';">' + esc(statusText) + '</span></td>'
                + '<td style="padding:13px 14px;font-size:11px;font-weight:700;color:var(--text-muted);">' + esc(next) + '</td>'
                + '<td style="padding:13px 14px;font-size:18px;color:var(--accent);">›</td></tr>'
                + '<tr class="public-shipment-detail" style="display:none;background:#f8fafc;"><td colspan="7" style="padding:0 14px 14px;"><div style="padding-top:10px;">' + detail + '</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;"><button class="btn btn-ghost" style="padding:6px 10px;font-size:10px;" onclick="event.stopPropagation();copyText(\\'' + publicUrl.replace(/'/g,"\\\\'") + '\\')">🔗 Copy Tracking Link</button></div></td></tr>';
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll('.public-list-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.public-list-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        document.querySelectorAll('.public-shipment-row').forEach(row => {
          const show = filter === 'all' || row.dataset.status === filter;
          row.style.display = show ? 'table-row' : 'none';
          if (!show && row.nextElementSibling) row.nextElementSibling.style.display = 'none';
        });
      });
    });

    // Trigger sequential timeline drawing
    setTimeout(() => {
      document.querySelectorAll('.timeline-stepper').forEach(stepper => {
         const nodes = stepper.querySelectorAll('.step-node');
         nodes.forEach((node, idx) => {
             if (nodes[idx + 1] && (nodes[idx + 1].classList.contains('completed') || nodes[idx + 1].classList.contains('active'))) {
                 setTimeout(() => node.classList.add('draw-line'), idx * 300);
             }
         });
      });
    }, 50);

  }, 1200); // 1.2s for realistic load feel
}

el("publicSearchBtn").addEventListener("click", performPublicSearch);
el("publicSearchInput").addEventListener("keypress", (e) => { if (e.key === "Enter") performPublicSearch(); });

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

// Bind the Snapshot button
el("bulkPhotoBtn").addEventListener("click", () => {
  if (!selectedIndices.size) return alert("Select at least one container!");
  const selectedRows = Array.from(selectedIndices).map(idx => rows[idx]);
  downloadMultipleStatusImage(selectedRows, "Bulk_Snapshot");
});

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

    if (activeQuickFilter === "active" && completed) return false;
    if (activeQuickFilter === "completed" && !completed) return false;
    if (activeQuickFilter === "today" && (getField(r, ["ETA"]) !== todayStr && getField(r, ["PORT IN"]) !== todayStr)) return false;
    if (activeQuickFilter === "demurrage" && (completed || !fees.demOverdue)) return false;
    if (activeQuickFilter === "detention" && (completed || !fees.detOverdue)) return false;
    if (activeQuickFilter === "critical_lfd" && (completed || ((fees.terminalDaysLeft > 2 || fees.terminalDaysLeft === null) && (fees.detentionDaysLeft > 2 || fees.detentionDaysLeft === null)))) return false;

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
  const filtered = getFilteredRows();
  updateKPIs();

  if (currentView === 'cards') renderCards(filtered);
  else if (currentView === 'sheet') renderSheet(filtered);
  else if (currentView === 'kanban') renderKanban(filtered);

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
            <label>Port Out LFD / Dwell</label>
            <val style="${fees.demOverdue ? 'color:var(--danger)' : ''}">${fees.terminalLFD} (${fees.portDwell}d / Free ${fees.portFreeDays}d)</val>
          </div>
          <div class="detail-item">
            <label>EMPTY RETURN VALIDITY / COUNTDOWN</label>
            <val>
              ${(() => {
                const ev = getEmptyReturnValidity(r);
                const c = ev.state === "overdue" ? "var(--danger)" : ev.state === "warning" || ev.state === "critical" ? "var(--warning)" : ev.state === "returned" ? "var(--success)" : "var(--text-main)";
                return `<span style="color:${c};font-weight:800">${ev.date} · ${ev.label}</span>`;
              })()}
            </val>
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
    el("sheetTableBody").innerHTML = `<tr><td colspan="17" style="text-align:center; padding:40px; color:var(--text-muted);">No records found.</td></tr>`;
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
        <td data-label="Port Out LFD" style="font-weight:700; color:${fees.demOverdue ? 'var(--danger)' : 'var(--text-muted)'};">${fees.terminalLFD}</td>
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
  renderUI();
  try {
    localStorage.setItem("containerRows", JSON.stringify(rows));
    await sb.from('containers').upsert({ id: 'gml_tracking_records', data: rows, updated_at: new Date().toISOString() });
  } catch (err) {
    console.warn("Cloud sync notice:", err);
  }
}

async function loadFromCloud() {
  try {
    const { data, error } = await sb.from('containers').select('data').eq('id', 'gml_tracking_records').single();
    if (!error && data && Array.isArray(data.data) && data.data.length > 0) {
      rows = data.data;
      localStorage.setItem("containerRows", JSON.stringify(rows));
      populateFilters();
      renderUI();
    }
  } catch(err){}
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

// Drag & Drop Listeners
const ddOverlay = el("dragDropOverlay");
window.addEventListener("dragover", (e) => { 
  e.preventDefault(); 
  if(currentUser && currentUser.role !== "Viewer") ddOverlay.classList.add("open"); 
});
ddOverlay.addEventListener("dragleave", (e) => { 
  e.preventDefault(); 
  ddOverlay.classList.remove("open"); 
});
ddOverlay.addEventListener("drop", (e) => {
  e.preventDefault();
  if(e.dataTransfer.files[0] && e.dataTransfer.files[0].name.match(/\.(xlsx|xls|csv)$/i)) {
    processExcelFile(e.dataTransfer.files[0]);
  } else {
    ddOverlay.classList.remove("open");
  }
});

// Load storage with safety fallback
try {
  const saved = localStorage.getItem("containerRows");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) {
      rows = parsed.map(item => ({
        "PORT OUT": "",
        "CONTAINER RETURN DATE": "",
        "TRUCK NO.": "",
        "DRIVER CONTACT": "",
        ...item
      }));
    }
  }
} catch(e){}

populateFilters();
loadFromCloud();
updateAuditBadge();
checkActiveSession();

activeQuickFilter = 'active';
document.querySelectorAll(".chip").forEach(c => {
  c.classList.toggle("active", c.dataset.filter === 'active');
});
renderUI();

const urlParams = new URLSearchParams(window.location.search);
const scannedCntr = urlParams.get("cntr");
if (scannedCntr) {
  el("publicSearchInput").value = scannedCntr;
  performPublicSearch();
}

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

// Bind the Snapshot button
el("bulkPhotoBtn").addEventListener("click", () => {
  if (!selectedIndices.size) return alert("Select at least one container!");
  const selectedRows = Array.from(selectedIndices).map(idx => rows[idx]);
  downloadMultipleStatusImage(selectedRows, "Bulk_Snapshot");
});

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

    if (activeQuickFilter === "active" && completed) return false;
    if (activeQuickFilter === "completed" && !completed) return false;
    if (activeQuickFilter === "today" && (getField(r, ["ETA"]) !== todayStr && getField(r, ["PORT IN"]) !== todayStr)) return false;
    if (activeQuickFilter === "demurrage" && (completed || !fees.demOverdue)) return false;
    if (activeQuickFilter === "detention" && (completed || !fees.detOverdue)) return false;
    if (activeQuickFilter === "critical_lfd" && (completed || ((fees.terminalDaysLeft > 2 || fees.terminalDaysLeft === null) && (fees.detentionDaysLeft > 2 || fees.detentionDaysLeft === null)))) return false;

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
  const filtered = getFilteredRows();
  updateKPIs();

  if (currentView === 'cards') renderCards(filtered);
  else if (currentView === 'sheet') renderSheet(filtered);
  else if (currentView === 'kanban') renderKanban(filtered);

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
    el("sheetTableBody").innerHTML = `<tr><td colspan="17" style="text-align:center; padding:40px; color:var(--text-muted);">No records found.</td></tr>`;
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
  renderUI();
  try {
    localStorage.setItem("containerRows", JSON.stringify(rows));
    await sb.from('containers').upsert({ id: 'gml_tracking_records', data: rows, updated_at: new Date().toISOString() });
  } catch (err) {
    console.warn("Cloud sync notice:", err);
  }
}

async function loadFromCloud() {
  try {
    const { data, error } = await sb.from('containers').select('data').eq('id', 'gml_tracking_records').single();
    if (!error && data && Array.isArray(data.data) && data.data.length > 0) {
      rows = data.data;
      localStorage.setItem("containerRows", JSON.stringify(rows));
      populateFilters();
      renderUI();
    }
  } catch(err){}
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

// Load storage with safety fallback
try {
  const saved = localStorage.getItem("containerRows");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) {
      rows = parsed.map(item => ({
        "PORT OUT": "",
        "CONTAINER RETURN DATE": "",
        "TRUCK NO.": "",
        "DRIVER CONTACT": "",
        ...item
      }));
    }
  }
} catch(e){}

populateFilters();
loadFromCloud();
updateAuditBadge();
checkActiveSession();

activeQuickFilter = 'active';
document.querySelectorAll(".chip").forEach(c => {
  c.classList.toggle("active", c.dataset.filter === 'active');
});
renderUI();

