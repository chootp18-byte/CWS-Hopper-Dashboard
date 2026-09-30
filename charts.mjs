const number=n=>Math.round(n).toLocaleString('en-US');
const time=t=>new Date(t).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
export function trendSVG(rows, capacity, kind='weight') {
  if(!rows.length)return '<p class="muted">No valid measured reports to chart.</p>';
  const width=620,height=230,left=54,right=22,top=22,bottom=40;
  const min=rows[0].ts,max=rows.at(-1).ts;
  const ceiling=kind==='weight'?Math.max(...capacity,...rows.flatMap(r=>[r.h1,r.h2]))*1.12:Math.max(12,...rows.map(r=>r.feedTank))*1.1;
  const x=t=>left+(max===min?.5:(t-min)/(max-min))*(width-left-right),y=n=>height-bottom-n/ceiling*(height-top-bottom);
  const series=kind==='weight'?[['h1','#287764','Hopper 1'],['h2','#6475ba','Hopper 2']]:[['feedTank','#287764','Feed tank']];
  let content='';
  for(let i=0;i<=4;i++){const n=ceiling*i/4;content+=`<line x1="${left}" x2="${width-right}" y1="${y(n)}" y2="${y(n)}" stroke="#e3eae5"/><text x="${left-8}" y="${y(n)+4}" text-anchor="end">${kind==='weight'?Math.round(n/1000)+'k':n.toFixed(1)}</text>`;}
  if(kind==='weight')capacity.forEach((n,i)=>{content+=`<line x1="${left}" x2="${width-right}" y1="${y(n)}" y2="${y(n)}" stroke="${series[i][1]}" stroke-dasharray="5 5" opacity=".6"/>`;});
  for(const [key,color,name]of series){
    content+=`<polyline points="${rows.map(r=>`${x(r.ts)},${y(r[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    content+=rows.map(r=>`<circle cx="${x(r.ts)}" cy="${y(r[key])}" r="4" fill="${color}"><title>${name}: ${number(r[key])} ${kind==='weight'?'lb':'ft'} at ${new Date(r.ts).toLocaleString()}</title></circle>`).join('');
  }
  [0,Math.floor((rows.length-1)/2),rows.length-1].filter((v,i,a)=>a.indexOf(v)===i).forEach(i=>content+=`<text x="${x(rows[i].ts)}" y="${height-14}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}">${time(rows[i].ts)}</text>`);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Measured ${kind==='weight'?'hopper weights in pounds':'feed tank level in feet'} over time. Exact values are in recent readings below.">${content}</svg>`;
}
