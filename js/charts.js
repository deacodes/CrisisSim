const CrisisCharts = {
  renderEvacuationProgressChart(containerId, customProgressData = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = customProgressData || window.CrisisData?.EVACUATION_PROGRESS_DATA || [];
    const width = 360;
    const height = 150;
    const pad = { top: 15, right: 25, bottom: 25, left: 35 };

    const maxVal = 15000;
    const maxHour = 24;

    const scaleX = (hr) => pad.left + (hr / maxHour) * (width - pad.left - pad.right);
    const scaleY = (val) => height - pad.bottom - (val / maxVal) * (height - pad.top - pad.bottom);

    const pathEvac = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.hour).toFixed(1)} ${scaleY(d.evacuated).toFixed(1)}`).join(' ');
    const pathStranded = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.hour).toFixed(1)} ${scaleY(d.stranded).toFixed(1)}`).join(' ');
    const pathBaseline = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.hour).toFixed(1)} ${scaleY(d.baseline).toFixed(1)}`).join(' ');

    const simHour = window.CrisisState?.simulation?.getState()?.currentTimeHours || 8.6;
    const scrubberX = scaleX(Math.min(24, simHour));

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-sans);">
        <line x1="${pad.left}" y1="${scaleY(0)}" x2="${width - pad.right}" y2="${scaleY(0)}" stroke="var(--border-subtle)" stroke-width="1"/>
        <line x1="${pad.left}" y1="${scaleY(5000)}" x2="${width - pad.right}" y2="${scaleY(5000)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3"/>
        <line x1="${pad.left}" y1="${scaleY(10000)}" x2="${width - pad.right}" y2="${scaleY(10000)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3"/>
        <line x1="${pad.left}" y1="${scaleY(15000)}" x2="${width - pad.right}" y2="${scaleY(15000)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3"/>

        <text x="${pad.left - 6}" y="${scaleY(0) + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end" font-family="var(--font-mono)">0</text>
        <text x="${pad.left - 6}" y="${scaleY(5000) + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end" font-family="var(--font-mono)">5K</text>
        <text x="${pad.left - 6}" y="${scaleY(10000) + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end" font-family="var(--font-mono)">10K</text>
        <text x="${pad.left - 6}" y="${scaleY(15000) + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end" font-family="var(--font-mono)">15K</text>

        <text x="${scaleX(0)}" y="${height - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-mono)">0h</text>
        <text x="${scaleX(6)}" y="${height - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-mono)">6h</text>
        <text x="${scaleX(12)}" y="${height - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-mono)">12h</text>
        <text x="${scaleX(18)}" y="${height - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-mono)">18h</text>
        <text x="${scaleX(24)}" y="${height - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-mono)">24h</text>

        <path d="${pathBaseline}" fill="none" stroke="var(--text-muted)" stroke-width="1.6" stroke-dasharray="4 3"/>
        <path d="${pathStranded}" fill="none" stroke="var(--accent-danger)" stroke-width="2"/>
        <path d="${pathEvac}" fill="none" stroke="var(--accent-safe)" stroke-width="2.5"/>

        <line x1="${scrubberX}" y1="${pad.top}" x2="${scrubberX}" y2="${height - pad.bottom}" stroke="var(--accent-flood-light)" stroke-width="1.2" stroke-dasharray="2 2"/>
        <circle cx="${scrubberX}" cy="${scaleY(12480 * Math.min(1, (simHour / 14)))}" r="3.5" fill="var(--accent-flood-light)" stroke="#000" stroke-width="1"/>

        <text x="${width - pad.right + 4}" y="${scaleY(12480) + 3}" fill="var(--accent-safe)" font-size="9.5" font-weight="700" font-family="var(--font-mono)">12,480</text>
        <text x="${width - pad.right + 4}" y="${scaleY(1230) + 3}" fill="var(--accent-danger)" font-size="9.5" font-weight="700" font-family="var(--font-mono)">1,230</text>
      </svg>
    `;
  },

  renderCostVsSafetyChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const policies = window.CrisisData?.POLICY_STRATEGIES || [
      { name: "Baseline", costNum: 4.2, safeEvacuated: 9280, color: "#94a3b8" },
      { name: "Shelter-First", costNum: 9.8, safeEvacuated: 11760, color: "#38bdf8" },
      { name: "Equity-First", costNum: 11.2, safeEvacuated: 12150, color: "#10b981" },
      { name: "Cost-Constrained", costNum: 5.5, safeEvacuated: 10100, color: "#a855f7" },
      { name: "Optimized (AI)", costNum: 12.0, safeEvacuated: 12480, color: "#06b6d4" }
    ];

    const width = 440;
    const height = 220;
    const pad = { top: 20, right: 30, bottom: 35, left: 55 };

    const minCost = 2, maxCost = 14;
    const minSafe = 8500, maxSafe = 13500;

    const scaleX = (cost) => pad.left + ((cost - minCost) / (maxCost - minCost)) * (width - pad.left - pad.right);
    const scaleY = (safe) => height - pad.bottom - ((safe - minSafe) / (maxSafe - minSafe)) * (height - pad.top - pad.bottom);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; font-family:var(--font-sans);">
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="var(--border-subtle)" stroke-width="1"/>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="var(--border-subtle)" stroke-width="1"/>

        <text x="${scaleX(4)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">$4M</text>
        <text x="${scaleX(8)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">$8M</text>
        <text x="${scaleX(12)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">$12M</text>
        <text x="${width / 2}" y="${height - 1}" fill="var(--text-secondary)" font-size="10.5" text-anchor="middle">Emergency Budget ($M)</text>

        <text x="${pad.left - 8}" y="${scaleY(9000) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">9,000</text>
        <text x="${pad.left - 8}" y="${scaleY(11000) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">11,000</text>
        <text x="${pad.left - 8}" y="${scaleY(13000) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">13,000</text>

        <path d="M ${scaleX(4.2)} ${scaleY(9280)} Q ${scaleX(8)} ${scaleY(11600)} ${scaleX(12)} ${scaleY(12480)}"
              fill="none" stroke="rgba(6, 182, 212, 0.4)" stroke-width="2" stroke-dasharray="4 2"/>

        ${policies.map(p => {
          const cx = scaleX(p.costNum || 6);
          const cy = scaleY(p.safeEvacuated);
          return `
            <g>
              <circle cx="${cx}" cy="${cy}" r="7" fill="${p.color || '#38bdf8'}" stroke="#000" stroke-width="1.5" opacity="0.95"/>
              <text x="${cx}" y="${cy - 10}" fill="var(--text-primary)" font-size="10" font-weight="600" text-anchor="middle">${p.name.split(' ')[0]}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `;
  },

  renderEquityVsTimeChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const policies = window.CrisisData?.POLICY_STRATEGIES || [];
    const width = 440;
    const height = 220;
    const pad = { top: 20, right: 30, bottom: 35, left: 55 };

    const minTime = 4, maxTime = 9;
    const minEq = 0.45, maxEq = 0.95;

    const scaleX = (t) => pad.left + ((t - minTime) / (maxTime - minTime)) * (width - pad.left - pad.right);
    const scaleY = (eq) => height - pad.bottom - ((eq - minEq) / (maxEq - minEq)) * (height - pad.top - pad.bottom);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; font-family:var(--font-sans);">
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="var(--border-subtle)" stroke-width="1"/>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="var(--border-subtle)" stroke-width="1"/>

        <text x="${scaleX(5)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">5.0h</text>
        <text x="${scaleX(7)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">7.0h</text>
        <text x="${scaleX(8.5)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">8.5h</text>
        <text x="${width / 2}" y="${height - 1}" fill="var(--text-secondary)" font-size="10.5" text-anchor="middle">Average Evacuation Time (Hours)</text>

        <text x="${pad.left - 8}" y="${scaleY(0.5) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">0.50</text>
        <text x="${pad.left - 8}" y="${scaleY(0.7) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">0.70</text>
        <text x="${pad.left - 8}" y="${scaleY(0.9) + 3}" fill="var(--text-muted)" font-size="9.5" text-anchor="end" font-family="var(--font-mono)">0.90</text>

        <rect x="${pad.left}" y="${scaleY(maxEq)}" width="${scaleX(6) - pad.left}" height="${scaleY(0.75) - scaleY(maxEq)}" fill="rgba(16, 185, 129, 0.08)" rx="3"/>
        <text x="${pad.left + 8}" y="${scaleY(0.93)}" fill="var(--accent-safe)" font-size="9.5" font-weight="700">Optimal (Fast & Fair)</text>

        ${policies.map(p => {
          const cx = scaleX(p.avgTime);
          const cy = scaleY(p.equityScore);
          return `
            <g>
              <circle cx="${cx}" cy="${cy}" r="7" fill="${p.color || '#10b981'}" stroke="#000" stroke-width="1.5"/>
              <text x="${cx}" y="${cy - 10}" fill="var(--text-primary)" font-size="10" font-weight="600" text-anchor="middle">${p.name.split(' ')[0]}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `;
  },

  renderEquityDisparityBarChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const groups = [
      { tier: "Low Vulnerability", baseline: 97.5, optimized: 98.2 },
      { tier: "Moderate Vulnerability", baseline: 85.2, optimized: 91.0 },
      { tier: "High Vulnerability (N4, N5, N7)", baseline: 46.8, optimized: 81.5 }
    ];

    const width = 500;
    const height = 180;
    const pad = { top: 20, right: 30, bottom: 30, left: 160 };

    const scaleX = (pct) => pad.left + (pct / 100) * (width - pad.left - pad.right);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; font-family:var(--font-sans);">
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="var(--border-subtle)"/>
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="var(--border-subtle)"/>

        <text x="${scaleX(0)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle">0%</text>
        <text x="${scaleX(50)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle">50%</text>
        <text x="${scaleX(100)}" y="${height - 12}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle">100%</text>

        ${groups.map((g, idx) => {
          const yBase = pad.top + idx * 44;
          const barHeight = 12;
          const wBase = scaleX(g.baseline) - pad.left;
          const wOpt = scaleX(g.optimized) - pad.left;
          return `
            <text x="${pad.left - 10}" y="${yBase + 16}" fill="var(--text-primary)" font-size="11" font-weight="600" text-anchor="end">${g.tier}</text>
            <rect x="${pad.left}" y="${yBase}" width="${wBase}" height="${barHeight}" fill="#64748b" rx="2"/>
            <text x="${scaleX(g.baseline) + 5}" y="${yBase + 9}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)">${g.baseline}%</text>

            <rect x="${pad.left}" y="${yBase + 15}" width="${wOpt}" height="${barHeight}" fill="var(--accent-safe)" rx="2"/>
            <text x="${scaleX(g.optimized) + 5}" y="${yBase + 24}" fill="var(--accent-safe)" font-size="9.5" font-weight="700" font-family="var(--font-mono)">${g.optimized}%</text>
          `;
        }).join('')}
      </svg>
    `;
  },

  renderMonteCarloDistribution(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const bins = [
      { bin: "70%", val: 72, count: 3 },
      { bin: "75%", val: 76, count: 7 },
      { bin: "80%", val: 80, count: 16 },
      { bin: "84%", val: 84, count: 34 },
      { bin: "88%", val: 88, count: 26 },
      { bin: "92%", val: 92, count: 11 },
      { bin: "96%", val: 96, count: 3 }
    ];

    const width = 480;
    const height = 180;
    const pad = { top: 20, right: 25, bottom: 30, left: 35 };

    const maxCount = 40;
    const scaleX = (idx) => pad.left + (idx / (bins.length - 1)) * (width - pad.left - pad.right);
    const scaleY = (c) => height - pad.bottom - (c / maxCount) * (height - pad.top - pad.bottom);

    const pathCurve = bins.map((b, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(b.count).toFixed(1)}`).join(' ');
    const areaCurve = `${pathCurve} L ${scaleX(bins.length - 1)} ${height - pad.bottom} L ${scaleX(0)} ${height - pad.bottom} Z`;

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; font-family:var(--font-sans);">
        <rect x="${scaleX(2)}" y="${pad.top}" width="${scaleX(4) - scaleX(2)}" height="${height - pad.top - pad.bottom}" fill="rgba(6, 182, 212, 0.14)" rx="3"/>

        <path d="${areaCurve}" fill="rgba(56, 189, 248, 0.15)"/>
        <path d="${pathCurve}" fill="none" stroke="var(--accent-flood-light)" stroke-width="2.5"/>

        <line x1="${scaleX(3)}" y1="${pad.top}" x2="${scaleX(3)}" y2="${height - pad.bottom}" stroke="var(--accent-safe)" stroke-width="2" stroke-dasharray="3 2"/>
        <text x="${scaleX(3)}" y="${pad.top - 5}" fill="var(--accent-safe)" font-size="10.5" font-weight="700" text-anchor="middle">Mean: 86.4%</text>

        ${bins.map((b, i) => `
          <text x="${scaleX(i)}" y="${height - 10}" fill="var(--text-muted)" font-size="9.5" text-anchor="middle" font-family="var(--font-mono)">${b.bin}</text>
        `).join('')}

        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="var(--border-subtle)"/>
      </svg>
    `;
  },

  renderSensitivityTornado(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = [
      { param: "Warning Time", impact: 92, note: "±2.4h" },
      { param: "Bridge 3 Inundation", impact: 88, note: "±45min" },
      { param: "Shelter Capacity", impact: 74, note: "+1.2k cots" },
      { param: "Rainfall Peak", impact: 71, note: "+20mm/h" },
      { param: "Ambulance Fleet", impact: 65, note: "+10 units" },
      { param: "Compliance Rate", impact: 58, note: "±10%" }
    ];

    const width = 480;
    const height = 190;
    const pad = { top: 15, right: 55, bottom: 15, left: 140 };

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; font-family:var(--font-sans);">
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="var(--border-subtle)"/>

        ${data.map((d, idx) => {
          const y = pad.top + idx * 27;
          const barW = (d.impact / 100) * (width - pad.left - pad.right);
          return `
            <text x="${pad.left - 10}" y="${y + 12}" fill="var(--text-primary)" font-size="11" font-weight="600" text-anchor="end">${d.param}</text>
            <rect x="${pad.left}" y="${y + 2}" width="${barW}" height="14" fill="${idx < 2 ? 'var(--accent-flood-light)' : 'var(--bg-surface)'}" stroke="var(--border-strong)" stroke-width="1" rx="2"/>
            <text x="${pad.left + barW + 8}" y="${y + 13}" fill="var(--text-secondary)" font-size="9" font-family="var(--font-mono)">${d.note}</text>
          `;
        }).join('')}
      </svg>
    `;
  }
};

window.CrisisCharts = CrisisCharts;
