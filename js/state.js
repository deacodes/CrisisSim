(function () {
  const SETTINGS_KEY = "crisissim_settings_v1";
  const SCENARIOS_KEY = "crisissim_scenarios_v1";
  const ACTIVE_SCENARIO_KEY = "crisissim_active_scenario_id";

  const defaultSettings = {
    theme: "dark",
    highContrast: false,
    largerLabels: false,
    reducedMotion: false,
    colorblindMode: false,
    mapMode: "3d",
    mapLayers: {
      floodDepth: true,
      routes: true,
      vulnerability: true,
      infrastructure: true,
      accessibility: true,
      agents: true
    },
    simDefaults: {
      speed: 1,
      agentCount: "medium",
      monteCarloRuns: 50,
      dynamicRerouting: true
    }
  };

  let settings = { ...defaultSettings };
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      settings = { ...defaultSettings, ...JSON.parse(saved) };
      settings.mapLayers = { ...defaultSettings.mapLayers, ...settings.mapLayers };
      settings.simDefaults = { ...defaultSettings.simDefaults, ...settings.simDefaults };
    }
  } catch (e) {
    console.warn("Could not load settings from localStorage", e);
  }

  let scenarios = [];
  try {
    const saved = localStorage.getItem(SCENARIOS_KEY);
    if (saved) {
      scenarios = JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Could not load scenarios from localStorage", e);
  }

  if (!scenarios || scenarios.length === 0) {
    scenarios = [...(window.CrisisData ? window.CrisisData.DEFAULT_SCENARIOS : [])];
  }

  let activeScenarioId = localStorage.getItem(ACTIVE_SCENARIO_KEY) || "sc-optimized";
  if (!scenarios.some(s => s.id === activeScenarioId)) {
    activeScenarioId = scenarios[0]?.id || "sc-optimized";
  }

  const simulationState = {
    isRunning: false,
    currentTimeHours: 8.6,
    speedMultiplier: 1,
    rainfallIntensity: 90,
    warningTime: 6,
    budget: 12.0,
    policies: {
      temporaryShelters: true,
      rescueBoats: true,
      ambulances: true,
      closeHighRiskRoads: true,
      prioritizeVulnerable: true
    },
    timerId: null,
    listeners: new Set()
  };

  function notify() {
    simulationState.listeners.forEach(cb => {
      try {
        cb(simulationState);
      } catch (err) {
        console.error("Simulation listener error:", err);
      }
    });
  }

  function calculateMetrics(hour, policies) {
    const clampedHour = Math.max(0, Math.min(24, hour));
    const progress = clampedHour / 24;

    let targetEvac = 12480;
    let targetStranded = 1230;
    let targetTime = 4.8;
    let targetEquity = 0.82;

    if (!policies.temporaryShelters) {
      targetEvac -= 1100;
      targetStranded += 800;
      targetTime += 0.8;
      targetEquity -= 0.08;
    }
    if (!policies.rescueBoats) {
      targetEvac -= 850;
      targetStranded += 750;
      targetEquity -= 0.07;
    }
    if (!policies.prioritizeVulnerable) {
      targetEquity -= 0.16;
      targetTime += 1.1;
      targetStranded += 420;
    }
    if (!policies.closeHighRiskRoads) {
      targetTime += 1.4;
      targetStranded += 310;
    }
    if (!policies.ambulances) {
      targetEquity -= 0.05;
      targetStranded += 240;
    }

    const sFactor = 1 / (1 + Math.exp(-0.35 * (clampedHour - 7)));
    const currentEvac = Math.round(targetEvac * sFactor);
    const currentStranded = Math.round(targetStranded * Math.min(1, sFactor * 1.3));

    const northOccPct = Math.min(100, Math.round(20 + 65 * sFactor));
    const westOccPct = Math.min(100, Math.round(15 + 50 * sFactor));
    const eastOccPct = Math.min(100, Math.round(10 + 42 * sFactor));
    const hospitalLoadPct = Math.min(100, Math.round(40 + 35 * sFactor));

    return {
      safelyEvacuated: currentEvac,
      stranded: currentStranded,
      avgEvacuationTime: targetTime.toFixed(1),
      equityScore: targetEquity.toFixed(2),
      shelterOccupancy: {
        north: northOccPct,
        west: westOccPct,
        east: eastOccPct
      },
      hospitalLoad: hospitalLoadPct,
      waterLevelBridge3: (1.8 - 0.25 * (clampedHour / 12)).toFixed(2),
      bridge3Closed: clampedHour >= 4.2
    };
  }

  function startSimulation() {
    if (simulationState.isRunning) return;
    simulationState.isRunning = true;
    const intervalMs = 250;
    const stepHoursPerSec = 0.5 * simulationState.speedMultiplier;

    simulationState.timerId = setInterval(() => {
      simulationState.currentTimeHours += (stepHoursPerSec * (intervalMs / 1000));
      if (simulationState.currentTimeHours >= 24) {
        simulationState.currentTimeHours = 24;
        pauseSimulation();
      }
      notify();
    }, intervalMs);
    notify();
  }

  function pauseSimulation() {
    if (!simulationState.isRunning) return;
    simulationState.isRunning = false;
    if (simulationState.timerId) {
      clearInterval(simulationState.timerId);
      simulationState.timerId = null;
    }
    notify();
  }

  function resetSimulation() {
    pauseSimulation();
    simulationState.currentTimeHours = 0;
    notify();
  }

  function setSimulationTime(hour) {
    simulationState.currentTimeHours = Math.max(0, Math.min(24, hour));
    notify();
  }

  function setSpeed(speed) {
    simulationState.speedMultiplier = speed;
    if (simulationState.isRunning) {
      pauseSimulation();
      startSimulation();
    } else {
      notify();
    }
  }

  function togglePolicy(policyKey) {
    if (simulationState.policies.hasOwnProperty(policyKey)) {
      simulationState.policies[policyKey] = !simulationState.policies[policyKey];
      notify();
      return simulationState.policies[policyKey];
    }
    return false;
  }

  function saveScenariosToStorage() {
    try {
      localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios));
    } catch (e) {
      console.error("Failed to save scenarios", e);
    }
  }

  function saveSettingsToStorage() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      applyTheme();
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  }

  function getActiveScenario() {
    return scenarios.find(s => s.id === activeScenarioId) || scenarios[0];
  }

  function setActiveScenario(id) {
    if (scenarios.some(s => s.id === id)) {
      activeScenarioId = id;
      localStorage.setItem(ACTIVE_SCENARIO_KEY, id);
      const sc = getActiveScenario();
      if (sc) {
        simulationState.rainfallIntensity = sc.rainfallIntensity || 90;
        simulationState.warningTime = sc.warningTime || 6;
        simulationState.budget = sc.budget || 12.0;
      }
      notify();
      return true;
    }
    return false;
  }

  function createScenario(newSc) {
    const id = "sc-" + Date.now();
    const created = {
      id,
      name: newSc.name || "Custom Riverton Scenario",
      shortName: newSc.name?.substring(0, 24) || "Custom Scenario",
      hazardType: newSc.hazardType || "Flood",
      severity: newSc.severity || "High",
      rainfallIntensity: Number(newSc.rainfallIntensity) || 90,
      stormDuration: Number(newSc.stormDuration) || 24,
      warningTime: Number(newSc.warningTime) || 6,
      budget: Number(newSc.budget) || 12.0,
      lastRunDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      status: "Ready",
      isBaseline: false,
      isCustom: true,
      outcomes: {
        safelyEvacuated: Math.round(11000 + Math.random() * 1500),
        stranded: Math.round(1000 + Math.random() * 1000),
        evacuationRate: 88.5,
        avgEvacuationTime: (4.5 + Math.random() * 2).toFixed(1),
        equityScore: (0.75 + Math.random() * 0.15).toFixed(2),
        totalCost: `$${(newSc.budget || 12.0).toFixed(1)}M`,
        shelterOverflowPct: 4,
        hospitalSurgePct: 70
      },
      description: newSc.description || "User-configured simulation scenario."
    };
    scenarios.unshift(created);
    saveScenariosToStorage();
    setActiveScenario(id);
    return created;
  }

  function duplicateScenario(id) {
    const original = scenarios.find(s => s.id === id);
    if (!original) return null;
    const copy = JSON.parse(JSON.stringify(original));
    copy.id = "sc-" + Date.now();
    copy.name = `${original.name} (Copy)`;
    copy.shortName = `${original.shortName || original.name} (Copy)`;
    copy.isFlagship = false;
    copy.isCustom = true;
    copy.lastRunDate = new Date().toISOString().replace('T', ' ').substring(0, 16);
    scenarios.push(copy);
    saveScenariosToStorage();
    return copy;
  }

  function renameScenario(id, newName) {
    const target = scenarios.find(s => s.id === id);
    if (target) {
      target.name = newName;
      target.shortName = newName.substring(0, 24);
      saveScenariosToStorage();
      notify();
      return true;
    }
    return false;
  }

  function deleteScenario(id) {
    if (scenarios.length <= 1) return false;
    scenarios = scenarios.filter(s => s.id !== id);
    if (activeScenarioId === id) {
      activeScenarioId = scenarios[0].id;
      localStorage.setItem(ACTIVE_SCENARIO_KEY, activeScenarioId);
    }
    saveScenariosToStorage();
    notify();
    return true;
  }

  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === "light") {
      root.classList.add("theme-light");
      root.classList.remove("theme-dark");
    } else {
      root.classList.add("theme-dark");
      root.classList.remove("theme-light");
    }

    if (settings.highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }

    if (settings.reducedMotion) {
      root.classList.add("reduced-motion");
    } else {
      root.classList.remove("reduced-motion");
    }

    if (settings.largerLabels) {
      root.classList.add("larger-labels");
    } else {
      root.classList.remove("larger-labels");
    }
  }

  window.CrisisState = {
    getSettings: () => ({ ...settings }),
    updateSettings: (newPartial) => {
      settings = { ...settings, ...newPartial };
      saveSettingsToStorage();
    },
    toggleTheme: () => {
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      saveSettingsToStorage();
      return settings.theme;
    },
    getScenarios: () => [...scenarios],
    getActiveScenario,
    setActiveScenario,
    createScenario,
    duplicateScenario,
    renameScenario,
    deleteScenario,
    resetScenariosToDefault: () => {
      scenarios = [...(window.CrisisData ? window.CrisisData.DEFAULT_SCENARIOS : [])];
      activeScenarioId = "sc-optimized";
      saveScenariosToStorage();
      localStorage.setItem(ACTIVE_SCENARIO_KEY, activeScenarioId);
      notify();
    },
    simulation: {
      getState: () => ({ ...simulationState }),
      start: startSimulation,
      pause: pauseSimulation,
      reset: resetSimulation,
      setTime: setSimulationTime,
      setSpeed,
      togglePolicy,
      setParam: (key, val) => {
        if (simulationState.hasOwnProperty(key)) {
          simulationState[key] = val;
          notify();
        }
      },
      subscribe: (cb) => {
        simulationState.listeners.add(cb);
        return () => simulationState.listeners.delete(cb);
      },
      getMetrics: () => calculateMetrics(simulationState.currentTimeHours, simulationState.policies)
    },
    applyTheme
  };

  document.addEventListener("DOMContentLoaded", applyTheme);
})();
