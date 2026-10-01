// Strict public V4 adapter, including operating-threshold overshoot scenarios.
// No credentials, ticket rows or backend writes. Caller must explicitly request a read.
import {CAPACITY, STALE_MS} from './core.mjs';
export const FORECAST_URL='https://cxpexzfwzpggmtlkwone.supabase.co/functions/v1/cws-facility-forecast';
const BASIS='user-confirmed-reporting-assumed-current';
const CUTOVER='2026-10-01T00:07:53.243Z';
const MAX_FETCH_AGE=300000;
const fail=()=>{throw Error('Invalid public forecast contract');};
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:fail();
const count=x=>Number.isSafeInteger(x)&&x>=0?x:fail();
const time=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?x:fail();
const nullableTime=x=>x===null?null:time(x);
const strings=x=>Array.isArray(x)&&x.length<=30&&x.every(s=>typeof s==='string'&&s.length<=300)?[...x]:fail();
const buckets=x=>Object.fromEntries(['confirmed','estimated','pending'].map(k=>[k,{ticketCount:count(x?.[k]?.ticketCount),loadCount:count(x?.[k]?.loadCount),netLb:number(x?.[k]?.netLb)}]));
const assumptions=['source-email-timestamp-is-inventory-measurement-time','inventory-and-ticket-net-pounds-assumed-comparable','measured-inventory-includes-removals-through-measurement','production-continues-at-inferred-rate','no-future-hauls-assumed'];

function scenario(x,threshold,target,sensitivity=false){
  if(x===null)return null;
  const f=x?.full;
  if(!f||f.thresholdLb!==threshold||!['conditional','beyond-horizon','modeled-threshold-crossed'].includes(f.status))fail();
  if(f.status==='conditional'&&(!(number(f.hours)>0)||f.hours>24||!time(f.at)))fail();
  if(f.status==='beyond-horizon'&&(f.hours!==null||f.at!==null))fail();
  if(f.status==='modeled-threshold-crossed'&&(!sensitivity||x.inventoryLb!==null||f.hours!==0||!time(f.at)))fail();
  if(f.status!=='modeled-threshold-crossed'&&number(x.inventoryLb)>=target)fail();
  // Per-hopper redirect estimates are deliberately not exposed by this adapter.
  return {inventoryLb:x.inventoryLb,full:{thresholdLb:threshold,status:f.status,hours:f.hours,at:f.at}};
}

