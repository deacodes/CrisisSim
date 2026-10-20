import {api,mutate,observeResource,number as num} from './api-client.js';
import {$,$$,text,state,page,active,prefs,guard,note,showError,button,rows,pct,hours,stranded,populateSelect} from './frontend.js';
import {chart,bars} from './result-charts.js';
let cards=[],recommendations=[],caseCards=[],selected='baseline',trials=10;
const completed=()=>state.experiment?.evaluations?.filter(e=>e.status==='completed'&&e.metrics)||[];
const metricTuple=m=>[m?`${num(m.safely_evacuated)} (${pct(m.completion_fraction)})`:'—',num(stranded(m)),hours(m?.mean_completed_evacuation_s),'Not defined'];
function strategyCard(card,e){
  text(':scope > div:nth-child(2)',e?`${num(e.metrics.cost)} units`:'—',card);
  const values=$$(':scope > div:last-child strong',card);
  if(values[0])values[0].textContent=pct(e?.metrics.completion_fraction);
  if(values[1])values[1].textContent='Not defined';
  text('.badge',e?'Computed':'Not evaluated',card);
  card.title=e?.label||'No result for this strategy in the selected experiment';
}
async function watch(id) {
  state.experimentStop?.();const generation=++state.experimentGeneration;
  state.experiment=await api('/experiments/'+id);
  if(generation!==state.experimentGeneration)return;
  localStorage.setItem('crisissim_experiment_'+page,id);
  state.experimentStop=observeResource('experiments',id,e=>{
    if(generation!==state.experimentGeneration)return;
    state.experiment=e;renderAnalysis();
    note(`${e.spec.kind}: ${e.status} · ${e.evaluations?.length||0} evaluated candidates/trials${e.error?' · '+e.error:''}`);
    if(e.error)showError(e.error);
  },status=>text('#analysis-connection',status));
  renderAnalysis();
}
async function run(kind) {
  if(state.analysisStarting)return;
  const config=structuredClone(active()?.config);
  if(!config)throw Error('Select a saved scenario first.');
  if(config.population>2000||config.flood.duration_s>7200)throw Error('Experiments support up to 2,000 residents and two hours. Create a smaller scenario; inputs will not be silently changed.');
  state.analysisStarting=true;
  try{
    const e=await mutate('/experiments',{kind,config,trials,evaluations:Number($('#optimization-evaluations')?.value||8)});
    state.experiments.unshift(e);populateSelect($('#experiment-select'),state.experiments,e.id,e=>`${e.spec.kind} · ${e.status} · ${e.spec.config.name}`);
    await watch(e.id);
  }finally{state.analysisStarting=false;}
}
function preparePolicy() {
  cards=$$('[onclick^="selectPolicyCard"]');
  recommendations=$$('main > .card:last-child > div:last-child > div');
  cards.forEach(c=>strategyCard(c,null));
  const table=$('main table');rows($('tbody',table),[]);
  const headers=$$('th',table);if(headers[4])headers[4].textContent='Queued admissions';if(headers[6])headers[6].textContent='Cost (model units)';
  text('.badge','No evaluations',table?.closest('.card'));
  for(const c of recommendations){text('strong','Awaiting evaluation',c);text(':scope > div:last-child','Recommendations require computed comparisons.',c);}
  const equityChart=$('#chart-equity-time');
  text('.card-title','Worst-Group Success vs. Evacuation Time',equityChart.closest('.card'));
  text('.badge','Measured outcomes',equityChart.closest('.card'));
  equityChart.nextElementSibling.textContent='Each point is a completed evaluation. Higher worst-group success is better; completed-only time excludes unfinished evacuations.';
  $('#chart-cost-safety').nextElementSibling.textContent='Computed candidates only. NSGA-II provides an approximate frontier, not a guarantee of optimality.';
  text('.product-statement-text','Numerical Policy Optimization');
  text('.product-statement-sub','Matched-seed comparisons and NSGA-II search execute the flood, agent, traffic and dispatch models. No external AI API is used.');
}
function prepareUncertainty() {
  const sliders=$$('.slider-container');
  const specs=[['Rainfall','30–120 mm/h','Independent uniform input'],['Warning delay','100–600 s','Independent uniform input'],
    ['Behavior seed','Varies by trial','Seeded individual behavior'],['Shelter capacity','Fixed per scenario','No staffing variation modeled'],
    ['Warning receipt','Scenario parameter','Not independently sampled']];
  sliders.forEach((s,i)=>{text('.slider-header > span:first-child',specs[i][0],s);text('.slider-val',specs[i][1],s);text(':scope > div:last-child',specs[i][2],s);
    const input=$('input',s);input.disabled=true;input.title='This batch model uses the displayed distribution; this old mock slider is not an implemented parameter.';});
  const hundred=$('#mc-100');hundred.disabled=true;hundred.title='Backend maximum: 50 trials';
  trials=Math.min(50,prefs.simDefaults?.monteCarloRuns||10);
  text('.product-statement-text','No Monte Carlo results selected');
  text('.product-statement-sub','Outcome quantiles are calculated from completed trials. They are not confidence intervals.');
  const histogram=$('#chart-mc-distribution'),sensitivity=$('#chart-sensitivity-tornado');
  text('.badge','Empirical outcomes',histogram.closest('.card'));histogram.nextElementSibling.textContent='Completed trial outcomes; no fitted probability density is assumed.';
  text('.badge','Morris screening',sensitivity.closest('.card'));sensitivity.nextElementSibling.textContent='Mean absolute elementary effect (μ*) on incomplete population. Fixed behavioral seed; independent inputs.';
  caseCards=$$('main > div:last-child > .card');
  for(const [i,c] of caseCards.entries()){
    text('.badge:last-child','Observed trial',c);text(':scope > strong','Awaiting results',c);
    text(':scope > div:nth-child(3)','Outcomes will be ranked by safely evacuated count.',c);
    const fields=$$('.tabular-nums',c);fields.forEach(el=>el.textContent='—');
  }
}
export function setupAnalysis() {
  if(!['policy-lab','uncertainty'].includes(page))return;
  if(page==='policy-lab')preparePolicy();else prepareUncertainty();
  const actions=$('.page-actions');
  if(page==='policy-lab'){
    button('Compare policies',()=>run('comparison'),actions);
    button('Optimize policies',()=>run('optimization'),actions);
    const input=document.createElement('select');input.id='optimization-evaluations';input.className='form-control';input.setAttribute('aria-label','Optimization evaluation budget');
    [8,16,24,48].forEach(n=>input.add(new Option(`${n} evaluations`,n)));actions.append(input);
  }else button('Run sensitivity',()=>run('sensitivity'),actions);
  button('Cancel experiment',async()=>{
    if(!state.experiment)throw Error('No experiment selected.');
    await mutate(`/experiments/${state.experiment.id}/cancel`,{});note('Cancellation requested.');
  },actions);
  const select=document.createElement('select');select.className='form-control';select.id='experiment-select';select.style.maxWidth='260px';select.setAttribute('aria-label','Saved experiment');
  select.addEventListener('change',guard(e=>watch(e.target.value)));actions.append(select);
  const status=document.createElement('span');status.id='analysis-connection';status.className='badge badge-neutral';status.textContent='Ready';actions.append(status);
  Object.assign(window,{
    applyCustomPolicy:guard(()=>run(selected==='optimized'||selected==='cost'?'optimization':'comparison')),
    selectPolicyCard:key=>{selected=key;cards.forEach(c=>c.setAttribute('aria-pressed',String(c.getAttribute('onclick').includes(`'${key}'`))));note(`Selected ${key}. Run Policy Simulation to evaluate ${key==='optimized'||key==='cost'?'NSGA-II candidates':'matched-seed policies'}.`);},
    runMonteCarlo:guard(()=>run('monte_carlo')),
    setMCRuns:n=>{trials=Math.min(50,n);[10,50,100].forEach(i=>$('#mc-'+i)?.classList.toggle('active',i===trials));}
  });
  for(const c of cards){c.tabIndex=0;c.setAttribute('role','button');c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click();}});}
  window.addEventListener('experiments-ready',guard(async()=>{
    const kinds=page==='policy-lab'?['comparison','optimization']:['monte_carlo','sensitivity'];
    const experiments=state.experiments.filter(e=>kinds.includes(e.spec.kind));
    populateSelect(select,experiments,'',e=>`${e.spec.kind} · ${e.status} · ${e.spec.config.name}`);
    const saved=localStorage.getItem('crisissim_experiment_'+page);
    const selected=experiments.find(e=>e.id===saved)||experiments.find(e=>e.spec.config.name===active()?.config.name);
    if(selected){select.value=selected.id;await watch(selected.id);}
  }));
  renderAnalysis();
}
export function renderAnalysis() {
  if(!['policy-lab','uncertainty'].includes(page))return;
  const list=completed(),e=state.experiment;
  if(page==='policy-lab'){
    const base=list.find(e=>e.label==='Baseline'),shelter=list.find(e=>e.label==='Shelter-first'),priority=list.find(e=>e.label==='Vulnerability-prioritized');
    const cheapest=list.reduce((a,b)=>!a||b.metrics.cost<a.metrics.cost?b:a,null);
    const safest=list.reduce((a,b)=>!a||b.metrics.safely_evacuated>a.metrics.safely_evacuated?b:a,null);
    const fair=list.reduce((a,b)=>!a||b.metrics.success_rate_gap<a.metrics.success_rate_gap?b:a,null);
    [base,shelter,e?.spec.kind==='optimization'?cheapest:null,priority,e?.spec.kind==='optimization'?safest:null].forEach((v,i)=>strategyCard(cards[i],v));
    rows($('main tbody'),list.map(v=>[
      v.label,`${pct(v.metrics.completion_fraction)} (${num(v.metrics.safely_evacuated)})`,num(stranded(v.metrics)),
      hours(v.metrics.mean_completed_evacuation_s),Object.values(v.metrics.facilities).reduce((s,f)=>s+f.queued,0),
      'Not defined',num(v.metrics.cost),`Shelters ${v.config.policy.temporary_shelters?'on':'off'} · buses ${v.config.policy.buses} · priority ${v.config.policy.prioritize_vulnerable?'on':'off'}`
    ]));
    text('.badge',`${list.length} evaluated candidates`,$('main table').closest('.card'));
    chart('chart-cost-safety',[{name:'Computed candidate',color:'var(--accent-flood-light)',points:list.map(v=>[v.metrics.cost,v.metrics.safely_evacuated])}],{scatter:true,xLabel:'Cost (model units)',yLabel:'Safely evacuated'});
    chart('chart-equity-time',[{name:'Computed candidate',color:'var(--accent-safe)',points:list.map(v=>[v.metrics.mean_completed_evacuation_s===null?null:v.metrics.mean_completed_evacuation_s/60,100*v.metrics.worst_group_success])}],{scatter:true,xLabel:'Completed mean time (minutes)',yLabel:'Worst-group success (%)'});
    [safest,cheapest,fair,null].forEach((v,i)=>{
      const c=recommendations[i];if(!c)return;
      text('strong',v?.label||(i===3?'No automatic preference':'Awaiting evaluation'),c);
      text(':scope > div:last-child',v?`${num(v.metrics.safely_evacuated)} safe · gap ${pct(v.metrics.success_rate_gap)} · ${num(v.metrics.cost)} cost units`:
        i===3?'Choose a trade-off using computed outcomes and model limitations. No objective weighting is assumed.':'No computed candidate.',c);
    });
  }else{
    if(e?.spec.kind==='monte_carlo'){
      const ranked=[...list].sort((a,b)=>b.metrics.safely_evacuated-a.metrics.safely_evacuated);
      [ranked[0],ranked[Math.floor(ranked.length/2)],ranked.at(-1)].forEach((v,i)=>{
        const c=caseCards[i];if(!c)return;
        text(':scope > strong',v?.label||'Awaiting results',c);
        text(':scope > div:nth-child(3)',v?`${num(v.config.flood.rainfall_mm_h,1)} mm/h · ${num(v.config.behavior.warning_mean_delay_s,1)}s mean warning delay`:'No computed trial.',c);
        $$('.tabular-nums',c).forEach((el,j)=>el.textContent=metricTuple(v?.metrics)[j]);
      });
      const points=[...list].map(v=>100*v.metrics.completion_fraction).sort((a,b)=>a-b).map((v,i)=>[v,(i+1)/list.length*100]);
      chart('chart-mc-distribution',[{name:'Empirical cumulative distribution',color:'var(--accent-flood-light)',points}],{xLabel:'Safely evacuated (%)',yLabel:'Cumulative trial fraction (%)'});
      const q=e.result?.quantiles;
      text('.product-statement-text',q?`Incomplete residents: ${num(q[0][0],1)} / ${num(q[1][0],1)} / ${num(q[2][0],1)}`:`${list.length} completed Monte Carlo trials`);
      text('.product-statement-sub',q?'5th / 50th / 95th empirical outcome percentiles. Independent rainfall and warning-delay inputs; not confidence intervals.':'Waiting for all trials before computing outcome quantiles.');
      text('.product-statement-banner .badge',e.status);
    }else if(e?.spec.kind==='sensitivity'){
      const result=e.result;
      bars('chart-sensitivity-tornado',result?result.names.map((name,i)=>({name:name.replace('_mm_h','').replace('warning_mean_delay_s','Warning delay'),value:result.mu_star[i]})):[],'Morris μ* (incomplete residents)');
      text('.product-statement-text',`${list.length} completed sensitivity evaluations`);
      text('.product-statement-sub','Morris elementary-effects screening of rainfall and warning delay; fixed behavioral seed.');
      text('.product-statement-banner .badge',e.status);
    }else{
      chart('chart-mc-distribution',[]);bars('chart-sensitivity-tornado',[]);
    }
  }
}
