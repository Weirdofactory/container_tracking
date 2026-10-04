(function(){
  function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]))}
  function statusDate(r){
    const s=window.st?r.st(r)[0]:"PENDING";
    const map={"RETURNED":"CONTAINER RETURN DATE","DE-STUFFED":"DESTUFFING DATE","CFS IN":"CFS IN","PORT OUT":"PORT OUT","PORT IN":"PORT IN","INWARD GRANTED":"INWARD DATE","IN TRANSIT":"ETD"};
    return map[s]?(window.sf?window.sf(r,[map[s]]):r[map[s]]):"";
  }
  function fmt(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
  function milestoneRows(r){
    const items=[
      ["ETD","ETD"],["ETA","ETA"],["INWARD DATE","INWARD"],["PORT IN","PORT IN"],["PORT OUT","PORT OUT"],["CFS IN","CFS IN"],["DESTUFFING DATE","DE-STUFFED"],["CONTAINER RETURN DATE","RETURNED"]
    ];
    return items.map(([key,label])=>{const v=window.sf?window.sf(r,[key]):r[key];return '<div class="sp-milestone"><span>'+esc(label)+'</span><b>'+(v?fmt(v):"—")+'</b></div>'}).join("");
  }
  function build(list){
    const now=new Date();
    const date=now.toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});
    return '<div id="statusPhotoCanvas" style="width:920px;background:#fff;color:#18384b;padding:38px 42px;font-family:Arial,sans-serif;box-sizing:border-box">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #17384a;padding-bottom:18px">'
      +'<div><div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#0878b5">SHIPMENT STATUS</div><div style="font-size:28px;font-weight:800;margin-top:7px">'+esc((window.APP&&APP.appName)||"Shipment Operations")+'</div></div>'
      +'<div style="text-align:right;font-size:12px;color:#71838c"><b style="display:block;color:#18384b;font-size:14px">STATUS UPDATED</b>'+date+'</div></div>'
      +list.map(r=>{const c=window.cnum?window.cnum(r):r["CONTAINER NO."];const s=window.st?window.st(r)[0]:"PENDING";const d=statusDate(r);return '<div style="margin-top:24px;border:1px solid #d8e2e7;padding:22px">'
        +'<div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start">'
        +'<div><div style="font-size:11px;color:#84949c;letter-spacing:1px">CONTAINER</div><div style="font-size:22px;font-weight:800;font-family:monospace;margin-top:4px">'+esc(c||"—")+'</div></div>'
        +'<div style="text-align:right"><div style="font-size:10px;color:#84949c;letter-spacing:1px">CURRENT STATUS</div><div style="display:inline-block;margin-top:5px;padding:8px 12px;background:#eaf5fa;color:#0878b5;font-size:13px;font-weight:800">'+esc(s)+'</div><div style="margin-top:7px;font-size:12px;color:#18384b"><b>STATUS DATE:</b> '+esc(fmt(d))+'</div></div></div>'
        +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dce5e9;margin-top:20px">'+milestoneRows(r)+'</div>'
        +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:18px;font-size:11px">'
        +'<div><span style="display:block;color:#8a989f">MBL</span><b>'+esc(window.sf?window.sf(r,["MBL NO","MBL"]):"")+'</b></div>'
        +'<div><span style="display:block;color:#8a989f">VESSEL / VOYAGE</span><b>'+esc(window.sf?window.sf(r,["VESSEL & VOY","VESSEL"]):"")+'</b></div>'
        +'<div><span style="display:block;color:#8a989f">POL</span><b>'+esc(window.sf?window.sf(r,["POL"]):"")+'</b></div>'
        +'<div><span style="display:block;color:#8a989f">GATEWAY</span><b>'+esc(window.sf?window.sf(r,["GATEWAY PORT"]):"")+'</b></div></div></div>'}).join("")
      +'<div style="margin-top:18px;padding-top:12px;border-top:1px solid #d8e2e7;font-size:10px;color:#82929a">Generated from live shipment records • '+date+'</div></div>';
  }
  function attach(){
    const b=document.getElementById("statusPhotoBtn");if(!b||!window.html2canvas)return;
    const fresh=b.cloneNode(true);b.replaceWith(fresh);
    fresh.addEventListener("click",async function(){
      const list=window.selectedRows?window.selectedRows():[];
      const data=list.length?list:(window.filtered?window.filtered():[]);
      if(!data.length){window.notify&&window.notify("Select at least one shipment first.");return}
      const wrap=document.createElement("div");wrap.style.cssText="position:fixed;left:-10000px;top:0;z-index:-1";wrap.innerHTML=build(data);document.body.appendChild(wrap);
      try{const canvas=await html2canvas(wrap.firstElementChild,{scale:2,backgroundColor:"#ffffff",useCORS:true});const a=document.createElement("a");a.download="Shipment_Status_"+new Date().toISOString().slice(0,10)+".png";a.href=canvas.toDataURL("image/png");a.click();window.notify&&window.notify("Status photo created with status date.")}catch(e){console.error(e);window.notify&&window.notify("Unable to create status photo.")}finally{wrap.remove()}
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(attach,50));else setTimeout(attach,50);
})();
