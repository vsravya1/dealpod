const sellers = [
 {id:'northstar', seller:'Northstar Computing', name:'Work Laptop', ram:32, ssd:1024, price:649, retail:779, units:8},
 {id:'campus', seller:'Campus Supply Co.', name:'Everyday Laptop', ram:16, ssd:512, price:569, retail:679, units:12},
 {id:'everyday', seller:'Everyday Electronics', name:'Study Laptop', ram:8, ssd:512, price:489, retail:579, units:12}
];

const variants = [
 ['everyday','study-8-512','Study Laptop',8,512,489,579,2],
 ['everyday','study-8-256','Study Laptop',8,256,419,499,3],
 ['everyday','study-16-512','Study Laptop',16,512,549,649,3],
 ['campus','everyday-8-256','Everyday Laptop',8,256,459,549,3],
 ['campus','everyday-16-256','Everyday Laptop',16,256,579,679,2],
 ['campus','everyday-16-512','Everyday Laptop',16,512,599,699,3],
 ['northstar','work-16-256','Work Laptop',16,256,549,649,2],
 ['northstar','work-16-512','Work Laptop',16,512,599,729,3],
 ['northstar','work-16-1024','Work Laptop',16,1024,679,799,3]
];

export const LAPTOP_SETUP_KEY = 'generic_laptops_v1';

export function laptopCatalog(now=Date.now()) {
 const terms={initial:0,region:'US',termsVersion:'1',cancelBeforePayment:true};
 const inventory=sellers.map(({units,...seller})=>({
  ...terms,...seller,threshold:2,capacity:2,inventoryOnly:true,
  closesAt:new Date(0).toISOString()
 }));
 const deals=variants.map(([sellerId,id,name,ram,ssd,price,retail,threshold])=>({
  ...terms,id,seller:sellers.find(s=>s.id===sellerId).seller,name,ram,ssd,price,retail,threshold,
  capacity:threshold,paymentWindowHours:24,closesAt:new Date(now+7*86400000).toISOString(),
  inventorySource:id,artTheme:sellerId,demoScenario:'catalog',demoLabel:'Group deal'
 }));
 return [...inventory,...deals];
}

export function laptopCommerce() {
 return {demands:[],policies:sellers.map(({id,units,price})=>({
  sellerId:id,offerId:id,units,price,threshold:2,
  tiers:[{quantity:2,price},{quantity:4,price:price-20}],
  revision:crypto.randomUUID(),autoPublish:false
 }))};
}
