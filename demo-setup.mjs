import {offers} from './core.mjs';
import {configure} from './commerce.mjs';
export const DEMO_SETUP_KEY='two_path_demo_inventory_v1';
export function prepareTwoPathDemo(store){
 if(store.hasSetup(DEMO_SETUP_KEY))return {applied:false};
 const data=store.getCommerce();
 for(const id of ['lenovo','dell','asus']){
  const source=offers.find(o=>o.id===id);if(!source)throw Error('Demo catalog is incomplete');
  const existing=data.policies.find(p=>p.sellerId===id);
  if(existing){existing.units+=6;existing.demoStockAdded=(existing.demoStockAdded||0)+6;}
  else{const policy=configure(data,id,id,6,source.price,2,[{quantity:4,price:source.price-20}]);policy.demoStockAdded=6;}
 }
 const source=offers.find(o=>o.id==='asus');
 const happy={...source,id:'demo-happy-asus',name:source.name,initial:0,threshold:2,capacity:2,paymentWindowHours:24,closesAt:new Date(Date.now()+3*86400000).toISOString(),demoLabel:'Fresh demo group · 2 buyers',demoScenario:'happy-path',inventorySource:'asus'};
 const existingOffer=store.loadOffers().find(o=>o.id===happy.id);
 if(existingOffer)throw Error('Demo group already exists without its setup marker. Existing records were retained; inspect the setup before retrying.');
 const asus=data.policies.find(p=>p.sellerId==='asus');asus.units-=2;
 const applied=store.saveCommerce(data,happy,{setupKey:DEMO_SETUP_KEY});
 if(applied)offers.push(happy);
 return {applied,offerId:happy.id,addedPerSeller:6};
}
