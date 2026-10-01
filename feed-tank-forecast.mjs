import {STALE_MS} from './core.mjs';
import {pacificStamp} from './preliminary-forecast.mjs';
export const TANK_RULES=Object.freeze({DM:{thresholdFt:5,inclusive:false},RC:{thresholdFt:8,inclusive:false}});
// Review proposal: do not extrapolate tiny intervals or bridge missed report cycles.
export const MIN_TANK_INTERVAL_MS=30*60000;
export function feedTankForecast(facility,rows,now=Date.now()){
  const rule=TANK_RULES[facility];
  const unavailable=(reason,fields={})=>({status:'unavailable',reason,...fields});
  if(!rule||!Array.isArray(rows)||!Number.isFinite(now))return unavailable('Invalid tank source');
  const unique=new Map();
  for(const row of rows){
    if(!row||!Number.isFinite(row.ts)||!Number.isFinite(row.feedTank)||row.feedTank<0)return unavailable('Missing or invalid tank reading');
    if(unique.has(row.ts)&&unique.get(row.ts).feedTank!==row.feedTank)return unavailable('Conflicting tank reports');
    unique.set(row.ts,row);
  }
  const sorted=[...unique.values()].sort((a,b)=>a.ts-b.ts),latest=sorted.at(-1),previous=sorted.at(-2);
  if(!latest)return unavailable('Waiting for tank reports');
  // Legacy intake defaults an absent FeedTank match to zero; no validity flag exists.
  if(latest.feedTank===0)return unavailable('Zero tank value is unverified: the intake can use zero for a missing level. Check the source report/site.',{...rule,reportedAt:latest.ts,reportedFt:0,unverifiedZero:true,observedTrigger:false});
  const observedTrigger=rule.inclusive?latest.feedTank<=rule.thresholdFt:latest.feedTank<rule.thresholdFt;
  const fields={...rule,reportedAt:latest.ts,reportedFt:latest.feedTank,observedTrigger};
  if(latest.ts>now)return unavailable('Tank report is future-dated',fields);
  if(now-latest.ts>STALE_MS)return unavailable('Tank report is stale — check site conditions',fields);
  // Reuse the same latest report pair for the visible net-level trend, even below the limit.
  const interval=previous?latest.ts-previous.ts:0;
  if(previous?.feedTank>0&&interval>=MIN_TANK_INTERVAL_MS&&interval<=STALE_MS){
    const drop=(previous.feedTank-latest.feedTank)/(interval/3600000);
    if(Number.isFinite(drop)){fields.trendStart=previous.ts;fields.declineFtPerHour=drop;fields.tankTrend=drop>0?'declining':drop<0?'rising':'steady';}
  }
  if(observedTrigger)return {status:'observed-threshold',...fields};
  if(!previous)return unavailable('Need two actual tank reports to establish a decline',fields);
  if(previous.feedTank===0)return unavailable('Previous zero tank value is unverified - need two valid levels',fields);
  const elapsed=latest.ts-previous.ts;
  if(elapsed<MIN_TANK_INTERVAL_MS||elapsed>STALE_MS)return unavailable('Tank report interval unsuitable — need reports 30–150 minutes apart',fields);
  if(latest.feedTank>previous.feedTank)return unavailable('Tank level rose — trend reset; wait for a new declining interval',fields);
  if(latest.feedTank===previous.feedTank)return unavailable('Tank level is not declining — no projected low-level time',fields);
  const declineFtPerHour=fields.declineFtPerHour;
  const hoursToBoundary=(latest.feedTank-rule.thresholdFt)/declineFtPerHour;
  const boundaryAt=latest.ts+hoursToBoundary*3600000;
  if(!Number.isFinite(boundaryAt)||Math.abs(boundaryAt)>8.64e15)return unavailable('Tank trend cannot produce a valid time',fields);
  return {status:'provisional',...fields,trendStart:previous.ts,declineFtPerHour,boundaryAt,strictCrossing:!rule.inclusive,
    secondsToBoundary:Math.max(0,(boundaryAt-now)/1000),boundaryTimeReached:boundaryAt<=now,longRange:hoursToBoundary>24};
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function feedTankHTML(facility,rows,now=Date.now(),{sourceReadFailed=false}={}){
  const f=feedTankForecast(facility,rows,now),rule=TANK_RULES[facility];
  if(!rule)return '';
  const label=`Below ${rule.thresholdFt} ft`;
  const active=f.status==='provisional'&&!sourceReadFailed;
  const rate=f.declineFtPerHour;
  const dropText=sourceReadFailed?'Unavailable':f.tankTrend==='declining'?
    (rate>=.01?rate.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):rate.toLocaleString('en-US',{maximumSignificantDigits:3}))+' ft/hr':
    f.tankTrend==='rising'?'Rising':f.tankTrend==='steady'?'Steady':'Unavailable';
  let title='Not projectable at current trend',detail=sourceReadFailed?'Source refresh failed — tank timing withheld.':f.reason||'';
  if(!sourceReadFailed&&f.status==='observed-threshold'){title='Low-level threshold reported';detail='Check site status now. This is the last reported level, not live telemetry.';}
  if(active){title=`${pacificStamp(f.boundaryAt)}`;detail=f.boundaryTimeReached?'Trend boundary time reached — confirm actual level.':`${Math.ceil(f.secondsToBoundary/3600)} hours to the trend boundary (approximate).`;}
  return `<div class="tank-projection ${f.observedTrigger?'urgent':''}" data-tank-facility="${facility}"><small>SEPARATE SHUTDOWN CAUSE · FEED TANK LOW</small><p><strong>${f.reportedFt===undefined?'Level unavailable':`${f.reportedFt.toLocaleString('en-US',{maximumFractionDigits:6})} ft ${f.unverifiedZero?'unverified':'reported'}`}</strong> · Trigger: ${label}</p><div class="tank-drop">Tank drop: <strong>${esc(dropText)}</strong></div><div class="tank-eta">${esc(title)}</div><p>${esc(detail)}</p>${f.reportedAt!==undefined?`<p class="muted">Source report ${pacificStamp(f.reportedAt)}.</p>`:''}${f.trendStart!==undefined?`<p class="muted">Tank drop interval: ${pacificStamp(f.trendStart)} to ${pacificStamp(f.reportedAt)}. Average net level change, not physical consumption.</p>`:''}${active?`<p><strong>PROVISIONAL</strong> · ${f.declineFtPerHour.toLocaleString('en-US',{maximumFractionDigits:4})} ft/hour net level decline.</p><p class="muted">Trend ${pacificStamp(f.trendStart)} to ${pacificStamp(f.reportedAt)}. Conditional on uninterrupted net decline; inflows/refills are unknown. An earlier hopper-full shutdown could interrupt this trend, so the projected tank crossing may never occur. This is not a physical consumption rate or guaranteed shutdown time.${f.longRange?' More than 24 hours from the report: especially uncertain.':''}${f.strictCrossing?` Exactly ${rule.thresholdFt} ft is not yet the shutdown condition; continuing decline crosses below it just afterward.`:''}</p>`:''}${f.observedTrigger&&f.status==='unavailable'?'<p class="warning">Last report met the low-level rule; source freshness prevents claiming a current state.</p>':''}<p class="muted">Independent of hopper fullness and truck load weights.</p></div>`;
}
