(function () {
  const NAV_SECTIONS = [
    {
      title: "Operations",
      items: [
        { id: "dashboard", label: "Dashboard", href: "index.html", icon: "activity" },
        { id: "scenarios", label: "Scenarios", href: "scenarios.html", icon: "layers" },
        { id: "city-model", label: "City Model", href: "city-model.html", icon: "map" }
      ]
    },
    {
      title: "Analysis",
      items: [
        { id: "policy-lab", label: "Policy Lab", href: "policy-lab.html", icon: "sliders" },
        { id: "equity", label: "Equity Analysis", href: "equity-analysis.html", icon: "pie-chart" },
        { id: "dynamics", label: "System Dynamics", href: "system-dynamics.html", icon: "trending-up" },
        { id: "uncertainty", label: "Uncertainty", href: "uncertainty.html", icon: "bar-chart-2" }
      ]
    },
    {
      title: "System & Reports",
      items: [
        { id: "reports", label: "Reports", href: "reports.html", icon: "file-text" },
        { id: "methodology", label: "Methodology", href: "methodology.html", icon: "book-open" },
        { id: "settings", label: "Settings", href: "settings.html", icon: "settings" }
      ]
    }
  ];

  function getIconSvg(name) {
    const icons = {
      activity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
      layers: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
      map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>',
      sliders: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>',
      "pie-chart": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>',
      "trending-up": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>',
      "bar-chart-2": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
      "file-text": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
      "book-open": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
      settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
      bell: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
      sun: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
      moon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
      chevronLeft: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
      chevronRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
      chevronDown: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
      alertTriangle: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    };
    return icons[name] || '';
  }

  function renderSidebar(activePageId) {
    const sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return;

    const isCollapsed = localStorage.getItem("crisissim_sidebar_collapsed") === "true";
    if (isCollapsed) {
      sidebar.classList.add("collapsed");
    } else {
      sidebar.classList.remove("collapsed");
    }

    let navHtml = `
      <div class="sidebar-header">
        <a href="index.html" class="brand-badge" title="CrisisSim Digital Twin">
          <div>
            <div class="brand-text">CrisisSim</div>
            <span class="brand-sub">Emergency Twin</span>
          </div>
        </a>
        <button class="sidebar-collapse-btn" onclick="CrisisCommon.toggleSidebarCollapse()" title="Toggle Sidebar Width">
          ${isCollapsed ? getIconSvg('chevronRight') : getIconSvg('chevronLeft')}
        </button>
      </div>
      <div class="sidebar-nav" id="sidebar-nav-list">
    `;

    NAV_SECTIONS.forEach(section => {
      navHtml += `<div class="nav-section-title">${section.title}</div>`;
      section.items.forEach(item => {
        const isActive = item.id === activePageId;
        navHtml += `
          <a href="${item.href}" class="nav-item ${isActive ? 'active' : ''}" title="${item.label}">
            ${getIconSvg(item.icon)}
            <span>${item.label}</span>
            ${item.id === 'scenarios' ? `<span class="badge-count">${window.CrisisState ? window.CrisisState.getScenarios().length : 5}</span>` : ''}
          </a>
        `;
      });
    });

    navHtml += `
      </div>
      <div class="sidebar-footer">
        <div class="footer-disclaimer-box">
          <strong style="display:block; margin-bottom:2px; color:var(--text-primary); font-size:10px;">Educational Support</strong>
          Synthetic Riverton twin for decision exploration. Not official dispatch.
        </div>
      </div>
    `;

    sidebar.innerHTML = navHtml;
  }

  function toggleSidebarCollapse() {
    const sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return;
    const nowCollapsed = !sidebar.classList.contains("collapsed");
    sidebar.classList.toggle("collapsed", nowCollapsed);
    localStorage.setItem("crisissim_sidebar_collapsed", nowCollapsed ? "true" : "false");
    const btn = sidebar.querySelector(".sidebar-collapse-btn");
    if (btn) {
      btn.innerHTML = nowCollapsed ? getIconSvg('chevronRight') : getIconSvg('chevronLeft');
    }
  }

  function renderHeader(activePageId) {
    const header = document.getElementById("app-header");
    if (!header) return;

    const activeScenario = window.CrisisState ? window.CrisisState.getActiveScenario() : { name: "Riverton Flood — Central City" };
    const simState = window.CrisisState ? window.CrisisState.simulation.getState() : { isRunning: true, currentTimeHours: 8.6 };

    const hours = Math.floor(simState.currentTimeHours || 8);
    const mins = Math.floor(((simState.currentTimeHours || 8) % 1) * 60);
    const clockStr = `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    header.innerHTML = `
      <div class="header-left">
        <div class="header-scenario-selector">
          <label>Scenario</label>
          <button class="scenario-select-btn" onclick="CrisisCommon.openScenarioModal()" title="Switch active scenario">
            <span id="header-scenario-name">${activeScenario.name}</span>
            ${getIconSvg('chevronDown')}
          </button>
        </div>

        <div class="header-clock" title="Simulation elapsed time">
          ${getIconSvg('activity')}
          <span id="header-clock-val">${clockStr}</span>
          <span style="color:var(--text-muted); font-size:11px;">| Jun 14, 2028</span>
        </div>

        <div id="header-status-badge" class="status-badge ${simState.isRunning ? 'status-running' : 'status-ready'}">
          <span class="pulse-dot"></span>
          <span>${simState.isRunning ? 'Sim Running' : 'Standby'}</span>
        </div>
      </div>

      <div class="header-right">
        <a href="command-center.html" class="btn btn-secondary btn-sm" style="gap:5px;">
          ${getIconSvg('activity')}
          <span>Command Center</span>
        </a>

        <button class="icon-btn" onclick="CrisisCommon.toggleTheme()" title="Toggle Dark/Light Mode">
          <span id="theme-icon">${document.documentElement.classList.contains('theme-light') ? getIconSvg('moon') : getIconSvg('sun')}</span>
        </button>

        <button class="icon-btn" onclick="CrisisCommon.toggleNotificationDrawer()" title="Critical Alerts">
          ${getIconSvg('bell')}
          <span class="badge-dot"></span>
        </button>

        <div class="user-badge" title="Officer in Charge">
          <div class="user-avatar-tag">EO</div>
          <span style="font-weight:600;">EO Officer</span>
        </div>
      </div>
    `;
  }

  function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type === 'danger' ? 'toast-danger' : ''}`;
    toast.innerHTML = `
      ${getIconSvg('check')}
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.2s";
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  function toggleNotificationDrawer() {
    let drawer = document.getElementById("notification-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.id = "notification-drawer";
      drawer.className = "drawer-panel";
      drawer.innerHTML = `
        <div class="modal-header">
          <div class="modal-title" style="display:flex; align-items:center; gap:6px;">
            ${getIconSvg('alertTriangle')}
            <span>Active Incident Stream</span>
          </div>
          <button class="icon-btn" onclick="CrisisCommon.toggleNotificationDrawer()">✕</button>
        </div>
        <div class="modal-body" style="padding:12px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:10px; font-weight:700; text-transform:uppercase;">
            Critical Riverton Broadcasts
          </div>
          <div id="drawer-alert-list">
            ${(window.CrisisData?.RECENT_ALERTS || []).map(a => `
              <div class="alert-item alert-${a.level}">
                <div class="alert-time">${a.time}</div>
                <div>
                  <div class="alert-title">${a.title}</div>
                  <div class="alert-desc">${a.location} — Action dispatched to field coordinators.</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer" style="font-size:11px; color:var(--text-muted);">
          All alerts calibrated to current flood crest model.
        </div>
      `;
      document.body.appendChild(drawer);
    }
    drawer.classList.toggle("open");
  }

  function openScenarioModal() {
    const scenarios = window.CrisisState ? window.CrisisState.getScenarios() : [];
    const activeSc = window.CrisisState ? window.CrisisState.getActiveScenario() : null;

    let modal = document.getElementById("scenario-modal");
    if (modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "scenario-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">Select Active Simulation Scenario</div>
          <button class="icon-btn" onclick="this.closest('.modal-backdrop').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${scenarios.map(sc => `
              <div class="card" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:12px; border-color:${sc.id === activeSc?.id ? 'var(--accent-flood-light)' : 'var(--border-subtle)'}; background:${sc.id === activeSc?.id ? 'var(--bg-surface)' : 'var(--bg-card)'}"
                   onclick="CrisisCommon.selectScenario('${sc.id}')">
                <div>
                  <div style="font-weight:600; color:var(--text-primary); font-size:13px; display:flex; align-items:center; gap:6px;">
                    ${sc.name}
                    ${sc.isFlagship ? `<span class="badge badge-info">Flagship</span>` : ''}
                    ${sc.isBaseline ? `<span class="badge badge-neutral">Baseline</span>` : ''}
                  </div>
                  <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
                    ${sc.hazardType} • ${sc.severity} • Budget: $${sc.budget}M
                  </div>
                </div>
                <div>
                  ${sc.id === activeSc?.id ? `<span class="badge badge-success">Active</span>` : `<button class="btn btn-secondary btn-sm">Load</button>`}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <a href="scenarios.html" class="btn btn-secondary btn-sm">Manage All Scenarios</a>
          <button class="btn btn-primary btn-sm" onclick="this.closest('.modal-backdrop').remove()">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function selectScenario(id) {
    if (window.CrisisState) {
      window.CrisisState.setActiveScenario(id);
      const sc = window.CrisisState.getActiveScenario();
      const nameEl = document.getElementById("header-scenario-name");
      if (nameEl && sc) nameEl.textContent = sc.name;
      showToast(`Loaded scenario: ${sc.name}`);
      const modal = document.getElementById("scenario-modal");
      if (modal) modal.remove();
      if (typeof window.onScenarioChanged === "function") {
        window.onScenarioChanged(sc);
      }
    }
  }

  function toggleTheme() {
    if (window.CrisisState) {
      const newTheme = window.CrisisState.toggleTheme();
      const iconEl = document.getElementById("theme-icon");
      if (iconEl) {
        iconEl.innerHTML = newTheme === "light" ? getIconSvg('moon') : getIconSvg('sun');
      }
      showToast(`Switched to ${newTheme === 'light' ? 'Light' : 'Dark'} mode`);
    }
  }

  function initSimulationSync() {
    if (window.CrisisState?.simulation) {
      window.CrisisState.simulation.subscribe(state => {
        const hours = Math.floor(state.currentTimeHours);
        const mins = Math.floor((state.currentTimeHours % 1) * 60);
        const clockStr = `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        const clockEl = document.getElementById("header-clock-val");
        if (clockEl) clockEl.textContent = clockStr;

        const badgeEl = document.getElementById("header-status-badge");
        if (badgeEl) {
          badgeEl.className = `status-badge ${state.isRunning ? 'status-running' : 'status-ready'}`;
          badgeEl.innerHTML = `
            <span class="pulse-dot"></span>
            <span>${state.isRunning ? 'Sim Running' : 'Standby'}</span>
          `;
        }
      });
    }
  }

  function initShell(activePageId) {
    renderSidebar(activePageId);
    renderHeader(activePageId);
    initSimulationSync();
  }

  window.CrisisCommon = {
    initShell,
    getIconSvg,
    showToast,
    toggleNotificationDrawer,
    openScenarioModal,
    selectScenario,
    toggleTheme,
    toggleSidebarCollapse
  };
})();
