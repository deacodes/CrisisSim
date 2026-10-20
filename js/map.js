class RivertonCityMap {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      isCompact: false,
      showControls: true,
      showLegend: true,
      allowLayerToggle: true,
      onNeighborhoodClick: null,
      ...options
    };

    this.layers = {
      floodDepth: true,
      routes: true,
      vulnerability: true,
      infrastructure: true,
      accessibility: true,
      agents: true
    };

    this.agents = this.createMockAgents(28);
    this.animationFrameId = null;
    this.selectedNeighborhoodId = null;

    if (this.container) {
      this.init();
    }
  }

  createMockAgents(count) {
    const paths = [
      [{ x: 380, y: 620 }, { x: 420, y: 580 }, { x: 520, y: 550 }, { x: 602, y: 520 }],
      [{ x: 420, y: 320 }, { x: 440, y: 248 }, { x: 480, y: 210 }, { x: 512, y: 190 }],
      [{ x: 230, y: 460 }, { x: 280, y: 440 }, { x: 334, y: 420 }],
      [{ x: 510, y: 380 }, { x: 490, y: 290 }, { x: 512, y: 190 }],
      [{ x: 660, y: 500 }, { x: 630, y: 515 }, { x: 602, y: 520 }]
    ];

    const agents = [];
    for (let i = 0; i < count; i++) {
      const pathIndex = i % paths.length;
      agents.push({
        path: paths[pathIndex],
        progress: Math.random(),
        speed: 0.0015 + Math.random() * 0.002
      });
    }
    return agents;
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.startAgentAnimation();

    if (window.CrisisState?.simulation) {
      window.CrisisState.simulation.subscribe(simState => {
        this.updateSimulationState(simState);
      });
    }
  }

  render() {
    const { isCompact, showControls, showLegend } = this.options;

    this.container.innerHTML = `
      <div class="map-container ${isCompact ? 'compact' : ''}">
        ${showControls && !isCompact ? `
          <div class="map-controls-overlay">
            <div class="map-control-group">
              <span style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-right:4px;">Layers:</span>
              <button class="map-layer-btn active" data-layer="floodDepth">Flood Depth</button>
              <button class="map-layer-btn active" data-layer="routes">Safe Routes</button>
              <button class="map-layer-btn active" data-layer="vulnerability">Vulnerability</button>
              <button class="map-layer-btn active" data-layer="infrastructure">Facilities</button>
              <button class="map-layer-btn active" data-layer="accessibility">Road Status</button>
            </div>
            <div class="map-control-group">
              <span style="font-size:11px; font-family:var(--font-mono); color:var(--accent-flood-light);" id="map-sim-hour-tag">Hour 08.6</span>
            </div>
          </div>
        ` : ''}

        <svg class="map-svg" viewBox="0 0 800 750" preserveAspectRatio="xMidYMid meet" style="font-family:'Prompt',sans-serif;">
          <defs>
            <pattern id="urbanGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
              <rect x="6" y="6" width="12" height="12" fill="rgba(255,255,255,0.015)" rx="1"/>
              <rect x="22" y="22" width="14" height="14" fill="rgba(255,255,255,0.01)" rx="1"/>
            </pattern>
          </defs>

          <rect width="800" height="750" fill="#080c14"/>
          <rect width="800" height="750" fill="url(#urbanGrid)"/>

          <g id="layer-neighborhoods" class="map-layer">
            ${(window.CrisisData?.NEIGHBORHOODS || []).map(n => `
              <polygon points="${n.polygon}"
                       class="map-neighborhood ${n.id === 'N5' ? 'critical-risk' : ''}"
                       data-id="${n.id}"
                       data-name="${n.name}"
                       data-tier="${n.vulnerabilityTier}"
                       data-pop="${n.population}"
                       data-elev="${n.elevation}m"
                       data-flood="${n.projectedFloodDepth}m"/>
              <text x="${n.center.x}" y="${n.center.y}"
                    fill="rgba(255,255,255,0.7)"
                    font-size="${isCompact ? '9' : '11'}"
                    font-weight="600"
                    text-anchor="middle"
                    class="map-label"
                    pointer-events="none">${n.name.split(' (')[0]}</text>
            `).join('')}
          </g>

          <g id="layer-floodDepth" class="map-layer">
            <path id="map-flood-risk-path" d="M 310 -10 Q 370 180 430 290 T 560 380 T 490 520 T 370 610 T 360 760 L 460 760 Q 570 610 650 490 T 490 280 T 410 -10 Z"
                  class="map-flood-risk"/>

            <path id="map-flood-zone-path" d="M 320 -10 Q 380 170 440 280 T 540 370 T 470 510 T 380 600 T 370 760 L 440 760 Q 540 600 610 490 T 470 280 T 390 -10 Z"
                  class="map-flood-zone"/>

            <path d="M 340 -10 Q 400 160 450 260 Q 490 340 520 380 Q 500 480 440 550 Q 390 610 390 760"
                  class="map-river"/>
            <path d="M 340 -10 Q 400 160 450 260 Q 490 340 520 380 Q 500 480 440 550 Q 390 610 390 760"
                  class="map-river-inner"/>
          </g>

          <g id="layer-roads" class="map-layer">
            <path d="M 80 460 L 730 460" class="map-road-arterial"/>
            <path d="M 440 50 L 440 720" class="map-road-arterial"/>
            <path d="M 190 240 L 680 580" class="map-road-minor"/>
            <path d="M 230 650 L 620 200" class="map-road-minor"/>
          </g>

          <g id="layer-routes" class="map-layer">
            <path d="M 380 620 L 420 580 L 520 550 L 602 520" class="map-route-safe"/>
            <path d="M 420 320 L 440 248 L 480 210 L 512 190" class="map-route-safe"/>
            <path d="M 230 460 L 280 440 L 334 420" class="map-route-safe"/>
            <path d="M 510 380 L 490 290 L 512 190" class="map-route-safe"/>
            <path d="M 660 500 L 630 515 L 602 520" class="map-route-safe"/>
          </g>

          <g id="layer-agents" class="map-layer">
            <g id="map-agent-dots-group"></g>
          </g>

          <g id="layer-accessibility" class="map-layer">
            <g class="map-blocked-road" data-name="Lower River Parkway Closed">
              <circle cx="436" cy="248" r="8" fill="#ef4444" opacity="0.85"/>
              <line x1="432" y1="244" x2="440" y2="252" stroke="#fff" stroke-width="2"/>
              <line x1="440" y1="244" x2="432" y2="252" stroke="#fff" stroke-width="2"/>
            </g>
            <g class="map-blocked-road" data-name="Mid-River Canal Bypass Closed">
              <circle cx="446" cy="456" r="8" fill="#ef4444" opacity="0.85"/>
              <line x1="442" y1="452" x2="450" y2="460" stroke="#fff" stroke-width="2"/>
              <line x1="450" y1="452" x2="442" y2="460" stroke="#fff" stroke-width="2"/>
            </g>
            <g class="map-blocked-road" id="marker-bridge3-cross" data-name="Bridge 3 Imminent Inundation">
              <circle cx="388" cy="620" r="9" fill="#ef4444"/>
              <line x1="383" y1="615" x2="393" y2="625" stroke="#fff" stroke-width="2.5"/>
              <line x1="393" y1="615" x2="383" y2="625" stroke="#fff" stroke-width="2.5"/>
            </g>
            <g class="map-blocked-road" data-name="South Causeway Water Overcurb">
              <circle cx="662" cy="442" r="8" fill="#f59e0b" opacity="0.9"/>
              <line x1="658" y1="442" x2="666" y2="442" stroke="#fff" stroke-width="2.5"/>
            </g>
          </g>

          <g id="layer-infrastructure" class="map-layer">
            <g class="map-marker" data-type="shelter" data-id="S1" transform="translate(512, 190)">
              <rect x="-14" y="-14" width="28" height="28" fill="#10b981" rx="4" stroke="#000" stroke-width="1"/>
              <path d="M -7 4 L -7 -3 L 0 -8 L 7 -3 L 7 4 Z" fill="#fff"/>
              <text x="0" y="22" fill="#fff" font-size="10" font-weight="700" text-anchor="middle" class="map-label">North Shelter</text>
            </g>

            <g class="map-marker" data-type="shelter" data-id="S2" transform="translate(334, 420)">
              <rect x="-14" y="-14" width="28" height="28" fill="#10b981" rx="4" stroke="#000" stroke-width="1"/>
              <path d="M -7 4 L -7 -3 L 0 -8 L 7 -3 L 7 4 Z" fill="#fff"/>
              <text x="0" y="22" fill="#fff" font-size="10" font-weight="700" text-anchor="middle" class="map-label">West Shelter</text>
            </g>

            <g class="map-marker" data-type="shelter" data-id="S3" transform="translate(602, 520)">
              <rect x="-14" y="-14" width="28" height="28" fill="#10b981" rx="4" stroke="#000" stroke-width="1"/>
              <path d="M -7 4 L -7 -3 L 0 -8 L 7 -3 L 7 4 Z" fill="#fff"/>
              <text x="0" y="22" fill="#fff" font-size="10" font-weight="700" text-anchor="middle" class="map-label">East Shelter</text>
            </g>

            <g class="map-marker" data-type="hospital" data-id="H1" transform="translate(624, 286)">
              <rect x="-14" y="-14" width="28" height="28" fill="#ef4444" rx="4" stroke="#000" stroke-width="1"/>
              <rect x="-3" y="-8" width="6" height="16" fill="#fff"/>
              <rect x="-8" y="-3" width="16" height="6" fill="#fff"/>
              <text x="0" y="22" fill="#fff" font-size="10" font-weight="700" text-anchor="middle" class="map-label">Riverside Hospital</text>
            </g>
          </g>
        </svg>

        ${showLegend && !isCompact ? `
          <div class="map-legend">
            <div class="map-legend-title">Operational Legend</div>
            <div class="legend-grid">
              <div class="legend-item"><div class="legend-swatch swatch-flood"></div><span>Flooded Area</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-risk"></div><span>Flood Risk (+6h)</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-route"></div><span>Safe Route</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-closed"></div><span>Blocked / Bridge 3</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-agent"></div><span>Evac Resident</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-shelter"></div><span>Shelter Active</span></div>
              <div class="legend-item"><div class="legend-swatch swatch-hospital"></div><span>Hospital Unit</span></div>
            </div>
          </div>
        ` : ''}

        ${!isCompact ? `
          <div class="map-scale-compass">
            <div>▲ N</div>
            <div class="scale-bar">
              <span>0</span>
              <div class="scale-line"></div>
              <span>2 km</span>
            </div>
          </div>
        ` : ''}

        <div id="map-tooltip" class="map-tooltip"></div>
      </div>
    `;

    this.renderAgentDots();
  }

  renderAgentDots() {
    const group = this.container.querySelector("#map-agent-dots-group");
    if (!group) return;

    let dotsHtml = "";
    this.agents.forEach((ag, idx) => {
      const pos = this.getPointOnPath(ag.path, ag.progress);
      dotsHtml += `<circle id="agent-dot-${idx}" cx="${pos.x}" cy="${pos.y}" r="2.8" class="map-agent-dot"/>`;
    });
    group.innerHTML = dotsHtml;
  }

  getPointOnPath(points, progress) {
    if (points.length < 2) return points[0] || { x: 0, y: 0 };
    const totalSegments = points.length - 1;
    const scaledProg = progress * totalSegments;
    const segIdx = Math.min(Math.floor(scaledProg), totalSegments - 1);
    const segFraction = scaledProg - segIdx;

    const p1 = points[segIdx];
    const p2 = points[segIdx + 1];

    return {
      x: p1.x + (p2.x - p1.x) * segFraction,
      y: p1.y + (p2.y - p1.y) * segFraction
    };
  }

  startAgentAnimation() {
    const isReduced = document.documentElement.classList.contains("reduced-motion");
    if (isReduced) return;

    const animate = () => {
      const simState = window.CrisisState?.simulation?.getState();
      const isRunning = simState ? simState.isRunning : true;
      const speed = simState ? simState.speedMultiplier : 1;

      if (isRunning) {
        this.agents.forEach((ag, idx) => {
          ag.progress = (ag.progress + ag.speed * speed) % 1;
          const pos = this.getPointOnPath(ag.path, ag.progress);
          const circle = this.container.querySelector(`#agent-dot-${idx}`);
          if (circle) {
            circle.setAttribute("cx", pos.x);
            circle.setAttribute("cy", pos.y);
          }
        });
      }
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  stopAgentAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  updateSimulationState(simState) {
    const hourTag = this.container.querySelector("#map-sim-hour-tag");
    if (hourTag) {
      hourTag.textContent = `Hour ${simState.currentTimeHours.toFixed(1)}`;
    }

    const floodZone = this.container.querySelector("#map-flood-zone-path");
    if (floodZone) {
      const progress = simState.currentTimeHours / 24;
      const opacity = 0.25 + 0.35 * Math.min(1, progress * 1.4);
      floodZone.style.opacity = opacity.toFixed(2);
    }

    const bridgeCross = this.container.querySelector("#marker-bridge3-cross");
    if (bridgeCross) {
      if (simState.currentTimeHours >= 4.2) {
        bridgeCross.style.display = "block";
      } else {
        bridgeCross.style.display = "none";
      }
    }
  }

  attachEventListeners() {
    const tooltip = this.container.querySelector("#map-tooltip");

    const layerButtons = this.container.querySelectorAll(".map-layer-btn");
    layerButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const layerKey = btn.dataset.layer;
        const layerEl = this.container.querySelector(`#layer-${layerKey}`);
        if (layerEl) {
          btn.classList.toggle("active");
          const isHidden = !btn.classList.contains("active");
          layerEl.classList.toggle("hidden", isHidden);
          if (window.CrisisCommon) {
            window.CrisisCommon.showToast(`Layer ${layerKey}: ${isHidden ? 'Hidden' : 'Visible'}`);
          }
        }
      });
    });

    const neighborhoods = this.container.querySelectorAll(".map-neighborhood");
    neighborhoods.forEach(n => {
      n.addEventListener("mouseenter", (e) => {
        if (!tooltip) return;
        const name = n.dataset.name;
        const pop = Number(n.dataset.pop).toLocaleString();
        const tier = n.dataset.tier;
        const elev = n.dataset.elev;
        const flood = n.dataset.flood;

        tooltip.innerHTML = `
          <strong style="color:var(--text-primary); font-family:'Prompt',sans-serif;">${name}</strong>
          <div style="font-size:10.5px; color:var(--text-secondary); margin-top:2px;">
            Pop: ${pop} • Vulnerability: <strong>${tier}</strong><br>
            Elevation: ${elev} • Flood Depth: <span style="color:var(--accent-flood-light);">${flood}</span>
          </div>
        `;
        tooltip.style.display = "block";
      });

      n.addEventListener("mousemove", (e) => {
        if (!tooltip) return;
        const rect = this.container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });

      n.addEventListener("mouseleave", () => {
        if (tooltip) tooltip.style.display = "none";
      });

      n.addEventListener("click", () => {
        const id = n.dataset.id;
        this.selectNeighborhood(id);
        if (typeof this.options.onNeighborhoodClick === "function") {
          this.options.onNeighborhoodClick(id);
        }
      });
    });

    const markers = this.container.querySelectorAll(".map-marker, .map-blocked-road");
    markers.forEach(m => {
      m.addEventListener("mouseenter", (e) => {
        if (!tooltip) return;
        const name = m.dataset.name || (m.dataset.id ? (m.dataset.id.startsWith('S') ? 'Designated Evacuation Shelter' : 'Emergency Hospital Facility') : 'Infrastructure Asset');
        tooltip.innerHTML = `<strong>${name}</strong>`;
        tooltip.style.display = "block";
      });
      m.addEventListener("mousemove", (e) => {
        if (!tooltip) return;
        const rect = this.container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });
      m.addEventListener("mouseleave", () => {
        if (tooltip) tooltip.style.display = "none";
      });
    });
  }

  selectNeighborhood(id) {
    this.selectedNeighborhoodId = id;
    const polygons = this.container.querySelectorAll(".map-neighborhood");
    polygons.forEach(p => {
      if (p.dataset.id === id) {
        p.classList.add("selected");
      } else {
        p.classList.remove("selected");
      }
    });
  }
}

window.RivertonCityMap = RivertonCityMap;
