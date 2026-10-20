import {api, mutate, connectBackend, apiURL, backendURL, observeResource, escapeHTML as esc, number as num} from './api-client.js';
import './common.js';

const page = location.pathname.split('/').pop().replace('.html', '') || 'index';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const preferences = readLocal('crisissim_settings_v1', {});
const state = {scenarios: [], runs: [], run: null, snapshot: null, city: null, mesh: null, series: [],
  field: null, maps: [], runStop: null, experimentStop: null, experiment: null, generation: 0, frameRequest: 0,
  replay: false, frame: -1, connected: false, saving: false, editing: null, experimentGeneration: 0};
const runPage = ['index','command-center','city-model','equity-analysis','system-dynamics','reports'].includes(page);
const experimentPage = ['policy-lab','uncertainty'].includes(page);
const clock = seconds => {
  if (!Number.isFinite(seconds)) return '—';
  return [Math.floor(seconds/3600), Math.floor(seconds/60)%60, Math.floor(seconds)%60].map(v=>String(v).padStart(2,'0')).join(':');
};
const percent = v => Number.isFinite(v) ? `${num(v*100,1)}%` : '—';
const minutes = v => Number.isFinite(v) ? `${num(v/60,1)} min` : '—';
const btn = (action, text, extra='') => `<button type="button" class="btn btn-secondary btn-sm" data-action="${action}" ${extra}>${text}</button>`;
const table = (headers, rows) => `<div class="table-responsive"><table class="ops-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No computed records yet.</td></tr>`}</tbody></table></div>`;
const put = (name, html) => $$(`[data-view="${name}"]`).forEach(el=>{el.innerHTML=html;});
const pairs = rows => `<dl class="bound-pairs">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const message = text => { $('#app-message').textContent=text; };
const error = text => { $('#app-error').textContent=text; $('#app-error').hidden=!text; };
const connection = text => { if ($('#connection-state')) $('#connection-state').textContent=text; };
const selectedScenario = () => state.scenarios.find(s=>s.id===$('#scenario-select')?.value);
const clearMaps = () => { state.maps.forEach(map=>map.dispose()); state.maps=[]; };
function applyAppearance() {
  document.documentElement.classList.toggle('theme-light', preferences.theme==='light');
  document.documentElement.classList.toggle('reduced-motion', !!preferences.reducedMotion);
  document.documentElement.classList.toggle('high-contrast', !!preferences.highContrast);
}
function savePreferences() { localStorage.setItem('crisissim_settings_v1',JSON.stringify(preferences)); applyAppearance(); }
function shell() {
  CrisisCommon.renderSidebar(({index:'dashboard','equity-analysis':'equity','system-dynamics':'dynamics'})[page]||page);
  $('#app-header').innerHTML=`<div class="header-left bound-toolbar">
    <label>Scenario<select id="scenario-select" class="form-control"><option value="">Loading scenarios…</option></select></label>
    ${runPage ? '<label>Run<select id="run-select" class="form-control"><option value="">No run selected</option></select></label>' : ''}
    </div><div class="header-right"><span id="connection-state" role="status">Connecting…</span>${btn('theme','Change theme')}${btn('reconnect','Retry connection')}</div>`;
  const skip=document.createElement('a');skip.href='#app-content';skip.className='bound-skip';skip.textContent='Skip to content';document.body.prepend(skip);
  $('#app-content').tabIndex=-1;
  $('#scenario-select').addEventListener('change',async()=>{
    localStorage.setItem('crisissim_scenario_id',$('#scenario-select').value);
    if(runPage) await selectRun('');
    if(experimentPage) { state.experimentStop?.();state.experiment=null;state.experimentGeneration++;resetExperiment(); }
  });
  $('#run-select')?.addEventListener('change',e=>selectRun(e.target.value).catch(e=>error(e.message)));
}
function selectors() {
  const scenario=$('#scenario-select');
  const selected=localStorage.getItem('crisissim_scenario_id');
  scenario.innerHTML='<option value="">Choose a scenario</option>'+state.scenarios.map(s=>`<option value="${s.id}">${esc(s.config.name)}</option>`).join('');
  scenario.value=state.scenarios.some(s=>s.id===selected)?selected:(state.scenarios[0]?.id||'');
  const run=$('#run-select');
  if(run) { run.innerHTML='<option value="">No run selected</option>'+state.runs.map(r=>`<option value="${r.id}">${esc(r.config.name)} · ${esc(r.status)} · ${esc(new Date(r.created).toLocaleString())}</option>`).join('');run.value=state.run?.id||''; }
  $$('.badge-count').forEach(el=>el.textContent=state.scenarios.length);
}
async function refreshLibrary() { [state.scenarios,state.runs]=await Promise.all([api('/scenarios'),api('/runs')]);selectors();renderLibrary(); }
function renderLibrary() {
  const query=$('#scenario-search')?.value.toLowerCase()||'';
  const rows=state.scenarios.filter(s=>`${s.config.name} ${s.config.flood.rainfall_mm_h}`.toLowerCase().includes(query)).map(s=>{
    const r=state.runs.find(r=>r.scenario_id===s.id),m=r?.metrics;
    return [esc(s.config.name),`${num(s.config.population)} residents · ${num(s.config.flood.rainfall_mm_h)} mm/h`,
      clock(s.config.flood.duration_s),m?`${num(m.safely_evacuated)} / ${num(m.population)}`:'—',esc(r?.status||'Not run'),
      `<div class="bound-toolbar">${btn('scenario-run','Run',`data-id="${s.id}"`)}<a class="btn btn-secondary btn-sm" href="new-scenario.html?edit=${s.id}">Edit / rename</a>${btn('duplicate','Duplicate',`data-id="${s.id}"`)}${btn('archive','Archive',`data-id="${s.id}"`)}</div>`];
  });
  put('scenarios',table(['Name','Configuration','Duration','Latest safely evacuated','Status','Actions'],rows));
  put('recent',table(['Scenario','Latest status','Action'],state.scenarios.slice(0,4).map(s=>[
    esc(s.config.name),esc(state.runs.find(r=>r.scenario_id===s.id)?.status||'Not run'),btn('scenario-run','Run',`data-id="${s.id}"`)])));
}
function controls() {
  const r=state.run, ready=state.frame>=0;
  const enabled={run:!!selectedScenario(),pause:r?.status==='running',resume:r?.status==='paused',
    cancel:['running','paused','queued'].includes(r?.status),retry:['failed','interrupted'].includes(r?.status),
    branch:ready,checkpoint:ready,latest:ready,csv:ready,json:ready,print:ready};
  for(const [action,value] of Object.entries(enabled)) $$(`[data-action="${action}"]`).forEach(el=>el.disabled=!value||!state.connected);
  if($('#run-status')) $('#run-status').textContent=r?.status||'No run';
  const option=$('#run-select')?.querySelector(`option[value="${r?.id}"]`);
  if(option&&r)option.textContent=`${r.config.name} · ${r.status} · ${new Date(r.created).toLocaleString()}`;
  if($('#run-clock')) $('#run-clock').textContent=clock(state.snapshot?.time_s??r?.time_s??0);
  const slider=$('#replay');
  if(slider) {slider.disabled=!ready;slider.max=Math.max(0,r?.sequence??0);slider.value=Math.max(0,state.frame);}
  put('run-name',esc(r?.config.name||selectedScenario()?.config.name||'No run selected'));
}
function setupRunContext() {
  if(!$('#run-context'))return;
  $('#run-context').innerHTML=`<div class="bound-toolbar"><span id="run-status" class="badge badge-info">No run</span><output id="run-clock">00:00:00</output>
    <label>Saved frame<input id="replay" type="range" min="0" max="0" step="1" value="0" disabled></label>
    ${btn('latest','Return to latest')}${btn('checkpoint','Save checkpoint')}</div>
    <p class="bound-note">Synthetic, uncalibrated city · calculated outcomes · educational use only. Not an official emergency forecast or dispatch system.</p>`;
  $('#replay').addEventListener('change',async e=>{
    state.replay=true;try{await loadFrame(Number(e.target.value));message('Replay: displaying the selected saved frame.');}catch(e){error(e.message);}
  });
}
async function selectRun(id) {
  state.runStop?.();state.runStop=null;clearMaps();
  const generation=++state.generation;state.frameRequest++;
  state.run=null;state.snapshot=null;state.city=null;state.mesh=null;state.field=null;state.series=[];state.frame=-1;state.replay=false;
  localStorage.setItem('crisissim_run_id',id);resetRunViews();controls();
  if(!id){if($('#run-select'))$('#run-select').value='';return;}
  const record=await api(`/runs/${id}`);
  if(generation!==state.generation)return;
  state.run=record;
  if(record.scenario_id&&state.scenarios.some(s=>s.id===record.scenario_id)) {
    localStorage.setItem('crisissim_scenario_id',record.scenario_id);
  }
  selectors();controls();
  state.runStop=observeResource('runs',id,async r=>{
    if(generation!==state.generation)return;
    const attemptChanged=r.attempt!==state.run?.attempt;
    state.run=r;
    state.runs=state.runs.map(old=>old.id===id?r:old);
    if(attemptChanged){state.frame=-1;state.city=null;state.mesh=null;clearMaps();}
    controls();
    if(r.error)error(r.error);
    if(!state.replay&&r.sequence>=0&&r.sequence!==state.frame) await loadFrame(r.sequence);
  },connection);
}
function resetRunViews() {
  for(const name of ['progress','events','hazard','resources','policy','facilities','infrastructure','neighborhood','equity-summary','equity-finding','equity-bars','equity-table','states','flood-chart','road-chart','shelter-chart','hospital-chart','closures','diagnostics','report']) {
    put(name,'<p>No computed snapshot selected. Run a saved scenario or select a previous run.</p>');
  }
  $$('[data-metric]').forEach(el=>el.textContent='—');
  $$('[data-map]').forEach(host=>host.innerHTML='<p>No computed map yet. Run or select a scenario.</p>');
}
async function loadFrame(sequence) {
  if(!state.run||sequence<0)return;
  const id=state.run.id, generation=state.generation, request=++state.frameRequest;
  const artifact=name=>api(`/runs/${id}/artifacts/${name}.json`);
  const [snapshot,series,city,mesh,field]=await Promise.all([
    artifact(`snapshot-${sequence}`),artifact('metrics'),state.city||artifact('city'),
    state.mesh||artifact('mesh'),$$('[data-map]').length?artifact(`field-${sequence}`):null]);
  if(generation!==state.generation||request!==state.frameRequest)return;
  Object.assign(state,{snapshot,series,city,mesh,field,frame:sequence});
  renderSnapshot();controls();
  if(!$$('[data-map]').length)return;
  try {
    if(!state.maps.length) {
      const {LiveMap}=await import('./live-map.js');
      if(generation!==state.generation||request!==state.frameRequest)return;
      for(const host of $$('[data-map]')) {
        setupMapToolbar(host);
        const map=new LiveMap(host,city,mesh,preferences.mapMode||'3d');
        Object.assign(map.layers,preferences.layers||{});
        state.maps.push(map);
      }
    }
    state.maps.forEach(map=>map.update(snapshot,field));
  } catch(e) { error(`Map could not start: ${e.message}. Select 2D in the map toolbar or Settings.`); }
}
function setupMapToolbar(host) {
  let toolbar=host.previousElementSibling;
  if(!toolbar?.classList.contains('computed-map-controls')) {
    toolbar=document.createElement('div');toolbar.className='computed-map-controls';host.before(toolbar);
  }
  toolbar.innerHTML=`<div class="bound-toolbar"><label>View<select class="form-control" data-map-mode><option value="3d">3D</option><option value="2d">2D</option></select></label>
    ${['Reset','Top','Zoom in','Zoom out','Pan left','Pan right','Pan up','Pan down'].map(label=>`<button type="button" class="btn btn-secondary btn-sm" data-map-control="${label}">${label}</button>`).join('')}</div>
    <div class="bound-toolbar">${['flood','roads','routes','agents','facilities','resources'].map(layer=>`<label><input type="checkbox" data-layer="${layer}" ${(preferences.layers?.[layer]??true)?'checked':''}>${layer}</label>`).join('')}</div>
    <p class="bound-note">Blue: computed water · Red: closed roads / hospitals · Green: routes / shelters · Amber: resident sample · Yellow: buses. Counts include every resident. 3D elevations are exaggerated 15× for visibility.</p>`;
  toolbar.querySelector('[data-map-mode]').value=preferences.mapMode||'3d';
  toolbar.onchange=async e=>{
    if(e.target.matches('[data-map-mode]')) {
      preferences.mapMode=e.target.value;savePreferences();clearMaps();
      try{await loadFrame(state.frame);}catch(e){error(e.message);}
    } else if(e.target.dataset.layer) {
      preferences.layers={...preferences.layers,[e.target.dataset.layer]:e.target.checked};savePreferences();
      state.maps.forEach(map=>map.setLayer(e.target.dataset.layer,e.target.checked));
    }
  };
  toolbar.onclick=e=>{
    const control=e.target.closest('[data-map-control]')?.dataset.mapControl;if(!control)return;
    const map=state.maps.find(m=>m.host===host);if(!map)return;
    const methods={Reset:()=>map.reset(),Top:()=>map.top(), 'Zoom in':()=>map.zoom(.85),'Zoom out':()=>map.zoom(1.15),
      'Pan left':()=>map.pan(-3,0),'Pan right':()=>map.pan(3,0),'Pan up':()=>map.pan(0,-3),'Pan down':()=>map.pan(0,3)};
    methods[control]();
  };
  host.addEventListener('map-error',e=>error(e.detail),{once:true});
}
function lineChart(series, value, label, fixedMax=null) {
  const points=series.map(s=>[s.time_s,value(s)]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
  if(!points.length)return '<p>No recorded values for this measure. Older runs may need to be recomputed.</p>';
  const xmax=Math.max(1,...points.map(p=>p[0])), ymax=Math.max(1,fixedMax??0,...points.map(p=>p[1]));
  return `<svg class="computed-chart" viewBox="0 0 640 200" role="img" aria-label="${esc(label)}">
    <path d="M58 16V162H620" fill="none" stroke="currentColor"/>
    <polyline points="${points.map(([x,y])=>`${58+x/xmax*555},${162-y/ymax*138}`).join(' ')}" fill="none" stroke="var(--accent-flood-light)" stroke-width="2"/>
    </svg><div class="chart-scale"><span>0–${num(ymax,2)}</span><span>00:00:00–${clock(xmax)}</span></div>
    <p class="bound-note">${esc(label)} · ${points.length} recorded samples</p>`;
}
function bars(rows, label) {
  const max=Math.max(1,...rows.map(r=>r[1]).filter(Number.isFinite));
  return `<div aria-label="${esc(label)}">${rows.map(([name,value])=>`<div class="computed-bar"><span>${esc(name)}</span><div><i style="width:${Number.isFinite(value)?Math.max(0,value/max*100):0}%"></i></div><strong>${num(value,2)}</strong></div>`).join('')}</div>`;
}
function scatter(evaluations, xValue, yValue, label) {
  const points=evaluations.filter(e=>e.status==='completed').map(e=>({e,x:xValue(e.metrics),y:yValue(e.metrics)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!points.length)return '<p>No completed evaluations for this chart.</p>';
  const xmax=Math.max(1,...points.map(p=>p.x)),ymax=Math.max(1,...points.map(p=>p.y));
  return `<svg class="computed-chart" viewBox="0 0 640 210" role="img" aria-label="${esc(label)}">
    <path d="M58 16V162H620" fill="none" stroke="currentColor"/>
    ${points.map(p=>`<circle cx="${58+p.x/xmax*550}" cy="${162-p.y/ymax*138}" r="5" fill="var(--accent-safe)"><title>${esc(p.e.label)}: ${num(p.x,2)}, ${num(p.y,2)}</title></circle>`).join('')}
    </svg><div class="chart-scale"><span>X: 0–${num(xmax,2)}</span><span>Y: 0–${num(ymax,2)}</span></div><p>${esc(label)}</p>`;
}
function renderSnapshot() {
  const {snapshot:s,run:r,city}=state,m=s.metrics,c=r.config;
  const values={safe:num(m.safely_evacuated),incomplete:num(m.incomplete_count),time:minutes(m.mean_completed_evacuation_s),gap:percent(m.success_rate_gap)};
  $$('[data-metric]').forEach(el=>el.textContent=values[el.dataset.metric]??'—');
  const series=state.series.filter(row=>row.time_s<=s.time_s);
  put('progress',lineChart(series,row=>row.safely_evacuated,'Safely evacuated residents',m.population));
  put('hazard',pairs([['Rainfall',`${num(c.flood.rainfall_mm_h)} mm/hour`],['Duration',clock(c.flood.duration_s)],['Warning delay',`${num(c.behavior.warning_mean_delay_s)} seconds`],['Boundary',c.flood.boundary_mode],['Current max depth',`${num(m.max_depth_m,3)} m`]]));
  $$('[data-edit]').forEach(el=>{el.href=r.scenario_id?`new-scenario.html?edit=${r.scenario_id}`:'new-scenario.html';});
  put('resources',pairs([['Buses',c.policy.buses],['Ambulances',c.policy.ambulances],['Boats',c.policy.rescue_boats],['Budget',num(c.policy.budget)],['Actual cost',num(m.cost,2)],['Reserved cost',num(m.reserved_cost,2)]]));
  const priority=(r.policy_events||[]).filter(e=>e.time_s<s.time_s).at(-1)?.policy.prioritize_vulnerable??c.policy.prioritize_vulnerable;
  put('policy',pairs([['Temporary shelter',c.policy.temporary_shelters?'Opens at 300 seconds':'Off'],['Mobility priority',priority?'On':'Off']]));
  put('facilities',table(['Facility','Occupancy','Capacity','Queued','Admissions'],Object.entries(m.facilities).map(([id,f])=>[esc(id),num(f.occupancy),num(f.capacity),num(f.queued),f.open?'Open':'Closed'])));
  put('events',s.events.length?`<ol class="computed-events">${s.events.slice(-150).map(e=>`<li><time>${clock(e.time_s)}</time><span>${esc(e.type.replaceAll('_',' '))} ${esc(e.road_id||e.facility||e.agent||e.request||'')}</span></li>`).join('')}</ol><p>Showing ${Math.min(150,s.events.length)} of ${s.events.length} recorded events through this frame.</p>`:'<p>No operational milestones by this frame.</p>');
  const neighborhoods=city.neighborhoods.map(n=>({...n,...m.neighborhoods[n.id]}));
  put('equity-summary',pairs([['Neighborhood success gap',percent(m.success_rate_gap)],['Worst-neighborhood success',percent(m.worst_group_success)],['Finite-horizon burden Gini',num(m.finite_horizon_wait_gini,3)]]));
  const lowest=Math.min(...neighborhoods.map(n=>n.success_rate));
  put('equity-finding',`<p>${neighborhoods.filter(n=>n.success_rate===lowest).map(n=>esc(n.name)).join(', ')}: ${percent(lowest)} safely evacuated. This is an observed outcome, not a causal explanation.</p>`);
  put('equity-bars',bars(neighborhoods.map(n=>[n.name,n.success_rate*100]),'Neighborhood success (%)'));
  put('equity-table',table(['Neighborhood','Residents','Mobility-impaired','Transit-dependent','Safe','Success','Not yet safe'],
    neighborhoods.map(n=>[esc(n.name),num(n.population),num(n.mobility_impaired),num(n.transit_dependent),num(n.safe),percent(n.success_rate),num(n.population-n.safe)])));
  const selector=$('#neighborhood-select');
  if(selector&&selector.dataset.run!==r.id) {
    selector.innerHTML=neighborhoods.map(n=>`<option value="${n.id}">${esc(n.name)}</option>`).join('');selector.dataset.run=r.id;selector.onchange=renderSnapshot;
  }
  const n=neighborhoods.find(n=>n.id===selector?.value)||neighborhoods[0];
  put('neighborhood',pairs([['Name',n.name],['Residents',n.population],['Safe',n.safe],['Success',percent(n.success_rate)],['Mobility-impaired',num(n.mobility_impaired)],['Transit-dependent',num(n.transit_dependent)],['Data source','Synthetic']]));
  put('infrastructure',table(['Asset','Kind','Road node','Capacity','Data source'],city.facilities.map(f=>[esc(f.id),esc(f.kind),esc(f.node),num(f.capacity),'Synthetic assumption'])));
  put('states',table(['State','Residents'],Object.entries(m.state_counts).map(([key,v])=>[esc(key.replaceAll('_',' ')),num(v)]))+
    `<p>State total: ${num(Object.values(m.state_counts).reduce((a,b)=>a+b,0))} / ${num(m.population)} residents.</p>`);
  put('flood-chart',lineChart(series,row=>row.max_depth_m,'Maximum cell water depth (m)'));
  put('road-chart',lineChart(series,row=>row.closed_roads,'Closed undirected road segments',city.roads.length));
  for(const kind of ['shelter','hospital'])put(`${kind}-chart`,lineChart(series,row=>Object.entries(row.facilities).filter(([id])=>id.startsWith(kind)).reduce((sum,[,f])=>sum+f.occupancy,0),`${kind} occupants (people)`));
  put('closures',table(['Closed road','State'],s.roads.filter(road=>road.closed).map(road=>[esc(road.id),'Closed'])));
  put('diagnostics',pairs([['Water-balance residual (m³)',num(s.mass_residual_m3,8)],['Water volume (m³)',num(m.water_volume_m3,3)],['Mean exposure (depth-seconds)',num(m.mean_exposure_depth_seconds,3)],['Incomplete residents',num(m.incomplete_count)]]));
  put('report',`<h3>${esc(c.name)}</h3><p>Run ${esc(r.id)} · ${esc(r.status)} · frame ${s.sequence} at ${clock(s.time_s)}</p>`+
    pairs([['Simulated population',m.population],['Safely evacuated',m.safely_evacuated],['Not yet safe',m.incomplete_count],['Completed-only mean',minutes(m.mean_completed_evacuation_s)],['Neighborhood success gap',percent(m.success_rate_gap)],['Cost (synthetic units)',num(m.cost,2)]])+
    '<p>Exports contain all available recorded frames, not only the displayed replay frame. No comparison or policy approval is inferred from this run. Synthetic, uncalibrated educational results.</p><h3>Run configuration</h3>'+
    `<pre>${esc(JSON.stringify(c,null,2))}</pre>`);
}

function setupScenarioForm() {
  if(page!=='new-scenario')return;
  const id=new URLSearchParams(location.search).get('edit');
  state.editing=state.scenarios.find(s=>s.id===id)||null;
  if(id&&!state.editing)error('This scenario is unavailable. You can create a new scenario instead.');
  const c=state.editing?.config;
  if(c) {
    const values={name:c.name,population:c.population,seed:c.seed,rain:c.flood.rainfall_mm_h,duration:c.flood.duration_s,
      warning:c.behavior.warning_mean_delay_s,preparation:c.behavior.preparation_median_s,mesh:c.flood.mesh_cells_per_axis,
      boundary:c.flood.boundary_mode,stage:c.flood.initial_stage_m,boundaryStage:c.flood.boundary_stage_m,
      budget:c.policy.budget,buses:c.policy.buses,ambulances:c.policy.ambulances,boats:c.policy.rescue_boats};
    for(const [name,v] of Object.entries(values))$(`[name="${name}"]`).value=v;
    $('[name="shelters"]').checked=c.policy.temporary_shelters;$('[name="priority"]').checked=c.policy.prioritize_vulnerable;
  }
}
function scenarioConfig() {
  const v=name=>Number($(`[name="${name}"]`).value), base=state.editing?.config||{};
  return {...base,name:$('[name="name"]').value.trim(),population:v('population'),seed:v('seed'),
    flood:{...base.flood,rainfall_mm_h:v('rain'),duration_s:v('duration'),output_interval_s:30,mesh_cells_per_axis:v('mesh'),
      boundary_mode:$('[name="boundary"]').value,initial_stage_m:v('stage'),boundary_stage_m:v('boundaryStage')},
    behavior:{...base.behavior,warning_mean_delay_s:v('warning'),preparation_median_s:v('preparation')},
    policy:{...base.policy,budget:v('budget'),buses:v('buses'),ambulances:v('ambulances'),rescue_boats:v('boats'),
      temporary_shelters:$('[name="shelters"]').checked,prioritize_vulnerable:$('[name="priority"]').checked}};
}
function step(number) {
  const current=$$('.step-content').find(el=>el.style.display!=='none');
  if(current&&number>Number(current.id.split('-').at(-1))) {
    const invalid=[...current.querySelectorAll('input,select')].find(el=>!el.checkValidity());
    if(invalid){invalid.reportValidity();return;}
  }
  $$('.step-content').forEach((el,i)=>el.style.display=i===number-1?'block':'none');
  $$('.step-item').forEach((el,i)=>el.classList.toggle('active',i===number-1));
  if(number===4)put('scenario-review',`<pre>${esc(JSON.stringify(scenarioConfig(),null,2))}</pre><p>Saving validates the numerical work budget. Only flood scenarios are implemented.</p>`);
}
async function saveScenario(run=false) {
  if(state.saving)return;
  const invalid=$$('.step-content input, .step-content select').find(el=>!el.checkValidity());
  if(invalid){step(Number(invalid.closest('.step-content').id.split('-').at(-1)));invalid.reportValidity();return;}
  state.saving=true;
  try {
    const config=scenarioConfig(),old=state.editing;
    const result=old?await mutate(`/scenarios/${old.id}`,{config,revision:old.revision},'PATCH'):await mutate('/scenarios',config);
    state.editing=result;localStorage.setItem('crisissim_scenario_id',result.id);
    if(run)await startRun(result);
    else location.href='scenarios.html';
  } finally {state.saving=false;}
}
async function startRun(scenario) {
  if(!scenario)throw new Error('Choose or create a saved scenario first.');
  const run=await mutate('/runs',{config:scenario.config,scenario_id:scenario.id,request_id:crypto.randomUUID()});
  localStorage.setItem('crisissim_run_id',run.id);localStorage.setItem('crisissim_scenario_id',scenario.id);
  if(page!=='command-center')location.href='command-center.html';
  else {state.runs.unshift(run);await selectRun(run.id);}
}

function resetExperiment() {
  for(const v of ['experiment-table','experiment-summary','distribution','sensitivity','quantiles','cost-safety','equity-time',...Array.from({length:5},(_,i)=>`strategy-${i}`)])put(v,'<p>No evaluated results selected.</p>');
  put('experiment-status','<p>No experiment selected. Choose a scenario and start an evaluation.</p>');
}
async function setupExperiments() {
  if(!experimentPage)return;
  put('experiment-controls',`<div class="bound-toolbar"><label>Trials / Morris trajectories<input class="form-control" id="trial-count" type="number" min="2" max="50" value="4"></label>
    <label>Search evaluation budget<input class="form-control" id="evaluation-count" type="number" min="8" max="48" step="8" value="16"></label>
    <label>Saved experiment<select class="form-control" id="experiment-select"><option value="">No experiment selected</option></select></label>${btn('cancel-experiment','Cancel experiment')}</div>
    <p>Up to 2,000 residents and two simulated hours per trial. Morris uses up to eight trajectories; each needs three model evaluations.</p>`);
  const records=(await api('/experiments')).filter(e=>page==='policy-lab'?['comparison','optimization'].includes(e.spec.kind):['monte_carlo','sensitivity'].includes(e.spec.kind));
  const selector=$('#experiment-select');
  selector.innerHTML='<option value="">Choose an experiment</option>'+records.map(e=>`<option value="${e.id}">${esc(e.spec.config.name)} · ${esc(e.spec.kind)} · ${esc(e.status)}</option>`).join('');
  selector.onchange=()=>watchExperiment(selector.value).catch(e=>error(e.message));
  const previous=localStorage.getItem(`crisissim_experiment_${page}`);
  if(records.some(e=>e.id===previous)){selector.value=previous;await watchExperiment(previous);}
}
async function watchExperiment(id) {
  state.experimentStop?.();state.experiment=null;resetExperiment();
  const generation=++state.experimentGeneration;
  if(!id)return;
  localStorage.setItem(`crisissim_experiment_${page}`,id);
  state.experimentStop=observeResource('experiments',id,record=>{
    if(generation!==state.experimentGeneration)return;
    state.experiment=record;renderExperiment(record);
  },connection);
}
function renderExperiment(record) {
  const evals=record.evaluations||[],completed=evals.filter(e=>e.status==='completed');
  const option=$('#experiment-select')?.querySelector(`option[value="${record.id}"]`);
  if(option)option.textContent=`${record.spec.config.name} · ${record.spec.kind} · ${record.status}`;
  put('experiment-status',`<p><strong>${esc(record.spec.kind.replaceAll('_',' '))} · <span id="experiment-status">${esc(record.status)}</span></strong> — ${esc(record.spec.config.name)} · ${completed.length} completed evaluations</p>`);
  $$('[data-action="cancel-experiment"]').forEach(el=>el.disabled=!['queued','running'].includes(record.status));
  put('experiment-table',table(['Evaluation','Safe / total','Not yet safe','Mean completed time','Success gap','Cost','Status'],evals.map(e=>{
    const m=e.metrics;return [esc(e.label),m?`${num(m.safely_evacuated)} / ${num(m.population)}`:'—',num(m?.incomplete_count),minutes(m?.mean_completed_evacuation_s),percent(m?.success_rate_gap),num(m?.cost,2),esc(e.error||e.status)];
  })));
  const preferred=[completed.find(e=>e.label==='Baseline'),completed.find(e=>e.label==='Shelter-first'),completed.find(e=>e.label==='Vulnerability-prioritized'),
    completed.find(e=>e.label==='NSGA-II candidate'),completed.find(e=>e.label==='Held-out seed')];
  preferred.forEach((e,i)=>put(`strategy-${i}`,e?pairs([['Safe',`${num(e.metrics.safely_evacuated)} / ${num(e.metrics.population)}`],['Success gap',percent(e.metrics.success_rate_gap)],['Cost',num(e.metrics.cost,2)]]):'<p>Not evaluated</p>'));
  put('cost-safety',scatter(completed,m=>m.cost,m=>m.safely_evacuated,'X: synthetic cost · Y: safely evacuated residents'));
  put('equity-time',scatter(completed,m=>m.mean_completed_evacuation_s==null?null:m.mean_completed_evacuation_s/60,m=>m.success_rate_gap*100,'X: completed-only mean (minutes) · Y: neighborhood success gap (percentage points)'));
  const result=record.result;
  put('distribution',bars(completed.map((e,i)=>[`Trial ${i+1}`,e.metrics.completion_fraction*100]),'Computed safe population (%) by trial'));
  put('quantiles',result?.quantiles?table(['Quantile','Incomplete residents','Exposure (m·s)','Cost','Success gap'],result.quantiles.map((q,i)=>[percent(result.quantile_levels[i]),...q.map(v=>num(v,3))])):'<p>Outcome quantiles are available after a Monte Carlo experiment completes.</p>');
  put('sensitivity',result?.mu_star?bars(result.names.map((name,i)=>[name,result.mu_star[i]]),'Morris μ* on incomplete population')+
    table(['Input','μ*','σ'],result.names.map((name,i)=>[esc(name),num(result.mu_star[i],3),num(result.sigma[i],3)])):'<p>Run Morris screening to compute sensitivity. No ranking is inferred from Monte Carlo trials.</p>');
  let summary=record.error?`<p role="alert">${esc(record.error)}</p>`:'';
  if(result?.pareto) {
    summary+='<p>Approximate non-dominated candidates. There is no universally best strategy. Held-out evaluations are reported separately.</p>'+
      table(['Temporary shelter','Buses','Ambulances','Priority','Incomplete','Exposure','Cost','Success gap'],
        result.pareto.map(p=>[p.variables[0]?'On':'Off',num(p.variables[1]),num(p.variables[2]),p.variables[3]?'On':'Off',...p.objectives.map(v=>num(v,3))]));
  }
  if(result?.quantiles)summary+=`<p>Empirical 5th/50th/95th percentile outcomes, not real-world confidence intervals. All-residents-safe frequency: ${percent(result.completion_probability)}.</p>`;
  if(record.spec.kind==='comparison')summary+='<p>Baseline: both interventions off. Shelter-first: shelter on, priority off. Mobility-prioritized: shelter off, priority on. All other inputs and seeds match.</p>';
  summary+=`<p>Failures are shown, not discarded. ${record.failed_trials||0} failed evaluations. Synthetic assumptions; no calibrated forecast or policy approval.</p>`;
  put('experiment-summary',summary);
}
async function startExperiment(kind) {
  const scenario=selectedScenario();if(!scenario)throw new Error('Choose a saved scenario first.');
  for(const el of [$('#trial-count'),$('#evaluation-count')])if(!el.checkValidity()){el.reportValidity();return;}
  const record=await mutate('/experiments',{kind,config:scenario.config,trials:Number($('#trial-count').value),evaluations:Number($('#evaluation-count').value)});
  const option=document.createElement('option');option.value=record.id;option.textContent=`${scenario.config.name} · ${kind} · queued`;
  $('#experiment-select').prepend(option);$('#experiment-select').value=record.id;await watchExperiment(record.id);
}
function settings() {
  if(page!=='settings')return;
  for(const key of ['theme','mapMode'])$(`[name="${key}"]`).value=preferences[key]||(key==='theme'?'dark':'3d');
  for(const key of ['highContrast','reducedMotion'])$(`[name="${key}"]`).checked=!!preferences[key];
  $$('[name^="layer-"]').forEach(el=>el.checked=preferences.layers?.[el.name.slice(6)]??true);
  $('#import-scenarios').onchange=async e=>{
    try {
      const file=e.target.files[0];if(!file)return;
      if(file.size>500000)throw new Error('Import must be smaller than 500 KB.');
      const configs=JSON.parse(await file.text());
      if(!Array.isArray(configs)||!configs.length||configs.length>50)throw new Error('Import an array of 1–50 scenario configurations.');
      await mutate('/scenarios/import',{configs});await refreshLibrary();message(`Imported ${configs.length} scenarios.`);
    }catch(e){error(e.message);}finally{$('#import-scenarios').value='';}
  };
}
async function download(path, filename) {
  const response=await fetch(apiURL(path),{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Export failed (${response.status}). Try again after results are available.`);
  saveBlob(await response.blob(),filename);
}
function saveBlob(blob,filename) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function action(name,el) {
  if(name.startsWith('step-'))return step(Number(name.slice(5)));
  if(name==='theme'){preferences.theme=preferences.theme==='light'?'dark':'light';savePreferences();settings();return;}
  if(name==='reconnect')return init();
  if(name==='save-settings'){
    for(const key of ['theme','mapMode'])preferences[key]=$(`[name="${key}"]`).value;
    for(const key of ['highContrast','reducedMotion'])preferences[key]=$(`[name="${key}"]`).checked;
    preferences.layers=Object.fromEntries($$('[name^="layer-"]').map(el=>[el.name.slice(6),el.checked]));
    savePreferences();message('Preferences saved for every map.');return;
  }
  if(name==='reset-settings'){Object.keys(preferences).forEach(k=>delete preferences[k]);savePreferences();settings();message('Appearance reset. Scenarios and results were not changed.');return;}
  if(!state.connected)throw new Error('Connect to the backend before running this action.');
  if(name==='save-scenario'||name==='save-run')return saveScenario(name==='save-run');
  if(name==='run'||name==='scenario-run')return startRun(name==='run'?selectedScenario():state.scenarios.find(s=>s.id===el.dataset.id));
  if(name==='duplicate'){await mutate(`/scenarios/${el.dataset.id}/duplicate`);return refreshLibrary();}
  if(name==='archive'){if(!confirm('Archive this scenario? Existing run results will be kept.'))return;await api(`/scenarios/${el.dataset.id}`,{method:'DELETE'});return refreshLibrary();}
  if(['pause','resume','cancel','retry'].includes(name)) {
    await mutate(`/runs/${state.run.id}/commands`,{action:name,request_id:crypto.randomUUID()});
    message(`${name} requested; applied at an output boundary.`);
    if(name==='retry')await selectRun(state.run.id);
    return;
  }
  if(name==='latest'){state.replay=false;await loadFrame(state.run.sequence);message('Showing latest computed results.');return;}
  if(name==='checkpoint'){await mutate(`/runs/${state.run.id}/checkpoint/${state.frame}`);message('Checkpoint recipe saved. Restore uses deterministic recomputation.');return;}
  if(name==='branch'){
    const r=await mutate(`/runs/${state.run.id}/branch`,{sequence:state.frame,prioritize_vulnerable:true});
    state.runs.unshift(r);await selectRun(r.id);return;
  }
  if(['compare','optimize','monte_carlo','sensitivity'].includes(name))return startExperiment(({compare:'comparison',optimize:'optimization'})[name]||name);
  if(name==='cancel-experiment'){await mutate(`/experiments/${state.experiment.id}/cancel`);message('Cancellation requested.');return;}
  if(name==='csv'||name==='json')return download(`/runs/${state.run.id}/report?format=${name}`,`CrisisSim-${state.run.id}.${name}`);
  if(name==='print')return window.print();
  if(name==='export-scenarios')saveBlob(new Blob([JSON.stringify(state.scenarios.map(s=>s.config),null,2)],{type:'application/json'}),'CrisisSim-scenarios.json');
}
let initializing=false;
async function init() {
  if(initializing)return;initializing=true;
  state.runStop?.();state.experimentStop?.();state.generation++;state.experimentGeneration++;
  state.connected=false;error('');connection('Connecting…');controls();
  try {
    await connectBackend();state.connected=true;
    await refreshLibrary();connection('Backend connected');
    $$('[data-api-docs]').forEach(el=>el.href=backendURL('/docs'));
    setupScenarioForm();settings();
    if(experimentPage)await setupExperiments();
    if(runPage) {
      const id=localStorage.getItem('crisissim_run_id');
      await selectRun(state.runs.some(r=>r.id===id)?id:'');
    }
  }catch(e){error(e.message);connection('Offline');}
  finally{initializing=false;controls();}
}
applyAppearance();shell();setupRunContext();settings();
$('#scenario-search')?.addEventListener('input',renderLibrary);
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
  el.disabled=true;
  try{error('');await action(el.dataset.action,el);}catch(e){error(e.message);}
  finally{el.disabled=false;controls();}
});
window.addEventListener('pagehide',()=>{state.runStop?.();state.experimentStop?.();clearMaps();});
void init();