export function parseFacilityForecast(body){
  if(body?.available!==true||body.schemaVersion!==1||body.source!=='HaulTrack+CWS_EMAIL'||body.unit!=='lb'||body.timezone!=='America/Los_Angeles'||body.staleAfterMinutes!==150||body.coverageBasis!==BASIS||body.captureAvailableFrom!==CUTOVER)fail();
  if(JSON.stringify(body.accountingAssumptions)!==JSON.stringify(assumptions)||!Array.isArray(body.facilities)||body.facilities.length!==2)fail();
  const generatedAt=time(body.generatedAt),sourceReadCompletedAt=time(body.sourceReadCompletedAt),ticketDataAsOf=time(body.ticketDataAsOf);
  if(Date.parse(ticketDataAsOf)!==Date.parse(generatedAt)||Date.parse(sourceReadCompletedAt)<Date.parse(generatedAt))fail();
  const seen=new Set();
  const facilities=body.facilities.map(f=>{
    const limits=CAPACITY[f.facility];
    if(!limits||seen.has(f.facility)||f.capacitiesLb?.h1!==limits[0]||f.capacitiesLb?.h2!==limits[1]||f.coverageBasis!==BASIS||f.captureAvailableFrom!==CUTOVER||!['unavailable','provisional','conditional'].includes(f.status))fail();
    seen.add(f.facility);
    const reportedAt=nullableTime(f.measuredAt),rateWindowStart=nullableTime(f.rateWindowStart);
    const measuredHoppersLb=f.measuredHoppersLb===null?null:{h1:number(f.measuredHoppersLb?.h1),h2:number(f.measuredHoppersLb?.h2)};
    const reportedInventoryLb=f.measuredInventoryLb===null?null:number(f.measuredInventoryLb);
    if(measuredHoppersLb&&(reportedInventoryLb===null||!Number.isFinite(measuredHoppersLb.h1+measuredHoppersLb.h2)||Math.abs(measuredHoppersLb.h1+measuredHoppersLb.h2-reportedInventoryLb)>.01))fail();
    const target=measuredHoppersLb?number(reportedInventoryLb+Math.max(0,limits[0]-measuredHoppersLb.h1)+Math.max(0,limits[1]-measuredHoppersLb.h2)):limits[0]+limits[1];
    const overage=measuredHoppersLb&&(measuredHoppersLb.h1>limits[0]||measuredHoppersLb.h2>limits[1]);
    const reasons=strings(f.reasons),warnings=strings(f.warnings),rateWindowHauls=buckets(f.rateWindowHauls),postAnchor=buckets(f.postAnchor);
    if(!['insufficient-post-protocol-history','single-interval-provisional','two-interval-comparison'].includes(f.historyQuality)||f.noCreditBasis!=='same-inferred-rate; no-credit-for-pending-or-approximate-post-anchor-removals; not-a-guaranteed-bound')fail();
    const expected=scenario(f.expected,limits[0]+limits[1],target),noCredit=scenario(f.noApproximateRemovalCredit,limits[0]+limits[1],target,true);
    const rate=f.productionLbPerHour===null?null:number(f.productionLbPerHour);
    if(f.status==='unavailable'&&(expected!==null||noCredit!==null||rate!==null))fail();
    if(f.status!=='unavailable'){
      if(!expected||!noCredit||!(rate>0)||reasons.length||!reportedAt||!rateWindowStart||!measuredHoppersLb||Date.parse(rateWindowStart)<Date.parse(CUTOVER)||Date.parse(rateWindowStart)>=Date.parse(reportedAt)||Date.parse(reportedAt)>Date.parse(generatedAt))fail();
      if(f.status==='conditional'&&(f.historyQuality!=='two-interval-comparison'||postAnchor.pending.ticketCount+rateWindowHauls.pending.ticketCount+postAnchor.estimated.ticketCount+rateWindowHauls.estimated.ticketCount>0))fail();
      if(overage&&Object.values(postAnchor).some(b=>b.ticketCount>0||b.loadCount>0||b.netLb>0))fail();
      for(const s of [expected,noCredit]){
        if(s.full.status==='conditional'&&Math.abs((target-s.inventoryLb)/rate-s.full.hours)>1e-8)fail();
        if(s.full.status==='beyond-horizon'&&(target-s.inventoryLb)/rate<=24)fail();
      }
      for(const s of [expected,noCredit])if(s.full.status==='conditional'&&Math.abs(Date.parse(s.full.at)-Date.parse(generatedAt)-s.full.hours*3600000)>2)fail();
    }
    const observedBothFull=measuredHoppersLb?measuredHoppersLb.h1>=limits[0]&&measuredHoppersLb.h2>=limits[1]:null;
    if(f.observedBothFull!==observedBothFull)fail();
    return {facility:f.facility,status:f.status,reportedAt,reportedInventoryLb,measuredHoppersLb,observedBothFull,rateWindowStart,productionLbPerHour:rate,reasons,warnings,historyQuality:f.historyQuality,rateWindowHauls,postAnchor,expected,noCredit,noCreditBasis:f.noCreditBasis,modeledFullThresholdCrossedAt:nullableTime(f.modeledFullThresholdCrossedAt),excludedTicketCount:count(f.excludedTicketCount),lateArrivalCount:count(f.lateArrivalCount)};
  });
  return {generatedAt,sourceReadCompletedAt,ticketDataAsOf,coverageBasis:BASIS,captureAvailableFrom:CUTOVER,staleAfterMinutes:150,accountingAssumptions:[...assumptions],unknownFacilityTicketCount:count(body.unknownFacilityTicketCount),facilities};
}

// Call on each display tick, not just at fetch time. Absolute ETA never resets.
export function selectFacilityForecast(parsed,facility,report,now=Date.now()){
  const f=parsed?.facilities.find(item=>item.facility===facility);
  const unavailable=reason=>({status:'unavailable',reason,expected:null,noCredit:null});
  if(!f)return unavailable('Forecast unavailable');
  if(!Number.isFinite(now)||now<Date.parse(parsed.sourceReadCompletedAt)||now-Date.parse(parsed.ticketDataAsOf)>MAX_FETCH_AGE)return unavailable('Forecast refresh required or device clock incorrect');
  if(report&&(report.ts>now||now-report.ts>STALE_MS))return unavailable('Report stale or future-dated');
  if(f.status==='unavailable')return {...f,reason:f.reasons.join('; ')};
  if(!report||report.ts!==Date.parse(f.reportedAt)||report.h1!==f.measuredHoppersLb?.h1||report.h2!==f.measuredHoppersLb?.h2)return unavailable('Report and forecast anchors differ — refresh required');
  if(report.ts>now||now-report.ts>STALE_MS)return unavailable('Report stale or future-dated');
  const countdown=s=>s?.full.at===null?null:Math.max(0,(Date.parse(s.full.at)-now)/1000);
  return {...f,inventoryAsOf:parsed.generatedAt,secondsUntilFull:countdown(f.expected),noCreditSecondsUntilFull:countdown(f.noCredit),thresholdTimeReached:f.expected.full.at!==null&&Date.parse(f.expected.full.at)<=now,assumption:'Conditional on continued production, flow redirection, and no future haul-outs. Reporting assumed current; delayed or unsubmitted loads may change this estimate.'};
}

export async function readFacilityForecast(fetchImpl=fetch){
  const response=await fetchImpl(FORECAST_URL,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Forecast unavailable');
  return parseFacilityForecast(await response.json());
}
