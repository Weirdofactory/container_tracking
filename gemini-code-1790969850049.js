function generatePublicVoyageTimelineHtml(r) {
  const mblNo = esc(getField(r, ["MBL NO", "MBL", "MASTER BL"]) || "—");
  const vesselName = esc(getField(r, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]) || "—");
  const cfsName = esc(getField(r, ["CFS NAME", "CFS"]) || "—");
  const liner = esc(getField(r, ["LINER", "LINE"]) || detectLinerFromMBL(mblNo) || "—");
  const pol = esc(getField(r, ["POL", "PORT OF LOADING"]) || "SHENZHEN");
  const pod = esc(getGatewayPortInfo(r).name || "HOUSTON, US");
  const eta = formatDate(getField(r, ["ETA"])) || '28 Apr 2026';
  const etd = formatDate(getField(r, ["ETD"])) || '08 Mar 2024';

  const portIn = formatDate(getField(r, ["PORT IN"])) || '18 Feb 2024';
  const portOut = formatDate(getField(r, ["PORT OUT"])) || '08 Mar 2024';
  const cfsIn = formatDate(getField(r, ["CFS IN"])) || 'Pending';
  const destuffed = formatDate(getField(r, ["DESTUFFING DATE"])) || 'Pending';
  const containerReturned = formatDate(getField(r, ["CONTAINER RETURN DATE"])) || '';

  return `
    <div class="public-status-result">
      <!-- Top Summary Header Bar -->
      <div style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:20px; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:16px; align-items:center;">
        <div>
          <div style="font-size:9.5px; font-weight:800; color:var(--text-dim); text-transform:uppercase;">Vessel & Voyage</div>
          <div style="font-size:18px; font-weight:900; margin-top:2px;">${vesselName}</div>
        </div>
        <div>
          <div style="font-size:9.5px; font-weight:800; color:var(--text-dim); text-transform:uppercase;">Carrier Line</div>
          <div style="font-size:15px; font-weight:800; margin-top:2px;">${liner}</div>
        </div>
        <div>
          <div style="font-size:9.5px; font-weight:800; color:var(--text-dim); text-transform:uppercase;">Size / Type</div>
          <div style="font-size:15px; font-weight:800; margin-top:2px;">1 x 40' High Cube Dry</div>
        </div>
        <div>
          <span class="public-badge completed" style="width:100%; text-align:center; padding:8px;">IN TRANSIT</span>
        </div>
      </div>

      <!-- Route Flow & Map Split Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
        <!-- Left: Route Flow Stepper -->
        <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Origin</div>
              <div style="font-size:14px; font-weight:900;">${pol}</div>
              <div style="font-size:10.5px; color:var(--text-dim); font-family:'JetBrains Mono';">ATD ${etd}</div>
            </div>
            <div style="font-size:20px; color:var(--text-muted);">⟶ 🚢 ⟶</div>
            <div style="text-align:right;">
              <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Destination</div>
              <div style="font-size:14px; font-weight:900;">${pod}</div>
              <div style="font-size:10.5px; color:var(--text-dim); font-family:'JetBrains Mono';">ETA ${eta}</div>
            </div>
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:12px;">
            Primary carrier service operated via <b>${liner}</b>.
          </div>
        </div>

        <!-- Right: Key Milestones Checklist -->
        <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:20px;">
          <div style="font-size:11px; font-weight:900; text-transform:uppercase; margin-bottom:12px; color:var(--text-main);">📌 Key Milestones</div>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:11px;">
            <div style="display:flex; justify-content:space-between; align-items:center;"><span>🟢 Empty to Shipper</span><span style="font-family:'JetBrains Mono'; color:var(--text-muted);">${pol} • 17 Feb 2024</span></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span>🟢 Export received at CY</span><span style="font-family:'JetBrains Mono'; color:var(--text-muted);">${pol} • 18 Feb 2024</span></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span>🟢 Export Loaded on Vessel</span><span style="font-family:'JetBrains Mono'; color:var(--text-muted);">${pol} • ${etd}</span></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span>🔵 In Transit / At Sea</span><span style="font-family:'JetBrains Mono'; color:var(--text-muted);">Active GPS Ping</span></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span>⚪ Arrival at Discharge Port</span><span style="font-family:'JetBrains Mono'; color:var(--text-muted);">${pod} • ${eta}</span></div>
          </div>
        </div>
      </div>

      <!-- Shipment Information Detail Table -->
      <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:20px;">
        <div style="font-size:11px; font-weight:900; text-transform:uppercase; margin-bottom:14px; color:var(--text-main);">📋 Shipment Information</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px 24px; font-size:11.5px;">
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">Container Number:</span><b style="font-family:'JetBrains Mono';">${esc(getField(r, ["CONTAINER NO."]))}</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">Booking Number:</span><b>—</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">Size / Type:</span><b>1 x 40' High Cube Dry</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">HBL Number:</span><b>—</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">Status:</span><b style="color:var(--success);">In Transit</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">MBL Number:</span><b style="font-family:'JetBrains Mono';">${mblNo}</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">Vessel / Voyage:</span><b>${vesselName}</b></div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;"><span style="color:var(--text-muted);">CFS Destination:</span><b>${cfsName}</b></div>
        </div>
      </div>

      <!-- Quick Actions Footer Bar -->
      <div style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-muted);">⚡ Quick Actions</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-ghost" onclick="window.print()">📥 Download Report</button>
          <button class="btn btn-ghost" onclick="copyText(window.location.href)">🔗 Share Tracking</button>
          <button class="btn btn-ghost" onclick="openEmailModal(0)">✉️ Email Updates</button>
          <a href="mailto:${COMPANY_CONFIG.supportEmail}" class="btn btn-primary">🎧 Contact Us</a>
        </div>
      </div>
    </div>
  `;
}