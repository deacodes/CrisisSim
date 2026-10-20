import {number as num} from './api-client.js';
import {$,$$,text,state,page,active,rows,pct,hours,clock,stranded,button,selectScenario} from './frontend.js';
import {chart,bars} from './result-charts.js';

const refs={};
const card=title=>$$('.card').find(c=>$('.card-title',c)?.textContent.includes(title));
const titleText=(el,value)=>{if(!el)return;const span=$('span',el);(span||el).textContent=value;};
const set=(el,value)=>{if(el)el.textContent=value??'—';};
const seriesPoints=fn=>state.series.map(m=>[m.time_s/60,fn(m)]);
const colors=['var(--accent-safe)','var(--accent-flood-light)','var(--accent-caution)'];
const facilityName=id=>id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());
function lastText(el,value) {
  if(!el)return;
  // Keep any leading icon/swatch, replace only the textual legend.
  const nodes=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE);
  nodes.forEach(n=>n.textContent='');el.append(document.createTextNode(value));
}
export function prepareResults() {
  $$('.metric-value,.metric-sub').forEach(e=>e.textContent='—');
  $$('main tbody').forEach(body=>rows(body,[]));
  for(const id of ['cc-metric-evac','cc-metric-stranded','cc-metric-time','cc-metric-equity','shelter-north-occ','shelter-west-occ','hospital-load-val'])
    text('#'+id,'—');
  $$('[id^="bar-"]').forEach(e=>e.style.width='0%');
  const progressIds=['dashboard-progress-chart','cc-progress-chart','rep-progress-chart'];
  for(const id of progressIds){
    const host=$('#'+id);if(!host)continue;host.textContent='No computed results yet.';
    const legend=host.nextElementSibling;
    if(legend){$$(':scope > span',legend).forEach((e,i)=>lastText(e,['Safely evacuated','Stranded / awaiting rescue','Baseline: not selected'][i]||''));}
    const c=host.closest('.card');if(c){
      titleText($('.card-title',c),'Evacuation Progress');text('.badge','Current run',c);
    }
  }
  if(page==='index'){
    refs.alerts=card('Critical Operational Alerts');
    const recent=card('Recent Simulation Scenarios');refs.recent=$(':scope > div:last-child',recent);refs.recentTemplates=$$(':scope > .card',refs.recent);
    refs.mapCaption=$('#dashboard-map-container')?.nextElementSibling;
  }
  if(page==='command-center'){
    refs.alerts=$('#cc-alerts-stream');
    const hosp=$('#hospital-load-val')?.previousElementSibling;set(hosp,'Hospital West');
    $$('.metric-sub').forEach(e=>e.textContent='Computed from selected run');
  }
  if(page==='equity-analysis'){
    refs.eqNumber=$('main .tabular-nums');
    refs.eqChange=refs.eqNumber?.nextElementSibling;
    refs.eqExplanation=$('main h2');
    refs.eqParagraph=refs.eqExplanation?.nextElementSibling;
    set(refs.eqNumber,'—');set(refs.eqChange,'Composite score not defined');
    set(refs.eqExplanation,'How fairness is measured');
    set(refs.eqParagraph,'The backend reports neighborhood success-rate gaps and finite-horizon waiting-time Gini. It does not define a composite equity score. Completed-only evacuation times exclude people who have not yet arrived.');
    refs.finding=card('Key Operational Finding');refs.recommendation=card('Recommended Corrective Action');
    for(const c of [refs.finding,refs.recommendation]){
      const body=$(':scope > div:last-child',c);body.textContent='Run a scenario to inspect computed outcomes.';
      text('.badge','Awaiting results',c);
    }
    const eqBadge=refs.eqNumber?.closest('.card')?.querySelector('.badge');set(eqBadge,'Measured outcomes');
    const disparity=$('#chart-disparity-bars')?.closest('.card');
    if(disparity){titleText($('.card-title',disparity),'Evacuation Success by Neighborhood');text('.badge','Current run',disparity);
      set($('#chart-disparity-bars').nextElementSibling,'Individual simulated residents; no population extrapolation.');}
    text('.badge','Computed outcomes',$('#equity-map-wrapper')?.closest('.card'));
    const th=$$('.equity-table th');set(th[2],'Mobility / Transit');set(th[4],'Completed Avg. Time');set(th[5],'Incomplete %');
    set(th[6],'Shelter Assignment');set(th[7],'Resources / 1k Pop');
  }
  if(page==='city-model'){
    refs.inventory=$('main tbody');
    const calibration=card('Synthetic Data');if(calibration){
      const parts=$$(':scope > div:last-child > div',calibration);
      set(parts[0],'Spatial synthesis: the backend uses a 2,400 × 2,000 meter synthetic domain, eight generated neighborhoods and a connected road graph. Elevations use an arbitrary synthetic datum.');
      set(parts[1],'Demographic assumptions: mobility impairment and transit dependence are seeded synthetic attributes. The city has not been calibrated against Census or USGS observations.');
    }
    $$('[id^="detail-"]').forEach(e=>{e.textContent='—';});
  }
  if(page==='system-dynamics'){
    refs.flow=$$('.flow-column');
    for(const id of ['dyn-chart-flood','dyn-chart-road','dyn-chart-shelter','dyn-chart-hospital']){
      const host=$('#'+id);host.textContent='No computed results yet.';
      const c=host.closest('.card');text('.badge','Awaiting results',c);
      if(host.nextElementSibling)host.nextElementSibling.textContent='Calculated values from saved snapshots.';
    }
    titleText($('.card-title',$('#dyn-chart-flood').closest('.card')),'Maximum Flood Depth');
    refs.bottlenecks=$$('main > div:last-child .card');
    for(const c of refs.bottlenecks)$$(':scope > :not(.card-header)',c).forEach((el,i)=>el.textContent=i?'Awaiting computed evidence.':'No bottleneck inferred yet.');
    for(const column of refs.flow)$$('.flow-node',column).forEach(n=>{text('strong','—',n);text('div','No computed result',n);});
  }
  if(page==='reports'){
    refs.reportSections=$$('.report-section');
    refs.reportSummary=$$('p',refs.reportSections[0]);
    refs.reportFindings=$$(':scope > div',refs.reportSections[4]);
    for(const p of refs.reportSummary)p.textContent='Select a computed run to generate this section.';
    for(const id of ['rep-safe','rep-stranded','rep-time','rep-equity']){
      const el=$('#'+id);set(el,'—');set(el?.nextElementSibling,id==='rep-equity'?'Composite score not defined':'Selected run only; no assumed baseline.');
    }
    const seal=$('.report-header-seal');
    text('.badge','Educational analysis',seal);
    text(':scope > div:first-child > div:first-child','CrisisSim Simulation Model · Computed flood briefing',seal);
    text(':scope > div:last-child > div:last-child','No report selected',seal);
    for(const f of refs.reportFindings)f.textContent='No computed finding available.';
    const limitations=$('p',refs.reportSections[5]);
    if(limitations)limitations.textContent='Synthetic, uncalibrated educational model. Flood hazards use ANUGA; evacuation uses individual agents, dynamic routing, finite-capacity traffic and resource dispatch. No mortality prediction or official dispatch advice is produced.';
  }
  if(page==='methodology')methodology();
}
function progress() {
  const series=[
    {name:'Safely evacuated',color:colors[0],points:seriesPoints(m=>m.safely_evacuated)},
    {name:'Stranded / awaiting rescue',color:'var(--accent-danger)',points:seriesPoints(stranded)}
  ];
  ['dashboard-progress-chart','cc-progress-chart','rep-progress-chart'].forEach(id=>chart(id,series,{yLabel:'Residents'}));
  const groups=Object.entries(state.snapshot?.metrics.neighborhoods||{});
  ['chart-disparity-bars','rep-disparity-chart'].forEach(id=>bars(id,groups.map(([id,g])=>({name:id,value:100*g.success_rate}))));
}
function events() {
  const list=state.snapshot?.events||[];
  const targets=[refs.alerts,$('#system-timeline')].filter(Boolean);
  for(const target of targets){
    let host=target;
    if(target.classList.contains('card')){
      if(!refs.alertList){
        refs.alertList=document.createElement('div');
        $$('.alert-item',target).forEach(e=>e.remove());target.append(refs.alertList);
      }host=refs.alertList;text('.badge',`${list.length} events`,target);
    }
    host.replaceChildren();
    if(!list.length){host.textContent='No recorded events at this frame.';continue;}
    const timeline=host.id==='system-timeline';
    for(const e of list.slice(timeline?-150:-8).reverse()){
      const item=document.createElement('div');item.className=timeline?'timeline-event':'alert-item alert-info';
      const when=document.createElement('div');when.className=timeline?'timeline-event-time':'alert-time';when.textContent=clock(e.time_s);
      const body=document.createElement('div'),title=document.createElement('div'),description=document.createElement('div');
      title.className=timeline?'timeline-event-title':'alert-title';title.textContent=(e.type||e.state||'Event').replaceAll('_',' ');
      description.className=timeline?'timeline-event-description':'alert-desc';
      description.textContent=Object.entries(e).filter(([k])=>!['type','state','time_s'].includes(k)).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`).join(' · ');
      body.append(title,description);item.append(when,body);host.append(item);
    }
  }
  const timeline=$('#system-timeline');if(timeline)text('.badge',`${list.length} recorded events`,timeline.closest('.card'));
}
function facilityLoads() {
  const f=state.snapshot?.metrics.facilities||{};
  for(const [key,id,bar] of [['shelter-north','shelter-north-occ','bar-north'],['shelter-west','shelter-west-occ','bar-west'],['hospital-west','hospital-load-val','bar-hospital']]){
    const value=f[key]?f[key].occupancy/f[key].capacity:null;text('#'+id,pct(value));
    const el=$('#'+bar);if(el)el.style.width=`${Number.isFinite(value)?100*value:0}%`;
  }
}
function dashboard() {
  if(page!=='index')return;
  const m=state.snapshot?.metrics;
  const values=[num(m?.safely_evacuated),num(stranded(m)),hours(m?.mean_completed_evacuation_s),'—'];
  $$('.metric-value').forEach((el,i)=>el.textContent=values[i]);
  const notes=[m?`${pct(m.completion_fraction)} of ${num(m.population)} simulated residents`:'No run selected',
    'Stranded + awaiting rescue; not all incomplete residents','Completed evacuations only','Composite score not defined'];
  $$('.metric-sub').forEach((el,i)=>el.textContent=notes[i]);
  text('.page-subtitle strong',state.run?.config.name||active()?.config.name||'No scenario selected');
  const subtitle=$('.page-header .page-subtitle');if(subtitle)lastText(subtitle,' · Synthetic flood model');
  if(refs.mapCaption){text('span:first-child',`${state.city?.neighborhoods.length||0} neighborhoods · ${m?`maximum depth ${num(m.max_depth_m,2)} m`:'run to calculate flood depth'}`,refs.mapCaption);}
  refs.recentTemplates?.forEach((template,i)=>{
    const scenario=state.scenarios[i],r=scenario&&state.runs.find(r=>r.scenario_id===scenario.id),metrics=r?.metrics;
    text(':scope > div:first-child > div:first-child > div:first-child',scenario?.config.name||'No saved scenario',template);
    text(':scope > div:first-child > div:first-child > div:last-child',r?.status||'Not run',template);
    text('.badge',r?.status||'Ready',template);
    const cells=$$(':scope > div:nth-child(2) > div',template);
    ['Safe: '+num(metrics?.safely_evacuated),'Stranded: '+num(stranded(metrics)),'Avg Time: '+hours(metrics?.mean_completed_evacuation_s),'Equity: not defined'].forEach((v,j)=>set(cells[j],v));
    text(':scope > div:last-child > span',`Cost: ${num(metrics?.cost)} model units`,template);
    const link=$('a',template);if(link){link.textContent=scenario?'Open':'Create scenario';link.href=scenario?`command-center.html?id=${scenario.id}`:'new-scenario.html';}
  });
}
function equity() {
  if(page!=='equity-analysis')return;
  const m=state.snapshot?.metrics;
  set(refs.eqChange,m?`Success gap ${pct(m.success_rate_gap)} · Wait Gini ${num(m.finite_horizon_wait_gini,3)}`:'No computed run selected');
  const groups=Object.entries(m?.neighborhoods||{}).sort((a,b)=>a[1].success_rate-b[1].success_rate);
  const worst=groups[0];
  set($(':scope > div:last-child',refs.finding),worst?`${state.city.neighborhoods.find(n=>n.id===worst[0])?.name||worst[0]}: ${pct(worst[1].success_rate)} safely evacuated (${worst[1].safe}/${worst[1].population}). This identifies an outcome disparity, not its causal mechanism.`:'Run a scenario to inspect computed outcomes.');
  text('.badge',worst?'Current outcome':'Awaiting results',refs.finding);
  set($(':scope > div:last-child',refs.recommendation),'Compare matched-seed policies in Policy Lab before recommending a change. Effects of untested interventions are not assumed.');
  const resourceCount=state.snapshot?.resources.length;
  rows($('#equity-table-body'),(state.city?.neighborhoods||[]).map(n=>{
    const g=m?.neighborhoods[n.id];
    return [n.name,num(g?.population??n.population),g?`${pct(g.mobility_impaired/g.population)} / ${pct(g.transit_dependent/g.population)}`:'—',
      pct(g?.success_rate),'Not aggregated',g?pct(1-g.success_rate):'—','Individual routing',m?`${num(resourceCount/m.population*1000,2)} citywide`:'—'];
  }));
}
function cityModel() {
  if(page!=='city-model')return;
  const n=state.city?.neighborhoods.find(n=>n.id===state.selectedNeighborhood),m=state.snapshot?.metrics,g=m?.neighborhoods[n?.id];
  if(!n)return;
  text('#detail-name',n.name);text('#detail-pop',num(g?.population??n.population));
  text('#detail-tier-badge','Synthetic attributes; no vulnerability index');
  const bounds=n.polygon, xs=bounds.map(p=>p[0]),ys=bounds.map(p=>p[1]);
  const indices=state.mesh?.centers.map((p,i)=>p[0]>=Math.min(...xs)&&p[0]<Math.max(...xs)&&p[1]>=Math.min(...ys)&&p[1]<Math.max(...ys)?i:-1).filter(i=>i>=0)||[];
  const beds=indices.map(i=>state.mesh.bed_m[i]),depths=indices.map(i=>state.field?.depth_m[i]).filter(Number.isFinite);
  text('#detail-elev',beds.length?`${num(Math.min(...beds),2)}–${num(Math.max(...beds),2)} m (synthetic)`:'Run for terrain mesh');
  text('#detail-flood',depths.length?`${num(Math.max(...depths),2)} m maximum`:'—');
  text('#detail-time','Not aggregated by district');
  for(const [key,value] of [['transit',g?g.transit_dependent/g.population:null],['mobility',g?g.mobility_impaired/g.population:null],['elderly',null]]){
    text('#detail-'+key,value===null?'Not modeled':pct(value));
    const el=$('#bar-'+key);if(el)el.style.width=`${value===null?0:value*100}%`;
  }
  text('#detail-shelter','Assigned per resident using available routes');
  text('#detail-notes',g?`${g.safe} of ${g.population} residents safely evacuated. Reference-city population is not an extrapolation of simulated outcomes.`:'Run a scenario to inspect seeded resident attributes and routing outcomes.');
  rows(refs.inventory,(state.city.facilities||[]).map(f=>{
    const load=m?.facilities[f.id];
    return [facilityName(f.id),f.kind,`${f.x}, ${f.y} m`,num(load?.capacity??f.capacity),load?`${load.occupancy} admitted · ${load.queued} queued · ${load.open?'open':'closed'}`:'Not simulated','Computed per run','Not modeled'];
  }));
}
function dynamics() {
  if(page!=='system-dynamics')return;
  const m=state.snapshot?.metrics;
  chart('dyn-chart-flood',[{name:'Max depth',color:colors[1],points:seriesPoints(m=>m.max_depth_m)}],{yLabel:'Maximum depth (m)'});
  chart('dyn-chart-road',[{name:'Roads open',color:colors[0],points:seriesPoints(m=>100*(1-m.closed_roads/(state.city?.roads.length||1)))}],{yLabel:'Roads open (%)'});
  chart('dyn-chart-shelter',['shelter-north','shelter-west','shelter-east'].map((id,i)=>({name:id,color:colors[i],points:seriesPoints(m=>m.facilities[id]?m.facilities[id].occupancy/m.facilities[id].capacity*100:null)})),{yLabel:'Shelter occupancy (%)'});
  chart('dyn-chart-hospital',[{name:'Hospital',color:colors[1],points:seriesPoints(m=>m.facilities['hospital-west']?100*m.facilities['hospital-west'].occupancy/m.facilities['hospital-west'].capacity:null)}],{yLabel:'Hospital occupancy (%)'});
  ['dyn-chart-flood','dyn-chart-road','dyn-chart-shelter','dyn-chart-hospital'].forEach(id=>text('.badge',m?'Computed':'Awaiting results',$('#'+id).closest('.card')));
  const origins=(state.city?.neighborhoods||[]).slice(0,4),roadStates=state.snapshot?.roads||[],facilities=Object.entries(m?.facilities||{}).slice(0,4);
  refs.flow?.forEach((col,i)=>$$('.flow-node',col).forEach((node,j)=>{
    if(i===0){text('strong',origins[j]?.name||'—',node);text('div',origins[j]?`${origins[j].population} simulated residents`:'No results',node);}
    if(i===1){text('strong',roadStates[j]?.id||'—',node);text('div',roadStates[j]?(roadStates[j].closed?'Closed by hazard':'Open to vehicles'):'No results',node);}
    if(i===2){text('strong',facilities[j]?facilityName(facilities[j][0]):'—',node);text('div',facilities[j]?`${facilities[j][1].occupancy}/${facilities[j][1].capacity} admitted · ${facilities[j][1].queued} queued`:'No results',node);}
  }));
  refs.bottlenecks?.forEach((c,i)=>{
    const content=$$(':scope > :not(.card-header)',c);
    set(content[0],['Road network closures','Facility queues','Numerical mass conservation'][i]);
    set(content[1],m?[`${m.closed_roads} roads closed at ${clock(state.snapshot.time_s)}.`,
      `${Object.values(m.facilities).reduce((s,f)=>s+f.queued,0)} people queued for admission.`,
      `Water mass residual: ${state.snapshot.mass_residual_m3.toExponential(3)} m³.`][i]:'No computed evidence yet.');
    for(const extra of content.slice(2))set(extra,'Interpret alongside saved events and model limitations.');
  });
}
function report() {
  if(page!=='reports')return;
  const m=state.snapshot?.metrics,r=state.run;
  text('#rep-scenario-name',r?.config.name||'No run selected');
  text('#rep-title',r?`${r.config.name} — Evacuation Brief`:'Riverton Flood Evacuation Strategy Brief');
  text('.report-header-seal > div:last-child > div:last-child',r?`Run ${r.id.slice(0,8)} · ${new Date(r.created).toLocaleString()}`:'No run selected');
  set(refs.reportSummary?.[0],m?`At ${clock(state.snapshot.time_s)}, ${m.safely_evacuated} of ${m.population} individually simulated residents are safely evacuated. ${stranded(m)} are stranded or awaiting rescue; ${m.incomplete_count} in total have not completed evacuation.`:'Select a computed run to generate this section.');
  set(refs.reportSummary?.[1],m?`Completed-only average evacuation time: ${hours(m.mean_completed_evacuation_s)}. Neighborhood success-rate gap: ${pct(m.success_rate_gap)}. Finite-horizon waiting-time Gini: ${num(m.finite_horizon_wait_gini,3)}. Recorded cost: ${num(m.cost)} model units. These values do not establish causality or an optimal policy.`:'Comparison claims require matched numerical evaluations.');
  text('#rep-safe',m?`${num(m.safely_evacuated)} (${pct(m.completion_fraction)})`:'—');
  text('#rep-stranded',num(stranded(m)));text('#rep-time',hours(m?.mean_completed_evacuation_s));
  const evaluations=state.experiments.filter(e=>e.spec?.kind==='comparison'&&e.spec.config.seed===r?.config.seed&&e.spec.config.name===r?.config.name).at(0)?.evaluations||[];
  rows($('tbody',refs.reportSections?.[2]),evaluations.filter(e=>e.metrics).map(e=>[e.label,num(e.metrics.safely_evacuated),num(stranded(e.metrics)),hours(e.metrics.mean_completed_evacuation_s),'Not defined',`${num(e.metrics.cost)} units`,'Inspect trade-offs']));
  refs.reportFindings?.forEach((el,i)=>set(el,m?(i===0?`${m.closed_roads} roads closed at the selected frame. Inspect the event timeline for measured closure times.`:`Neighborhood success rates differ by ${pct(m.success_rate_gap)}. Model assumptions and incomplete evacuations must be considered before interpreting this gap.`):'No computed finding available.'));
}
function methodology() {
  const content={
    'city-model':['Synthetic local Cartesian geography spans 2,400 × 2,000 meters, eight neighborhoods and a connected road graph. Reference population is 78,500; each run explicitly selects the number of individual residents.','No Census/USGS empirical calibration has been performed.'],
    'flood-model':['ANUGA solves the two-dimensional shallow-water equations on a triangular mesh with wetting/drying, Manning friction, rainfall and specified boundary conditions.','Rainfall, infiltration and drainage are explicit inputs. Flood fields are held between saved hazard updates; extrema are sampled at output times.'],
    'agent-behavior':['Seeded individual agents receive warnings, prepare, seek transport, travel, await admission and reach shelter. Mobility impairment and transit dependence are assumed probabilities.','Completed-only travel times exclude incomplete evacuations. No mortality or household vehicle-sharing model is implemented.'],
    'dynamic-routing':['NetworkX routes use flood-affected road costs and closure thresholds. Finite road storage, sending/receiving limits and FIFO traffic packets constrain movement.','Off-road walking is simplified. Boats use inundated road corridors, not an arbitrary navigable-water graph.'],
    'optimization':['OR-Tools CP-SAT allocates rescue resources subject to operational constraints. NSGA-II explores policy candidates against incomplete population, exposure, cost and neighborhood success-rate gap.','Approximate nondominated candidates are tested with held-out seeds; global optimality is not guaranteed.'],
    'uncertainty':['Latin hypercube trials sample independent rainfall Uniform(30,120) mm/h and mean warning delay Uniform(100,600) seconds. Behavior seeds also vary across trials. Reported 5th/50th/95th percentiles are empirical outcome quantiles, not confidence intervals.','Morris sensitivity screening uses those two inputs and a fixed behavioral seed; it is not a Sobol decomposition.'],
    'equity-metric':['The backend reports the maximum minus minimum neighborhood success rate, worst-group success, and population-weighted finite-horizon waiting-time Gini. No composite equity score is defined.','Gini is undefined when total waiting burden is zero. Equal outcomes alone do not establish adequate safety.'],
    'limitations':['Synthetic, uncalibrated educational model; not an official emergency forecast or dispatch service. Verification tests are not empirical validation.','Simplifications include individual traffic packets, no bus pooling, corridor-limited boats, simplified hospital admission and no automatic recovery from interrupted rescues.'],
    'sources':['Implemented tools: ANUGA, NumPy/SciPy, NetworkX, OR-Tools, SALib and pymoo. Reproducibility manifests record configurations, dependency versions and engine source hashes.','Synthetic inputs are assumptions, not observations from real emergency services.']
  };
  for(const [id,paragraphs] of Object.entries(content)){
    const section=$('#'+id);if(!section)continue;
    const bodies=$$(':scope > :not(h2)',section);
    bodies.forEach((el,i)=>set(el,paragraphs[i]||'See the saved run manifest for the exact configuration and model limitations.'));
  }
  text('#equity-metric h2','7. Equity Metrics: Success Gaps & Waiting-Time Gini');
  text('#sources h2','9. Numerical Libraries & Provenance');
}
export function renderResults() {
  const m=state.snapshot?.metrics;
  text('#cc-metric-evac',num(m?.safely_evacuated));text('#cc-metric-stranded',num(stranded(m)));
  text('#cc-metric-time',hours(m?.mean_completed_evacuation_s));text('#cc-metric-equity','—');
  const equityValue=$('#cc-metric-equity');if(equityValue)equityValue.title='Composite equity score is not defined. See Equity Analysis for measured disparities.';
  facilityLoads();progress();events();dashboard();equity();cityModel();dynamics();report();
}
