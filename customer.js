
/* GML CUSTOMER PORTAL — functional public search + SeaRates-inspired shipment detail */
(function(){
  "use strict";

  var customerMaps = {};
  var customerMapLayers = {};
  var customerReportLinks = {};
  var customerReportRecords = {};
  var igmHblCache = {};
  var customerIgmSummary = {};

  function getCustomerSb(){
    try{
      if(typeof sb!=="undefined" && sb) return sb;
    }catch(e){}
    if(window.sb) return window.sb;
    if(window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY){
      window.sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
      return window.sb;
    }
    if(window.supabase){
      window.sb=window.supabase.createClient("https://ykeucqritoexykqrggzz.supabase.co","sb_publishable_olbFhK5Wu6hGiaGGDdXMeA_6szko2wZ");
      return window.sb;
    }
    return null;
  }

  function cv(r,names,fallback){
    fallback = fallback || "";
    try{
      var value = typeof getField === "function" ? getField(r,names) : "";
      return value || fallback;
    }catch(e){ return fallback; }
  }
  function cclean(value){
    var s = String(value == null ? "" : value).trim();
    if(!s || /^(n\/a|na|unknown|unverified|null|-)$/i.test(s)) return "";
    return s;
  }
  function cdate(value){
    if(value instanceof Date){
      if(isNaN(value.getTime())) return "—";
      var dateMonths=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return String(value.getDate()).padStart(2,"0")+" "+dateMonths[value.getMonth()]+" "+value.getFullYear();
    }
    var s=String(value == null ? "" : value).trim();
    if(!s || /^(n\/a|na|null|-)$/i.test(s)) return "—";
    try{
      var d = typeof parseLocalDate === "function" ? parseLocalDate(s) : new Date(s);
      if(!d || isNaN(d.getTime())) return s;
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return String(d.getDate()).padStart(2,"0")+" "+months[d.getMonth()]+" "+d.getFullYear();
    }catch(e){ return s; }
  }
  function cesc(value){ return typeof esc === "function" ? esc(value) : String(value == null ? "" : value); }
  function cvalid(value){ return typeof validDate === "function" ? validDate(value) : !!String(value == null ? "" : value).trim(); }

  function getCustomerStatus(r){
    var returned = cvalid(cv(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE"]));
    var destuff = cvalid(cv(r,["DESTUFFING DATE","DESTUFF DATE"]));
    var cfs = cvalid(cv(r,["CFS IN"]));
    var portOut = cvalid(cv(r,["PORT OUT"]));
    var portIn = cvalid(cv(r,["PORT IN"]));
    var inward = cvalid(cv(r,["INWARD DATE","INWARD"]));
    var departed = cvalid(cv(r,["ATD","ACTUAL DEPARTURE","VESSEL DEPARTURE","DEPARTURE DATE"])) || cvalid(cv(r,["ETD"]));
    var eta = cvalid(cv(r,["ETA","ESTIMATED ARRIVAL"]));
    if(returned) return {text:"RETURNED",detail:"Empty container returned"};
    if(destuff) return {text:"DE-STUFFED",detail:"Cargo de-stuff completed"};
    if(cfs) return {text:"CFS IN",detail:"Cargo received at CFS"};
    if(portOut) return {text:"PORT OUT",detail:"Container released from port"};
    if(portIn) return {text:"ARRIVED AT PORT",detail:"Vessel / container arrival recorded"};
    if(inward) return {text:"INWARD GRANTED",detail:"Inward processing recorded"};
    if(departed) return {text:"IN TRANSIT",detail:"Vessel has departed origin"};
    if(eta) return {text:"ETA SCHEDULED",detail:"Estimated arrival is scheduled"};
    return {text:"TRACKING PENDING",detail:"Shipment milestone data pending"};
  }

  function getCustomerMilestones(r){
    var pod = cclean(cv(r,["POD","PORT OF DISCHARGE","DISCHARGE PORT"])) || cclean(cv(r,["GATEWAY PORT","GATEWAY"])) || "Destination";
    var pol = cclean(cv(r,["POL","PORT OF LOADING"])) || "Origin";
    var cfs = cclean(cv(r,["CFS NAME","CFS"])) || "CFS";
    var terminal = cclean(typeof getGatewayPortInfo === "function" ? getGatewayPortInfo(r).name : "") || cclean(cv(r,["GATEWAY PORT","GATEWAY"])) || pod;
    return [
      {label:"Vessel Departed",location:pol,date:cv(r,["ATD","ACTUAL DEPARTURE","VESSEL DEPARTURE","DEPARTURE DATE"]) || cv(r,["ETD"])},
      {label:"Arrival at Discharge",location:pod,date:cv(r,["ATA","ACTUAL ARRIVAL","ARRIVAL DATE"]) || cv(r,["ETA"])},
      {label:"Inward Granted",location:terminal,date:cv(r,["INWARD DATE","INWARD"])},
      {label:"Port In",location:terminal,date:cv(r,["PORT IN"])},
      {label:"Port Out",location:terminal,date:cv(r,["PORT OUT"])},
      {label:"CFS In-Gate",location:cfs,date:cv(r,["CFS IN"])},
      {label:"De-stuffing",location:cfs,date:cv(r,["DESTUFFING DATE","DESTUFF DATE"])},
      {label:"Empty Returned",location:terminal,date:cv(r,["CONTAINER RETURN DATE","EMPTY RETURN DATE"])}
    ];
  }

  function getCustomerEvents(r){
    var seen = {};
    return getCustomerMilestones(r).filter(function(m){
      if(!cvalid(m.date)) return false;
      var key = m.label+"|"+String(m.date);
      if(seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function dataItem(label,value){
    return '<div class="customer-info-item"><span class="data-label">'+cesc(label)+'</span><strong>'+cesc(value || "—")+'</strong></div>';
  }
  function detailBox(label,value){
    return '<div class="customer-detail-box"><span class="data-label">'+cesc(label)+'</span><strong>'+cesc(value || "—")+'</strong></div>';
  }

  function buildCustomerReport(r,index){
    var cntr = cclean(cv(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"])) || "—";
    var type = cclean(cv(r,["TYPE","EQUIPMENT TYPE","CONTAINER TYPE","SIZE"])) || "—";
    var mbl = cclean(cv(r,["MBL NO","MBL","MASTER BL"])) || "—";
    var hbl = cclean(cv(r,["HBL NO","HBL","HOUSE BL"])) || "—";
    var booking = cclean(cv(r,["BOOKING NO.","BOOKING NUMBER","BOOKING","BOOKING NO"])) || "—";
    var liner = cclean(cv(r,["LINER","LINE","SHIPPING LINE"])) || "—";
    var vessel = cclean(cv(r,["VESSEL & VOY","VESSEL","VESSEL NAME"])) || "—";
    var status = getCustomerStatus(r);
    var pol = cclean(cv(r,["POL","PORT OF LOADING"])) || "—";
    var pod = cclean(cv(r,["POD","PORT OF DISCHARGE","DISCHARGE PORT"])) || cclean(cv(r,["GATEWAY PORT","GATEWAY"])) || "—";
    var receipt = cclean(cv(r,["PLACE OF RECEIPT","RECEIPT PLACE"])) || pol;
    var delivery = cclean(cv(r,["PLACE OF DELIVERY","DELIVERY PLACE"])) || pod;
    var transship = cclean(cv(r,["TRANSSHIPMENT PORT","TRANSHIPMENT PORT","TRANSSHIPMENT","TRANSHIPMENT"])) || "N/A";
    var gateway = cclean(typeof getGatewayPortInfo === "function" ? getGatewayPortInfo(r).name : "") || cclean(cv(r,["GATEWAY PORT","GATEWAY"])) || pod;
    var cfs = cclean(cv(r,["CFS NAME","CFS"])) || "—";
    var departure = cv(r,["ATD","ACTUAL DEPARTURE","VESSEL DEPARTURE","DEPARTURE DATE"]) || cv(r,["ETD"]);
    var arrival = cv(r,["ATA","ACTUAL ARRIVAL","ARRIVAL DATE"]) || cv(r,["ETA"]);
    var shipper = cclean(cv(r,["SHIPPER","EXPORTER"])) || "—";
    var consignee = cclean(cv(r,["CONSIGNEE","IMPORTER"])) || "—";
    var notify = cclean(cv(r,["NOTIFY PARTY","NOTIFY"])) || "—";
    var freight = cclean(cv(r,["FREIGHT TERM","FREIGHT TERMS","TERM","FREIGHT"])) || "—";
    var cargo = cclean(cv(r,["CARGO DESCRIPTION","CARGO","COMMODITY","DESCRIPTION"])) || "—";
    var pkg = cclean(cv(r,["PACKAGE","PACKAGES","PKG","PACKAGE TYPE"])) || "—";
    var qty = cclean(cv(r,["QUANTITY","QTY","PACKAGE QTY"])) || "—";
    var weight = cclean(cv(r,["WEIGHT (KGS)","WEIGHT KGS","WEIGHT","GROSS WEIGHT"])) || "—";
    var cbm = cclean(cv(r,["CBM","VOLUME","VOLUME (CBM)"])) || "—";
    var dg = cclean(cv(r,["DG","DANGEROUS GOODS","IMDG"])) || "No";
    var seal = cclean(cv(r,["SEAL NO.","SEAL NO","SEAL"])) || "—";
    var po = cclean(cv(r,["PURCHASE ORDER NO.","PURCHASE ORDER","PO NO","P/O NO."])) || "—";
    var remarks = cclean(cv(r,["REMARKS","REMARK"])) || "—";
    var milestones = getCustomerMilestones(r);
    var events = getCustomerEvents(r);
    var doneCount = milestones.filter(function(m){ return cvalid(m.date); }).length;
    var lastDone = milestones.reduce(function(acc,m,i){ return cvalid(m.date) ? i : acc; }, -1);
    var mapId = "customerMap_"+index;
    var routeMapId = mapId+"_route";
    var reportId = "customerReport_"+index;
    customerReportLinks[reportId] = window.location.href.split("?")[0]+"?cntr="+encodeURIComponent(cntr);
    customerReportRecords[reportId] = r;

    var mailTo = typeof COMPANY_CONFIG !== "undefined" && COMPANY_CONFIG.supportEmail ? COMPANY_CONFIG.supportEmail : "madhan@gmlindia.net";
    var waNumber = typeof COMPANY_CONFIG !== "undefined" && COMPANY_CONFIG.whatsappNumber ? COMPANY_CONFIG.whatsappNumber : "919884070344";
    var emailHref = "mailto:"+mailTo+"?subject="+encodeURIComponent("Shipment Updates - "+cntr)+"&body="+encodeURIComponent("Please provide shipment updates for container "+cntr);

    var html = '';
    html += '<article class="customer-report" id="'+reportId+'" data-container="'+cesc(cntr)+'">';
    html += '<div class="customer-report-top"><div class="customer-report-top-left"><span class="customer-report-mark">GML</span><div><strong>GREENWICH MERIDIAN LOGISTICS</strong><small>Customer Shipment Tracking</small></div></div><div class="customer-generated"><span>STATUS REPORT</span><strong>'+cesc(cdate(new Date()))+'</strong></div></div>';
    html += '<section class="customer-report-hero"><div><span class="customer-live-pill">● '+cesc(status.text)+'</span><h1>'+cesc(status.detail)+'</h1><p>'+cesc(vessel)+(vessel!=="—"&&liner!=="—"?" • "+cesc(liner):"")+'</p></div><div class="customer-container-chip"><span>CONTAINER NUMBER</span><strong>'+cesc(cntr)+'</strong><small>'+cesc(type)+(type!=="—"?" EQUIPMENT":"")+'</small></div></section>';
    html += '<section class="customer-summary"><div class="customer-summary-item"><small>VESSEL / VOYAGE</small><strong>'+cesc(vessel)+'</strong></div><div class="customer-summary-item"><small>CARRIER / LINE</small><strong>'+cesc(liner)+'</strong></div><div class="customer-summary-item"><small>MBL NUMBER</small><strong>'+cesc(mbl)+'</strong></div><div class="customer-summary-item customer-summary-status"><small>CURRENT STATUS</small><strong>'+cesc(status.text)+'</strong></div></section>';

    var tabNames = [["overview","Overview"],["route","Route & Map"],["vessel","Vessel Information"],["cargo","Cargo Details"],["documents","Documents"],["history","Event History"]];
    html += '<div class="customer-tabs" role="tablist">';
    tabNames.forEach(function(t,i){ html += '<button type="button" class="customer-tab '+(i===0?"active":"")+'" data-tab="'+t[0]+'">'+t[1]+'</button>'; });
    html += '</div>';

    var hblBoxId="customerHbl_"+index;
    html += '<section class="customer-tab-pane active" data-pane="overview">';
    html += '<div class="customer-overview-grid">';
    html += '<div>';
    html += '<div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>SHIPMENT INFORMATION</strong></div><small>REFERENCE DATA</small></div><div class="customer-info-grid">';
    [["Container Number",cntr],["Size / Type",type]].forEach(function(x){html+=dataItem(x[0],x[1]);});
    html += '<div class="customer-info-item customer-hbl-item"><span class="data-label">HBL NUMBERS</span><div id="'+hblBoxId+'" class="customer-hbl-list"><span class="customer-hbl-loading">Loading HBL details…</span></div></div>';
    [["MBL Number",mbl],["Vessel / Voyage",vessel]].forEach(function(x){html+=dataItem(x[0],x[1]);});
    html += '</div></div>';

    html += '<div class="customer-section-card customer-igm-cargo-card"><div class="customer-section-title"><div><span class="customer-section-number">04</span><strong>CARGO INFORMATION</strong></div><small>IGM / HBL SUMMARY</small></div><div id="customerIgmSummary_'+index+'" class="customer-igm-cargo-summary"><div class="customer-igm-loading">Waiting for IGM / HBL data…</div></div></div>';
    html += '</div>';

    html += '<div>';
    html += '<div class="customer-section-card customer-map-card"><div class="customer-section-title"><div><span class="customer-section-number">02</span><strong>ROUTE & MAP</strong></div><small>PORT-TO-PORT</small></div><div class="customer-map-wrap"><div id="'+mapId+'" class="customer-map"></div><div class="customer-map-toggle"><button type="button" class="active" data-map-mode="map">Map</button><button type="button" data-map-mode="satellite">Satellite</button></div></div><div class="customer-map-note"><span>'+cesc(pol)+' → '+cesc(pod)+'</span><strong>'+cesc(vessel)+'</strong></div></div>';
    html += '<div class="customer-section-card" style="margin-top:13px"><div class="customer-section-title"><div><span class="customer-section-number">03</span><strong>KEY MILESTONES</strong></div><small>'+doneCount+' RECORDED</small></div><div class="customer-milestone-list">';
    milestones.forEach(function(m,idx){
      var done = cvalid(m.date);
      var active = !done && idx===lastDone+1;
      html += '<div class="customer-mile '+(done?"done ":"")+(active?"active":"")+'"><span class="customer-mile-dot">'+(done?"✓":String(idx+1).padStart(2,"0"))+'</span><div class="customer-mile-copy"><strong>'+cesc(m.label)+'</strong><small>'+cesc(m.location)+'</small></div><span class="customer-mile-date">'+cesc(done?cdate(m.date):"Pending")+'</span></div>';
    });
    html += '</div></div></div></div>';

    html += '<div class="customer-bottom-grid customer-bottom-grid-single">';
    html += '<div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">05</span><strong>PORT INFORMATION</strong></div><small>LOGISTICS ROUTE</small></div><div class="customer-port-grid">';
    [["Place of Receipt",receipt],["Loading Port",pol],["Transshipment",transship],["Discharge Port",pod],["Place of Delivery",delivery],["Gateway / Terminal",gateway]].forEach(function(x){html+='<div class="customer-port-item"><span class="data-label">'+cesc(x[0])+'</span><strong>'+cesc(x[1])+'</strong></div>';});
    html += '</div></div></div>';

    html += '<div class="customer-section-card" style="margin:0 20px 15px"><div class="customer-section-title"><div><span class="customer-section-number">06</span><strong>QUICK ACTIONS</strong></div><small>SHARE & SUPPORT</small></div><div class="customer-actions">';
    html += '<button class="customer-action" type="button" data-action="print">🖨️ Print / PDF</button>';
    html += '<button class="customer-action" type="button" data-action="share">🔗 Share Tracking</button>';
    html += '<a class="customer-action" href="'+emailHref+'">✉️ Email Updates</a>';
    html += '<a class="customer-action primary" href="https://wa.me/'+waNumber+'" target="_blank" rel="noopener">💬 Contact Us</a>';
    html += '</div></div>';
    html += '</section>';

    html += '<section class="customer-tab-pane" data-pane="route"><div class="customer-tab-body"><div class="customer-panel-grid">';
    html += '<div class="customer-section-card customer-route-panel"><div class="customer-section-title" style="margin:-18px -18px 16px"><div><span class="customer-section-number">01</span><strong>SHIPMENT ROUTE</strong></div><small>ORIGIN → DELIVERY</small></div><div class="customer-route-line">';
    html += '<div class="customer-route-node"><small>RECEIPT</small><strong>'+cesc(receipt)+'</strong></div><b class="customer-route-arrow">→</b>';
    html += '<div class="customer-route-node"><small>LOADING</small><strong>'+cesc(pol)+'</strong></div><b class="customer-route-arrow">→</b>';
    html += '<div class="customer-route-node"><small>DISCHARGE</small><strong>'+cesc(pod)+'</strong></div><b class="customer-route-arrow">→</b>';
    html += '<div class="customer-route-node"><small>DELIVERY</small><strong>'+cesc(delivery)+'</strong></div></div>';
    html += '<div class="customer-route-foot"><span>TRANSSHIPMENT</span><strong>'+cesc(transship)+'</strong><span>GATEWAY</span><strong>'+cesc(gateway)+'</strong></div>';
    html += '<div class="customer-route-foot"><span>DEPARTURE</span><strong>'+cesc(cdate(departure))+'</strong><span>ARRIVAL</span><strong>'+cesc(cdate(arrival))+'</strong></div></div>';
    html += '<div class="customer-section-card customer-map-card"><div class="customer-section-title"><div><span class="customer-section-number">02</span><strong>INTERACTIVE MAP</strong></div><small>TRACKING ROUTE</small></div><div class="customer-map-wrap"><div id="'+routeMapId+'" class="customer-map"></div></div></div>';
    html += '</div></div></section>';

    html += '<section class="customer-tab-pane" data-pane="vessel"><div class="customer-tab-body"><div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>VESSEL INFORMATION</strong></div><small>VOYAGE REFERENCE</small></div><div class="customer-vessel-grid">';
    [["Vessel / Voyage",vessel],["Carrier / Line",liner],["MBL Number",mbl],["Booking Number",booking],["ETD",cdate(departure)],["ETA",cdate(arrival)],["Port of Loading",pol],["Port of Discharge",pod],["Gateway / Terminal",gateway]].forEach(function(x){html+=detailBox(x[0],x[1]);});
    html += '</div><div style="padding:12px 13px;border-top:1px solid #edf1f5;display:flex;justify-content:flex-end"><button class="customer-action primary" type="button" data-action="route-modal">🗺️ Open Route Tracker</button></div></div></div></section>';

    html += '<section class="customer-tab-pane" data-pane="cargo"><div class="customer-tab-body"><div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>CARGO DETAILS</strong></div><small>CARGO & COMMERCIAL DATA</small></div><div class="customer-cargo-detail-grid">';
    [["Package",pkg],["Quantity",qty],["Gross Weight (KGS)",weight],["Volume (CBM)",cbm],["Freight Term",freight],["DG",dg],["Cargo Description",cargo],["Purchase Order",po],["Remarks",remarks]].forEach(function(x){html+=detailBox(x[0],x[1]);});
    html += '</div></div></div></section>';

    html += '<section class="customer-tab-pane" data-pane="documents"><div class="customer-tab-body"><div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>DOCUMENT REFERENCES</strong></div><small>AVAILABLE IDENTIFIERS</small></div><div class="customer-doc-grid">';
    [["Booking Number",booking],["HBL Number",hbl],["MBL Number",mbl],["Purchase Order",po],["Seal Number",seal],["Container Number",cntr]].forEach(function(x){html+=detailBox(x[0],x[1]);});
    html += '</div><div class="customer-doc-empty"><strong>Document files are not attached to this shipment record.</strong>Contact operations when a document copy is required.</div></div></div></section>';

    html += '<section class="customer-tab-pane" data-pane="history"><div class="customer-tab-body"><div class="customer-section-card customer-events"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>EVENT HISTORY</strong></div><small>CHRONOLOGICAL VIEW</small></div>';
    if(events.length){
      html += '<table><thead><tr><th>Event</th><th>Location</th><th>Date / Time</th><th>Status</th></tr></thead><tbody>';
      events.forEach(function(e){html+='<tr><td><strong>'+cesc(e.label)+'</strong></td><td>'+cesc(e.location)+'</td><td>'+cesc(cdate(e.date))+'</td><td><span class="customer-event-status done">Recorded</span></td></tr>';});
      html += '</tbody></table>';
    }else{
      html += '<div class="customer-doc-empty"><strong>No milestone history recorded yet.</strong>Shipment updates will appear here as operations data are entered.</div>';
    }
    html += '</div></div></section>';
    html += '<div class="customer-report-footer"><span>GREENWICH MERIDIAN LOGISTICS • CUSTOMER SHIPMENT TRACKING</span><strong>Customer Copy • '+cesc(cntr)+'</strong></div></article>';
    return html;
  }

  function searchCandidates(r,type){
    var fields = type==="container"
      ? ["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]
      : ["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO","MBL NO","MBL","MASTER BL","HBL NO","HBL","HOUSE BL","BOOKING NO.","BOOKING NUMBER","BOOKING","VESSEL & VOY","VESSEL","VESSEL NAME","CUSTOMER REF","CUSTOMER REFERENCE","PURCHASE ORDER NO.","PURCHASE ORDER","PO NO","P/O NO."];
    return fields.map(function(n){return cv(r,[n]);}).filter(Boolean).map(function(v){return String(v).toLowerCase().replace(/[^a-z0-9]/g,"");});
  }

  async function performCustomerSearch(){
    var input=el("publicSearchInput"),btn=el("publicSearchBtn"),container=el("publicResultContainer");
    if(!input||!btn||!container)return;
    var raw=String(input.value||"").trim();
    if(!raw){
      if(typeof toast==="function")toast("Please enter a container, MBL or shipment reference.");
      input.focus();return;
    }
    btn.classList.add("btn-loading");
    container.style.display="block";
    container.innerHTML='<div class="customer-skeleton"><div style="padding:20px;background:#fff;border-bottom:1px solid #e4eaf0"><div class="customer-skeleton-line" style="width:180px;height:11px"></div><div class="customer-skeleton-line" style="width:260px;height:24px;margin-top:9px"></div></div><div style="padding:25px"><div class="customer-skeleton-line" style="height:110px"></div><div class="customer-skeleton-line" style="height:80px;margin-top:14px"></div></div></div>';
    container.scrollIntoView({behavior:"smooth",block:"start"});
    try{
      if(typeof cloudDataReady!=="undefined") await cloudDataReady;
      var type=el("publicTrackingType") ? el("publicTrackingType").value : "container";
      var queries=raw.split(/[\s,]+/).filter(Boolean).map(function(q){return q.toLowerCase().replace(/[^a-z0-9]/g,"");}).filter(Boolean);
      var data=typeof rows!=="undefined"&&Array.isArray(rows)?rows:[];
      var matched=data.filter(function(r){
        var hay=searchCandidates(r,type);
        return queries.some(function(q){return hay.some(function(v){return v===q||v.includes(q);});});
      });
      var badge=el("publicResultCountBadge");
      if(badge)badge.textContent=matched.length+" result"+(matched.length===1?"":"s");
      if(!matched.length){
        container.innerHTML='<div class="customer-empty"><div><div class="customer-empty-icon">⌕</div><strong>No shipment records found</strong><span>Check the reference and try again.</span><span style="margin-top:9px">Example: <code>SKHU9422886</code> or an MBL / booking number.</span></div></div>';
        return;
      }
      var note=matched.length===1
        ? '<div class="customer-results-note"><strong>Shipment found</strong><span>Detailed status, route, milestones and shipment information are shown below.</span></div>'
        : '<div class="customer-results-note"><strong>'+matched.length+' shipment records found</strong><span>Each matching container is shown as a separate customer tracking report.</span></div>';
      container.innerHTML='<div class="customer-result-stack">'+note+matched.map(buildCustomerReport).join("")+'</div>';
      bindReportInteractions(matched);
      loadIgmHblsForReports(matched);
    }catch(err){
      console.error("Customer portal search error:",err);
      container.style.display="block";
      container.innerHTML='<div class="customer-empty"><div><div class="customer-empty-icon">!</div><strong>Tracking service temporarily unavailable</strong><span>Please try again in a moment.</span></div></div>';
    }finally{
      btn.classList.remove("btn-loading");
    }
  }

  function bindReportInteractions(matched){
    matched.forEach(function(r,index){
      var reportId="customerReport_"+index;
      var report=document.getElementById(reportId);
      if(!report)return;

      report.querySelectorAll(".customer-tab").forEach(function(tab){
        tab.addEventListener("click",function(){ switchCustomerTab(reportId,tab.dataset.tab); });
      });
      report.querySelectorAll("[data-map-mode]").forEach(function(b){
        b.addEventListener("click",function(){
          toggleCustomerMapLayer("customerMap_"+index,b.dataset.mapMode,b);
        });
      });
      report.querySelector('[data-action="print"]')?.addEventListener("click",function(){window.print();});
      report.querySelector('[data-action="share"]')?.addEventListener("click",function(){shareCustomerReport(reportId);});
      report.querySelector('[data-action="route-modal"]')?.addEventListener("click",function(){
        var rr=customerReportRecords[reportId];
        if(rr&&typeof openRouteMap==="function") openRouteMap(cv(rr,["POL","PORT OF LOADING"]),cv(rr,["POD","PORT OF DISCHARGE","GATEWAY PORT","GATEWAY"]),cv(rr,["VESSEL & VOY","VESSEL","VESSEL NAME"]));
      });

      setTimeout(function(){initCustomerMap("customerMap_"+index,r);},80);
    });
  }




  function buildIgmSummary(rows){
    var hbls=[];
    var seen={};
    var totalWeight=0;
    var totalPackages=0;
    var packageTypes=[];
    var igmNumbers=[];
    var destinations=[];
    rows.forEach(function(row){
      var h=String(row.hbl_no||"").trim().toUpperCase();
      if(h&&!seen[h]){seen[h]=true;hbls.push(h);}
      if(Number(row.gross_weight)) totalWeight += Number(row.gross_weight);
      if(Number(row.total_package)) totalPackages += Number(row.total_package);
      if(row.package_code && packageTypes.indexOf(String(row.package_code))<0) packageTypes.push(String(row.package_code));
      if(row.igm_no && igmNumbers.indexOf(String(row.igm_no))<0) igmNumbers.push(String(row.igm_no));
      if(row.port_destination && destinations.indexOf(String(row.port_destination))<0) destinations.push(String(row.port_destination));
    });
    return {
      hblCount:hbls.length,
      totalWeight:totalWeight,
      totalPackages:totalPackages,
      packageTypes:packageTypes,
      igmNumbers:igmNumbers,
      destinations:destinations
    };
  }

  function fmtMetricNumber(v,decimals){
    var n=Number(v);
    if(!isFinite(n)) return "—";
    return n.toLocaleString("en-IN",{minimumFractionDigits:decimals||0,maximumFractionDigits:decimals||2});
  }

  function renderCustomerIgmSummary(index,rows){
    var box=document.getElementById("customerIgmSummary_"+index);
    if(!box)return;
    if(!rows.length){
      box.innerHTML='<div class="customer-igm-empty">No IGM / HBL cargo data linked to this container yet.</div>';
      return;
    }
    var s=buildIgmSummary(rows);
    var summaryPairs=[
      ["HBL COUNT",fmtMetricNumber(s.hblCount,0)],
      ["TOTAL PACKAGES",fmtMetricNumber(s.totalPackages,0)],
      ["GROSS WEIGHT (KGS)",fmtMetricNumber(s.totalWeight,2)],
      ["PACKAGE TYPES",s.packageTypes.join(", ")||"—"],
      ["IGM NUMBER",s.igmNumbers.join(", ")||"—"],
      ["DESTINATION",s.destinations.join(", ")||"—"]
    ];
    var html='<div class="customer-igm-metrics">'+summaryPairs.map(function(x){
      return '<div class="customer-igm-metric"><span>'+cesc(x[0])+'</span><strong>'+cesc(x[1])+'</strong></div>';
    }).join("")+'</div>';
    html+='<div class="customer-igm-breakdown"><div class="customer-igm-breakdown-title"><span>HBL CARGO BREAKDOWN</span><small>'+s.hblCount+' HBL'+(s.hblCount===1?"":"s")+'</small></div>';
    html+='<div class="customer-igm-table-wrap"><table class="customer-igm-table"><thead><tr><th>HBL</th><th>SUBLINE</th><th>PKG</th><th>QTY</th><th>WEIGHT</th></tr></thead><tbody>';
    rows.forEach(function(row){
      html+='<tr><td><button type="button" class="customer-igm-hbl-link" data-hbl="'+cesc(String(row.hbl_no||"").toUpperCase())+'">'+cesc(String(row.hbl_no||"").toUpperCase())+'</button></td><td>'+cesc(row.subline_number||"—")+'</td><td>'+cesc(row.package_code||"—")+'</td><td>'+cesc(row.total_package||"—")+'</td><td>'+cesc(row.gross_weight!=null?fmtMetricNumber(row.gross_weight,2):"—")+' '+cesc(row.unit_of_weight||"")+'</td></tr>';
    }).join("");
    html+='</tbody></table></div></div>';
    box.innerHTML=html;
    box.querySelectorAll(".customer-igm-hbl-link").forEach(function(btn){
      btn.addEventListener("click",function(){openIgmModal(btn.getAttribute("data-hbl"));});
    });
  }

  function normalizeIgmHeader(v){
    return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g,"");
  }

  function igmFindColumn(headers, candidates){
    var normalized=headers.map(normalizeIgmHeader);
    for(var i=0;i<candidates.length;i++){
      var target=normalizeIgmHeader(candidates[i]);
      var exact=normalized.indexOf(target);
      if(exact>=0) return exact;
    }
    for(var i=0;i<candidates.length;i++){
      var target=normalizeIgmHeader(candidates[i]);
      var idx=normalized.findIndex(function(h){ return h.indexOf(target)>=0 || target.indexOf(h)>=0; });
      if(idx>=0) return idx;
    }
    return -1;
  }

  function igmToText(v){
    if(v == null) return "";
    return String(v).trim();
  }

  function igmToNumber(v){
    var s=igmToText(v).replace(/,/g,"");
    if(!s) return null;
    var n=Number(s);
    return isFinite(n) ? n : null;
  }

  function igmPick(row, headers, candidates){
    var idx=igmFindColumn(headers,candidates);
    return idx>=0 ? igmToText(row[idx]) : "";
  }

  function deriveIgmNoFromFileName(fileName){
    var m=String(fileName||"").match(/igm[_\-\s]*(\d+)/i);
    return m ? m[1] : "";
  }

  function deriveMblFromFileName(fileName){
    var s=String(fileName||"");
    var m=s.match(/(?:bl|mbl)[_\-\s]+([A-Z]{4,6}[A-Z0-9]+)/i);
    if(m) return m[1].replace(/[_\-\s]+$/,"");
    return "";
  }

  function findIgmHeaderRow(rows){
    var best={index:-1,score:0};
    rows.slice(0,80).forEach(function(row,index){
      var text=row.map(igmToText).join(" | ").toLowerCase();
      var score=0;
      if(/hbl|house\s*bl|house\s*bill/.test(text)) score+=4;
      if(/igm/.test(text)) score+=4;
      if(/container/.test(text)) score+=2;
      if(/gross\s*weight|grossweight/.test(text)) score+=1;
      if(/line|subline/.test(text)) score+=1;
      if(score>best.score) best={index:index,score:score};
    });
    return best.index;
  }

  function parseIgmWorkbook(arrayBuffer,fileName){
    if(typeof XLSX==="undefined") throw new Error("Excel parser is unavailable.");
    var wb=XLSX.read(arrayBuffer,{type:"array",cellDates:false,raw:false});
    var all=[];
    var fallbackIgm=deriveIgmNoFromFileName(fileName);
    var fallbackMbl=deriveMblFromFileName(fileName);

    wb.SheetNames.forEach(function(sheetName){
      var ws=wb.Sheets[sheetName];
      var matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:false});

      function rowText(row){ return row.map(igmToText).join(" | ").toLowerCase(); }
      function isBlank(row){ return !row || !row.some(function(v){ return igmToText(v)!==""; }); }
      function isHblHeader(row){
        var t=rowText(row);
        return /house\s*bl\s*no/.test(t) && /bl\s*no/.test(t) && /cargo\s*movement/.test(t);
      }
      function isIgmHeader(row){
        var t=rowText(row);
        return /igm\s*no/.test(t) && /igm\s*date/.test(t) && /voyage\s*number/.test(t);
      }
      function isContainerHeader(row){
        var t=rowText(row);
        return /container\s*details/.test(t) && /container\s*status/.test(t);
      }
      function nextNonBlank(from){
        for(var n=from;n<matrix.length;n++) if(!isBlank(matrix[n])) return n;
        return -1;
      }

      for(var i=0;i<matrix.length;i++){
        if(!isHblHeader(matrix[i])) continue;

        var hblHeader=matrix[i].map(igmToText);
        var hblDataIndex=nextNonBlank(i+1);
        if(hblDataIndex<0) continue;
        var hblData=matrix[hblDataIndex];

        var hbl=igmPick(hblData,hblHeader,["House BL No","House Bill No","HBL No"]);
        var mbl=igmPick(hblData,hblHeader,["BL No","Master BL","MBL No"]);
        if(!hbl) continue;
        if(!mbl) mbl=fallbackMbl;

        var base={
          hbl_no:hbl,mbl_no:mbl,
          bl_date:igmPick(hblData,hblHeader,["BL Date","Bill Date"]),
          hbl_date:igmPick(hblData,hblHeader,["House BL Date","HBL Date","House Bill Date"]),
          line_number:igmToNumber(igmPick(hblData,hblHeader,["Line Number","Line No","Line"])),
          subline_number:igmToNumber(igmPick(hblData,hblHeader,["Subline Number","Subline No","Subline"])),
          cargo_movement:igmPick(hblData,hblHeader,["Cargo Movement","Movement"]),
          gross_weight:igmToNumber(igmPick(hblData,hblHeader,["Gross Weight","GrossWeight","Weight"])),
          unit_of_weight:igmPick(hblData,hblHeader,["Unit Of Weight","Unit of Weight","Weight Unit","UOM"]),
          total_package:igmToNumber(igmPick(hblData,hblHeader,["Total Package","Total Packages","Packages","No of Packages"])),
          package_code:igmPick(hblData,hblHeader,["Package Code","Pkg Code","Package Type"]),
          port_destination:igmPick(hblData,hblHeader,["Port Destination","Destination Port"]),
          desc_of_goods:igmPick(hblData,hblHeader,["Desc Of Goods","Description of Goods","Goods Description","Cargo Description"]),
          igm_no:fallbackIgm,
          igm_date:"",
          inw_date:"",
          igm_file_name:sheetName,
          gateway_port:"",
          voyage_number:"",
          imo_no:"",
          vessel_code:"",
          source_file_name:fileName
        };

        var containers=[];
        for(var j=hblDataIndex+1;j<matrix.length;j++){
          if(isHblHeader(matrix[j])) break;

          if(isIgmHeader(matrix[j])){
            var ih=matrix[j].map(igmToText);
            var id=nextNonBlank(j+1);
            if(id<0) continue;
            base.igm_no=igmPick(matrix[id],ih,["IGM No","IGM Number","IGM"])||base.igm_no;
            base.igm_date=igmPick(matrix[id],ih,["IGM Date","IGM Filing Date","IGM Date/Time"]);
            base.inw_date=igmPick(matrix[id],ih,["INW Date","Inward Date","INW"]);
            base.igm_file_name=igmPick(matrix[id],ih,["File Name","IGM File Name"])||sheetName;
            base.gateway_port=igmPick(matrix[id],ih,["Gateway Port","Gateway"]);
            base.voyage_number=igmPick(matrix[id],ih,["Voyage Number","Voyage No","Voyage"]);
            base.imo_no=igmPick(matrix[id],ih,["IMO No","IMO Number","IMO"]);
            base.vessel_code=igmPick(matrix[id],ih,["Vessel Code","Vessel ID"]);
            j=id;
            continue;
          }

          if(isContainerHeader(matrix[j])){
            var ch=matrix[j].map(igmToText);
            var cd=nextNonBlank(j+1);
            if(cd<0) continue;
            var container=igmPick(matrix[cd],ch,["Container Details","Container No","Container Number","Container"]);
            var status=igmPick(matrix[cd],ch,["Container Status","Status"])||"LCL";
            if(container) containers.push({container_no:container,container_status:status});
            j=cd;
          }
        }

        containers.forEach(function(cont){
          all.push(Object.assign({},base,{
            container_no:cont.container_no,
            container_status:cont.container_status
          }));
        });
      }
    });

    var unique={};
    all.forEach(function(row){
      unique[String(row.hbl_no).toUpperCase()+"|"+String(row.container_no).toUpperCase()]=row;
    });
    return Object.keys(unique).map(function(k){return unique[k];});
  }

  async function importIgmWorkbook(file){
    var authRaw=localStorage.getItem("gml_auth_code_user");
    var auth=null;
    try{auth=authRaw?JSON.parse(authRaw):null;}catch(e){}
    var userId=auth && (auth.uid || auth.user_id);
    if(!userId) throw new Error("Please sign in to the Staff Portal first.");
    if(auth.role==="Viewer") throw new Error("IGM import is available to Admin / Editor users only.");

    var buffer=await file.arrayBuffer();
    var records=parseIgmWorkbook(buffer,file.name);
    if(!records.length) throw new Error("No HBL + container rows were detected in this IGM file.");

    var imported=0;
    var chunkSize=250;
    for(var i=0;i<records.length;i+=chunkSize){
      var chunk=records.slice(i,i+chunkSize);
      var resp=await sb.rpc("import_igm_hbl_rows",{p_user_id:userId,p_rows:chunk});
      if(resp.error) throw new Error(resp.error.message||"IGM import failed.");
      imported += Number(resp.data&&resp.data.imported||chunk.length);
    }
    return {detected:records.length,imported:imported};
  }

  function bindIgmImport(){
    var input=el("igmImportInput");
    if(!input) return;
    input.addEventListener("change",async function(){
      var file=input.files&&input.files[0];
      input.value="";
      if(!file) return;
      var label=el("igmImportLabel");
      if(label){label.dataset.originalText=label.textContent;label.classList.add("btn-loading");}
      try{
        var result=await importIgmWorkbook(file);
        if(typeof toast==="function") toast("IGM import complete: "+result.imported+" HBL records updated.");
      }catch(err){
        console.error("IGM import error:",err);
        alert(err.message||"Unable to import IGM file.");
      }finally{
        if(label){label.classList.remove("btn-loading");}
      }
    });
  }

  async function customerRpc(functionName,params){
    var client=getCustomerSb();
    if(!client) throw new Error("Supabase client is unavailable.");
    var result=await client.rpc(functionName,params||{});
    if(result.error) throw result.error;
    return result.data;
  }

  async function loadIgmHblsForReports(matched){
    for(var i=0;i<matched.length;i++){
      var r=matched[i];
      var cntr=cclean(cv(r,["CONTAINER NO.","CONTAINER","CONTAINER NO","CNTR NO"]));
      var box=document.getElementById("customerHbl_"+i);
      if(!box||!cntr) continue;

      try{
        var bundle=await customerRpc("get_customer_igm_bundle",{p_container:cntr});
        if(!bundle || Array.isArray(bundle) || typeof bundle!=="object"){
          throw new Error("Invalid IGM bundle response.");
        }

        var rows=Array.isArray(bundle.hbls)?bundle.hbls:[];
        rows.forEach(function(row){
          igmHblCache[String(row.hbl_no||"").toUpperCase()]=row;
        });

        renderIgmHblList(box,rows);
        renderCustomerIgmSummary(i,rows);

        var count=Number(bundle.hbl_count||rows.length||0);
        var summaryBox=document.getElementById("customerIgmSummary_"+i);
        if(summaryBox && count===0){
          summaryBox.querySelector(".customer-igm-loading")?.replaceWith(
            Object.assign(document.createElement("div"),{
              className:"customer-igm-empty",
              textContent:"No IGM / HBL records linked to this container."
            })
          );
        }
      }catch(err){
        console.warn("IGM/HBL lookup failed:",err);
        box.innerHTML='<span class="customer-hbl-empty">Unable to load IGM / HBL details.</span>';
        var summaryBox=document.getElementById("customerIgmSummary_"+i);
        if(summaryBox) summaryBox.innerHTML='<div class="customer-igm-empty">IGM data could not be loaded. Please contact operations.</div>';
      }
    }
  }

  function renderIgmHblList(box,rows){
    if(!rows.length){
      box.innerHTML='<span class="customer-hbl-empty">No linked HBL / IGM record.</span>';
      return;
    }
    box.innerHTML=rows.map(function(row){
      var h=String(row.hbl_no||"").toUpperCase();
      var sub=row.subline_number ? "SL "+row.subline_number : "";
      return '<button type="button" class="customer-hbl-chip" data-hbl="'+cesc(h)+'">'+
        '<span>'+cesc(h)+'</span><small>'+cesc(sub)+'</small></button>';
    }).join("");
    box.querySelectorAll(".customer-hbl-chip").forEach(function(btn){
      btn.addEventListener("click",function(){openIgmModal(btn.getAttribute("data-hbl"));});
    });
    var count=rows.length;
    box.insertAdjacentHTML("afterbegin",'<span class="customer-hbl-count">'+count+' HBL'+(count===1?"":"s")+'</span>');
  }

  function ensureIgmModal(){
    var existing=document.getElementById("igmDetailsModal");
    if(existing) return existing;
    var wrap=document.createElement("div");
    wrap.id="igmDetailsModal";
    wrap.className="customer-igm-modal";
    wrap.innerHTML=
      '<div class="customer-igm-backdrop" data-igm-close></div>'+
      '<div class="customer-igm-dialog" role="dialog" aria-modal="true" aria-labelledby="igmDetailsTitle">'+
        '<div class="customer-igm-head"><div><span class="customer-igm-kicker">CUSTOMS / IGM LINK</span><h2 id="igmDetailsTitle">HBL Details</h2><p id="igmDetailsSub">Indian Customs manifest information</p></div>'+
        '<button type="button" class="customer-igm-close" data-igm-close aria-label="Close">✕</button></div>'+
        '<div id="igmDetailsBody" class="customer-igm-body"></div>'+
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelectorAll("[data-igm-close]").forEach(function(x){
      x.addEventListener("click",function(){wrap.classList.remove("open");});
    });
    document.addEventListener("keydown",function(e){
      if(e.key==="Escape") wrap.classList.remove("open");
    });
    return wrap;
  }

  function openIgmModal(hbl){
    var key=String(hbl||"").trim().toUpperCase();
    if(!key) return;
    var row=igmHblCache[key];
    if(!row) return;
    var modal=ensureIgmModal();
    var body=document.getElementById("igmDetailsBody");
    document.getElementById("igmDetailsTitle").textContent=key;
    document.getElementById("igmDetailsSub").textContent="IGM "+(row.igm_no||"—")+" • Line "+(row.line_number||"—")+" / Subline "+(row.subline_number||"—");
    var fields=[
      ["IGM Number",row.igm_no],["IGM Date",cdate(row.igm_date)],["BL Number",row.mbl_no],["BL Date",cdate(row.bl_date)],
      ["HBL Number",row.hbl_no],["HBL Date",cdate(row.hbl_date)],["Container",row.container_no],["Container Status",row.container_status],
      ["Gateway Port",row.gateway_port],["Voyage Number",row.voyage_number],["IMO Number",row.imo_no],["Vessel Code",row.vessel_code],
      ["Port Destination",row.port_destination],["Cargo Movement",row.cargo_movement],["Gross Weight",row.gross_weight ? row.gross_weight+" "+(row.unit_of_weight||"") : "—"],
      ["Packages",row.total_package ? row.total_package+" "+(row.package_code||"") : "—"],["INW Date",row.inw_date]
    ];
    body.innerHTML=
      '<div class="customer-igm-summary"><div><small>HBL</small><strong>'+cesc(row.hbl_no)+'</strong></div><div><small>IGM</small><strong>'+cesc(row.igm_no)+'</strong></div><div><small>CONTAINER</small><strong>'+cesc(row.container_no)+'</strong></div><div><small>STATUS</small><strong>'+cesc(row.container_status||"—")+'</strong></div></div>'+
      '<div class="customer-igm-section"><div class="customer-igm-section-title">IGM / BL REFERENCE</div><div class="customer-igm-grid">'+
      fields.map(function(x){return '<div><span>'+cesc(x[0])+'</span><strong>'+cesc(x[1]||"—")+'</strong></div>';}).join("")+
      '</div></div>'+
      '<div class="customer-igm-section"><div class="customer-igm-section-title">CARGO DECLARATION</div>'+
      '<div class="customer-igm-cargo"><div><span>Description of Goods</span><strong>'+cesc(row.desc_of_goods||"—")+'</strong></div><div><span>Port Destination</span><strong>'+cesc(row.port_destination||"—")+'</strong></div><div><span>Gross Weight</span><strong>'+cesc(row.gross_weight||"—")+' '+cesc(row.unit_of_weight||"")+'</strong></div><div><span>Package</span><strong>'+cesc(row.total_package||"—")+' '+cesc(row.package_code||"")+'</strong></div></div></div>'+
      '<div class="customer-igm-source">Source: '+cesc(row.source_file_name||"IGM data")+'</div>';
    modal.classList.add("open");
  }

  function initCustomerMap(mapId,r){
    if(typeof L==="undefined")return;
    var node=document.getElementById(mapId);
    if(!node||customerMaps[mapId])return;
    var pol=cclean(cv(r,["POL","PORT OF LOADING","PLACE OF RECEIPT"]))||"Origin";
    var pod=cclean(cv(r,["POD","PORT OF DISCHARGE","DISCHARGE PORT","GATEWAY PORT","GATEWAY"]))||"Destination";
    var vessel=cclean(cv(r,["VESSEL & VOY","VESSEL","VESSEL NAME"]))||"Ocean Vessel";
    var origin=typeof resolveCoords==="function"?resolveCoords(pol,[22.48,113.91]):{name:pol,coord:[22.48,113.91]};
    var dest=typeof resolveCoords==="function"?resolveCoords(pod,[13.0827,80.2707]):{name:pod,coord:[13.0827,80.2707]};
    var latDelta=Math.abs(dest.coord[0]-origin.coord[0]), lonDelta=Math.abs(dest.coord[1]-origin.coord[1]);
    var bend=Math.max(4,Math.min(9,(latDelta+lonDelta)/4));
    var mid=[(origin.coord[0]+dest.coord[0])/2+bend,(origin.coord[1]+dest.coord[1])/2];
    var map=L.map(mapId,{zoomControl:true,attributionControl:false,scrollWheelZoom:false});
    var light=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{maxZoom:18,subdomains:"abcd"});
    var satellite=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:18});
    light.addTo(map);
    var path=L.polyline([origin.coord,mid,dest.coord],{color:"#0d87e3",weight:4,opacity:.92}).addTo(map);
    var marker=function(label,cls){return L.divIcon({className:"customer-map-marker",html:'<div class="customer-marker '+cls+'">'+cesc(label)+'</div>',iconSize:null,iconAnchor:[0,0]});};
    L.marker(origin.coord,{icon:marker(origin.name,"origin")}).addTo(map);
    L.marker(dest.coord,{icon:marker(dest.name,"destination")}).addTo(map);
    L.marker(mid,{icon:marker("🚢 "+vessel,"vessel")}).addTo(map);
    map.fitBounds(path.getBounds(),{padding:[28,28]});
    customerMaps[mapId]=map;
    customerMapLayers[mapId]={map:map,light:light,satellite:satellite};
  }

  function toggleCustomerMapLayer(mapId,mode,button){
    var set=customerMapLayers[mapId];if(!set)return;
    if(mode==="satellite"){set.map.removeLayer(set.light);set.satellite.addTo(set.map);}
    else{set.map.removeLayer(set.satellite);set.light.addTo(set.map);}
    if(button&&button.parentElement)button.parentElement.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",b===button);});
  }

  function switchCustomerTab(reportId,tab){
    var report=document.getElementById(reportId);if(!report)return;
    report.querySelectorAll(".customer-tab").forEach(function(b){b.classList.toggle("active",b.dataset.tab===tab);});
    report.querySelectorAll(".customer-tab-pane").forEach(function(p){p.classList.toggle("active",p.dataset.pane===tab);});
    var r=customerReportRecords[reportId];
    if(tab==="route"&&r){
      var routeMapId=reportId.replace("customerReport_","customerMap_")+"_route";
      setTimeout(function(){initCustomerMap(routeMapId,r);if(customerMaps[routeMapId])customerMaps[routeMapId].invalidateSize();},60);
    }
  }

  async function shareCustomerReport(reportId){
    var url=customerReportLinks[reportId];if(!url)return;
    try{
      if(navigator.share){await navigator.share({title:"Shipment Tracking",text:"Track shipment "+(document.getElementById(reportId)?.dataset.container||""),url:url});}
      else if(navigator.clipboard){await navigator.clipboard.writeText(url);if(typeof toast==="function")toast("Tracking link copied.");}
      else if(typeof copyText==="function"){copyText(url);}
    }catch(e){}
  }

  function updateSearchPlaceholder(){
    var type=el("publicTrackingType")?el("publicTrackingType").value:"container";
    var input=el("publicSearchInput");if(!input)return;
    input.placeholder=type==="container"?"MSMU5334429":"Enter container, MBL, HBL or booking";
  }

  function wireCustomerPortal(){
    var oldBtn=el("publicSearchBtn");
    if(oldBtn){
      var fresh=oldBtn.cloneNode(true);
      fresh.id="publicSearchBtn";
      fresh.removeAttribute("onclick");
      fresh.classList.add("customer-track-btn");
      oldBtn.replaceWith(fresh);
      fresh.addEventListener("click",performCustomerSearch);
    }
    var oldInput=el("publicSearchInput");
    if(oldInput){
      var freshInput=oldInput.cloneNode(true);
      freshInput.id="publicSearchInput";
      oldInput.replaceWith(freshInput);
      freshInput.addEventListener("keydown",function(e){if(e.key==="Enter")performCustomerSearch();});
    }
    el("publicTrackingType")?.addEventListener("change",updateSearchPlaceholder);
    var multipleBtn=el("publicMultipleBtn");
    if(multipleBtn){
      multipleBtn.addEventListener("click",function(){
        var type=el("publicTrackingType");
        if(type){type.value="all";type.dispatchEvent(new Event("change"));}
        var input=el("publicSearchInput");
        if(input){
          input.focus();
          if(typeof toast==="function")toast("Enter multiple container / MBL / booking references separated by comma or space.");
        }
      });
    }
    updateSearchPlaceholder();
    var scanned=new URLSearchParams(window.location.search).get("cntr");
    if(scanned){
      var input=el("publicSearchInput");
      if(input){input.value=scanned;setTimeout(function(){performCustomerSearch();},100);}
    }
  }

  window.GMLCustomerPortalSearch=performCustomerSearch;
  window.performPublicSearch=performCustomerSearch;
  window.toggleCustomerMapLayer=toggleCustomerMapLayer;
  window.switchCustomerTab=switchCustomerTab;
  window.shareCustomerReport=shareCustomerReport;
  window.openIgmModal=openIgmModal;
  bindIgmImport();
  wireCustomerPortal();
})();
