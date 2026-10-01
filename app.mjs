import {CAPACITY,STALE_MS,normalize,forecast,bothFullProjection,intervalLoads} from './core.mjs';
import {makeFixture} from './fixtures.mjs';
import {trendSVG} from './charts.mjs';
import {readCurrentCWS} from './readings-api.mjs';
import {readHaulSummary} from './haul-summary.mjs';
import {readFacilityForecast} from './facility-forecast.mjs';
import {forecastHTML} from './forecast-view.mjs';
import {feedTankHTML} from './feed-tank-forecast.mjs';

const $=id=>document.getElementById(id);
const fmt=n=>Math.round(n).toLocaleString('en-US');
const names={DM:'Durham',RC:'Rock Creek'};
const stamp=t=>new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scenario=new URLSearchParams(location.search).get('scenario')||'overview';
// Release default is live; synthetic scenarios require an explicit demo/scenario URL.
const liveMode=new URLSearchParams(location.search).get('mode')!=='demo'&&!new URLSearchParams(location.search).has('scenario');
// Retain synthetic source timestamps across both manual refresh and page reload.
let anchor=Date.now();
try {const stored=Number(sessionStorage.getItem('cws-fixture-anchor'));if(stored>0)anchor=stored;else sessionStorage.setItem('cws-fixture-anchor',String(anchor));} catch {}
const fixture=makeFixture(scenario,anchor);
if(liveMode){fixture.readings=[];fixture.loads=[];fixture.coverage='unknown';}
let data={DM:[],RC:[]},dataError='';
let facilityForecast=null;
let haulSummary=null,haulSummaryStatus='Fetching public HaulTrack totals…';
try {data=normalize(fixture.readings);} catch {dataError='Report validation failed. Invalid readings are withheld; do not dispatch using this preview scenario.';}
const loads=fixture.loads;
let detailFacility='DM';
$('scenario').value=scenario;
$('scenario').addEventListener('change',e=>{location.search='?mode=demo&scenario='+encodeURIComponent(e.target.value);});
if(liveMode){
  document.querySelector('.dev').textContent='LIVE MODE · Fetching CWS readings and HaulTrack totals · Read only';
  $('scenario').closest('details').hidden=true;
  document.querySelector('footer').textContent='CWS readings + public HaulTrack totals · Read only · No backend writes';
}else document.querySelector('.dev').textContent='DEVELOPMENT PREVIEW · Synthetic reports · Live writes disabled';

