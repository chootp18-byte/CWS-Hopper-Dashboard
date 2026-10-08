import {CAPACITY,STALE_MS} from './core.mjs';
// A source-rate scenario, not an estimate of actual removals or a safe deadline.
export function preliminaryForecast(facility,report,now=Date.now()){
  const unavailable=reason=>({status:'unavailable',reason});
  const cap=CAPACITY[facility];
  if(!cap||!report||![report.ts,report.h1,report.h2,now].every(Number.isFinite)||report.h1<0||report.h2<0)return unavailable('Missing or invalid source report');
  if(report.ts>now)return unavailable('Source report is future-dated');
  if(now-report.ts>STALE_MS)return unavailable('Source report is stale');
  if(typeof report.feeding!=='boolean')return unavailable('Feeding state unconfirmed');
  if(report.productionRateBasis!=='source-email'||report.productionRateReportedAt!==report.ts||typeof report.reportedProductionLbPerHour!=='number'||!Number.isFinite(report.reportedProductionLbPerHour))return unavailable('Reported production rate missing or not matched to this report');
  const rate=report.reportedProductionLbPerHour;
  if(rate<=0)return unavailable('Reported production rate is zero or invalid');
  const room=Math.max(0,cap[0]-report.h1)+Math.max(0,cap[1]-report.h2);
  const hours=room/rate,at=report.ts+hours*3600000;
  if(!Number.isFinite(at)||Math.abs(at)>8.64e15||!Number.isFinite(hours))return unavailable('Reported production calculation is invalid');
  return {status:'preliminary',reportedAt:report.ts,rateLbPerHour:rate,roomAtReportLb:room,restart:!report.feeding,hoursFromRestart:hours,beyondHorizon:hours>24,fullAt:report.feeding?at:null,secondsRemaining:report.feeding?Math.max(0,(at-now)/1000):null,thresholdTimeReached:report.feeding&&at<=now};
}
export const pacificStamp=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(t));
