
/* GML CUSTOMER PORTAL — functional public search + SeaRates-inspired shipment detail */
(function(){
  "use strict";

  var customerMaps = {};
  var customerMapLayers = {};
  var customerReportLinks = {};
  var customerReportRecords = {};

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

    html += '<section class="customer-tab-pane active" data-pane="overview">';
    html += '<div class="customer-overview-grid">';
    html += '<div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">01</span><strong>SHIPMENT INFORMATION</strong></div><small>REFERENCE DATA</small></div><div class="customer-info-grid">';
    [["Container Number",cntr],["Size / Type",type],["Booking Number",booking],["HBL Number",hbl],["MBL Number",mbl],["Vessel / Voyage",vessel],["Freight Term",freight],["Cargo Description",cargo],["Shipper",shipper],["Consignee",consignee],["Notify Party",notify],["Seal Number",seal]].forEach(function(x){html+=dataItem(x[0],x[1]);});
    html += '</div></div>';

    html += '<div>';
    html += '<div class="customer-section-card customer-map-card"><div class="customer-section-title"><div><span class="customer-section-number">02</span><strong>ROUTE & MAP</strong></div><small>PORT-TO-PORT</small></div><div class="customer-map-wrap"><div id="'+mapId+'" class="customer-map"></div><div class="customer-map-toggle"><button type="button" class="active" data-map-mode="map">Map</button><button type="button" data-map-mode="satellite">Satellite</button></div></div><div class="customer-map-note"><span>'+cesc(pol)+' → '+cesc(pod)+'</span><strong>'+cesc(vessel)+'</strong></div></div>';
    html += '<div class="customer-section-card" style="margin-top:13px"><div class="customer-section-title"><div><span class="customer-section-number">03</span><strong>KEY MILESTONES</strong></div><small>'+doneCount+' RECORDED</small></div><div class="customer-milestone-list">';
    milestones.forEach(function(m,idx){
      var done = cvalid(m.date);
      var active = !done && idx===lastDone+1;
      html += '<div class="customer-mile '+(done?"done ":"")+(active?"active":"")+'"><span class="customer-mile-dot">'+(done?"✓":String(idx+1).padStart(2,"0"))+'</span><div class="customer-mile-copy"><strong>'+cesc(m.label)+'</strong><small>'+cesc(m.location)+'</small></div><span class="customer-mile-date">'+cesc(done?cdate(m.date):"Pending")+'</span></div>';
    });
    html += '</div></div></div></div>';

    html += '<div class="customer-bottom-grid">';
    html += '<div class="customer-section-card"><div class="customer-section-title"><div><span class="customer-section-number">04</span><strong>CARGO INFORMATION</strong></div><small>CARGO PROFILE</small></div><div class="customer-cargo-grid">';
    [["Package",pkg],["Quantity",qty],["Weight (KGS)",weight],["CBM",cbm],["Freight Term",freight],["DG",dg]].forEach(function(x){html+='<div class="customer-cargo-item"><span class="data-label">'+cesc(x[0])+'</span><strong>'+cesc(x[1])+'</strong></div>';});
    html += '</div></div>';
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

  window.performPublicSearch=performCustomerSearch;
  window.toggleCustomerMapLayer=toggleCustomerMapLayer;
  window.switchCustomerTab=switchCustomerTab;
  window.shareCustomerReport=shareCustomerReport;
  wireCustomerPortal();
})();
