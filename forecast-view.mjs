import {selectFacilityForecast} from './facility-forecast.mjs';
import {preliminaryForecast,pacificStamp} from './preliminary-forecast.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const stamp=pacificStamp;
const intervalStamp=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(t));
export const reportedRateText=n=>n.toLocaleString('en-US',{maximumFractionDigits:20});
const calculatedRateText=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
function reasonText(reason=''){
  if(reason.includes('stale'))return 'Report overdue — timing paused. Confirm conditions at the facility.';
  if(reason.includes('need-two-post-protocol'))return 'Waiting for new reports after load-tracking update';
  if(reason.includes('anchors differ'))return 'Report and forecast are updating — waiting for matching source reports.';
  if(reason.includes('refresh')||reason.includes('clock'))return 'Forecast needs a fresh update. Check your device clock if this continues.';
  if(reason.includes('modeled-full-threshold')||reason.includes('interval-modeled-full'))return 'The model reached the full threshold. Confirm site conditions; further production is unknown.';
  if(reason.includes('over-threshold'))return 'Load-adjusted forecast paused by the server after an above-threshold report; reported weights remain valid.';
  if(reason.includes('feeding'))return 'Feeding is stopped or unconfirmed — timing paused.';
  if(reason.includes('ticket')||reason.includes('delayed'))return 'Load details need review before a facility estimate is available.';
  if(reason.includes('noisy')||reason.includes('nonpositive'))return 'Recent reports do not establish a consistent positive production rate.';
  if(reason.includes('negative')||reason.includes('balance'))return 'Reported inventory and load timing do not balance. Timing paused for review.';
  return 'Forecast temporarily unavailable. Reported hopper weights and hauling totals are shown independently.';
}
export function forecastHTML(parsed,facility,report,now=Date.now(),{allowPreliminary=true}={}){
  const f=selectFacilityForecast(parsed,facility,report,now),active=f.status!=='unavailable';
  const latestInterval=f.warnings?.includes('latest-report-interval-only; not-smoothed; no-statistical-confidence')===true;
  const flowLabel=latestInterval?'CALCULATED · LATEST INTERVAL':'CALCULATED LOAD-ADJUSTED RATE';
  const both=report&&report.h1>=(facility==='DM'?129000:105000)&&report.h2>=(facility==='DM'?130000:109000);
  const preliminary=!both&&!active&&allowPreliminary?preliminaryForecast(facility,report,now):null;
  if(preliminary?.status==='preliminary'){
    const minutes=Math.ceil((preliminary.restart?preliminary.hoursFromRestart*3600:preliminary.secondsRemaining)/60);
    const duration=`${Math.floor(minutes/60)}h ${minutes%60}m`;
    const title=preliminary.restart?'No filling projected while stopped':preliminary.thresholdTimeReached?'Scenario full time reached':stamp(preliminary.fullAt);
    return `<div class="shutdown-projection ${preliminary.thresholdTimeReached?'urgent':''}" data-forecast-basis="reported-production"><p class="flow-rate"><small>${flowLabel}</small><strong>Unavailable</strong></p><small>PROJECTED SHUTDOWN · BOTH HOPPERS FULL</small><div class="eta">${title}</div><p class="eta-date">${preliminary.restart?'IF FEEDING RESTARTS: '+duration+' to full':'FALLBACK SCENARIO · '+duration+' remaining'}${preliminary.beyondHorizon?' · >24h, especially uncertain':''}</p><p class="scenario-basis">${reportedRateText(preliminary.rateLbPerHour)} lb/hour <strong>source-reported rate</strong> · ${preliminary.restart?'from restart':'from '+stamp(preliminary.reportedAt)}. Assumes ${preliminary.restart?'unchanged inventory until restart':'continuous feeding'} and <strong>no pickups ${preliminary.restart?'before or after restart':'since this report'}</strong>.</p><p class="scenario-basis">Conditional scenario, not the load-adjusted forecast or a guaranteed shutdown time.</p><p class="muted">Calculated forecast: ${esc(reasonText(f.reason))} Flow must redirect into remaining room. Source email time is a proxy for inventory time; questionable loads are not credited.</p></div>`;

  }

  const title=both?'Both hoppers full in report':active?(f.thresholdTimeReached?'Projected full time reached':f.expected.full.at?`${stamp(f.expected.full.at)}`:'Beyond the 24-hour forecast window'):'Timing unavailable';
  const minutes=active&&f.secondsUntilFull!==null?Math.ceil(f.secondsUntilFull/60):null;
  const counts=active?`Pending loads used: ${fmt(f.rateWindowHauls.pending.ticketCount)} in the production interval; ${fmt(f.postAnchor.pending.ticketCount)} after the report.`:'';
  const sensitivity=active?(f.noCredit.full.status==='modeled-threshold-crossed'?`Model crossed at ${stamp(f.noCredit.full.at)}; production afterward is unknown.`:f.noCredit.full.at?`${stamp(f.noCredit.full.at)}`:'Beyond 24 hours'):'';
  return `<div class="shutdown-projection ${both||f.thresholdTimeReached?'urgent':''}">${active?`<p class="flow-rate"><small>${flowLabel}</small><strong>${calculatedRateText(f.productionLbPerHour)} <span>lb/hour</span></strong></p>`:`<p class="flow-rate"><small>${flowLabel}</small><strong>Unavailable</strong></p>`}<small>PROJECTED SHUTDOWN · BOTH HOPPERS FULL</small><div class="eta">${esc(title)}</div>${both?'<p class="warning">Both hoppers were at or above their full operating limits in the report. Check site status now.</p>':''}<p class="eta-date">${active?`${f.status==='provisional'?'LOAD-ADJUSTED · PROVISIONAL':'LOAD-ADJUSTED · CONDITIONAL'} · ${minutes===null?'Long-range estimate':`${Math.floor(minutes/60)}h ${minutes%60}m remaining`}${f.expected.full.longRange?' · >24h provisional projection, especially uncertain':''}`:esc(reasonText(f.reason))}</p>${!active&&!both&&preliminary?.status==='unavailable'?`<p class="scenario-basis">Fallback unavailable: ${esc(preliminary.reason)}.</p>`:''}${active?`<p>${fmt(f.expected.inventoryLb)} lb combined estimate as of ${stamp(f.inventoryAsOf)}.</p><p class="confidence">${latestInterval?'Uses the newest two valid reports and actual elapsed time; no averaging across earlier intervals.':'Calculated over the report interval shown below.'} ${esc(counts)}</p><p class="muted">${latestInterval?'Latest rate interval':'Rate interval'} ${intervalStamp(f.rateWindowStart)} to ${intervalStamp(f.reportedAt)}. Report timestamp is a proxy for inventory time.</p><details><summary>Sensitivity: no pending / approximate removal credit</summary><p>${esc(sensitivity)}${f.noCredit.full.longRange?' · >24h provisional projection, especially uncertain':''}</p><p>Same inferred production rate; excludes pending and approximate removals after the report only. Earlier uncertain loads can affect the rate. This is not a guaranteed or conservative bound.</p></details>`:''}${f.modeledFullThresholdCrossedAt?`<p class="warning">Model reached the threshold at ${stamp(f.modeledFullThresholdCrossedAt)}. This does not confirm an observed shutdown.</p>`:''}<p class="muted">Assumes flow redirects to available room, production continues, and <strong>no additional future haul-outs</strong>. All-load reporting is assumed current; delayed or unsubmitted loads may change the estimate.</p>${parsed?`<p class="muted">Forecast as of ${stamp(parsed.generatedAt)} · Ticket cutoff ${stamp(parsed.ticketDataAsOf)} · Sources read ${stamp(parsed.sourceReadCompletedAt)}.</p>`:''}</div>`;
}
