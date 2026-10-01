import {normalize} from './core.mjs';
// Existing public CWS read endpoint, unchanged from repository main.
// No token, Sheet ID, loadout endpoint or write operation is used here.
export const CWS_READINGS_URL='https://script.google.com/macros/s/AKfycbzKlIuwgFqQ4INdVpJvmB-YtYbFK1GspYEvZ9XQjhACAORv3tis7WWtc9wWr_KwrOgifQ/exec?action=readings';
export async function readCurrentCWS(fetchImpl=fetch) {
  const response=await fetchImpl(CWS_READINGS_URL,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('CWS reading request failed');
  const body=await response.json();
  if(body.status!=='ok'||!Array.isArray(body.data))throw Error('Unexpected CWS reading response');
  // Whitelist report fields; never carry ticket/photo/driver information through.
  const rows=body.data.map(r=>({Timestamp:r.Timestamp,Facility:r.Facility,H1:r.H1,H2:r.H2,Feeding:r.Feeding,FeedTank:r.FeedTank}));
  const normalized=normalize(rows);
  // Optional additive source fields. Never infer a rate from inventory, feeding,
  // previous reports, or facility defaults. Ambiguous duplicates lose rate only.
  for(const [facility,reports] of Object.entries(normalized))for(const report of reports){
    const candidates=body.data.filter(r=>r.Facility===facility&&Date.parse(r.Timestamp)===report.ts).map(r=>{
      const rate=r.ReportedProductionLbPerHour;
      const at=r.ProductionRateReportedAt;
      return typeof rate==='number'&&Number.isFinite(rate)&&rate>=0&&typeof at==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(at)&&Date.parse(at)===report.ts&&r.ProductionRateBasis==='source-email'
        ? {reportedProductionLbPerHour:rate,productionRateReportedAt:report.ts,productionRateBasis:'source-email'} : null;
    });
    if(candidates[0]&&candidates.every(value=>JSON.stringify(value)===JSON.stringify(candidates[0])))Object.assign(report,candidates[0]);
  }
  return normalized;
}
