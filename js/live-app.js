import {api, mutate, escapeHTML as esc, number as num, observeRun} from './api-client.js';
import './common.js';

const page=location.pathname.split('/').pop()||'index.html';
const main=document.querySelector('#live-content');
const nav=[
 ['index.html','Dashboard','activity'],['scenarios.html','Scenarios','layers'],
 ['command-center.html','Command Center','activity'],['city-model.html','City Model','map'],
 ['policy-lab.html','Policy Lab','sliders'],['equity-analysis.html','Equity Analysis','pie-chart'],
 ['system-dynamics.html','System Dynamics','trending-up'],['uncertainty.html','Uncertainty','bar-chart-2'],
 ['reports.html','Reports','file-text'],['methodology.html','Methodology','book-open'],['settings.html','Settings','settings']
];
const state={scenarios:[],runs:[],run:null,snapshot:null,series:[],city:null,mesh:null,map:null,stop:null,
  sequence:-1,replay:false,requestVersion:0,experimentTimer:null};
const settings=JSON.parse(localStorage.getItem('crisissim_settings_v1')||'{}');
document.documentElement.classList.toggle('theme-light',settings.theme==='light');
document.documentElement.classList.toggle('reduced-motion',!!settings.reducedMotion);
const clock=t=>`${Math.floor(t/3600).toString().padStart(2,'0')}:${Math.floor(t/60%60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const button=(id,text,primary=false)=>`<button id="${id}" class="btn ${primary?'btn-primary':'btn-secondary'}" type="button">${text}</button>`;
const title=(heading,description)=>`<h1>${heading}</h1><p>${description}</p>`;
const errorHTML='<div id="live-error" class="live-error" role="alert"></div>';
const statusHTML='<div id="live-message" role="status" class="live-notice"></div>';
function error(message){const el=document.querySelector('#live-error');if(el)el.textContent=message;}
function message(text){const el=document.querySelector('#live-message');if(el)el.textContent=text;}
function bind(id,handler,event='click'){
 const el=document.getElementById(id);if(!el)return;
 el.addEventListener(event,async e=>{
  if(event==='click')el.disabled=true;
  try{error('');await handler(e);}catch(err){error(err.message);}
  finally{if(event==='click')el.disabled=false;}
 });
}
function table(headings,rows){return `<div class="live-table-wrap"><table class="live-table"><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function row(values){return `<tr>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;}
function initShell(){
 document.querySelector('#app-sidebar').innerHTML=`
  <div class="sidebar-header"><a href="/" class="brand-text">CrisisSim</a></div>
  <nav class="sidebar-nav" aria-label="Main navigation">${nav.map(([href,label,icon])=>
   `<a href="/${href}" class="nav-item ${page===href?'active':''}" ${page===href?'aria-current="page"':''}>
    ${CrisisCommon.getIconSvg(icon)}<span>${label}</span></a>`).join('')}</nav>
  <div class="sidebar-footer">Synthetic city · educational use only</div>`;
 document.querySelector('#app-header').innerHTML=`<div class="live-header">
  <label for="selected-run">Run</label><select id="selected-run"><option value="">No saved runs</option></select>
  <span id="run-status" class="live-status">Ready</span><output id="run-clock">00:00:00</output>
  ${button('theme-toggle','Change theme')}</div>`;
 const skip=document.createElement('a');skip.href='#live-content';skip.className='live-skip';skip.textContent='Skip to content';document.body.prepend(skip);
 main.tabIndex=-1;
 bind('theme-toggle',()=>{
  settings.theme=settings.theme==='light'?'dark':'light';
  document.documentElement.classList.toggle('theme-light',settings.theme==='light');
  localStorage.setItem('crisissim_settings_v1',JSON.stringify(settings));
 });
 bind('selected-run',e=>selectRun(e.target.value),'change');
}
function runOptions(){
 const selector=document.querySelector('#selected-run');
 selector.innerHTML='<option value="">Choose a saved run</option>'+state.runs.map(r=>
  `<option value="${r.id}">${esc(r.config.name)} · ${esc(r.status)} · ${esc(new Date(r.created).toLocaleString())}</option>`).join('');
 selector.value=state.run?.id||'';
}
async function selectRun(id){
 state.stop?.();state.map?.dispose();state.map=null;
 state.run=null;state.snapshot=null;state.series=[];state.city=null;state.mesh=null;state.sequence=-1;state.replay=false;
 state.requestVersion++;
 if(!id){localStorage.removeItem('crisissim_run_id');render();return;}
 const version=state.requestVersion;
 const run=await api(`/runs/${id}`);
 if(version!==state.requestVersion)return;
 state.run=run;localStorage.setItem('crisissim_run_id',id);runOptions();render();
 document.querySelector('#run-status').textContent=run.status;
 document.querySelector('#run-clock').textContent=clock(run.time_s);
 state.stop=observeRun(id,async update=>{
  if(state.run?.id!==id)return;
  state.run={...state.run,...update};
  document.querySelector('#run-status').textContent=update.status;
  document.querySelector('#run-clock').textContent=clock(update.time_s);
  if(update.error)error(update.error);
  updateControls();
  if(!state.replay&&update.sequence>=0) {
   try{await loadSnapshot(update.sequence);}catch(e){error(e.message);}
  }
 },message);
 if(run.sequence>=0)await loadSnapshot(run.sequence);
}
async function loadSnapshot(sequence){
 const id=state.run.id, version=++state.requestVersion;
 const snapshot=await api(`/runs/${id}/artifacts/snapshot-${sequence}.json`);
 if(version!==state.requestVersion||id!==state.run?.id)return;
 state.snapshot=snapshot;state.sequence=sequence;
 if(!state.city){
  [state.city,state.mesh]=await Promise.all(['city','mesh'].map(n=>api(`/runs/${id}/artifacts/${n}.json`)));
 }
 state.series=await api(`/runs/${id}/artifacts/metrics.json`);
 if(version!==state.requestVersion||id!==state.run?.id)return;
 updateResults();
 const host=document.querySelector('#computed-map');
 if(host){
  const field=await api(`/runs/${id}/artifacts/field-${sequence}.json`);
  if(version!==state.requestVersion)return;
  if(!state.map){
   const {LiveMap}=await import('./live-map.js');
   if(version!==state.requestVersion)return;
   try{state.map=new LiveMap(host,state.city,state.mesh,settings.mapMode||'3d');}
   catch(e){host.textContent='3D rendering could not start. Select 2D map in Settings.';throw e;}
  }
  state.map.update(snapshot,field);
 }
 document.querySelector('#run-clock').textContent=clock(snapshot.time_s);
}
function updateControls(){
 const r=state.run;
 for(const [id,enabled]of Object.entries({
  'pause-run':r?.status==='running','resume-run':r?.status==='paused',
  'cancel-run':['queued','running','paused'].includes(r?.status),
  'retry-run':['failed','interrupted'].includes(r?.status),
  'checkpoint-run':state.sequence>=0,'branch-run':state.sequence>=0
 })) {const el=document.getElementById(id);if(el)el.disabled=!enabled;}
 const slider=document.querySelector('#replay');
 if(slider){slider.max=Math.max(0,r?.sequence||0);if(!slider.matches(':active'))slider.value=Math.max(0,state.sequence);}
}
function mapPanel(){
 return `<div class="live-map-toolbar">${button('map-reset','Reset view')}${button('map-in','Zoom in')}${button('map-out','Zoom out')}
 ${button('map-left','Pan left')}${button('map-right','Pan right')}${button('map-up','Pan up')}${button('map-down','Pan down')}
 <label>View<select id="map-mode"><option value="3d">3D models</option><option value="2d">2D operations</option></select></label>
 ${['flood','roads','routes','agents','facilities','resources'].map(layer=>`<label><input type="checkbox" checked data-layer="${layer}">${layer}</label>`).join('')}</div>
 <div id="computed-map" class="live-map"><p>Waiting for a computed snapshot.</p></div>
 <div class="live-legend"><span style="--key:#249fce">Computed water</span><span style="--key:#f06b64">Closed roads</span>
 <span style="--key:#34d399">Assigned routes / shelters</span><span style="--key:#ffdb8c">Resident sample</span></div>
 <p class="live-notice">Terrain and river use the numerical mesh. Resident markers are a display sample; metrics count everyone. No six-hour forecast layer is available.</p>`;
}
function bindMap(){
 for(const [id,fn]of [['map-reset',()=>state.map?.reset()],['map-in',()=>state.map?.zoom(.85)],['map-out',()=>state.map?.zoom(1.15)],
 ['map-left',()=>state.map?.pan(-3,0)],['map-right',()=>state.map?.pan(3,0)],['map-up',()=>state.map?.pan(0,-3)],['map-down',()=>state.map?.pan(0,3)]])bind(id,fn);
 const select=document.querySelector('#map-mode');if(select)select.value=settings.mapMode||'3d';
 bind('map-mode',async e=>{
  settings.mapMode=e.target.value;localStorage.setItem('crisissim_settings_v1',JSON.stringify(settings));
  state.map?.dispose();state.map=null;if(state.sequence>=0)await loadSnapshot(state.sequence);
 },'change');
 document.querySelectorAll('[data-layer]').forEach(el=>el.addEventListener('change',()=>state.map?.setLayer(el.dataset.layer,el.checked)));
 document.querySelector('#computed-map')?.addEventListener('map-error',e=>message(e.detail));
}
function summary(){return `<dl class="live-summary" id="summary"><div><dt>Computed results</dt><dd>—</dd></div></dl>`;}
function chart(){
 if(!state.series.length)return '<p>No progress samples yet.</p>';
 const maxT=Math.max(1,...state.series.map(s=>s.time_s)), maxN=state.run.config.population;
 const points=state.series.filter(s=>s.time_s<=(state.snapshot?.time_s??Infinity)).map(s=>`${50+s.time_s/maxT*700},${165-s.safely_evacuated/maxN*140}`).join(' ');
 return `<svg class="live-chart" viewBox="0 0 800 200" role="img" aria-label="Safely evacuated population over simulation time">
 <path d="M50 20V165H760" fill="none" stroke="currentColor"/><polyline points="${points}" fill="none" stroke="#34d399" stroke-width="3"/>
 <text x="5" y="28" fill="currentColor" font-size="13">${maxN}</text><text x="20" y="170" fill="currentColor" font-size="13">0</text>
 <text x="50" y="192" fill="currentColor" font-size="13">00:00</text><text x="670" y="192" fill="currentColor" font-size="13">${clock(maxT)}</text></svg>`;
}
function updateResults(){
 const s=state.snapshot;if(!s)return;
 const m=s.metrics;
 const summaryEl=document.querySelector('#summary');
 if(summaryEl)summaryEl.innerHTML=[
  ['Safely evacuated',num(m.safely_evacuated)],['Not yet safe',num(m.incomplete_count)],
  ['Mean completed evacuation',m.mean_completed_evacuation_s==null?'—':`${num(m.mean_completed_evacuation_s/60,1)} min`],
  ['Worst-neighborhood success',`${num(m.worst_group_success*100,1)}%`]
 ].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
 const progress=document.querySelector('#progress-chart');if(progress)progress.innerHTML=chart();
 const details=document.querySelector('#run-details');
 if(details)details.innerHTML=table(['Measure','Value'],[
  row(['Population simulated',num(m.population)]),row(['Actual cost (synthetic units)',num(m.cost,2)]),
  row(['Reserved future cost',num(m.reserved_cost,2)]),row(['Closed road segments',num(m.closed_roads)]),
  row(['Water-balance residual',`${num(s.mass_residual_m3,8)} m³`]),
  row(['Finite-horizon burden Gini',num(m.finite_horizon_wait_gini,3)])
 ]);
 const facilities=document.querySelector('#facilities');
 if(facilities)facilities.innerHTML=table(['Facility','Occupancy','Queued','Admissions'],Object.entries(m.facilities).map(([id,f])=>
  row([esc(id),`${f.occupancy} / ${f.capacity}`,num(f.queued),f.open?'Open':'Closed'])));
 const equity=document.querySelector('#equity-table');
 if(equity)equity.innerHTML=table(['Neighborhood','Population','Safely evacuated','Success rate'],state.city.neighborhoods.map(n=>{
  const g=m.neighborhoods[n.id];return row([esc(n.name),num(g.population),num(g.safe),`${num(g.success_rate*100,1)}%`]);
 }));
 const city=document.querySelector('#city-table');
 if(city)city.innerHTML=table(['Neighborhood','Individual residents','Data origin'],state.city.neighborhoods.map(n=>row([esc(n.name),num(n.population),'Synthetic'])));
 const events=document.querySelector('#events');
 if(events)events.innerHTML=s.events.length?s.events.slice(-100).reverse().map(e=>`<div class="live-event">
  <time>${clock(e.time_s)}</time><span>${esc(e.type.replaceAll('_',' '))} · ${esc(e.road_id||e.facility||e.request||'')}</span></div>`).join(''):'<p>No operational milestones yet.</p>';
 const states=document.querySelector('#agent-states');
 if(states)states.innerHTML=table(['State','Residents'],Object.entries(m.state_counts).map(([k,v])=>row([esc(k.replaceAll('_',' ')),num(v)])));
 updateControls();
}
function render(){
 state.map?.dispose();state.map=null;clearTimeout(state.experimentTimer);
 const header=nav.find(n=>n[0]===page)?.[1]||'New Scenario';
 main.innerHTML=title(header,'Computed results from a synthetic city. Educational decision support—not an official forecast or dispatch system.')+errorHTML+statusHTML;
 if(page==='scenarios.html'){renderScenarios();return;}
 if(page==='new-scenario.html'){renderForm();return;}
 if(page==='settings.html'){renderSettings();return;}
 if(page==='methodology.html'){renderMethodology();return;}
 if(['policy-lab.html','uncertainty.html'].includes(page)){renderExperiments();return;}
 if(page==='reports.html'){renderReports();return;}
 main.insertAdjacentHTML('beforeend',`<div class="live-toolbar"><a class="btn btn-primary" href="/new-scenario.html">Create scenario</a>
 ${button('run-selected','Run saved scenario')}${button('pause-run','Pause')}${button('resume-run','Resume')}
 ${button('cancel-run','Cancel')}${button('retry-run','Retry interrupted run')}</div>`);
 bind('run-selected',startSelected);
 for(const action of ['pause','resume','cancel','retry'])bind(action+'-run',async()=>{
  await mutate(`/runs/${state.run.id}/commands`,{action,request_id:crypto.randomUUID()});
  state.run=await api(`/runs/${state.run.id}`);updateControls();
  message(`${action} requested; applied at the next saved output boundary.`);
  if(action==='retry')await selectRun(state.run.id);
 });
 if(!state.run){main.insertAdjacentHTML('beforeend','<div class="live-empty">No run selected. Create a scenario or choose a saved run above.</div>');updateControls();return;}
 main.insertAdjacentHTML('beforeend',summary()+`<div class="live-toolbar">
  <label for="replay">Replay saved frame</label><input id="replay" type="range" min="0" max="0" value="0" step="1">
  ${button('return-live','Return to latest')}${button('checkpoint-run','Save checkpoint')}${button('branch-run','Branch: prioritize vulnerable')}
  </div>`);
 bind('replay',async e=>{state.replay=true;await loadSnapshot(Number(e.target.value));message('Replay mode: showing a recorded snapshot.');},'change');
 bind('return-live',async()=>{state.replay=false;await loadSnapshot(state.run.sequence);message('Showing latest available results.');});
 bind('checkpoint-run',async()=>{await mutate(`/runs/${state.run.id}/checkpoint/${state.sequence}`);message('Checkpoint recipe saved. Restore uses deterministic recomputation.');});
 bind('branch-run',async()=>{
  const branch=await mutate(`/runs/${state.run.id}/branch`,{sequence:state.sequence,prioritize_vulnerable:true});
  state.runs=await api('/runs');await selectRun(branch.id);
 });
 if(['index.html','command-center.html','city-model.html','equity-analysis.html'].includes(page))main.insertAdjacentHTML('beforeend',mapPanel());
 if(page==='equity-analysis.html')main.insertAdjacentHTML('beforeend','<h2>Neighborhood outcomes</h2><p>No unexplained composite equity score. Equal poor outcomes are not success.</p><div id="equity-table"></div>');
 if(page==='city-model.html')main.insertAdjacentHTML('beforeend','<h2>Population and provenance</h2><p>This run uses individual synthetic residents, not weighted extrapolation. Original illustrative demographic claims are not used.</p><div id="city-table"></div>');
 if(['index.html','command-center.html','system-dynamics.html'].includes(page))main.insertAdjacentHTML('beforeend','<h2>Evacuation progress</h2><div id="progress-chart"></div><h2>Facility load</h2><div id="facilities"></div><h2>Chronological milestones</h2><div id="events"></div>');
 if(page==='system-dynamics.html')main.insertAdjacentHTML('beforeend','<h2>Agent states</h2><div id="agent-states"></div>');
 main.insertAdjacentHTML('beforeend','<h2>Run diagnostics</h2><div id="run-details"></div>');
 bindMap();updateControls();updateResults();
}
async function startSelected(){
 const scenario=state.scenarios.find(s=>s.id===localStorage.getItem('crisissim_scenario_id'))||state.scenarios[0];
 if(!scenario)throw new Error('Create and save a scenario first.');
 const run=await mutate('/runs',{config:scenario.config,scenario_id:scenario.id,request_id:crypto.randomUUID()});
 state.runs=await api('/runs');await selectRun(run.id);
}
function renderScenarios(){
 main.insertAdjacentHTML('beforeend',`<div class="live-toolbar"><a class="btn btn-primary" href="/new-scenario.html">Create scenario</a>
 <label>Search<input id="scenario-search" type="search" placeholder="Scenario name"></label></div><div id="scenario-list"></div>`);
 const draw=()=>{
  const query=document.querySelector('#scenario-search').value.toLowerCase();
  document.querySelector('#scenario-list').innerHTML=table(['Name','Population','Rainfall','Duration','Actions'],
   state.scenarios.filter(s=>s.config.name.toLowerCase().includes(query)).map(s=>row([
    esc(s.config.name),num(s.config.population),`${num(s.config.flood.rainfall_mm_h)} mm/h`,clock(s.config.flood.duration_s),
    `<div class="live-toolbar"><button class="btn btn-primary" data-run="${s.id}">Run</button>
    <a class="btn btn-secondary" href="/new-scenario.html?edit=${s.id}">Edit / rename</a>
    <button class="btn btn-secondary" data-copy="${s.id}">Duplicate</button><button class="btn btn-secondary" data-delete="${s.id}">Archive</button></div>`
   ]))) || '<p>No saved scenarios.</p>';
  document.querySelectorAll('[data-run]').forEach(el=>el.onclick=async()=>{
   try{el.disabled=true;localStorage.setItem('crisissim_scenario_id',el.dataset.run);await startSelected();location.href='/command-center.html';}catch(e){error(e.message);el.disabled=false;}
  });
  for(const type of ['copy','delete'])document.querySelectorAll(`[data-${type}]`).forEach(el=>el.onclick=async()=>{
   try{
    if(type==='copy')await mutate(`/scenarios/${el.dataset.copy}/duplicate`);
    else await api(`/scenarios/${el.dataset.delete}`,{method:'DELETE'});
    state.scenarios=await api('/scenarios');draw();
   }catch(e){error(e.message);}
  });
 };
 document.querySelector('#scenario-search').addEventListener('input',draw);draw();
}
function renderForm(){
 const editing=state.scenarios.find(s=>s.id===new URLSearchParams(location.search).get('edit'));
 const c=editing?.config||{name:'Riverton flood evacuation',population:800,seed:42,
  flood:{rainfall_mm_h:60,duration_s:1800,mesh_cells_per_axis:8,output_interval_s:30,boundary_mode:'closed'},
  behavior:{warning_mean_delay_s:300,preparation_median_s:600},policy:{budget:100000,buses:2,ambulances:2,rescue_boats:1}};
 const input=(label,name,value,min,max,step=1)=>`<label>${label}<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
 main.insertAdjacentHTML('beforeend',`<form id="scenario-form" class="live-form">
 <label>Scenario name<input name="name" value="${esc(c.name)}" maxlength="120" required></label>
 ${input('Individual residents','population',c.population,8,78500)}
 ${input('Rainfall (mm/hour)','rain',c.flood.rainfall_mm_h,0,300)}
 ${input('Duration (seconds)','duration',c.flood.duration_s,60,86400,30)}
 ${input('Mean warning receipt delay (seconds)','warning',c.behavior.warning_mean_delay_s,1,3600)}
 ${input('Median preparation time (seconds)','preparation',c.behavior.preparation_median_s,1,7200)}
 ${input('Mesh cells per axis','mesh',c.flood.mesh_cells_per_axis,4,128)}
 ${input('Random seed','seed',c.seed,0,4294967295)}
 ${input('Budget (synthetic cost units)','budget',c.policy.budget,0,10000000)}
 ${input('Evacuation buses','buses',c.policy.buses,0,30)}
 ${input('Ambulances','ambulances',c.policy.ambulances,0,30)}
 ${input('Rescue boats','boats',c.policy.rescue_boats,0,20)}
 <label>Boundary condition<select name="boundary"><option value="closed">Closed basin</option><option value="transmissive">Open / transmissive</option><option value="stage">Prescribed stage</option></select></label>
 <fieldset><legend>Response policies</legend>
 <label><input name="shelters" type="checkbox" ${c.policy.temporary_shelters?'checked':''}>Temporary shelter</label>
 <label><input name="priority" type="checkbox" ${c.policy.prioritize_vulnerable?'checked':''}>Prioritize mobility assistance</label></fieldset>
 <button type="submit" class="btn btn-primary">${editing?'Save changes':'Save scenario'}</button></form>
 <p class="live-notice">The server enforces numerical work limits. Small profiles use fewer actual residents, not inflated population estimates. Prescribed-stage boundaries use 0 m unless edited through the API.</p>`);
 const form=document.querySelector('#scenario-form');form.elements.boundary.value=c.flood.boundary_mode;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const submit=form.querySelector('button');submit.disabled=true;
  const f=new FormData(form),v=name=>Number(f.get(name));
  const config={...c,name:f.get('name'),population:v('population'),seed:v('seed'),
   flood:{...c.flood,rainfall_mm_h:v('rain'),duration_s:v('duration'),mesh_cells_per_axis:v('mesh'),boundary_mode:f.get('boundary')},
   behavior:{...c.behavior,warning_mean_delay_s:v('warning'),preparation_median_s:v('preparation')},
   policy:{...c.policy,budget:v('budget'),buses:v('buses'),ambulances:v('ambulances'),rescue_boats:v('boats'),temporary_shelters:f.has('shelters'),prioritize_vulnerable:f.has('priority')}};
  try{
   const result=editing?await mutate(`/scenarios/${editing.id}`,{config,revision:editing.revision},'PATCH'):await mutate('/scenarios',config);
   localStorage.setItem('crisissim_scenario_id',result.id);location.href='/scenarios.html';
  }catch(err){error(err.message);submit.disabled=false;}
 });
}
function renderSettings(){
 main.insertAdjacentHTML('beforeend',`<div class="live-form">
 <label>Map mode<select id="setting-map"><option value="3d">3D models</option><option value="2d">2D operations</option></select></label>
 <label>Appearance<select id="setting-theme"><option value="dark">Dark</option><option value="light">Light</option></select></label>
 <fieldset><legend>Accessibility</legend><label><input id="setting-motion" type="checkbox">Reduce motion</label></fieldset></div>
 <h2>Simulation configuration</h2><p>Population, hazard parameters and resources are saved per scenario. Appearance preferences remain on this device.</p>
 <a class="btn btn-secondary" href="/new-scenario.html">Configure a scenario</a>`);
 for(const [id,key]of [['setting-map','mapMode'],['setting-theme','theme']]){
  document.getElementById(id).value=settings[key]||(key==='theme'?'dark':'3d');
  bind(id,e=>{settings[key]=e.target.value;localStorage.setItem('crisissim_settings_v1',JSON.stringify(settings));document.documentElement.classList.toggle('theme-light',settings.theme==='light');message('Preference saved.');},'change');
 }
 document.querySelector('#setting-motion').checked=!!settings.reducedMotion;
 bind('setting-motion',e=>{settings.reducedMotion=e.target.checked;localStorage.setItem('crisissim_settings_v1',JSON.stringify(settings));document.documentElement.classList.toggle('reduced-motion',settings.reducedMotion);},'change');
}
function renderMethodology(){
 main.insertAdjacentHTML('beforeend',`<h2>Hydrodynamics</h2><p>ANUGA solves the depth-averaged shallow-water equations using finite volumes. Rainfall, infiltration, drainage, friction and boundary fluxes contribute to the water balance. Output fields are sampled at recorded times.</p>
 <h2>Evacuation and transport</h2><p>Seeded individual agents receive warnings and prepare to leave. Self-driving residents use FIFO traffic cells with capacity and storage constraints. Routes respond to current conditions, not future flood knowledge. Boats are restricted to sufficiently inundated road corridors.</p>
 <h2>Facilities and response</h2><p>CP-SAT dispatch assigns compatible vehicles under a budget. Shelter admissions and hospital service respect capacity. A vehicle arriving does not automatically make its passengers safe.</p>
 <h2>Equity and uncertainty</h2><p>Results report neighborhood success gaps, worst-group success and finite-horizon burden inequality. There is no composite equity score. Monte Carlo output quantiles describe modeled variability, not confidence in real-world forecasts. Morris screening assumes independent inputs. NSGA-II produces an approximate Pareto frontier, not proven global optima.</p>
 <h2>Limitations</h2><p>The city, behavior, safety thresholds and costs are synthetic assumptions. Verification includes water conservation and analytical benchmarks; empirical calibration has not been performed. Replay uses recorded snapshots. Checkpoint restoration recomputes from immutable inputs and policy history.</p>
 <p><a href="/docs" target="_blank" rel="noopener">Open API reference</a></p>`);
}
function renderReports(){
 if(!state.run){main.insertAdjacentHTML('beforeend','<p>Select a computed run to export its report.</p>');return;}
 const id=state.run.id;
 main.insertAdjacentHTML('beforeend',`<div class="live-toolbar">
 <a class="btn btn-primary" href="/api/v1/runs/${id}/report?format=csv">Download CSV</a>
 <a class="btn btn-secondary" href="/api/v1/runs/${id}/report" target="_blank" rel="noopener">Open reproducible JSON</a>
 ${button('print-report','Print / save PDF')}</div>${summary()}<h2>Run diagnostics</h2><div id="run-details"></div>
 <h2>Configuration and provenance</h2><div id="report-config" class="live-report"></div>`);
 const pre=document.createElement('pre');pre.textContent=JSON.stringify(state.run.config,null,2);document.querySelector('#report-config').append(pre);
 bind('print-report',()=>window.print());updateResults();
}
function renderExperiments(){
 main.insertAdjacentHTML('beforeend',`<p>Experiments run the actual engine. They are limited to 2,000 residents, two simulated hours, and a ten-minute compute budget.</p>
 <div class="live-toolbar"><label>Scenario<select id="experiment-scenario">${state.scenarios.map(s=>`<option value="${s.id}">${esc(s.config.name)}</option>`).join('')}</select></label>
 <label>Trials<input id="trial-count" type="number" min="2" max="50" value="4"></label>
 ${page==='policy-lab.html'?button('compare','Compare policies',true)+button('optimize','Find Pareto policies'):
 button('monte-carlo','Run Monte Carlo',true)+button('sensitivity','Run Morris screening')}</div>
 <div id="experiment-results"><p>No experiment loaded.</p></div>`);
 for(const [id,kind]of [['compare','comparison'],['optimize','optimization'],['monte-carlo','monte_carlo'],['sensitivity','sensitivity']])bind(id,async()=>{
  const scenario=state.scenarios.find(s=>s.id===document.querySelector('#experiment-scenario').value);
  if(!scenario)throw new Error('Save a scenario before starting an experiment.');
  const exp=await mutate('/experiments',{kind,config:scenario.config,trials:Number(document.querySelector('#trial-count').value),evaluations:16});
  localStorage.setItem('crisissim_experiment_id',exp.id);await pollExperiment(exp.id);
 });
 const selected=localStorage.getItem('crisissim_experiment_id');if(selected)pollExperiment(selected).catch(e=>error(e.message));
}
async function pollExperiment(id){
 clearTimeout(state.experimentTimer);
 const e=await api(`/experiments/${id}`),host=document.querySelector('#experiment-results');if(!host)return;
 host.innerHTML=`<h2>${esc(e.spec.kind.replaceAll('_',' '))} · ${esc(e.status)}</h2>
 <p>${(e.evaluations||[]).length} evaluations recorded. Failed trials: ${e.failed_trials||0}.</p>
 ${['running','queued'].includes(e.status)?button('cancel-experiment','Cancel experiment'):''}`+
 table(['Evaluation','Safe / total','Cost','Success gap','Status'],(e.evaluations||[]).map(item=>row([
 esc(item.label),item.metrics?`${num(item.metrics.safely_evacuated)} / ${num(item.metrics.population)}`:'—',
 num(item.metrics?.cost,2),num(item.metrics?.success_rate_gap,3),esc(item.status)
 ])));
 if(e.error){const p=document.createElement('p');p.className='live-error';p.textContent=e.error;host.append(p);}
 if(e.result){const pre=document.createElement('pre');pre.className='live-detail';pre.textContent=JSON.stringify(e.result,null,2);host.append(pre);}
 bind('cancel-experiment',async()=>{await mutate(`/experiments/${id}/cancel`);await pollExperiment(id);});
 if(['queued','running'].includes(e.status))state.experimentTimer=setTimeout(()=>pollExperiment(id).catch(err=>error(err.message)),1500);
}
async function boot(){
 initShell();
 try{
  await api('/health');
  [state.scenarios,state.runs]=await Promise.all([api('/scenarios'),api('/runs')]);
  const selected=localStorage.getItem('crisissim_run_id');
  runOptions();render();
  if(selected&&state.runs.some(r=>r.id===selected))await selectRun(selected);
 }catch(e){
  main.innerHTML=title('Simulation service unavailable','Your saved data has not been replaced with demo results.')+errorHTML+button('retry-connect','Retry connection');
  error(e.message);bind('retry-connect',boot);
 }
}
window.addEventListener('beforeunload',()=>{state.stop?.();state.map?.dispose();clearTimeout(state.experimentTimer);});
boot();
