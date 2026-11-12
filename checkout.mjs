import {groupPaymentStatus} from './public/group-payment.js';
import {offers} from './core.mjs';
export function eligibleMember(state,id){
 const member=state.members.find(m=>m.id===id);if(!member||member.status!=='committed')throw Error('An active commitment is required for checkout');
 const offer=offers.find(o=>o.id===member.offerId);
 if(member.cancellationRequestedAt)throw Error('Cancellation review is pending. Do not start a new payment.');
 if(groupPaymentStatus(offer,state.members).overdue)throw Error('Payment window ended. Seller resolution required; existing payments will be reconciled.');
 const count=offer.initial+state.members.filter(m=>m.offerId===offer.id&&['committed','paid'].includes(m.status)).length;
 if(count<offer.threshold)throw Error('The group is still waiting for more commitments');
 if(member.termsVersion!==offer.termsVersion||member.total!==offer.price)throw Error('Offer terms changed; review is required');
 return {member,offer};
}
export function validatePayment(order,member){
 const unit=order.purchase_units?.[0];const captures=unit?.payments?.captures||[];
 if(order.status!=='COMPLETED'||order.purchase_units?.length!==1||unit.custom_id!==member.id||captures.length!==1)throw Error('PayPal payment is not completed or does not match this commitment');
 const capture=captures[0];
 if(capture.status!=='COMPLETED'||capture.amount?.currency_code!=='USD'||capture.amount?.value!==member.total.toFixed(2))throw Error('PayPal capture amount or status does not match the commitment');
 return capture;
}
function recordPayment(state,member,order){const capture=validatePayment(order,member),first=member.status!=='paid'||member.paypal.captureId!==capture.id;member.status='paid';member.paymentStatus='paypal_sandbox_paid';member.paypal.captureId=capture.id;member.paypal.paidAt ||= new Date().toISOString();if(first)state.events.unshift({at:member.paypal.paidAt,action:'paypal_capture',memberId:member.id,offerId:member.offerId,detail:'PayPal sandbox payment completed',...(member.buyerId?{buyerId:member.buyerId}:{})});}
export async function createCheckout(state,id,client,save,origin){
 const member=state.members.find(m=>m.id===id);if(!member||!['committed','paid'].includes(member.status))throw Error('An active commitment is required for checkout');
 const offer=offers.find(o=>o.id===member.offerId);
 if(member.paypal?.orderId){const order=await client.get(member.paypal.orderId);if(order.status==='COMPLETED'){recordPayment(state,member,order);await save();return {completed:true};}
 eligibleMember(state,id);
 const url=order.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href||member.paypal.approvalUrl;
 if(!url)throw Error('No approval link available. Retry payment reconciliation.');return {approvalUrl:url};}
 eligibleMember(state,id);
 if(!member.paypal){member.paypal={createKey:crypto.randomUUID(),captureKey:crypto.randomUUID(),returnKey:crypto.randomUUID()};await save();}
 const result=await client.create({intent:'CAPTURE',purchase_units:[{reference_id:member.id,custom_id:member.id,description:offer.name+' group offer',amount:{currency_code:'USD',value:member.total.toFixed(2),breakdown:{item_total:{currency_code:'USD',value:member.total.toFixed(2)}}},items:[{name:offer.name,sku:offer.inventorySource||offer.id,quantity:'1',category:'PHYSICAL_GOODS',unit_amount:{currency_code:'USD',value:member.total.toFixed(2)}}]}],payment_source:{paypal:{experience_context:{brand_name:'DealPod',user_action:'PAY_NOW',shipping_preference:'GET_FROM_FILE',return_url:origin+'/?checkout=approved&member='+member.id+'&key='+member.paypal.returnKey,cancel_url:origin+'/?checkout=cancelled'}}}},member.paypal.createKey);
 const approvalUrl=result.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
 if(!result.id||!approvalUrl)throw Error('PayPal did not return an order and approval link');
 const url=new URL(approvalUrl);if(url.protocol!=='https:'||!(url.hostname==='www.sandbox.paypal.com'||url.hostname==='sandbox.paypal.com'))throw Error('Unexpected PayPal approval destination');
 member.paypal.orderId=result.id;member.paypal.approvalUrl=approvalUrl;member.paymentStatus='awaiting_paypal_approval';await save();return {approvalUrl};
}
export async function captureCheckout(state,input,client,save){
 const member=state.members.find(m=>m.id===input.id);
 if(!member?.paypal?.orderId||input.orderId!==member.paypal.orderId||input.key!==member.paypal.returnKey)throw Error('Payment return does not match the saved checkout');
 if(member.status==='paid')return {completed:true};
 let order=await client.get(member.paypal.orderId);
 if(order.status!=='COMPLETED'){
 eligibleMember(state,member.id);
 if(order.status!=='APPROVED')throw Error('PayPal approval is required before payment');
 member.paymentStatus='capture_pending';await save();
 try{order=await client.capture(member.paypal.orderId,member.paypal.captureKey);}catch(err){
  const reconciled=await client.get(member.paypal.orderId);if(reconciled.status!=='COMPLETED')throw err;order=reconciled;
 }
 }
 recordPayment(state,member,order);await save();return {completed:true};
}
