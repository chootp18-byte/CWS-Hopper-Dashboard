import {STALE_MS} from './core.mjs';

// Reported operating state, independent of calculated flow or forecast availability.
export function feedingStatus(report,now=Date.now(),sourceReadFailed=false){
  const unknown=detail=>({state:'unknown',label:'STATUS UNKNOWN',detail});
  if(sourceReadFailed)return unknown('Source refresh failed');
  if(!report||![now,report.ts,report.h1,report.h2,report.feedTank].every(Number.isFinite)||[report.h1,report.h2,report.feedTank].some(v=>v<0)||typeof report.feeding!=='boolean')return unknown('No valid feeding report');
  if(report.ts>now)return unknown('Report timestamp is in the future');
  if(now-report.ts>STALE_MS)return unknown('Report overdue — confirm site status');
  return report.feeding?{state:'running',label:'RUNNING',detail:'Feeding in latest report'}:{state:'off',label:'NOT FEEDING',detail:'Feeding off in latest report'};
}
export function feedingStatusHTML(report,now=Date.now(),sourceReadFailed=false){
  const s=feedingStatus(report,now,sourceReadFailed);
  return `<div class="feed-status feed-${s.state}" data-feed-state="${s.state}"><strong>${s.label}</strong><span>${s.detail}</span></div>`;
}
