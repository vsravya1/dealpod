import {groupPaymentStatus,startPaymentWindow} from './public/group-payment.js';
export const offers = [
 {id:'lenovo',seller:'Northstar Computing',name:'Lenovo IdeaPad Slim 5',ram:16,ssd:512,price:649,retail:749,threshold:3,capacity:3,initial:2,region:'US',closesAt:'2026-10-19T04:59:00Z',termsVersion:'1',cancelBeforePayment:true},
 {id:'dell',seller:'Campus Supply Co.',name:'Dell Inspiron 15',ram:16,ssd:256,price:599,retail:699,threshold:4,capacity:4,initial:2,region:'US',closesAt:'2026-10-19T04:59:00Z',termsVersion:'1',cancelBeforePayment:false},
 {id:'asus',seller:'Everyday Electronics',name:'ASUS Vivobook 16',ram:8,ssd:512,price:499,retail:579,threshold:3,capacity:3,initial:1,region:'US',closesAt:'2026-10-19T04:59:00Z',termsVersion:'1',cancelBeforePayment:true}
];
export function match(requirements){
 return offers.filter(o=>!o.inventoryOnly).map(o=>({...o,differences:[...(o.price>requirements.budget?['Above your budget']:[]),...(o.ram<requirements.ram?['Less RAM than requested']:[]),...(o.ssd<requirements.ssd?['Less storage than requested']:[]) ]})).sort((a,b)=>a.differences.length-b.differences.length||a.price-b.price);
}
export function accept(state,offerId,consent,buyerId='demo-buyer',catalog=offers){
 const offer=catalog.find(o=>o.id===offerId); if(!offer)throw Error('Unknown offer');
 if(groupPaymentStatus(offer,state.members).overdue)throw Error('The group payment window has ended. Seller resolution is required before new buyers join.');
 if(consent!==offer.termsVersion)throw Error('Accept the current seller agreement first');
 if(state.members.some(m=>m.offerId===offerId&&(m.buyerId||'demo-buyer')===buyerId&&!['cancelled','refunded'].includes(m.status)))throw Error('You already have a commitment or waitlist entry for this offer');
 const count=offer.initial+state.members.filter(m=>m.offerId===offerId&&['committed','paid'].includes(m.status)).length;
 const member={id:crypto.randomUUID(),offerId,status:count>=offer.capacity?'waitlisted':'committed',termsVersion:consent,acceptedAt:new Date().toISOString(),total:offer.price,...(buyerId!=='demo-buyer'?{buyerId}:{})};state.members.push(member);startPaymentWindow(state,offer);
 if(offer.initial+state.members.filter(m=>m.offerId===offerId&&['committed','paid'].includes(m.status)).length>=offer.threshold){
  state.events ||= [];for(const m of state.members.filter(m=>m.offerId===offerId&&m.status==='committed'&&!m.checkoutReadyAt)){
   m.checkoutReadyAt=new Date().toISOString();
   state.events.unshift({at:m.checkoutReadyAt,action:'group_ready',buyerId:m.buyerId||'demo-buyer',memberId:m.id,offerId,detail:'Group target reached. Coordinator notified the buyer assistant that checkout can be offered.'});
   state.events.unshift({at:m.checkoutReadyAt,action:'buyer_checkout_ready',buyerId:m.buyerId||'demo-buyer',memberId:m.id,offerId,detail:'Buyer assistant received group readiness. Checkout availability is checked against payment deadlines and cancellation status; your payment approval is required.'});
  }
 }
 return member;
}
export function ownedMember(state,id,buyerId){const member=state.members.find(m=>m.id===id&&(m.buyerId||'demo-buyer')===buyerId);if(!member)throw Error('Commitment not found for this buyer');return member;}
export function cancel(state,id){
 const member=state.members.find(m=>m.id===id);if(!member)throw Error('Commitment not found');
 if(member.paypal)throw Error('A PayPal checkout exists for this commitment. Seller review is required before cancellation.');
 const offer=offers.find(o=>o.id===member.offerId);
 if(!['committed','waitlisted'].includes(member.status))throw Error('Paid orders require a seller-reviewed refund; cancellation is unavailable');
 if(member.status==='committed'&&!offer.cancelBeforePayment)throw Error('This seller agreement does not permit cancellation after acceptance');
 const wasCommitted=member.status==='committed';member.status='cancelled';
 if(wasCommitted){const next=state.members.find(m=>m.offerId===offer.id&&m.status==='waitlisted');if(next){next.status='committed';next.promotedAt=new Date().toISOString();if(member.paymentDeadline)next.paymentDeadline=member.paymentDeadline;}}
}
export function pay(state,id,fail=false){
 const member=state.members.find(m=>m.id===id);if(!member||member.status!=='committed')throw Error('Only an active commitment can proceed to checkout');
 if(member.paypal)throw Error('Use PayPal checkout to reconcile this payment');
 const offer=offers.find(o=>o.id===member.offerId);
 const count=offer.initial+state.members.filter(m=>m.offerId===offer.id&&['committed','paid'].includes(m.status)).length;
 if(count<offer.threshold)throw Error('Group threshold has not been reached');
 if(groupPaymentStatus(offer,state.members).overdue)throw Error('Payment window ended. Seller resolution required.');
 member.paymentStatus=fail?'failed':'simulated_paid';if(!fail)member.status='paid';
 return member;
}
export function requestCancellation(state,id){
 const member=state.members.find(m=>m.id===id);if(!member)throw Error('Commitment not found');
 if(!['committed','waitlisted','paid'].includes(member.status))throw Error('This commitment is already closed');
 const offer=offers.find(o=>o.id===member.offerId);
 if(!member.paypal&&member.status!=='paid'&&(member.status==='waitlisted'||offer.cancelBeforePayment)){
  cancel(state,id);return {status:'cancelled',message:'Cancelled. Any eligible waitlisted buyer is promoted.'};
 }
 member.cancellationRequestedAt ||= new Date().toISOString();
 return {status:'review_requested',message:'Cancellation requested. Awaiting seller review; your commitment and payment remain unchanged. No refund has been issued.'};
}

