import {dealStatus} from './deal-status.js';
export function findWatchedDeal(brief, offers, counts = {}) {
 if (!brief?.supported || !brief._confirmed || !brief.budget) return null;
 if (brief.deliveryDays || brief.waitingDays || (brief.requiredPreferences ?? brief.preferences ?? []).length) return null;
 const region = brief.location?.trim();
 if (region && !/^(US|USA|United States)$/i.test(region)) return null;
 return offers.filter(offer => {
  const status = dealStatus(offer, counts[offer.id] ?? offer.initial);
  return !status.closed && status.available > 0 && offer.price <= brief.budget &&
   offer.ram >= (brief.ram || 0) && offer.ssd >= (brief.ssd || 0) &&
   (!brief.brand || offer.name.toLowerCase().includes(brief.brand.toLowerCase())) &&
   (!region || offer.region === 'US');
 }).sort((a, b) => a.price - b.price)[0] ?? null;
}

export function buyerGuidance(brief,offers,counts={}){
 if(!brief?.supported||!brief.budget)return {message:brief?.question||'Tell me your laptop needs and maximum budget.',actions:[]};
 const flex=brief.flexibleFields||[];
 const changes=o=>[...(!flex.includes('brand')&&brief.brand&&!o.name.toLowerCase().includes(brief.brand.toLowerCase())?['brand']:[]),...(!flex.includes('ram')&&o.ram<(brief.ram||0)?['ram']:[]),...(!flex.includes('ssd')&&o.ssd<(brief.ssd||0)?['ssd']:[])];
 const current=offers.filter(o=>!dealStatus(o,counts[o.id]??o.initial).closed);
 const available=current.filter(o=>(counts[o.id]??o.initial)<o.capacity);
 const exact=available.filter(o=>o.price<=brief.budget&&!changes(o).length).sort((a,b)=>a.price-b.price||Number(!!b.demoScenario)-Number(!!a.demoScenario))[0];
 if(exact)return {message:'Best current fit on checked specifications: '+exact.name+' at $'+exact.price+'. That is $'+(exact.retail-exact.price)+' below its individual demo price. Review the terms before joining.',actions:[]};
 const full=current.find(o=>o.price<=brief.budget&&!changes(o).length&&(counts[o.id]??o.initial)>=o.capacity);
 const alternative=available.filter(o=>o.price<=brief.budget).sort((a,b)=>changes(a).length-changes(b).length||a.price-b.price)[0];
 let message=full?full.name+' at $'+full.price+' matches your checked specifications, but the group is full. A waitlist is available; a place is not guaranteed.':'No open deal meets all your required budget and specifications.';
 if(alternative){const fields=changes(alternative),labels={brand:'a different brand',ram:alternative.ram+' GB RAM instead of '+brief.ram+' GB',ssd:alternative.ssd+' GB storage instead of '+brief.ssd+' GB'};message+=' '+alternative.name+' is available at $'+alternative.price+', but requires '+fields.map(k=>labels[k]).join(' and ')+'. Would you make those preferences flexible, or keep your requirements and request a new deal?';return {message,actions:fields.length?[{fields,label:'Make '+fields.map(k=>({brand:'brand',ram:'RAM',ssd:'storage'}[k])).join(' & ')+' flexible',detail:'Allows '+fields.map(k=>labels[k]).join(' and ')+'. Your budget and other required specifications stay fixed.'}]:[]};}
 if(available.length){const cheapest=[...available].sort((a,b)=>a.price-b.price)[0];message+=' The lowest available price is $'+cheapest.price+', above your $'+brief.budget+' limit. I will keep your budget unchanged.';}
 return {message:message+' Keep your requirements and post a group-deal request to look for new seller stock.',actions:[]};
}
