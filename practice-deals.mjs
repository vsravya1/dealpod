import {offers} from './core.mjs';

export function preparePracticeDeals(store,batch='practice-v1',now=Date.now()){
 const key='practice_deals:'+batch;
 if(store.hasSetup(key))return {applied:false,count:0};
 const variants=[
  ['lenovo',8,256,449,529,2],['lenovo',16,256,549,649,2],['lenovo',8,512,499,599,3],
  ['dell',16,256,579,679,2],['dell',8,512,479,579,2],['dell',16,512,629,729,3],
  ['asus',8,512,489,579,2],['asus',16,512,599,699,2],['asus',16,1024,679,799,3]
 ];
 const items=variants.map(([sourceId,ram,ssd,price,retail,size],i)=>{
  const source=offers.find(o=>o.id===sourceId);if(!source)throw Error('Practice catalog source missing');
  return {...source,id:batch+'-'+(i+1),ram,ssd,price,retail,initial:0,threshold:size,capacity:size,paymentWindowHours:24,
   inventorySource:sourceId,demoScenario:'practice',demoLabel:'Practice '+(i+1)+' - '+size+' buyers - '+batch.slice(-6),
   demoBatch:batch,closesAt:new Date(now+(7+i%3)*86400000).toISOString()};
 });
 const applied=store.addDemoOffers(key,items);if(applied)offers.push(...items);
 return {applied,count:applied?items.length:0};
}
