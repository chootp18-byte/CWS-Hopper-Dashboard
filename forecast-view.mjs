import {selectFacilityForecast} from './facility-forecast.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const stamp=t=>new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function reasonText(reason=''){
  if(reason.includes('stale'))return 'Report overdue — timing paused. Confirm conditions at the facility.';
  if(reason.includes('need-two-post-protocol'))return 'Waiting for new reports after load-tracking update';
  if(reason.includes('anchors differ'))return 'Report and forecast are updating — waiting for matching source reports.';
  if(reason.includes('refresh')||reason.includes('clock'))return 'Forecast needs a fresh update. Check your device clock if this continues.';
  if(reason.includes('modeled-full-threshold')||reason.includes('interval-modeled-full'))return 'The model reached the full threshold. Confirm site conditions; further production is unknown.';
  if(reason.includes('over-threshold'))return 'A hopper report exceeds its full operating limit. Confirm the reading and routing before using an estimate.';
  if(reason.includes('feeding'))return 'Feeding is stopped or unconfirmed — timing paused.';
  if(reason.includes('noisy')||reason.includes('nonpositive'))return 'Recent reports do not establish a consistent positive production rate.';
  if(reason.includes('negative')||reason.includes('balance'))return 'Reported inventory and load timing do not balance. Timing paused for review.';
  if(reason.includes('ticket')||reason.includes('delayed'))return 'Load details need review before a facility estimate is available.';
  return 'Forecast temporarily unavailable. Reported hopper weights and hauling totals are shown independently.';
}
export function forecastHTML(parsed,facility,report,now=Date.now()){
  const f=selectFacilityForecast(parsed,facility,report,now),active=f.status!=='unavailable';
  const both=report&&report.h1>=(facility==='DM'?129000:105000)&&report.h2>=(facility==='DM'?130000:109000);
  const title=active?(f.thresholdTimeReached?'Projected full time reached':f.expected.full.at?`About ${stamp(f.expected.full.at)}`:'Beyond the 24-hour forecast window'):'Timing unavailable';
  const minutes=active&&f.secondsUntilFull!==null?Math.ceil(f.secondsUntilFull/60):null;
  const counts=active?`Pending loads used: ${fmt(f.rateWindowHauls.pending.ticketCount)} in the production interval; ${fmt(f.postAnchor.pending.ticketCount)} after the report.`:'';
  const sensitivity=active?(f.noCredit.full.status==='modeled-threshold-crossed'?`Model crossed at ${stamp(f.noCredit.full.at)}; production afterward is unknown.`:f.noCredit.full.at?`About ${stamp(f.noCredit.full.at)}`:'Beyond 24 hours'):'';
  return `<div class="shutdown-projection ${both||f.thresholdTimeReached?'urgent':''}"><small>PROJECTED SHUTDOWN · BOTH HOPPERS FULL</small><div class="eta">${esc(title)}</div>${both?'<p class="warning">Both hoppers were at or above their full operating limits in the report. Check site status now.</p>':''}<p class="eta-date">${active?`${f.status==='provisional'?'PROVISIONAL':'CONDITIONAL'} · ${minutes===null?'Long-range estimate':`${Math.floor(minutes/60)}h ${minutes%60}m remaining`}`:esc(reasonText(f.reason))}</p>${active?`<p><strong>${fmt(f.productionLbPerHour)} lb/hour estimated production</strong></p><p>${fmt(f.expected.inventoryLb)} lb combined estimate as of ${stamp(f.inventoryAsOf)}.</p><p class="confidence">${f.historyQuality==='single-interval-provisional'?'Only two reports — consistency cannot yet be assessed.':'Two production intervals compared; this is not statistical confidence.'} ${esc(counts)}</p><p class="muted">Rate interval ${stamp(f.rateWindowStart)} to ${stamp(f.reportedAt)}. Report timestamp is a proxy for inventory time.</p><details><summary>Sensitivity: no pending / approximate removal credit</summary><p>${esc(sensitivity)}</p><p>Same inferred production rate; excludes pending and approximate removals after the report only. Earlier uncertain loads can affect the rate. This is not a guaranteed or conservative bound.</p></details>`:''}${f.modeledFullThresholdCrossedAt?`<p class="warning">Model reached the threshold at ${stamp(f.modeledFullThresholdCrossedAt)}. This does not confirm an observed shutdown.</p>`:''}<p class="muted">Assumes flow redirects to available room, production continues, and <strong>no additional future haul-outs</strong>. All-load reporting is assumed current; delayed or unsubmitted loads may change the estimate.</p>${parsed?`<p class="muted">Forecast as of ${stamp(parsed.generatedAt)} · Ticket cutoff ${stamp(parsed.ticketDataAsOf)} · Sources read ${stamp(parsed.sourceReadCompletedAt)}.</p>`:''}</div>`;
}
