export const DEFAULT_DEMO_CLOSE='2026-10-19T04:59:00Z';
export function closingTime(offer){const time=Date.parse(offer.closesAt||DEFAULT_DEMO_CLOSE);return Number.isFinite(time)?time:null;}
export function dealStatus(offer,committed,now=Date.now()){
 const deadline=closingTime(offer),remaining=deadline===null?null:Math.max(0,deadline-now),closed=deadline===null||remaining===0;
 const count=Math.max(0,committed),needed=Math.max(0,offer.threshold-count),available=Math.max(0,offer.capacity-count),percent=Math.min(100,Math.round(count/offer.threshold*100));
 return {deadline,remaining,closed,count,needed,available,percent,status:closed?'closed':available===0?'full':needed===0?'ready':'forming'};
}
export function formatTimeLeft(remaining){if(remaining===null)return 'Schedule pending';if(remaining<=0)return 'Closed';const minutes=Math.ceil(remaining/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;return days?days+'d '+String(hours).padStart(2,'0')+'h '+String(mins).padStart(2,'0')+'m':hours?hours+'h '+String(mins).padStart(2,'0')+'m':minutes+'m';}
export function assertDealOpen(offer,now=Date.now()){if(dealStatus(offer,0,now).closed)throw Error('This group offer has closed to new buyers. Existing commitments and payments remain available.');}

export function availabilitySummary(offers,counts={}){
 const open=offers.filter(o=>!dealStatus(o,counts[o.id]??o.initial).closed);
 const full=open.filter(o=>(counts[o.id]??o.initial)>=o.capacity);
 const available=open.filter(o=>(counts[o.id]??o.initial)<o.capacity);
 const exactFull=full.filter(o=>!o.differences?.length);
 const parts=exactFull.map(o=>o.name+' is full. A waitlist is available; a place is not guaranteed.');
 if(available.length){
  const matches=available.filter(o=>!o.differences?.length).length;
  const alternatives=available.length-matches;
  if(matches)parts.push(matches===1?'1 available deal matches your checked specifications.':matches+' available deals match your checked specifications.');
  if(alternatives)parts.push(alternatives===1?'1 alternative is listed below.':alternatives+' alternatives are listed below.');
 }
 else parts.push(open.length?'There are no open places in these groups right now.':'These deal windows have closed.');
 return parts.join(' ');
}
