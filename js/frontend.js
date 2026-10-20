/**
 * Backend adapter for the authored HTML frontend.
 * The HTML/CSS is the presentation contract: update existing fields and clone
 * existing repeated-row/card templates. Do not replace page/card containers.
 */
import { api, mutate, connectBackend, apiURL, observeResource, escapeHTML as esc, number as num } from './api-client.js';
import { chart, bars } from './result-charts.js';
import './common.js';
import { setupForms } from './frontend-forms.js';
import { setupAnalysis, renderAnalysis } from './frontend-analysis.js';
import { renderResults, prepareResults } from './frontend-results.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const text = (selector, value, root = document) => { const el = $(selector, root); if (el) el.textContent = value ?? '—'; };
export const pct = v => Number.isFinite(v) ? `${num(v * 100, 1)}%` : '—';
export const hours = v => Number.isFinite(v) ? `${num(v / 3600, 2)} hrs` : '—';
export const clock = v => Number.isFinite(v) ? `T+${[Math.floor(v / 3600), Math.floor(v / 60) % 60, Math.floor(v) % 60].map(n => String(n).padStart(2, '0')).join(':')}` : '—';
export const stranded = m => m ? (m.state_counts?.stranded || 0) + (m.state_counts?.awaiting_rescue || 0) : null;
const local = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
export const prefs = { theme: 'dark', mapMode: '3d', simDefaults: { speed: 1, agentCount: 'medium', monteCarloRuns: 10 }, ...local('crisissim_settings_v1', {}) };
export const page = location.pathname.split('/').pop().replace('.html', '') || 'index';
export const state = {
  scenarios: [], runs: [], active: null, run: null, snapshot: null, series: [], city: null, mesh: null, field: null,
  defaults: null, draft: null, frame: -1, generation: 0, frameRequest: 0, runStop: null, maps: [], connected: false, replay: false,
  selectedNeighborhood: 'N5', experiments: [], experiment: null, experimentStop: null, experimentGeneration: 0
};
export const active = () => state.scenarios.find(s => s.id === state.active);
export const guard = fn => async (...args) => { try { return await fn(...args); } catch (e) { showError(e.message); return null; } };
export function showError(message) {
  text('#backend-message', message); $('#backend-message')?.setAttribute('role', 'alert');
  CrisisCommon.showToast(message, 'danger');
}
export function note(message) { text('#backend-message', message); $('#backend-message')?.setAttribute('role', 'status'); }
export function savePreferences(change = {}) {
  Object.assign(prefs, change); localStorage.setItem('crisissim_settings_v1', JSON.stringify(prefs));
  for (const [key, cls] of [['highContrast', 'high-contrast'], ['largerLabels', 'larger-labels'], ['reducedMotion', 'reduced-motion'], ['colorblindMode', 'colorblind-mode']])
    document.documentElement.classList.toggle(cls, !!prefs[key]);
  document.documentElement.classList.toggle('theme-light', prefs.theme === 'light');
  document.documentElement.classList.toggle('theme-dark', prefs.theme !== 'light');
}
// The original shell remains responsible for its own markup.
window.CrisisState = {
  getSettings: () => prefs, updateSettings: savePreferences, toggleTheme: () => { savePreferences({ theme: prefs.theme === 'light' ? 'dark' : 'light' }); return prefs.theme; },
  getScenarios: () => state.scenarios.map(s => ({ id: s.id, name: s.config.name, hazardType: 'Flood', severity: 'Configured', budget: s.config.policy.budget / 1e6 })),
  getActiveScenario: () => ({ name: active()?.config.name || 'Select a scenario', id: state.active }),
  setActiveScenario: id => selectScenario(id),
  simulation: { getState: () => ({ currentTimeHours: (state.snapshot?.time_s || 0) / 3600, isRunning: state.run?.status === 'running' }), subscribe: () => () => { } }
};
export function button(label, fn, parent, primary = false) {
  const b = document.createElement('button'); b.type = 'button'; b.className = `btn btn-${primary ? 'primary' : 'secondary'} btn-sm`;
  b.textContent = label; b.addEventListener('click', guard(fn)); parent?.append(b); return b;
}
export function rows(body, values) {
  if (!body) return;
  // Keep authored cell classes/styles for repeated records.
  if (!body._rowTemplate) body._rowTemplate = body.querySelector('tr')?.cloneNode(true);
  const template = body._rowTemplate;
  body.replaceChildren();
  for (const valuesRow of values) {
    const row = template?.cloneNode(true) || document.createElement('tr');
    while (row.children.length > valuesRow.length) row.lastElementChild.remove();
    valuesRow.forEach((value, i) => {
      let td = row.children[i]; if (!td) { td = document.createElement('td'); row.append(td); }
      td.replaceChildren(value instanceof Node ? value : document.createTextNode(String(value ?? '—')));
    });
    body.append(row);
  }
  if (!values.length) {
    const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = body.closest('table')?.querySelectorAll('th').length || 1;
    cell.textContent = 'No computed records yet.';
  }
}
export function populateSelect(select, records, value, label) {
  if (!select) return;
  select.replaceChildren(new Option('Select…', ''), ...records.map(r => new Option(label(r), r.id)));
  select.value = value || '';
}
function setupShell() {
  CrisisCommon.initShell(({ index: 'dashboard', 'new-scenario': 'scenarios', 'equity-analysis': 'equity', 'system-dynamics': 'dynamics' })[page] || page);
  const line = document.createElement('p'); line.id = 'backend-message'; line.className = 'page-subtitle'; line.setAttribute('role', 'status');
  line.textContent = 'Connecting to the simulation service…';
  ($('.page-header') || $('main > div:first-child'))?.after(line);
  // Reuse the existing scenario modal. Async selection is committed only after
  // the backend record is available; never interpolate a user name as HTML.
  CrisisCommon.selectScenario = guard(async id => { await selectScenario(id); $('#scenario-modal')?.remove(); });
  let actions = $('.page-actions') || $('.page-header');
  if (page === 'command-center') {
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Run history and backend controls'; details.append(summary);
    actions = document.createElement('div'); actions.id = 'backend-run-controls';
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:8px 0'; details.append(actions); line.after(details);
  }
  if (!['settings', 'new-scenario', 'scenarios', 'methodology'].includes(page)) {
    const select = document.createElement('select'); select.id = 'computed-run-select'; select.className = 'form-control';
    select.setAttribute('aria-label', 'Saved simulation run'); select.style.maxWidth = '240px';
    select.addEventListener('change', guard(e => selectRun(e.target.value))); actions?.append(select);
  }
  if (page !== 'command-center') button('Select scenario', () => CrisisCommon.openScenarioModal(), actions);
}
export async function refreshLibrary() {
  [state.scenarios, state.runs] = await Promise.all([api('/scenarios'), api('/runs')]);
  $$('.badge-count').forEach(e => e.textContent = state.scenarios.length);
  populateSelect($('#computed-run-select'), state.runs, state.run?.id, r => `${r.config.name} · ${r.status}`);
  populateSelect($('#report-scenario-select'), state.scenarios, state.active, s => s.config.name);
  renderLibrary();
}
export async function selectScenario(id) {
  if (!state.scenarios.some(s => s.id === id)) throw Error('That scenario is no longer available.');
  state.active = id; state.draft = structuredClone(active().config);
  localStorage.setItem('crisissim_scenario_id', id); localStorage.setItem('crisissim_active_scenario_id', id);
  state.experimentStop?.(); state.experimentGeneration++; state.experiment = null;
  await selectRun(state.runs.find(r => r.scenario_id === id)?.id || '');
  renderAnalysis(); syncControls();
}
export async function selectRun(id) {
  state.runStop?.(); clearInterval(state.playback); state.playback = null;
  const generation = ++state.generation; state.frameRequest++;
  disposeMaps(); Object.assign(state, { run: null, snapshot: null, mesh: null, field: null, series: [], frame: -1, replay: false });
  state.city = state.referenceCity; renderResults(); syncControls();
  localStorage.setItem('crisissim_run_id', id);
  if (!id) { await mountMaps(); return; }
  const run = await api(`/runs/${id}`); if (generation !== state.generation) return;
  state.run = run;
  if (state.scenarios.some(s => s.id === run.scenario_id)) { state.active = run.scenario_id; localStorage.setItem('crisissim_scenario_id', state.active); }
  state.draft = structuredClone(run.config); syncControls(true);
  populateSelect($('#computed-run-select'), state.runs, id, r => `${r.config.name} · ${r.status}`);
  state.runStop = observeResource('runs', id, async next => {
    if (generation !== state.generation) return;
    if (next.attempt !== state.run?.attempt) { state.frame = -1; state.city = null; state.mesh = null; disposeMaps(); }
    state.run = next; state.runs = state.runs.map(r => r.id === id ? next : r); syncControls();
    if (next.error) showError(next.error);
    if (!state.replay && next.sequence >= 0 && next.sequence !== state.frame) await loadFrame(next.sequence);
    if (next.sequence < 0) note(`${next.config.name}: ${next.status}. Waiting for the first computed snapshot.`);
    renderLibrary();
  }, status => { if (state.run?.id === id) text('#backend-connection', status); });
}
export async function loadFrame(sequence) {
  const id = state.run?.id, generation = state.generation, request = ++state.frameRequest; if (!id || sequence < 0) return;
  const artifact = name => api(`/runs/${id}/artifacts/${name}.json`);
  const [snapshot, field, series, city, mesh] = await Promise.all([
    artifact(`snapshot-${sequence}`), artifact(`field-${sequence}`), artifact('metrics'),
    state.mesh ? state.city : artifact('city'), state.mesh || artifact('mesh')]);
  if (generation !== state.generation || request !== state.frameRequest) return;
  Object.assign(state, { snapshot, field, city, mesh, series: series.filter(m => m.time_s <= snapshot.time_s), frame: sequence });
  if (!state.maps.length) await mountMaps();
  state.maps.forEach(m => m.update(snapshot, field)); renderResults(); syncControls();
  note(`${state.run.config.name} · ${state.run.status} · ${clock(snapshot.time_s)}${state.replay ? ' · saved-frame replay' : ''} · ${num(snapshot.metrics.population)} simulated residents. Synthetic, uncalibrated model.`);
}
function disposeMaps() { state.maps.forEach(m => m.dispose()); state.maps = []; state.mapGeneration = (state.mapGeneration || 0) + 1; }
export async function mountMaps() {
  const generation = state.mapGeneration;
  const hosts = ['dashboard-map-container', 'command-center-map-wrapper', 'city-model-map-wrapper', 'equity-map-wrapper'].map(id => document.getElementById(id)).filter(Boolean);
  if (!hosts.length) return;
  const { mountOriginalMap } = await import('./frontend-map.js');
  if (generation !== state.mapGeneration) return;
  for (const host of hosts) {
    if (generation !== state.mapGeneration) return;
    const map = await mountOriginalMap(host, state, prefs, guard(id => { state.selectedNeighborhood = id; renderResults(); }));
    if (generation !== state.mapGeneration) { map.dispose(); return; } state.maps.push(map);
  }
}
export async function changeMap(mode) { savePreferences({ mapMode: mode }); disposeMaps(); await mountMaps(); }
export async function startRun(config = state.draft || active()?.config) {
  if (!config) throw Error('Create or select a scenario first.');
  if (state.starting) return;
  state.starting = true; syncControls();
  try {
    const run = await mutate('/runs', { config, scenario_id: state.active, request_id: crypto.randomUUID() });
    state.runs.unshift(run); await selectRun(run.id); return run;
  } finally { state.starting = false; syncControls(); }
}
export async function command(action) {
  if (!state.run) throw Error('No run selected.');
  await mutate(`/runs/${state.run.id}/commands`, { action, request_id: crypto.randomUUID() });
  note(`${action} requested; takes effect at the next output checkpoint.`);
}
function syncControls(setInputs = false) {
  const r = state.run, m = state.snapshot?.metrics, c = state.draft || active()?.config;
  text('#header-scenario-name', active()?.config.name || r?.config.name || 'Select a scenario');
  text('#cc-scenario-tag', r?.config.name || active()?.config.name || 'No scenario selected');
  text('#header-clock-val', clock(state.snapshot?.time_s || 0));
  text('#sim-time-display', clock(state.snapshot?.time_s || 0));
  const badge = $('#header-status-badge'); if (badge) text('span:last-child', r?.status || 'Ready', badge);
  text('#play-text', r?.status === 'running' ? 'Pause' : r?.status === 'paused' ? 'Resume' : state.playback ? 'Pause replay' : r?.status === 'completed' ? 'Replay' : 'Start');
  const play = $('#btn-sim-play'); if (play) play.disabled = !!state.starting || r?.status === 'queued' || !state.connected;
  const scrub = $('#sim-time-scrubber');
  if (scrub) { scrub.min = 0; scrub.max = Math.max(0, r?.sequence ?? 0); scrub.step = 1; scrub.value = Math.max(0, state.frame); scrub.disabled = !m; }
  if (!c) return;
  if (setInputs || !state.controlsSet) {
    state.controlsSet = true;
    const bindings = {
      rainfall: [c.flood.rainfall_mm_h, 0, 300, 1, ' mm/hr'],
      warning: [c.behavior.warning_mean_delay_s, 1, 3600, 1, ' seconds'], budget: [c.policy.budget, 0, 10000000, 1000, ' units']
    };
    for (const [key, [value, min, max, step, unit]] of Object.entries(bindings)) {
      const display = $(`#ctrl-${key}-val`), input = display?.closest('.slider-container')?.querySelector('input');
      if (input) { Object.assign(input, { value, min, max, step }); text(`#ctrl-${key}-val`, `${num(value)}${unit}`); }
    }
    const ids = {
      'pol-temp-shelters': c.policy.temporary_shelters, 'pol-rescue-boats': c.policy.rescue_boats > 0,
      'pol-ambulances': c.policy.ambulances > 0, 'pol-road-closures': true, 'pol-equity': c.policy.prioritize_vulnerable
    };
    for (const [id, value] of Object.entries(ids)) if ($('#' + id)) $('#' + id).checked = value;
  }
}
function scenarioStatusBadge(status) {
  const normalized = (status || 'ready').toLowerCase();
  const badge = document.createElement('span');
  const tone = { completed: 'badge-success', running: 'badge-info', queued: 'badge-info', paused: 'badge-neutral', failed: 'badge-danger', ready: 'badge-neutral', draft: 'badge-neutral' }[normalized] || 'badge-neutral';
  badge.className = `badge ${tone}`;
  badge.textContent = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return badge;
}
function renderLibrary() {
  const tbody = $('#scenarios-table-body'); if (!tbody) return;
  const q = $('#scenario-search')?.value.toLowerCase() || '', filter = $('#filter-status')?.value || 'all', hazard = $('#filter-hazard')?.value || 'all';
  const list = state.scenarios.filter(s => {
    const r = state.runs.find(r => r.scenario_id === s.id), status = (r?.status || 'ready').toLowerCase();
    const haystack = `${s.config.name} ${s.config.flood.rainfall_mm_h} ${s.config.policy?.template || ''}`.toLowerCase();
    return haystack.includes(q) && (filter === 'all' || filter.toLowerCase() === status) && (hazard === 'all' || hazard === 'Flood');
  });
  text('#stat-total', state.scenarios.length);
  text('#stat-running', state.runs.filter(r => ['running', 'queued', 'paused'].includes(r.status)).length);
  text('#stat-completed', state.runs.filter(r => r.status === 'completed').length);
  const completed = state.runs.filter(r => r.status === 'completed' && r.metrics?.equity_gap != null);
  text('#stat-equity', completed.length ? num(completed.reduce((s, r) => s + r.metrics.equity_gap, 0) / completed.length) : '—');
  text('#scenario-count-badge', `${list.length} shown`);
  const empty = $('#scenarios-empty'); if (empty) empty.style.display = list.length ? 'none' : 'block';
  tbody.replaceChildren();
  for (const s of list) {
    const r = state.runs.find(r => r.scenario_id === s.id), m = r?.metrics;
    const row = document.createElement('tr');
    if (s.id === state.active) row.classList.add('highlight-row');
    const nameCell = document.createElement('td');
    const title = document.createElement('div'); title.style.fontWeight = '600'; title.style.color = 'var(--text-primary)'; title.textContent = s.config.name;
    const meta = document.createElement('div'); meta.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px';
    meta.textContent = `${num(s.config.population)} residents · ${s.config.policy?.template || 'Custom policy'}`;
    nameCell.append(title, meta);
    const hazardCell = document.createElement('td');
    hazardCell.innerHTML = '<span class="badge badge-info">Flood</span>';
    const sev = document.createElement('div'); sev.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px';
    sev.textContent = `${num(s.config.flood.rainfall_mm_h)} mm/h rainfall`;
    hazardCell.append(sev);
    const params = document.createElement('td');
    params.style.fontSize = '11.5px'; params.style.lineHeight = '1.45';
    params.innerHTML = `Warning ${num(s.config.behavior.warning_mean_delay_s)}s<br>Budget ${num(s.config.policy.budget)}`;
    const evac = document.createElement('td'); evac.className = 'tabular-nums';
    evac.textContent = m ? `${num(m.safely_evacuated)} (${pct(m.completion_fraction)})` : '—';
    const strandedCell = document.createElement('td'); strandedCell.className = 'tabular-nums'; strandedCell.textContent = num(stranded(m));
    const equity = document.createElement('td'); equity.className = 'tabular-nums';
    equity.textContent = m?.equity_gap != null ? num(m.equity_gap) : '—';
    const statusCell = document.createElement('td'); statusCell.append(scenarioStatusBadge(r?.status || 'ready'));
    const lastRun = document.createElement('td'); lastRun.style.fontSize = '11.5px';
    lastRun.textContent = r ? new Date(r.created).toLocaleString() : 'Not run';
    const actions = document.createElement('td'); actions.style.textAlign = 'right';
    const toolbar = document.createElement('div'); toolbar.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap';
    button('Open', async () => { await selectScenario(s.id); location.href = `command-center.html?id=${s.id}`; }, toolbar);
    button('Duplicate', async () => { await mutate(`/scenarios/${s.id}/duplicate`, {}); await refreshLibrary(); }, toolbar);
    button('Rename', async () => {
      const name = prompt('Scenario name:', s.config.name); if (!name?.trim()) return;
      await mutate(`/scenarios/${s.id}`, { config: { ...s.config, name: name.trim() }, revision: s.revision }, 'PATCH'); await refreshLibrary();
    }, toolbar);
    button('Delete', async () => {
      if (!confirm(`Archive "${s.config.name}"? Saved runs remain available.`)) return;
      await mutate(`/scenarios/${s.id}`, {}, 'DELETE'); await refreshLibrary();
      if (state.active === s.id) { state.active = null; await selectRun(''); }
    }, toolbar);
    actions.append(toolbar);
    row.append(nameCell, hazardCell, params, evac, strandedCell, equity, statusCell, lastRun, actions);
    tbody.append(row);
  }
  if (!list.length && !tbody.children.length) {
    const row = tbody.insertRow(), cell = row.insertCell();
    cell.colSpan = 9; cell.style.padding = '28px 16px'; cell.style.textAlign = 'center'; cell.style.color = 'var(--text-muted)';
    cell.textContent = 'No scenarios match your filters.';
  }
}
function setupCommand() {
  Object.assign(window, {
    toggleSimPlay: guard(async () => {
      if (state.run?.status === 'running') return command('pause');
      if (state.run?.status === 'paused') return command('resume');
      if (state.run?.status === 'completed') {
        if (state.playback) { clearInterval(state.playback); state.playback = null; syncControls(); return; }
        state.replay = true; await loadFrame(0);
        let busy = false;
        state.playback = setInterval(guard(async () => {
          if (busy) return;
          if (state.frame >= state.run.sequence) { clearInterval(state.playback); state.playback = null; syncControls(); return; }
          busy = true; try { await loadFrame(Math.min(state.run.sequence, state.frame + (state.speed || 1))); } finally { busy = false; }
        }), 500); syncControls(); return;
      }
      await startRun();
    }),
    resetSim: guard(async () => {
      clearInterval(state.playback); state.playback = null;
      if (state.run?.sequence >= 0) { state.replay = true; await loadFrame(0); }
    }),
    scrubSimTime: guard(async value => { state.replay = true; await loadFrame(Number(value)); }),
    setSimSpeed: speed => { state.speed = speed;[1, 5, 20].forEach(s => $('#spd-' + s)?.classList.toggle('active', s === speed)); note('Speed controls saved-frame replay; solver timesteps are unchanged.'); },
    onHazardParamChange: (key, value) => {
      const c = state.draft; if (!c) return;
      const n = Number(String(value).replace(/[$M]/g, ''));
      if (key === 'rainfall') c.flood.rainfall_mm_h = n;
      if (key === 'warning') c.behavior.warning_mean_delay_s = n;
      if (key === 'budget') c.policy.budget = n;
      state.controlsSet = false; syncControls(); note('Configuration changed for the next run. Current results are unchanged.');
    },
    handlePolicyToggle: key => {
      const p = state.draft?.policy; if (!p) return;
      if (key === 'temporaryShelters') p.temporary_shelters = !p.temporary_shelters;
      if (key === 'prioritizeVulnerable') p.prioritize_vulnerable = !p.prioritize_vulnerable;
      if (key === 'rescueBoats') p.rescue_boats = p.rescue_boats ? 0 : 1;
      if (key === 'ambulances') p.ambulances = p.ambulances ? 0 : 2;
      state.controlsSet = false; syncControls(); note('Policy edited for the next run. Use New run to calculate its effects.');
    }
  });
  if (page !== 'command-center') return;
  const actions = $('#backend-run-controls') || $('.page-actions') || $('.page-header');
  button('New run', () => startRun(), actions);
  button('Cancel run', () => command('cancel'), actions);
  button('Retry run', () => command('retry'), actions);
  button('Latest frame', async () => { state.replay = false; if (state.run?.sequence >= 0) await loadFrame(state.run.sequence); }, actions);
  button('Checkpoint', async () => {
    if (state.frame < 0) throw Error('Select a computed frame first.');
    await mutate(`/runs/${state.run.id}/checkpoint/${state.frame}`, {}); note('Checkpoint recipe saved.');
  }, actions);
  button('Branch priority', async () => {
    if (state.frame < 0) throw Error('Select a computed frame first.');
    const run = await mutate(`/runs/${state.run.id}/branch`, { sequence: state.frame, prioritize_vulnerable: !!state.draft.policy.prioritize_vulnerable });
    state.runs.unshift(run); await selectRun(run.id);
  }, actions);
  const closure = $('#pol-road-closures'); if (closure) { closure.disabled = true; closure.closest('.policy-toggle-row').removeAttribute('onclick'); closure.closest('.policy-toggle-row').title = 'Road closures are calculated from flood thresholds and cannot be disabled.'; }
  text('#ctrl-warning-val', '—');
  const warning = $('#ctrl-warning-val')?.previousElementSibling; if (warning) warning.textContent = 'Mean warning delay';
  for (const key of ['warning', 'budget']) {
    const group = $(`#ctrl-${key}-val`)?.closest('.slider-container'); const ticks = group?.lastElementChild;
    if (ticks?.tagName === 'DIV') ticks.textContent = key === 'warning' ? '1–3,600 seconds after warning start' : '0–10,000,000 model cost units';
  }
}
export function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function init() {
  savePreferences(); setupShell(); prepareResults(); setupCommand(); setupForms(); setupAnalysis(); renderResults();
  Object.assign(window, {
    filterScenarios: renderLibrary, exportEquityReport: () => window.print(), exportReport: () => window.print(),
    onReportScenarioChange: guard(selectScenario),
    loadNeighborhoodDetail: id => { state.selectedNeighborhood = id; renderResults(); },
    switchModelLayer: layer => {
      $$('#city-model-map-wrapper').forEach(() => state.maps.forEach(map => map.setPerspective?.(layer)));
      $$('[id^="btn-layer-"]').forEach(b => b.classList.toggle('active', b.id === `btn-layer-${layer}`));
      text('#layer-caption', ({ pop: 'Sampled resident positions', vuln: 'Neighborhood evacuation outcomes', elev: 'Synthetic ground elevation', flood: 'Computed water depth', shelter: 'Shelter locations', hospital: 'Hospital locations', road: 'Computed road closures' })[layer]);
    }
  });
  window.addEventListener('crisissim-map-mode-change', guard(e => changeMap(e.detail.mode)));
  await connectBackend(); state.connected = true;
  const model = await api('/model'); state.defaults = model.defaults; state.referenceCity = model.city; state.city = model.city;
  await refreshLibrary();
  state.active = new URLSearchParams(location.search).get('id') || localStorage.getItem('crisissim_scenario_id');
  if (!active()) state.active = state.scenarios[0]?.id || null;
  state.draft = structuredClone(active()?.config || state.defaults);
  window.dispatchEvent(new Event('backend-ready'));
  const saved = localStorage.getItem('crisissim_run_id');
  const explicit = new URLSearchParams(location.search).get('id');
  const run = state.runs.find(r => r.id === saved && (!explicit || r.scenario_id === explicit)) || state.runs.find(r => r.scenario_id === state.active);
  if (!['settings', 'new-scenario', 'scenarios', 'methodology', 'policy-lab', 'uncertainty'].includes(page)) await selectRun(run?.id || '');
  else { syncControls(true); renderResults(); }
  if (['policy-lab', 'uncertainty', 'reports'].includes(page)) {
    state.experiments = await api('/experiments'); window.dispatchEvent(new Event('experiments-ready'));
  }
  if (!state.run) note(state.active ? 'Scenario loaded. Start a run in Command Center to calculate results.' : 'Connected. Create a scenario to calculate results.');
  window.CrisisBackend = { state, selectRun, selectScenario, startRun }; // inspectable source of displayed values
}
window.addEventListener('pagehide', () => { state.runStop?.(); state.experimentStop?.(); clearInterval(state.playback); disposeMaps(); });
init().catch(error => { state.connected = false; showError(`Backend unavailable: ${error.message}. Start the service and reload this page.`); });
