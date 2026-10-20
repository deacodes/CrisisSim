import {api,mutate,number as num} from './api-client.js';
import {$,$$,state,prefs,page,text,guard,note,savePreferences,refreshLibrary,startRun,download,button,changeMap} from './frontend.js';

const val=id=>Number($('#'+id)?.value);
const checked=id=>!!$('#'+id)?.checked;
const setLabel=(el,label)=>{const group=el?.closest('.form-group,.slider-container');text('.form-label,.slider-header > span:first-child',label,group||document);};
function options(el,entries,value){if(!el)return;el.replaceChildren(...entries.map(([v,label])=>new Option(label,v)));el.value=String(value);}
function numeric(id,value,min,max,step=1){const el=$('#'+id);if(el)Object.assign(el,{value,min,max,step});}
function field(parent,label,id,value,type='number') {
  const wrap=document.createElement('div');wrap.className='form-group';
  const lab=document.createElement('label');lab.className='form-label';lab.htmlFor=id;lab.textContent=label;
  const input=document.createElement('input');input.className='form-control';input.id=id;input.type=type;input.value=value;
  wrap.append(lab,input);parent.append(wrap);return input;
}
function configureWizard() {
  if(page!=='new-scenario'||!state.defaults)return;
  const c=state.defaults;
  const count={low:500,medium:800,high:2000}[prefs.simDefaults?.agentCount]||800;
  numeric('input-rainfall',c.flood.rainfall_mm_h,0,300);
  options($('#input-duration'),[[600,'10 minutes'],[1800,'30 minutes'],[3600,'1 hour'],[7200,'2 hours']],c.flood.duration_s);
  numeric('input-warning',c.behavior.warning_mean_delay_s,1,3600);
  setLabel($('#input-warning'),'Mean warning receipt delay (seconds)');
  const warningTicks=$('#input-warning').nextElementSibling;warningTicks.textContent='1–3,600 seconds after the warning starts';
  $('#input-warning').setAttribute('oninput',"updateVal('warning', this.value + ' seconds')");
  const rainTicks=$('#input-rainfall').nextElementSibling;rainTicks.textContent='0–300 mm/h; synthetic rainfall input, no return-period classification';
  numeric('input-budget',c.policy.budget,0,10000000,1000);
  $('#input-budget').setAttribute('oninput',"updateVal('budget', this.value + ' model units')");
  $('#input-budget').nextElementSibling.textContent='0–10,000,000 model cost units (not a municipal dollar estimate)';
  numeric('input-boats',c.policy.rescue_boats,0,20);
  numeric('input-ambulances',c.policy.ambulances,0,30);
  setLabel($('#input-ambulances'),'Ambulance units');
  const selects=$$('#step-panel-2 select');
  selects[0].id='input-infiltration';setLabel(selects[0],'Infiltration rate (mm/h)');
  options(selects[0],[[0,'0 mm/h — no infiltration'],[5,'5 mm/h'],[15,'15 mm/h']],c.flood.infiltration_mm_h);
  selects[1].id='input-stage';setLabel(selects[1],'Initial water stage (synthetic datum)');
  options(selects[1],[[0,'0 m'],[.6,'0.6 m'],[1.4,'1.4 m']],c.flood.initial_stage_m);
  const n5=$('#input-n5-mode');n5.disabled=true;options(n5,[['fixed','Backend road network (bypasses not modeled)']],'fixed');
  options($('#input-equity-weight'),[['high','Prioritize mobility-impaired residents'],['equal','No vulnerability priority']],c.policy.prioritize_vulnerable?'high':'equal');
  $('#input-equity-weight').addEventListener('change',e=>{$('#check-equity').checked=e.target.value==='high';});
  $('#check-equity').addEventListener('change',e=>{$('#input-equity-weight').value=e.target.checked?'high':'equal';});
  $('#check-shelters').checked=c.policy.temporary_shelters;
  $('#check-boats').checked=c.policy.rescue_boats>0;
  $('#check-equity').checked=c.policy.prioritize_vulnerable;
  $('#check-closures').disabled=true;$('#check-closures').checked=true;
  $('#check-closures').parentElement.lastChild.textContent=' Flood-threshold road closures (always calculated)';
  const parent=$('#input-ambulances').closest('.form-group').parentElement;
  const buses=field(parent,'Transit buses','input-buses',c.policy.buses);buses.min=0;buses.max=30;
  const advanced=document.createElement('details');
  const summary=document.createElement('summary');summary.textContent='Numerical model settings';advanced.append(summary);
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px';advanced.append(grid);
  for(const [id,label,value,min,max,step] of [
    ['population','Simulated residents (not population weights)',count,8,78500,1],
    ['seed','Reproducible random seed',c.seed,0,2147483647,1],
    ['mesh','Mesh cells per axis',c.flood.mesh_cells_per_axis,4,128,1],
    ['output','Saved output interval (seconds)',c.flood.output_interval_s,2,600,2],
    ['preparation','Median preparation time (seconds)',c.behavior.preparation_median_s,1,86400,1],
    ['transit','Transit-dependent fraction',c.behavior.transit_fraction,0,1,.01],
    ['mobility','Mobility-impaired fraction',c.behavior.mobility_fraction,0,1,.01],
    ['drainage','Drainage rate (mm/h)',c.flood.drainage_mm_h,0,100,1],
    ['manning','Manning roughness',c.flood.manning_n,.001,.3,.001],
    ['warning-start','Warning start (seconds)',c.behavior.warning_start_s,0,86400,1]
  ])Object.assign(field(grid,label,'advanced-'+id,value),{min,max,step});
  $('#step-panel-2 > .card').append(advanced);
  text('#val-warning',`${c.behavior.warning_mean_delay_s} seconds`);
  text('#val-rainfall',`${c.flood.rainfall_mm_h} mm/hr`);
  text('#val-budget',`${num(c.policy.budget)} model units`);
  text('#step-panel-2 .badge',`${count} simulated residents`);
  $('#advanced-population').addEventListener('input',e=>text('#step-panel-2 .badge',`${e.target.value} simulated residents`));
  const review=$('#step-panel-4');
  $$('.tabular-nums',review).forEach(e=>{if(!e.id)e.textContent='Calculated after run';});
  const projection=$$('strong',review).find(e=>e.textContent.includes('Simulation projection'));
  if(projection)projection.parentElement.textContent='Results are calculated after launch. No flood crest or policy outcome is assumed.';
  text('.badge',review? 'Configuration review':'',review);
  $('#input-name').maxLength=120;
}
function configFromWizard() {
  const c=structuredClone(state.defaults);
  if(!c)throw Error('The backend is not connected.');
  c.name=$('#input-name').value.trim();
  c.population=val('advanced-population');c.seed=val('advanced-seed');
  Object.assign(c.flood,{rainfall_mm_h:val('input-rainfall'),duration_s:val('input-duration'),
    infiltration_mm_h:val('input-infiltration'),initial_stage_m:val('input-stage'),
    mesh_cells_per_axis:val('advanced-mesh'),output_interval_s:val('advanced-output'),
    drainage_mm_h:val('advanced-drainage'),manning_n:val('advanced-manning')});
  Object.assign(c.behavior,{warning_mean_delay_s:val('input-warning'),warning_start_s:val('advanced-warning-start'),
    preparation_median_s:val('advanced-preparation'),transit_fraction:val('advanced-transit'),mobility_fraction:val('advanced-mobility')});
  Object.assign(c.policy,{budget:val('input-budget'),buses:val('input-buses'),ambulances:val('input-ambulances'),
    rescue_boats:checked('check-boats')?val('input-boats'):0,temporary_shelters:checked('check-shelters'),
    prioritize_vulnerable:checked('check-equity')});
  if(!c.name)throw Error('Enter a scenario name.');
  for(const input of $$('#step-panel-1 input,#step-panel-2 input,#step-panel-3 input')){
    if(!input.checkValidity()){input.reportValidity();throw Error(`Check ${input.id.replaceAll('-',' ')}.`);}
  }
  if(c.flood.duration_s/c.traffic_dt_s*c.population>50000000)throw Error('This configuration exceeds the 50-million agent-tick budget. Reduce duration or population.');
  if(c.flood.duration_s%c.flood.output_interval_s!==0||c.flood.output_interval_s%c.traffic_dt_s!==0)
    throw Error('Output interval must divide the duration and be a multiple of the two-second traffic timestep.');
  return c;
}
function goToStep(step) {
  for(let i=1;i<=4;i++){
    $('#step-panel-'+i).style.display=i===step?'block':'none';
    $('#step-nav-'+i).className=`step-item ${i===step?'active':i<step?'completed':''}`;
  }
  if(step===4){
    const c=configFromWizard();
    text('#review-name',c.name);text('#review-rainfall',`${c.flood.rainfall_mm_h} mm/h`);
    text('#review-duration',`${c.flood.duration_s/60} minutes`);text('#review-warning',`${c.behavior.warning_mean_delay_s} seconds mean delay`);
    text('#review-budget',`${num(c.policy.budget)} model units`);
  }
}
function setupSettings() {
  if(page!=='settings')return;
  const bindings={'setting-theme':'theme','setting-high-contrast':'highContrast','setting-large-labels':'largerLabels',
    'setting-reduced-motion':'reducedMotion','setting-colorblind':'colorblindMode','setting-map-mode':'mapMode'};
  for(const [id,key] of Object.entries(bindings)){
    const input=$('#'+id);if(!input)continue;
    if(input.type==='checkbox')input.checked=!!prefs[key];else input.value=prefs[key];
    input.removeAttribute('onchange');input.addEventListener('change',()=>savePreferences({[key]:input.type==='checkbox'?input.checked:input.value}));
  }
  options($('#sim-def-agents'),[['low','500 simulated residents'],['medium','800 simulated residents'],['high','2,000 simulated residents']],prefs.simDefaults?.agentCount||'medium');
  options($('#sim-def-mc'),[[2,'2 trials (smoke test)'],[10,'10 trials'],[50,'50 trials']],Math.min(50,prefs.simDefaults?.monteCarloRuns||10));
  $('#sim-def-speed').value=prefs.simDefaults?.speed||1;
  for(const [id,key] of [['sim-def-speed','speed'],['sim-def-agents','agentCount'],['sim-def-mc','monteCarloRuns']]){
    $('#'+id).addEventListener('change',e=>savePreferences({simDefaults:{...prefs.simDefaults,[key]:key==='agentCount'?e.target.value:Number(e.target.value)}}));
  }
  const groups=$$('.settings-group'),management=groups.at(-1);
  text('.settings-group-title span','Scenario data management',management);
  text('p','Scenarios and numerical results are stored by the backend. Appearance preferences remain in this browser. Exports contain validated scenario configurations.',management);
  const reset=$('[onclick="resetAllData()"]');if(reset)reset.textContent='Reset appearance preferences';
}
export function setupForms(){
  setupSettings();
  window.addEventListener('backend-ready',configureWizard,{once:true});
  Object.assign(window,{
    selectHazard:()=>note('Flood is the implemented hazard model.'),
    updateVal:(id,value)=>text('#val-'+id,value),
    goToStep:guard(goToStep),
    applyPolicyTemplate:template=>{
      if(template==='baseline'){$('#check-shelters').checked=false;$('#check-equity').checked=false;}
      else if(template==='equity'){$('#check-equity').checked=true;}
      else if(template==='cost'){$('#input-budget').value=10000;}
      else{$('#check-shelters').checked=true;}
      $('#input-equity-weight').value=checked('check-equity')?'high':'equal';
      text('#val-budget',`${num(val('input-budget'))} model units`);
    },
    launchScenario:guard(async()=>{
      if(state.launching)return;state.launching=true;
      const launch=$('[onclick="launchScenario()"]');launch.disabled=true;
      try{
        const config=configFromWizard(),record=await mutate('/scenarios',config);
        state.scenarios.unshift(record);state.active=record.id;state.draft=config;
        localStorage.setItem('crisissim_scenario_id',record.id);
        await startRun(config);location.href=`command-center.html?id=${record.id}`;
      }finally{state.launching=false;launch.disabled=false;}
    }),
    saveAllSettings:()=>{savePreferences();note('Preferences saved.');},
    exportScenarioJSON:()=>download('CrisisSim-scenarios.json',{version:2,configs:state.scenarios.map(s=>s.config)}),
    importScenarioJSON:guard(async e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(file.size>1000000)throw Error('Scenario import must be smaller than 1 MB.');
      const parsed=JSON.parse(await file.text()),configs=parsed.configs;
      if(!Array.isArray(configs)||!configs.length)throw Error('Use a backend scenario export with a configs array; mock-data exports are not supported.');
      await mutate('/scenarios/import',{configs});await refreshLibrary();note(`Imported ${configs.length} validated scenarios.`);e.target.value='';
    }),
    resetAllData:()=>{
      if(!confirm('Reset appearance preferences? Your scenarios and results will not be deleted.'))return;
      savePreferences({theme:'dark',mapMode:'3d',highContrast:false,largerLabels:false,reducedMotion:false,colorblindMode:false});
      location.reload();
    }
  });
}
