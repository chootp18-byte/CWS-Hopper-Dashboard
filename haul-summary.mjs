// Read-only, aggregate-only contract. Never convert these totals to facility loads.
// Approved public aggregate function; no key or raw-ticket access is required.
export const HAUL_SUMMARY_URL='https://cxpexzfwzpggmtlkwone.supabase.co/functions/v1/cws-hauling-summary';
export function normalizeHaulSummary(body) {
  if(!body||!Array.isArray(body.days))throw Error('Invalid HaulTrack summary');
  if(body.weight_basis!=='haultrack-recorded-pound-convention'||body.weight_quality_policy!=='20000-100000-lb-per-load-v1')throw Error('Unknown weight basis or quality policy');
  const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const instant=value=>date(value)&&/(Z|[+-]\d{2}:\d{2})$/.test(value);
  if(!date(body.window_start)||!date(body.window_end)||Date.parse(body.window_start)>Date.parse(body.window_end))throw Error('Invalid summary window');
  if(!instant(body.source_fetched_at))throw Error('Source fetch timestamp requires an offset');
  if(body.latest_ticket_entry_at!=null&&!instant(body.latest_ticket_entry_at))throw Error('Invalid latest entry timestamp');
  const weight=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const group=raw=>{
    if(!raw)throw Error('Missing summary group');
    for(const field of ['ticket_count','load_count','unknown_facility_count','accepted_weight_ticket_count','excluded_weight_ticket_count'])if(!Number.isInteger(raw[field])||raw[field]<0)throw Error('Invalid summary count');
    if(raw.unknown_facility_count>raw.ticket_count)throw Error('Unknown facility count exceeds tickets');
    if(raw.accepted_weight_ticket_count+raw.excluded_weight_ticket_count!==raw.ticket_count)throw Error('Weight coverage counts do not reconcile');
    const allExcluded=raw.ticket_count>0&&raw.accepted_weight_ticket_count===0;
    const pounds=allExcluded?null:weight(raw.net_lb),tons=allExcluded?null:weight(raw.net_short_tons);
    return {ticketCount:raw.ticket_count,loadCount:raw.load_count,unknownFacilityCount:raw.unknown_facility_count,acceptedWeightTicketCount:raw.accepted_weight_ticket_count,excludedWeightTicketCount:raw.excluded_weight_ticket_count,recordedNetLb:pounds,recordedNetShortTons:tons,weightStatus:allExcluded||pounds===null?'unavailable':raw.excluded_weight_ticket_count>0?'partial':'complete'};
  };
  const dates=new Set();
  const days=body.days.map(day=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date))throw Error('Invalid summary date');
    if(dates.has(day.date)||day.date<body.window_start.slice(0,10)||day.date>body.window_end.slice(0,10))throw Error('Duplicate or out-of-window summary date');
    dates.add(day.date);
    return {date:day.date,verified:group(day.verified),pending:group(day.pending)};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  // "Verified" is ticket workflow status, not evidence that historical units were audited.
  // Dates are ticket_date, not created_at or actual haul occurrence. No inferred timezone.
  return {source:'HaulTrack',dateBasis:'ticket-date',unitBasis:body.weight_basis,weightQualityPolicy:body.weight_quality_policy,weightReviewStatus:'range-screened-not-unit-certified',windowStart:body.window_start,windowEnd:body.window_end,generatedAt:body.source_fetched_at,latestTicketEntryAt:body.latest_ticket_entry_at??null,days};
}
export async function readHaulSummary(url=HAUL_SUMMARY_URL,fetchImpl=fetch) {
  if(!url)return null;
  const response=await fetchImpl(url,{method:'GET',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('HaulTrack summary unavailable');
  return normalizeHaulSummary(await response.json());
}
