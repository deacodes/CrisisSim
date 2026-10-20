// Presentation only. Inputs are persisted numerical results, never forecasts
// generated in the browser. Keep the original SVG chart style and containers.
import {escapeHTML as esc, number as num} from './api-client.js';

export function chart(id, series, {xLabel='Elapsed minutes', yLabel='', scatter=false}={}) {
  const host=document.getElementById(id);
  if(!host)return;
  const valid=series.map(s=>({...s, points:s.points.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]))}));
  const points=valid.flatMap(s=>s.points);
  if(!points.length){host.textContent='No computed results yet.';return;}
  const width=440,height=210,pad={left:58,right:20,top:18,bottom:44};
  const xmax=Math.max(1,...points.map(p=>p[0])), ymax=Math.max(1,...points.map(p=>p[1]));
  const x=v=>pad.left+v/xmax*(width-pad.left-pad.right);
  const y=v=>height-pad.bottom-v/ymax*(height-pad.top-pad.bottom);
  const ticks=[0,.25,.5,.75,1];
  host.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(yLabel)} by ${esc(xLabel)}" style="width:100%;height:100%;font-family:var(--font-sans)">
    ${ticks.map(t=>`<line x1="${pad.left}" x2="${width-pad.right}" y1="${y(t*ymax)}" y2="${y(t*ymax)}" stroke="var(--border-subtle)" stroke-dasharray="3 3"/>
      <text x="${pad.left-8}" y="${y(t*ymax)+4}" fill="var(--text-muted)" text-anchor="end" font-size="11">${num(t*ymax,t*ymax<10?2:0)}</text>
      <text x="${x(t*xmax)}" y="${height-24}" fill="var(--text-muted)" text-anchor="middle" font-size="11">${num(t*xmax,1)}</text>`).join('')}
    ${valid.map(s=>scatter?s.points.map(p=>`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="${s.color}"><title>${esc(s.name)}: ${num(p[0],2)}, ${num(p[1],2)}</title></circle>`).join(''):
      `<path d="${s.points.map((p,i)=>`${i?'L':'M'}${x(p[0])},${y(p[1])}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`).join('')}
    <text x="${width/2}" y="${height-5}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${esc(xLabel)}</text>
    <text x="${pad.left}" y="12" font-size="11" fill="var(--text-secondary)">${esc(yLabel)}</text></svg>`;
}

export function bars(id, rows, label='Evacuation success (%)') {
  const host=document.getElementById(id);if(!host)return;
  const data=rows.filter(r=>Number.isFinite(r.value));
  if(!data.length){host.textContent='No computed results yet.';return;}
  const max=Math.max(1,...data.map(r=>r.value));
  host.innerHTML=`<svg viewBox="0 0 440 ${Math.max(160,data.length*25+30)}" role="img" aria-label="${esc(label)}" style="width:100%;height:100%;font-family:var(--font-sans)">
    <text x="10" y="12" fill="var(--text-secondary)" font-size="11">${esc(label)}</text>
    ${data.map((r,i)=>`<text x="10" y="${34+i*25}" fill="var(--text-secondary)" font-size="11">${esc(r.name)}</text>
      <rect x="140" y="${23+i*25}" width="${240*r.value/max}" height="14" fill="var(--accent-flood-light)"/>
      <text x="390" y="${34+i*25}" fill="var(--text-primary)" font-size="11">${num(r.value,1)}</text>`).join('')}</svg>`;
}
