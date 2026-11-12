import {processShipment,offers} from './core.mjs';
import {validatePayment} from './checkout.mjs';

export async function shipGroup(state,offerId,sellerName,entries,client,save){
 // Validate ownership, group readiness and every input before contacting PayPal.
 const offer=offers.find(o=>o.id===offerId);
 if(!offer||offer.seller!==sellerName)throw Error('Deal not found for this seller');
 const members=state.members.filter(m=>m.offerId===offerId&&m.status==='paid'&&!m.cancellationRequestedAt&&(!m.shippedAt||m.tracking?.status!=='submitted'));
 if(!members.length)return {shipped:0,message:'No shipments need processing or tracking.'};
 const previewState=structuredClone(state);
 // Older shipments can receive tracking without another stock reduction or dispatch event.
 for(const m of previewState.members)if(members.some(item=>item.id===m.id))delete m.shippedAt;
 processShipment(previewState,offerId,sellerName);
 const inputs=new Map((Array.isArray(entries)?entries:[]).map(e=>[e.memberId,e]));
 for(const m of members){
  if(!m.paypal?.orderId||!m.paypal?.captureId)throw Error('PayPal capture is required before adding shipment tracking.');
  const e=inputs.get(m.id);
  if(!e||!['UPS','USPS','FEDEX','DHL'].includes(e.carrier)||!/^[-A-Za-z0-9]{6,64}$/.test(e.trackingNumber||''))throw Error('Enter a carrier and a 6–64 character tracking number for every paid buyer.');
  if(m.tracking&&(m.tracking.number!==e.trackingNumber||m.tracking.carrier!==e.carrier))throw Error('Tracking already submitted. Retry with the same carrier and tracking number.');
 }
 for(const m of members){
  if(m.tracking?.status==='submitted')continue;
  const e=inputs.get(m.id);
  m.tracking ||= {number:e.trackingNumber,carrier:e.carrier,status:'pending',sandbox:true};
  await save();
  // Reconcile first: a previous submission may have succeeded before a timeout.
  const order=await client.get(m.paypal.orderId);
  const capture=validatePayment(order,m);
  if(capture.id!==m.paypal.captureId)throw Error('PayPal capture does not match the saved payment.');
  const existing=order.purchase_units.flatMap(u=>u.shipping?.trackers||[]).some(t=>t.tracking_number===e.trackingNumber&&t.carrier===e.carrier&&t.id?.startsWith(m.paypal.captureId+'-'));
  if(!existing)await client.track(m.paypal.orderId,{capture_id:m.paypal.captureId,tracking_number:e.trackingNumber,carrier:e.carrier,notify_payer:false});
  m.tracking.status='submitted';m.tracking.submittedAt=new Date().toISOString();
  state.events.unshift({at:m.tracking.submittedAt,action:'paypal_tracking',buyerId:m.buyerId||'demo-buyer',memberId:m.id,offerId,detail:'Shipment tracking submitted to PayPal sandbox. Demo fulfillment; no carrier booking.'});
  await save();
 }
 const result=processShipment(state,offerId,sellerName);await save();
 return {...result,message:'Group shipment processed. Tracking submitted to PayPal sandbox; no real carrier shipment booked.'};
}
