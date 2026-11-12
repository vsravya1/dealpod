import {laptopCatalog,laptopCommerce,LAPTOP_SETUP_KEY} from './laptop-catalog.mjs';
import {shipGroup} from './shipment.mjs';
import {preparePracticeDeals} from './practice-deals.mjs';
import {prepareTwoPathDemo} from './demo-setup.mjs';
import {groupPaymentStatus} from './public/group-payment.js';
import {addDemand,configure,publish,candidate,prepareDemand,createCommerceAgent,log,findGroup,claimGroup,prepareGroup,groupMembers,publishGroup,autoPublishBlock,joinAuthorized,fits,policyOptions} from './commerce.mjs';
import {assertDealOpen} from './public/deal-status.js';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {offers,match,accept,ownedMember,requestCancellation,pay,approveCancellation,processShipment} from './core.mjs';
import {createPayPalClient} from './paypal.mjs';
import {createCheckout,captureCheckout} from './checkout.mjs';
import {createBuyerAssistant,resultsFor,validateBrief} from './assistant.mjs';
import {createSellerAgent} from './seller-agent.mjs';
import {openStore} from './storage.mjs';
try{process.loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
const paypal=createPayPalClient({clientId:process.env.PAYPAL_CLIENT_ID,secret:process.env.PAYPAL_CLIENT_SECRET,environment:process.env.PAYPAL_ENV||'sandbox'});
const configured=!!(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET);
const assistant=createBuyerAssistant({key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
const sellerAgent=createSellerAgent({key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
const port=Number(process.env.PORT||3000);
const origin='http://localhost:'+port;
const rehearsal=process.env.GROUPOFFERS_DEMO_SETUP==='two-path-v1';
const store=openStore({path:process.env.GROUPOFFERS_DB_PATH||'data/groupoffers.sqlite',legacyPath:process.env.GROUPOFFERS_LEGACY_PATH||'data/state.json',catalog:rehearsal?laptopCatalog():offers});
offers.splice(0,offers.length,...store.loadOffers());
if(rehearsal){
 if(offers.some(o=>o.inventoryOnly)){
  if(!store.hasSetup(LAPTOP_SETUP_KEY))store.saveCommerce(laptopCommerce(),null,{setupKey:LAPTOP_SETUP_KEY});
  const batch=process.env.DEALPOD_PRACTICE_BATCH;
  if(batch){
   const additions=laptopCatalog().filter(o=>!o.inventoryOnly).map(o=>({...o,id:batch+'-'+o.id}));
   if(store.addDemoOffers('practice_deals:'+batch,additions))offers.push(...additions);
  }
 }else{
  prepareTwoPathDemo(store);
  preparePracticeDeals(store,process.env.DEALPOD_PRACTICE_BATCH||'practice-v1');
 }
}
let state=store.loadState();
let queue=Promise.resolve();
const commerceAgent=createCommerceAgent({key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
let commerceBusy=false;
function demandCurrent(d){try{const saved=store.getRequest(d.requestId,d.buyerId);return saved.status!=='joined'&&saved.brief._confirmed&&saved.brief._revision===d.revision;}catch{return false;}}
function publishDemand(data,id,sellerId,options){
 const demand=data.demands.find(d=>d.id===id&&d.sellerId===sellerId);
 if(!demand)throw Error('Proposal not found');
 const offer=publishGroup(data,id,sellerId,demandCurrent,options);
 if(!offer)return {offerId:demand.offer.id};
 const next=structuredClone(state);
 const group=groupMembers(data,demand);
 for(const request of group)log(request,'Coordinator · automated rule','Published deal '+offer.id+' is available in My requests.');
 const joined=joinAuthorized(data,group,offer,next,demandCurrent);
 store.saveCommerce(data,offer,{state:next,joined});
 offers.push(offer);
 state=next;
 return {offerId:offer.id,autoJoined:joined.length};
}
async function commerceTick(){if(commerceBusy)return;commerceBusy=true;try{
 const claim=queue.then(()=>{const data=store.getCommerce();let changed=false;for(const d of data.demands)if(['posted','awaiting_approval','needs_review','failed'].includes(d.status)&&!demandCurrent(d)){d.status='stale';log(d,'Coordinator · automated rule','Requirements changed or a deal was already joined. Automatic action stopped.');changed=true;}for(const item of data.demands){if(item.status==='awaiting_approval'&&item.groupId&&data.demands.some(x=>x.groupId===item.groupId&&x.status==='stale')){item.status='posted';delete item.groupId;delete item.groupSize;delete item.offer;log(item,'Coordinator · automated rule','Another grouped request changed. Looking for compatible demand again.');changed=true;}}const task=findGroup(data,demandCurrent);if(!task){if(changed)store.saveCommerce(data);return null;}claimGroup(task.group,task.policy);store.saveCommerce(data);return structuredClone(task);});queue=claim.catch(()=>{});const task=await claim;if(!task)return;
 try{await prepareGroup(task.group,task.policy,commerceAgent);}catch(e){for(const d of task.group){d.status='failed';log(d,'Coordinator · automated rule',e.message);}}
 const finish=queue.then(()=>{const data=store.getCommerce();const valid=task.group.every(d=>demandCurrent(d));for(const result of task.group){const current=data.demands.find(d=>d.id===result.id);if(!valid){result.status=demandCurrent(result)?'posted':'stale';delete result.groupId;delete result.groupSize;delete result.offer;log(result,'Coordinator · automated rule','A grouped request changed. Valid requests return to the demand pool.');}if(current?.status==='working'){const authorization=current.authorization;const extraEvents=current.events.filter(e=>!result.events.some(r=>r.at===e.at&&r.actor===e.actor&&r.text===e.text));Object.assign(current,result);current.events.push(...extraEvents);current.authorization=authorization;}}
 const lead=data.demands.find(d=>d.id===task.group[0].id);
 if(lead?.status==='awaiting_approval'&&data.policies.some(p=>p.sellerId===lead.sellerId&&p.autoPublish===true)){
  const reason=autoPublishBlock(data,lead,demandCurrent);
  if(!reason){publishDemand(data,lead.id,lead.sellerId,{automatic:true});return;}
  for(const d of groupMembers(data,lead))log(d,'Coordinator · automated rule',reason);
 }
 store.saveCommerce(data);});queue=finish.catch(()=>{});await finish;
 }catch(e){console.error('Commerce worker:',e.message);}finally{commerceBusy=false;}}
{const data=store.getCommerce();for(const d of data.demands)if(d.status==='working'){d.status='failed';log(d,'Coordinator · automated rule','Server restarted during assessment. Buyer can retry.');}store.saveCommerce(data);}
const commerceTimer=setInterval(commerceTick,5000);commerceTimer.unref();
function paymentSummaries(deals=offers){return Object.fromEntries(deals.map(o=>[o.id,groupPaymentStatus(o,state.members)]));}
async function saveState(){store.saveState(state);}
function demandProgress(d){if(d.status!=='posted')return '';const data=store.getCommerce(),p=candidate(data,d);if(!p)return 'Waiting for seller-declared inventory matching your must-haves.';const o=offers.find(o=>o.id===p.offerId);const count=new Set(data.demands.filter(x=>x.status==='posted'&&demandCurrent(x)&&fits(x.brief,{...o,price:p.price})).map(x=>x.buyerId)).size;return count+' compatible '+(count===1?'buyer':'buyers')+' · '+p.threshold+' needed for one shared proposal.';}
function publicState(buyerId){return {groupPayments:paymentSummaries(),demands:store.getCommerce().demands.filter(d=>d.buyerId===buyerId).map(d=>({...d,progress:demandProgress(d)})),offers,buyerId,sellers:sellerProfiles(),buyers:store.buyers(),requests:store.listRequests(buyerId),handoffs:store.handoffsForBuyer(buyerId),workflow:store.workflowForBuyer(buyerId),audit:store.requestAudit(buyerId),groupCounts:Object.fromEntries(offers.map(o=>[o.id,o.initial+state.members.filter(m=>m.offerId===o.id&&['committed','paid'].includes(m.status)).length])),events:state.events.filter(e=>(e.buyerId||'demo-buyer')===buyerId),aiEnabled:!!process.env.OPENAI_API_KEY,paymentMode:configured?'paypal-sandbox':'simulation',members:state.members.filter(m=>(m.buyerId||'demo-buyer')===buyerId).map(({paypal,...m})=>({...m,...(paypal?{paypalOrderId:paypal.orderId,paypalCaptureId:paypal.captureId,paidAt:paypal.paidAt}: {})}))};}
function sellerProfiles(){return offers.filter((o,i)=>offers.findIndex(a=>a.seller===o.seller)===i).map(o=>({id:o.id,name:o.seller}));}
function sharedSellerRequests(data, sellerId, policy) {
 const source = offers.find(offer => offer.id === policy?.offerId);
 const tiers = policy ? policyOptions(policy) : [];
 return data.demands.filter(request =>
  ['posted', 'working', 'awaiting_approval', 'needs_review', 'failed', 'published'].includes(request.status) &&
  (request.status === 'published'
   ? request.offer && Date.parse(request.offer.closesAt) > Date.now()
   : demandCurrent(request))
 ).map(request => {
  const assigned = request.status !== 'posted' && request.sellerId;
  const matchesStock = source && tiers.some(tier => fits(request.brief, {...source, price:tier.price}));
  let routing = 'Waiting for compatible requests';
  if (assigned) {
   const seller = sellerProfiles().find(profile => profile.id === assigned)?.name;
   routing = request.status === 'published'
    ? 'Deal published by ' + (seller || 'the matched seller')
    : assigned === sellerId ? 'Routed to your proposal queue' : 'Routed to ' + (seller || 'another seller');
  } else if (!matchesStock) {
   routing = policy ? 'Outside your current stock or pricing rules' : 'No stock rules configured';
  }
  return {requestId:request.requestId, summary:request.brief.summary, routing};
 });
}
function sellerView(id){const seller=sellerProfiles().find(s=>s.id===id);if(!seller)throw Error('Unknown demo seller');const deals=offers.filter(o=>o.seller===seller.name);const data=store.getCommerce(),policy=data.policies.find(p=>p.sellerId===id)||null;return {groupPayments:paymentSummaries(deals),opportunities:sharedSellerRequests(data,id,policy),policy,demands:store.getCommerce().demands.filter(d=>d.sellerId===id&&(!d.groupId||d.groupId===d.id)).map(({buyerId,authorization,...d})=>({...d,participants:groupMembers(data,d).filter(x=>x.sellerId===id).map(x=>({requestId:x.requestId,summary:x.brief.summary,budget:x.brief.budget,ram:x.brief.ram,ssd:x.brief.ssd,brand:x.brief.brand,buyerName:store.buyers().find(b=>b.id===x.buyerId)?.name||'Buyer',buyerAssessment:x.buyerAssessment,events:x.events}))})),seller,handoffs:store.handoffsForSeller(id).map(({buyerId,...h})=>h),workflow:store.workflowForSeller(id),events:state.events.filter(e=>deals.some(o=>o.id===e.offerId)).map(e=>({at:e.at,action:e.action,detail:e.detail,memberId:e.memberId,offerId:e.offerId})),offers:deals,drafts:store.sellerDrafts(id),members:state.members.filter(m=>deals.some(o=>o.id===m.offerId)).map(m=>({id:m.id,offerId:m.offerId,status:m.status,shippedAt:m.shippedAt,shipmentStatus:m.shipmentStatus,tracking:m.tracking,acceptedBy:m.acceptedBy,authorizationId:m.authorizationId,total:m.total,acceptedAt:m.acceptedAt,promotedAt:m.promotedAt,cancellationRequestedAt:m.cancellationRequestedAt,cancellationApprovedAt:m.cancellationApprovedAt,checkoutStarted:!!m.paypal,paymentDeadline:m.paymentDeadline,paymentStatus:m.paymentStatus,paidAt:m.paypal?.paidAt,paypalOrderId:m.paypal?.orderId,paypalCaptureId:m.paypal?.captureId,buyerName:store.buyers().find(b=>b.id===(m.buyerId||'demo-buyer'))?.name||'Demo buyer'})),groupCounts:Object.fromEntries(deals.map(o=>[o.id,o.initial+state.members.filter(m=>m.offerId===o.id&&['committed','paid'].includes(m.status)).length]))};}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,origin);
 if(req.method==='POST'&&req.headers.origin&&![origin,'http://127.0.0.1:'+port].includes(req.headers.origin))throw Error('Unexpected request origin');
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.url.startsWith('/api/')){
 const buyerId=req.headers['x-demo-buyer']||'demo-buyer';if(!store.buyers().some(b=>b.id===buyerId))throw Error('Unknown demo buyer');
 let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Request too large');}const input=body?JSON.parse(body):{};
 let output;
 if(req.method==='GET'&&req.url==='/api/state')output=publicState(buyerId);
 else if(req.method==='GET'&&url.pathname==='/api/seller')output=sellerView(url.searchParams.get('id'));
 else if(req.method==='POST'&&req.url==='/api/handoffs'){
 const offer=offers.find(o=>o.id===input.offerId);if(!offer)throw Error('Unknown offer');assertDealOpen(offer);const seller=sellerProfiles().find(s=>s.name===offer.seller);const startJob=queue.then(()=>store.startHandoff({requestId:input.requestId,buyerId,sellerId:seller.id,offer,revision:input.revision}));queue=startJob.catch(()=>{});const started=await startJob;
 if(!started.run)output={handoff:started.handoff};else{try{const saved=store.getRequest(input.requestId,buyerId);const brief=Object.fromEntries(['budget','ram','ssd','brand','preferences','summary','location','deliveryDays','waitingDays'].map(k=>[k,saved.brief[k]??null]));const committed=offer.initial+state.members.filter(m=>m.offerId===offer.id&&['committed','paid'].includes(m.status)).length;const proposal=await sellerAgent({brief,offer,committed});const job=queue.then(()=>store.completeHandoff(started.handoff.id,proposal));queue=job.catch(()=>{});output={handoff:await job};}catch(err){const job=queue.then(()=>store.failHandoff(started.handoff.id,err.message));queue=job.catch(()=>{});await job;throw err;}}
 }
 else if(req.method==='POST'&&['/api/demands/post','/api/demands/retry','/api/demands/revoke','/api/seller/agent-policy','/api/seller/publish-demand','/api/seller/decline-demand'].includes(req.url)){
 const job=queue.then(()=>{const data=store.getCommerce();let result;
 if(req.url==='/api/demands/post'){const saved=store.getRequest(input.requestId,buyerId);if(saved.brief._revision!==input.revision)throw Error('Resume and confirm the latest requirements.');result=addDemand(data,saved,buyerId,publicState(buyerId).groupCounts,input.options||{});}
 if(req.url==='/api/demands/retry'){const d=data.demands.find(d=>d.id===input.id&&d.buyerId===buyerId);if(!d||!['failed','needs_review'].includes(d.status)||!demandCurrent(d))throw Error('Post current requirements instead.');for(const item of groupMembers(data,d)){if(!demandCurrent(item)){item.status='stale';continue;}item.status='posted';delete item.groupId;delete item.groupSize;delete item.offer;log(item,'Coordinator · automated rule','Group assessment reset after an explicit buyer retry.');}result={ok:true};}
 if(req.url==='/api/demands/revoke'){const d=data.demands.find(d=>d.id===input.id&&d.buyerId===buyerId);if(!d||!d.authorization)throw Error('Authorization not found for this buyer.');if(d.autoJoinedMemberId)throw Error('Your agent already joined. Use the cancellation flow for that commitment.');d.authorization.revokedAt=new Date().toISOString();d.authorization.enabled=false;log(d,'Buyer','Revoked auto-join permission. Request remains posted for manual review.');result={ok:true};}
 if(req.url==='/api/seller/agent-policy')result=configure(data,input.sellerId,input.offerId,Number(input.units),Number(input.price),Number(input.threshold),input.tiers||[],{autoPublish:input.autoPublish===true});
 if(req.url==='/api/seller/decline-demand'){const d=data.demands.find(d=>d.id===input.id&&d.sellerId===input.sellerId);if(!d||!['awaiting_approval','needs_review'].includes(d.status))throw Error('Proposal is not awaiting a seller decision.');for(const item of groupMembers(data,d)){item.status='declined';log(item,'Seller','Declined the shared draft. No stock allocated or deal published.');}result={ok:true};}
 if(req.url==='/api/seller/publish-demand')return publishDemand(data,input.id,input.sellerId);
 store.saveCommerce(data);return result;});queue=job.catch(()=>{});output=await job;
 }
 else if(req.method==='POST'&&req.url==='/api/seller/process-shipment'){

 const seller=sellerProfiles().find(s=>s.id===input.sellerId);if(!seller)throw Error('Unknown demo seller');const job=queue.then(async()=>{return shipGroup(state,input.offerId,seller.name,input.tracking,paypal,()=>store.saveState(state));});queue=job.catch(()=>{});output=await job;
 }
 else if(req.method==='POST'&&req.url==='/api/seller/cancellation-approve'){
 const seller=sellerProfiles().find(s=>s.id===input.sellerId);if(!seller)throw Error('Unknown demo seller');
 const job=queue.then(()=>{const next=structuredClone(state);const result=approveCancellation(next,input.id,seller.name);store.saveState(next);state=next;return result;});queue=job.catch(()=>{});output=await job;
 }
 else if(req.method==='POST'&&req.url==='/api/seller/decision'){
 sellerView(input.sellerId);const job=queue.then(()=>{if(input.decision==='approve'){const h=store.getHandoff(input.id);const offer=offers.find(o=>o.id===h.offerId);if(!offer)throw Error('Unknown offer');assertDealOpen(offer);}return store.decideHandoff(input.id,input.sellerId,input.decision);});queue=job.catch(()=>{});output={handoff:await job};
 }
 else if(req.method==='POST'&&req.url==='/api/seller/drafts'){

 sellerView(input.sellerId);const d=input.draft||{};
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>120||typeof d.terms!=='string'||d.terms.length>2000)throw Error('Enter a product name and terms under 2,000 characters.');
 for(const k of ['price','ram','ssd','threshold','capacity','deliveryDays','waitingDays'])if(!Number.isFinite(d[k])||d[k]<=0||d[k]>100000)throw Error('Enter a positive '+k);if(d.capacity<d.threshold)throw Error('Stock must cover the minimum group size.');for(const k of ['ram','ssd','threshold','capacity','deliveryDays','waitingDays'])if(!Number.isInteger(d[k]))throw Error(k+' must be a whole number.');
 const draft=Object.fromEntries(['name','price','ram','ssd','threshold','capacity','deliveryDays','waitingDays','terms'].map(k=>[k,d[k]]));const job=queue.then(()=>store.saveSellerDraft(input.sellerId,draft));queue=job.catch(()=>{});output={id:await job,status:'draft'};
 }
 else if(req.method==='GET'&&url.pathname.startsWith('/api/requests/')){const saved=store.getRequest(decodeURIComponent(url.pathname.slice('/api/requests/'.length)),buyerId);output={...saved,...(saved.brief._confirmed?resultsFor(saved.brief,publicState(buyerId).groupCounts):{offers:[]})};}
 else if(req.method==='POST'&&req.url==='/api/requests/flexibility'){
 const job=queue.then(()=>{const previous=store.getRequest(input.requestId,buyerId);if(previous.status==='joined'||previous.brief._revision!==input.revision||!previous.brief._confirmed)throw Error('Resume a current confirmed search before changing preferences.');if(!Array.isArray(input.fields)||!input.fields.length||input.fields.some(k=>!['brand','ram','ssd'].includes(k)||previous.brief[k]==null))throw Error('Choose only captured brand, RAM or storage preferences.');const flexibleFields=[...new Set([...(previous.brief.flexibleFields||[]),...input.fields])];return store.confirmRequest(input.requestId,buyerId,input.revision,{flexibleFields});});queue=job.catch(()=>{});const saved=await job;output={...saved,...resultsFor(saved.brief,publicState(buyerId).groupCounts)};
 }
 else if(req.method==='POST'&&req.url==='/api/requests/confirm'){
 const previous=store.getRequest(input.requestId,buyerId);const r=input.requirements||{};
 const brief=validateBrief({...previous.brief,budget:r.budget,ram:r.ram,ssd:r.ssd,brand:r.brand,deliveryDays:r.deliveryDays,waitingDays:r.waitingDays,location:r.location});
 if(!brief.supported||!brief.budget||(brief.location!=null&&(typeof brief.location!=='string'||brief.location.length>100)))throw Error('Confirm your maximum budget before finding deals.');
 const requirements=Object.fromEntries(['budget','ram','ssd','brand','deliveryDays','waitingDays','location'].map(k=>[k,brief[k]]));
 const job=queue.then(()=>store.confirmRequest(input.requestId,buyerId,input.revision,requirements));queue=job.catch(()=>{});const saved=await job;output={...saved,...resultsFor(saved.brief,publicState(buyerId).groupCounts)};
 }
 else if(req.method==='POST'&&req.url==='/api/assistant'){
 if(typeof input.message!=='string'||!input.message.trim()||input.message.length>1500)throw Error('Describe your request in up to 1,500 characters');
 const previous=input.requestId?store.getRequest(input.requestId,buyerId):null;if(previous?.status==='joined')throw Error('Start a new search to change an accepted request');
 const messages=[...(previous?.conversation||[]),{role:'user',content:input.message}];output=await assistant(messages);output.reply=resultsFor(output.brief,publicState(buyerId).groupCounts).reply;
 const result=output;const job=queue.then(()=>store.saveRequest({id:input.requestId,buyerId,expectedTurns:previous?.conversation.length,brief:result.brief,messages,reply:result.reply}));queue=job.catch(()=>{});output.requestId=await job;output.brief=store.getRequest(output.requestId,buyerId).brief;
 }
 else if(req.method==='POST'&&['/api/paypal/create','/api/paypal/capture'].includes(req.url)){
 if(!configured)throw Error('PayPal sandbox credentials are missing');
 const job=queue.then(()=>{ownedMember(state,input.id,buyerId);return req.url==='/api/paypal/create'?createCheckout(state,input.id,paypal,saveState,origin):captureCheckout(state,input,paypal,saveState);});queue=job.catch(()=>{});output=await job;
 }
 else if(req.method==='POST'&&req.url==='/api/match'){
 throw Error('Review and confirm a saved request before matching offers.');
 }else if(req.method==='POST'&&['/api/accept','/api/cancel','/api/pay','/api/reset'].includes(req.url)){
 const job=queue.then(async()=>{const next=structuredClone(state);let result;
 if(req.url==='/api/accept'){if(input.requestId){if(!store.getRequest(input.requestId,buyerId).brief._confirmed)throw Error('Confirm your requirements before joining an offer.');if(store.getRequest(input.requestId,buyerId).brief._revision!==input.revision)throw Error('Requirements changed. Confirm the latest requirements before joining.');if(store.getRequest(input.requestId,buyerId).status==='joined')throw Error('This request already has an accepted offer. Start a new search for another purchase.');}const selectedOffer=offers.find(o=>o.id===input.offerId);if(!selectedOffer)throw Error('Unknown offer');assertDealOpen(selectedOffer);result=accept(next,input.offerId,input.termsVersion,buyerId);if(input.requestId)result.requestId=input.requestId;}
 if(['/api/cancel','/api/pay'].includes(req.url))ownedMember(next,input.id,buyerId);
 if(req.url==='/api/cancel')result=requestCancellation(next,input.id);
 if(req.url==='/api/pay'){if(configured)throw Error('Simulation is disabled while PayPal is configured');result=pay(next,input.id,input.fail===true);}
 if(req.url==='/api/reset'){throw Error('Use New search to start again. Existing buyer and payment records are retained.');}else next.events.unshift({at:new Date().toISOString(),action:req.url.slice(5),detail:result?.status||input.id,buyerId});
 const event=next.events[0],member=next.members.find(m=>m.id===(req.url==='/api/accept'?result.id:input.id));if(member){event.memberId=member.id;event.offerId=member.offerId;}if(req.url==='/api/accept'){const offer=offers.find(o=>o.id===result.offerId);const count=offer.initial+next.members.filter(m=>m.offerId===offer.id&&['committed','paid'].includes(m.status)).length;event.detail=result.status==='waitlisted'?'Group full; buyer added to the waitlist.':count>=offer.threshold?'Group target reached. Checkout is available for committed buyers.':'Place reserved. Waiting for '+(offer.threshold-count)+' more '+(offer.threshold-count===1?'buyer.':'buyers.');}
 store.saveState(next,req.url==='/api/accept'?{requestId:input.requestId,buyerId}:{});state=next;return result||{ok:true};});queue=job.catch(()=>{});output=await job;
 }else{res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'API endpoint not found. Restart the server and refresh the page to load the current version.'}));return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(output));return;
 }
 const paths={'/':'index.html','/app.js':'app.js','/deal-status.js':'deal-status.js','/group-payment.js':'group-payment.js','/buyer-guidance.js':'buyer-guidance.js','/style.css':'style.css','/paypal-logo.png':'paypal-logo.png'};const file=paths[url.pathname];if(!file){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile('public/'+file));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});server.on('error',e=>{store.close();console.error(e.code==='EADDRINUSE'?'Port '+port+' is busy. Stop your previous server with Ctrl+C, then run npm start again.':'Server could not start: '+e.code);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log('DealPod: '+origin+' · SQLite storage · '+(configured?'PayPal sandbox enabled':'Simulated payments')));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(commerceTimer);server.close(()=>{store.close();process.exit(0);});});
