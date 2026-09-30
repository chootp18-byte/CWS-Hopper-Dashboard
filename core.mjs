// Operational full-capacity limits confirmed by the user on 2026-09-30.
// Both hoppers full triggers facility shutdown; flow can redirect to available room.
export const CAPACITY = {DM:[129000,130000],RC:[105000,109000]};
export const STALE_MS = 150 * 60000; // two-hour reports plus 30-minute grace
export function bothFullProjection(rows, capacity, now, loads=[], coverage='unknown', routing='unknown') {
  const latest=rows.at(-1),previous=rows.at(-2);
  if(!latest)return {reason:'No valid source report'};
  if(latest.ts>now)return {reason:'Source timestamp is in the future'};
  if(now-latest.ts>STALE_MS)return {reason:'Stale report — timing unavailable'};
  if(latest.h1>=capacity[0]&&latest.h2>=capacity[1])return {atCapacity:true,reason:'Both measured hoppers at confirmed full limits — check site status now'};
  if(latest.h1>capacity[0]||latest.h2>capacity[1])return {reason:'A reading exceeds its confirmed full limit — verify the reading before projecting'};
  if(!latest.feeding)return {reason:'Feeding was off — no positive-flow ETA'};
  if(coverage!=='verified-fixture')return {reason:'Load coverage or ticket review incomplete — timing unavailable'};
  if(routing!=='redirect')return {reason:'Flow routing after first hopper fills is unconfirmed'};
  if(!previous||!previous.feeding||latest.ts<=previous.ts||latest.ts-previous.ts>STALE_MS)return {reason:'Need two recent feeding reports'};
  const estimate=forecast(rows,now,loads);
  if(estimate.reason)return {reason:estimate.reason};
  if(!(estimate.rate>0))return {reason:'No positive production rate — timing unavailable'};
  const remaining=capacity[0]+capacity[1]-estimate.total;
  const bothAt=now+remaining/estimate.rate*3600000;
  return {bothAt,rate:estimate.rate,remaining:Math.max(0,remaining),hours:Math.max(0,remaining/estimate.rate),addedBack:estimate.addedBack,removed:estimate.removed,reached:remaining<=0,projectionOnly:true};
}
export function loadEventsToRecords(events) {
  const latest=new Map();
  for(const event of events) {
    if(!event.source||!event.ticketId||!Number.isInteger(event.version)||event.version<1) throw Error('Load event requires source, stable ticket ID and version');
    const key=JSON.stringify([event.source,event.ticketId]),prior=latest.get(key);
    if(prior&&event.version===prior.version&&JSON.stringify(event)!==JSON.stringify(prior)) throw Error('Conflicting ticket version');
    if(!prior||event.version>prior.version) latest.set(key,event);
  }
  return [...latest.values()].filter(e=>e.reviewStatus==='approved'&&!e.deleted).map(e=>{
    // Untimed/uncertain loads remain in upstream history, never timed estimates.
    if(e.timestampBasis!=='actual-loading'||e.timeConfidence!=='verified'||!e.timezone) return null;
    if(e.unit!=='lb'||e.unitBasis!=='verified-net-pounds') throw Error('Load unit basis must be verified net pounds; legacy database unit is not authoritative');
    const entry=Date.parse(e.entryTime),exit=Date.parse(e.exitTime);
    const offset=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s);
    if(!CAPACITY[e.facility]||!offset(e.entryTime)||!offset(e.exitTime)||!Number.isFinite(entry)||!Number.isFinite(exit)||entry>=exit||!Number.isInteger(e.netPounds)||e.netPounds<=0) throw Error('Approved ticket requires verified facility, loading times and net pounds');
    return {id:e.ticketId,version:e.version,source:e.source,facility:e.facility,entry,exit,weight:e.netPounds,truck:e.truck||'',state:'confirmed'};
  }).filter(Boolean);
}
export function normalize(rows) {
  const result={DM:[],RC:[]};
  const seen=new Map();
  for (const r of rows) {
    if (!result[r.Facility] || !/^\d{4}-.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.Timestamp)) throw Error('Invalid facility or timestamp offset');
    const ts=Date.parse(r.Timestamp);
    const nums=[r.H1,r.H2,r.FeedTank].map(v=>typeof v==='number' || (typeof v==='string' && v.trim()!=='') ? Number(v) : NaN);
    if (!Number.isFinite(ts)||nums.some(v=>!Number.isFinite(v)||v<0)) throw Error('Missing or invalid report values');
    if (![true,false,'true','false','TRUE','FALSE'].includes(r.Feeding)) throw Error('Invalid feeding state');
    const row={ts,h1:nums[0],h2:nums[1],feedTank:nums[2],feeding:String(r.Feeding).toLowerCase()==='true'};
    const key=r.Facility+ts, signature=JSON.stringify(row);
    if(seen.has(key)&&seen.get(key)!==signature) throw Error('Conflicting duplicate report');
    if(!seen.has(key)) result[r.Facility].push(row);
    seen.set(key,signature);
  }
  Object.values(result).forEach(rows=>rows.sort((a,b)=>a.ts-b.ts));
  return result;
}
// Loads must already be reconciled records from the adapter, never browser drafts.
// Half-open intervals (start, end] count boundary events exactly once.
export function intervalLoads(loads, start, end) {
  return loads.filter(l=>l.exit>start && l.exit<=end).reduce((sum,l)=>sum+l.weight,0);
}
export function forecast(rows, now=Date.now(), loads=[]) {
  const last=rows.at(-1), prev=rows.at(-2);
  if(!last) return {reason:'No measured report available'};
  if(last.ts>now) return {reason:'Report timestamp is in the future'};
  if(now-last.ts>STALE_MS) return {reason:'Report is stale — forecast paused'};
  const trusted=loads.filter(l=>l.state==='confirmed' || l.state==='confirmed-fixture');
  if(trusted.some(l=>!Number.isFinite(l.entry)||!Number.isFinite(l.exit)||l.entry>=l.exit||!Number.isFinite(l.weight)||l.weight<=0)) return {reason:'Invalid load history — forecast paused'};
  const boundaries=[last.ts,...(prev?[prev.ts]:[])];
  if(trusted.some(l=>boundaries.some(t=>l.entry<t&&l.exit>t)||l.entry<=now&&l.exit>now)) return {reason:'Loading overlaps a measurement or is in progress — forecast paused'};
  const removed=intervalLoads(trusted,last.ts,now);
  if(!last.feeding) {
    const total=last.h1+last.h2-removed;
    return total<0 ? {reason:'Loads exceed available weight — verify records'} : {rate:0,total,removed,addedBack:0,mode:'off'};
  }
  if(!prev || last.ts<=prev.ts || last.ts-prev.ts>STALE_MS || !prev.feeding) return {reason:'Need two recent feeding reports'};
  const addedBack=intervalLoads(trusted,prev.ts,last.ts);
  const change=last.h1+last.h2-prev.h1-prev.h2+addedBack;
  if(change<0) return {reason:'Weight fell beyond recorded loads — forecast unavailable'};
  const rate=change/((last.ts-prev.ts)/3600000);
  const total=last.h1+last.h2+rate*(now-last.ts)/3600000-removed;
  if(total<0) return {reason:'Loads exceed available weight — verify records'};
  return {rate,total,removed,addedBack,mode:'feeding'};
}
export function loadPayload(v) {
  const entry=new Date(v.entry),exit=new Date(v.exit),weight=Number(v.weight);
  if(!CAPACITY[v.facility]||!Number.isFinite(+entry)||!Number.isFinite(+exit)||exit<=entry||exit>Date.now()||!Number.isInteger(weight)||weight<=0||weight>200000||!v.truck.trim()) throw Error('Check truck, entry/exit times and whole-pound net weight (1–200,000 lb). Exit must be after entry and not in the future.');
  return {action:'add',timestamp:exit.toISOString(),entryTime:entry.toISOString(),exitTime:exit.toISOString(),facility:v.facility,hopper:'combined',weight,truck:v.truck.trim(),notes:v.notes.trim()};
}
export function persistDraft(storage,payload) {
  const key='cws-dev-drafts-v1',items=JSON.parse(storage.getItem(key)||'[]');
  if(!Array.isArray(items)) throw Error('Draft storage is invalid; export or recover it before saving');
  const fingerprint=JSON.stringify(payload);
  if(items.some(d=>JSON.stringify(d.payload)===fingerprint)) return {duplicate:true,items};
  items.push({id:crypto.randomUUID(),created:new Date().toISOString(),state:'browser-draft',payload});
  const encoded=JSON.stringify(items);
  storage.setItem(key,encoded);
  if(storage.getItem(key)!==encoded) throw Error('Browser storage verification failed');
  return {duplicate:false,items};
}