export function approveCancellation(state,id,sellerName){
 const member=state.members.find(m=>m.id===id);const offer=offers.find(o=>o.id===member?.offerId);
 if(!member||!offer||offer.seller!==sellerName)throw Error('Commitment not found for this seller');
 if(member.status==='cancelled'&&member.cancellationApprovedAt)return {status:'cancelled',promotedId:member.replacementId||null,message:'Cancellation already approved.'};
 if(!member.cancellationRequestedAt)throw Error('No cancellation request is pending');
 if(member.paypal||member.status==='paid')throw Error('Checkout or payment exists. Payment reconciliation and refund review are required before releasing this place.');
 if(!['committed','waitlisted'].includes(member.status))throw Error('This commitment is already closed');
 const heldPlace=member.status==='committed',at=new Date().toISOString();member.status='cancelled';member.cancellationApprovedAt=at;member.cancellationApprovedBy=sellerName;
 const next=heldPlace?state.members.find(m=>m.offerId===offer.id&&m.status==='waitlisted'&&!m.cancellationRequestedAt):null;
 if(next){next.status='committed';next.promotedAt=at;if(member.paymentDeadline)next.paymentDeadline=member.paymentDeadline;member.replacementId=next.id;}
 state.events.unshift({at,action:'seller_cancellation_approved',buyerId:member.buyerId||'demo-buyer',memberId:member.id,offerId:offer.id,detail:sellerName+' approved the unpaid cancellation. '+(next?'The first waiting buyer was promoted.':'The place is available to new buyers.')});
 if(next)state.events.unshift({at,action:'waitlist_promoted',buyerId:next.buyerId||'demo-buyer',memberId:next.id,offerId:offer.id,detail:'Promoted from the waitlist after seller-approved cancellation.'});
 return {status:'cancelled',promotedId:next?.id||null,message:next?'Cancellation approved. The first waitlisted buyer has been promoted.':'Cancellation approved. The place is now available to new buyers.'};
}

export function processShipment(state,offerId,sellerName){
 const offer=offers.find(o=>o.id===offerId);if(!offer||offer.seller!==sellerName)throw Error('Deal not found for this seller');
 const paid=state.members.filter(m=>m.offerId===offerId&&m.status==='paid'&&!m.shippedAt&&!m.cancellationRequestedAt);
 if(!paid.length)return {shipped:0,message:'No paid, unshipped purchases are ready to process.'};
 const payment=groupPaymentStatus(offer,state.members);if(!payment.ready)throw Error(payment.overdue?'Payment deadline passed. Seller resolution required; no automatic refund or replacement.':'All required buyer payments must be complete and cancellation requests resolved before group shipment.');
 const at=new Date().toISOString();for(const m of paid){m.shippedAt=at;m.shipmentStatus='shipped';m.shippedBy=sellerName;state.events.unshift({at,action:'shipment_processed',buyerId:m.buyerId||'demo-buyer',memberId:m.id,offerId,detail:sellerName+' processed shipment. One unit dispatched (demo fulfillment).'});}
 return {shipped:paid.length,message:'Shipment processed for '+paid.length+' paid '+(paid.length===1?'buyer':'buyers')+'. All required group payments are complete.'};
}