function renderFacilities(){
  const opened=new Set([...document.querySelectorAll('.facility details[open]')].map(el=>el.dataset.disclosure));
  const focused=document.activeElement?.closest('.facility summary')?.parentElement.dataset.disclosure;
  $('data-error').textContent=dataError;$('data-error').hidden=!dataError;
  $('facilities').innerHTML=Object.entries(data).map(([facility,rows])=>{
    const latest=rows.at(-1);
    if(!latest)return `<article class="facility"><small>${facility} / SOURCE REPORT</small><h3>${names[facility]}</h3><p class="warning">No valid measured report available.</p><p>Estimates unavailable. Check the report source.</p></article>`;
    const age=Math.floor((Date.now()-latest.ts)/60000);
    const stale=Date.now()-latest.ts>STALE_MS,future=age<0;
    const facilityLoads=loads.filter(l=>l.facility===facility);
    const estimate=fixture.coverage==='verified-fixture'?forecast(rows,Date.now(),facilityLoads):{reason:'Load coverage or ticket review incomplete — estimate paused'};
    const projection=bothFullProjection(rows,CAPACITY[facility],Date.now(),facilityLoads,fixture.coverage,'redirect');
    const minutes=projection.hours===undefined?null:Math.max(0,Math.round(projection.hours*12)*5);
    const countdown=minutes===null?'':minutes>=60?`${Math.floor(minutes/60)}h ${minutes%60}m remaining`:`${minutes} minutes remaining`;
    let timing=`<div class="shutdown-projection ${projection.reached||projection.atCapacity?'urgent':minutes!==null&&minutes<=120?'soon':''}"><small>PROJECTED SHUTDOWN · BOTH HOPPERS FULL</small><div class="eta">${projection.reason?'Timing unavailable':projection.reached?'May already be full':`About ${new Date(projection.bothAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`}</div><p class="eta-date">${projection.reason?escape(projection.reason):`${new Date(projection.bothAt).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${countdown}`}</p><p><strong>${projection.rate?fmt(projection.rate)+' lb/hour estimated production':'Production estimate unavailable'}</strong></p><p class="muted">${projection.remaining!==undefined?fmt(projection.remaining)+' lb combined space estimated now. ':''}Flow can redirect to the hopper with room. Assumes current production continues and <strong>no additional future haul-outs</strong>.</p><p class="confidence">${projection.reason?'Insufficient current evidence':'Conditional estimate — not a guaranteed shutdown time'}. Full-capacity limits confirmed by the user. Synthetic load coverage only; HaulTrack is not connected.</p></div>`;
    if(liveMode)timing=forecastHTML(facilityForecast,facility,latest,Date.now(),{allowPreliminary:!dataError});
    const explanation=estimate.reason ? 'The measured report above is unchanged.' : estimate.mode==='off'
      ? `Holding the reported inventory less ${fmt(estimate.removed)} lb hauled since the report. Assumes feeding has remained off.`
      : `Estimated production: ${fmt(estimate.rate)} lb/hour. Added back ${fmt(estimate.addedBack)} lb hauled between readings; subtracted ${fmt(estimate.removed)} lb hauled since the latest report.`;
    return `<article class="facility" data-plant="${facility}">
      <div class="heading"><small>${facility} / SOURCE REPORT</small><span class="pill ${stale||future?'attention':''}">${future?'Check timestamp':stale?'Stale report':'Current report'}</span></div>
      <h3>${names[facility]}</h3><p class="muted source-time" data-measured-at="${latest.ts}">Reported ${stamp(latest.ts)}${future?'':` · ${age} minutes ago`}</p>
      ${stale||future?`<p class="warning">${future?'Source timestamp is in the future.':'Report overdue.'} Confirm site conditions before dispatch.</p>`:''}
      <div class="hoppers">${[latest.h1,latest.h2].map((weight,i)=>{
        const pct=weight/CAPACITY[facility][i]*100;
        return `<div><small>HOPPER ${i+1}</small><div class="weight">${fmt(weight)} <span>lb</span></div><div class="bar"><i class="${pct>=80?'high':''}" style="width:${Math.min(pct,100)}%"></i></div><p class="hopper-meta">${pct.toFixed(1)}% · ${fmt(CAPACITY[facility][i])} lb max</p>${pct>=80?`<p class="warning">${pct>=100?'At / above capacity':'High fill'}</p>`:''}</div>`;
      }).join('')}</div>
      ${timing}
      ${feedTankHTML(facility,rows,Date.now(),{sourceReadFailed:!!dataError})}
      <p class="muted">At report time: <strong>${latest.feeding?'feeding':'not feeding'}</strong> · Feed tank ${latest.feedTank.toFixed(1)} ft</p>
      ${liveMode?`<p class="muted">Reported weights above are unchanged by estimates. Source email time is a proxy, not exact sensor telemetry. Daily company-wide totals are never deducted from these weights.</p>`:`<div class="estimate"><small>COMBINED ESTIMATE · NOT LIVE TELEMETRY</small><p>${estimate.reason||`<strong>${fmt(estimate.total)} lb</strong> estimated now`}</p><p class="muted">${explanation}</p><p class="muted">Actual confirmed removals are applied once; past hauling does not promise future pickups. One full hopper is an early warning, not a facility shutdown.</p></div>`}
    </article>`;
  }).join('');
  compactFacilities();
  document.querySelectorAll('.facility details').forEach(el=>{el.open=opened.has(el.dataset.disclosure);});
  if(focused)document.querySelector('[data-disclosure="'+focused+'"] > summary')?.focus({preventScroll:true});
}

// Presentation only: retain the full safety explanations in native disclosures.
function compactFacilities(){
 document.querySelectorAll('.facility[data-plant]').forEach(card=>{
  const plant=card.dataset.plant;
  const details=document.createElement('details');details.className='operation-details';details.dataset.disclosure=plant+'-methods';
  const summary=document.createElement('summary');summary.textContent='Details & assumptions';details.append(summary);
  card.querySelectorAll('.shutdown-projection').forEach(box=>{
   [...box.children].forEach(el=>{
    if(el.matches('p.flow-rate,small,.eta,.eta-date,.warning'))return;
    details.append(el);
   });
  });
  card.querySelectorAll('.tank-projection').forEach(box=>{
   const label=box.querySelector('small');label.textContent='PROJECTED SHUTDOWN · TANK LOW';
   const paragraphs=[...box.children].filter(el=>el.tagName==='P');
   paragraphs.forEach((el,i)=>{
    if(i===0){el.classList.add('tank-level');return;}
    if(i===1||el.matches('.warning'))return; // timing withheld / check-site reasons stay visible
    if(el.textContent.startsWith('PROVISIONAL')){
     const badge=document.createElement('p');badge.className='tank-quality';badge.textContent=box.textContent.includes('More than 24 hours')?'Provisional · >24h, especially uncertain':'Provisional · net level trend';box.insertBefore(badge,el);
    }
    details.append(el);
   });
  });
  [...card.children].filter(el=>el.matches('p.muted:not(.source-time),.estimate')).forEach(el=>details.append(el));
  details.querySelectorAll('details').forEach((el,i)=>el.dataset.disclosure=plant+'-nested-'+i);
  card.append(details);
 });
}

function renderDetails(){
  const rows=data[detailFacility],cap=CAPACITY[detailFacility];
  $('detail-name').textContent=names[detailFacility];
  $('weight-chart').innerHTML=trendSVG(rows,cap);
  $('tank-chart').innerHTML=trendSVG(rows,cap,'tank');
  $('chart-range').textContent=rows.length?`${stamp(rows[0].ts)} to ${stamp(rows.at(-1).ts)} · ${rows.length} source reports`:'No valid reports';
  $('history').innerHTML=rows.map((row,i)=>{
    const prev=rows[i-1],delta=prev?row.h1+row.h2-prev.h1-prev.h2:null;
    const removed=prev?intervalLoads(loads.filter(l=>l.facility===detailFacility&&l.state==='confirmed-fixture'),prev.ts,row.ts):0;
    return `<tr><td>${stamp(row.ts)}</td><td>${fmt(row.h1)}</td><td>${fmt(row.h2)}</td><td>${delta===null?'—':`${delta>=0?'+':''}${fmt(delta)}`}</td><td>${liveMode?'Unknown':prev?fmt(removed):'—'}</td><td>${row.feedTank.toFixed(1)} ft</td><td>${row.feeding?'Feeding':'Off'}</td></tr>`;
  }).reverse().join('')||'<tr><td colspan="7">No valid readings.</td></tr>';
  $('recent-loads').innerHTML=loads.filter(l=>l.facility===detailFacility).sort((a,b)=>b.exit-a.exit).map(l=>`<div class="load-row"><div><strong>${fmt(l.weight)} lb net · ${escape(l.truck)}</strong><p class="muted">Actual loading: ${stamp(l.entry)} → ${stamp(l.exit)}</p>${l.uploadedAt?`<p class="muted">Delayed upload: ${stamp(l.uploadedAt)}. Actual loading time governs the calculation.</p>`:''}<p class="muted">Ticket ${escape(l.id)} · Source: synthetic HaulTrack adapter</p></div><span class="pill">${l.state==='pending'?'Pending review — excluded':'Verified fixture — not live synced'}</span></div>`).join('')||'<p class="muted">No load records for this facility in the fixture.</p>';
  if(liveMode){$('recent-loads').textContent='HaulTrack is not connected. No load records have been fetched; this does not mean zero loads.';$('recent-loads').previousElementSibling.textContent='Waiting for a sanitized read-only HaulTrack endpoint.';$('recent-loads').previousElementSibling.previousElementSibling.textContent='HaulTrack not connected. No ticket details or sample loads are used in live mode.';}
  if(liveMode){
    $('recent-loads').textContent=haulSummaryStatus;
    if(haulSummary){
      $('recent-loads').previousElementSibling.textContent='Sanitized company-wide totals only; no driver, ticket photo, Field ID or raw ticket information.';
      $('recent-loads').previousElementSibling.previousElementSibling.textContent='HaulTrack aggregate totals connected. Facility estimates use a separate report-and-load calculation with their own quality checks.';
      const recorded=bucket=>`${bucket.recordedNetLb===null?'Unavailable / quarantined':fmt(bucket.recordedNetLb)+' lb'}<br><small>${fmt(bucket.acceptedWeightTicketCount)} accepted / ${fmt(bucket.excludedWeightTicketCount)} excluded${bucket.weightStatus==='partial'?' — PARTIAL SUM':''}</small>`;
      const latest=haulSummary.days.at(-1);
      const totals=key=>haulSummary.days.reduce((sum,day)=>({tickets:sum.tickets+day[key].ticketCount,pounds:sum.pounds+(day[key].recordedNetLb??0),available:sum.available+(day[key].recordedNetLb===null?0:day[key].acceptedWeightTicketCount),missing:sum.missing+(day[key].recordedNetLb===null?day[key].acceptedWeightTicketCount:0),excluded:sum.excluded+day[key].excludedWeightTicketCount}),{tickets:0,pounds:0,available:0,missing:0,excluded:0});
      const verified=totals('verified'),pending=totals('pending');
      const periodWeight=total=>total.available===0&&total.tickets>0?'Unavailable / quarantined':`${fmt(total.pounds)} accepted lb${total.excluded||total.missing?' (partial sum)':''}`;
      $('recent-loads').innerHTML=`<p>Company-wide CWS totals by <strong>ticket date</strong> — both facilities combined, independent of the chart selector. Window ${escape(haulSummary.windowStart)} to ${escape(haulSummary.windowEnd)}.</p><p class="muted">Source fetched ${stamp(haulSummary.generatedAt)}.</p>${haulSummary.latestTicketEntryAt?`<p class="muted">Latest ticket entry: ${stamp(haulSummary.latestTicketEntryAt)}. Entry time may use a client clock; it is not the physical loading time.</p>`:''}<div id="haul-window-totals"><p><strong>Window verified:</strong> ${fmt(verified.tickets)} tickets · ${periodWeight(verified)} · ${fmt(verified.excluded)} excluded weights</p><p><strong>Window pending:</strong> ${fmt(pending.tickets)} tickets · ${periodWeight(pending)} · ${fmt(pending.excluded)} excluded weights</p></div>${latest?`<p id="haul-latest-day" class="review-summary"><strong>Latest ticket date ${escape(latest.date)}:</strong> ${fmt(latest.verified.ticketCount)} verified / ${fmt(latest.pending.ticketCount)} pending tickets. Pending is not verified.</p>`:''}<p class="warning">Weights follow HaulTrack's recorded-pound convention, screened to 20,000–100,000 lb per load. Excluded ticket counts remain visible; mixed totals are partial and all-excluded totals are unavailable, never zero. “Verified” means ticket status, not independent unit certification.</p><p class="warning">Unknown pickup/time tickets and all daily totals are excluded from Durham and Rock Creek forecasts.</p><div class="table-wrap"><table id="haul-days"><thead><tr><th>Ticket date</th><th>Verified tickets / loads</th><th>Verified-status accepted weight</th><th>Pending tickets / loads</th><th>Pending accepted weight</th><th>Unknown facility tickets</th></tr></thead><tbody>${haulSummary.days.slice().reverse().map(day=>`<tr data-date="${escape(day.date)}"><td>${escape(day.date)}</td><td>${fmt(day.verified.ticketCount)} / ${fmt(day.verified.loadCount)}</td><td>${recorded(day.verified)}</td><td>${fmt(day.pending.ticketCount)} / ${fmt(day.pending.loadCount)}</td><td>${recorded(day.pending)}</td><td>${fmt(day.verified.unknownFacilityCount+day.pending.unknownFacilityCount)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  }
  document.querySelectorAll('[data-facility]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.facility===detailFacility)));
}
document.querySelectorAll('[data-facility]').forEach(button=>button.addEventListener('click',()=>{detailFacility=button.dataset.facility;renderDetails();}));

function readDrafts(){
  const items=JSON.parse(localStorage.getItem('cws-dev-drafts-v1')||'[]');
  if(!Array.isArray(items))throw Error('Invalid drafts');
  return items;
}
function renderDrafts(){
  $('drafts').replaceChildren();
  try {
    const items=readDrafts();
    if(!items.length)$('drafts').textContent='No browser drafts yet.';
    for(const draft of items.slice().reverse()){
      const element=document.createElement('div');element.className='draft';
      const title=document.createElement('strong');
      title.textContent=`${names[draft.payload.facility]} · ${fmt(draft.payload.weight)} lb net · Truck ${draft.payload.truck}`;
      const detail=document.createElement('p');
      detail.textContent=`Unsynced browser draft. Entry ${stamp(draft.payload.entryTime)}; exit ${stamp(draft.payload.exitTime)}. ${draft.payload.notes}`;
      const state=document.createElement('span');state.className='pill';state.textContent='Not submitted to Google Sheets';
      element.append(title,detail,state);$('drafts').append(element);
    }
  }catch {$('drafts').textContent='Cannot read browser drafts. Storage may be blocked or damaged; keep your ticket.';}
}
$('export').addEventListener('click',()=>{
  try {const url=URL.createObjectURL(new Blob([JSON.stringify(readDrafts(),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='cws-browser-drafts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch {$('export-status').textContent='Export failed: browser drafts could not be read.';}
});
let readingRequestActive=false;
async function refresh(){
  if(readingRequestActive)return;
  if(liveMode){
    readingRequestActive=true;$('refresh').disabled=true;
    $('checked').textContent='Fetching current CWS readings (read-only)…';
    const [cws,haul,projection]=await Promise.allSettled([readCurrentCWS(),readHaulSummary(),readFacilityForecast()]);
    facilityForecast=projection.status==='fulfilled'&&cws.status==='fulfilled'?projection.value:null;
    if(cws.status==='fulfilled'){data=cws.value;dataError='';$('checked').textContent=`CWS readings fetched ${stamp(Date.now())}. Source report timestamps shown below.`;}
    else{dataError='Current CWS feed could not be read or validated. Any prior readings retain their original source times.';$('checked').textContent='CWS refresh failed — no sample data substituted.';}
    if(haul.status==='fulfilled'&&haul.value){haulSummary=haul.value;haulSummaryStatus='';}
    else{haulSummary=null;haulSummaryStatus='HaulTrack totals unavailable or invalid. No totals or sample records substituted; this does not mean zero loads.';}
    document.querySelector('.dev').textContent=`LIVE MODE · CWS ${cws.status==='fulfilled'?'readings loaded':'refresh failed'} · HaulTrack ${haulSummary?'totals loaded':'unavailable'} · Read only`;
    readingRequestActive=false;$('refresh').disabled=false;
  } else $('checked').textContent=`Preview checked ${stamp(Date.now())}. Source measurement times unchanged. No live requests.`;
  renderFacilities();renderDetails();
}
$('refresh').addEventListener('click',refresh);window.addEventListener('storage',renderDrafts);
refresh();renderDrafts();setInterval(renderFacilities,1000);setInterval(refresh,300000);
