// Synthetic reports only. No private Sheet IDs, credentials or backend transport.
export function makeFixture(scenario='overview', now=Date.now()) {
  const hour=3600000, readings=[],loads=[];
  for(const facility of ['DM','RC']) {
    const stale=scenario==='stale'||scenario==='overview'&&facility==='RC';
    for(let i=0;i<7;i++) {
      const ts=now-(6-i)*2*hour-(stale?4*hour:20*60000);
      readings.push({Timestamp:new Date(ts).toISOString(),Facility:facility,
        H1:(facility==='DM'?84000:47000)+i*5000,
        H2:(facility==='DM'?40000:33000)+i*4000,
        Feeding:scenario!=='off',FeedTank: +(10.5-i*.2).toFixed(1)});
    }
  }
  if(scenario==='loads') {
    const dm=readings.filter(r=>r.Facility==='DM'),last=Date.parse(dm.at(-1).Timestamp);
    // Remove 40k between the final two reports: correction restores 4,500 lb/h.
    dm.at(-1).H1-=24000;dm.at(-1).H2-=16000;
    loads.push({id:'fixture-load-1',facility:'DM',entry:last-60*60000,exit:last-45*60000,weight:40000,truck:'Demo 12',state:'confirmed-fixture'});
    loads.push({id:'fixture-load-2',facility:'DM',entry:last+5*60000,exit:last+15*60000,weight:20000,truck:'Demo 08',state:'confirmed-fixture'});
  } else {
    loads.push({id:'fixture-history',facility:'DM',entry:now-18*hour,exit:now-17.5*hour,weight:42000,truck:'Demo 12',state:'confirmed-fixture'});
  }
  if(scenario==='full')readings.filter(r=>r.Facility==='DM').at(-1).H1=131000;
  if(['near','imbalance'].includes(scenario)) {
    const dm=readings.filter(r=>r.Facility==='DM');
    dm.at(-2).H1=122000;dm.at(-1).H1=127000;
    dm.at(-2).H2=scenario==='near'?123000:22000;dm.at(-1).H2=scenario==='near'?127000:26000;
  }
  if(scenario==='paused')for(const f of ['DM','RC']){const r=readings.filter(r=>r.Facility===f);r.at(-1).H1=r.at(-2).H1;r.at(-1).H2=r.at(-2).H2;}
  if(scenario==='pending')loads.push({id:'review-pending',facility:'DM',entry:now-3600000,exit:now-1800000,weight:40000,truck:'Demo 08',state:'pending'});
  if(scenario==='delayed')loads.push({id:'late-upload',facility:'DM',entry:now-3600000,exit:now-1800000,uploadedAt:now,weight:40000,truck:'Demo 08',state:'confirmed-fixture'});
  if(scenario==='invalid')readings.at(-1).H1='';
  if(scenario==='future')readings.at(-1).Timestamp=new Date(now+hour).toISOString();
  return {status:'ok',coverage:scenario==='pending'?'unknown':'verified-fixture',readings:scenario==='empty'?[]:scenario==='missing'?readings.filter(r=>r.Facility==='DM'):scenario==='out-of-order'?readings.reverse():readings,loads};
}
