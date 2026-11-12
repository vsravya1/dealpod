// Shared payment summary; exposes counts only, never another buyer's payment details.
export function groupPaymentStatus(offer,members,now=Date.now()){
 const all=members.filter(m=>m.offerId===offer.id),active=all.filter(m=>['committed','paid'].includes(m.status));
 const paid=active.filter(m=>m.status==='paid').length,committed=offer.initial+active.length;
 const required=Math.max(0,offer.threshold-offer.initial,active.length),missing=Math.max(0,required-paid);
 const dates=all.map(m=>Date.parse(m.paymentDeadline)).filter(Number.isFinite);const deadline=dates.length?Math.min(...dates):null;
 const overdue=deadline!==null&&now>=deadline&&missing>0,pendingCancellation=active.some(m=>m.cancellationRequestedAt&&!m.cancellationApprovedAt);
 const ready=committed>=offer.threshold&&missing===0&&!pendingCancellation&&active.length>0;
 const dispatched=active.filter(m=>m.shippedAt).length;
 const status=dispatched===active.length&&dispatched>0?'shipped':overdue?'resolution_required':ready?'ready_to_ship':committed<offer.threshold?'collecting_buyers':'awaiting_payments';
 return {paid,required,missing,committed,deadline,overdue,ready,pendingCancellation,dispatched,status,prefilled:offer.initial};
}
export function startPaymentWindow(state,offer,now=Date.now()){
 if(!offer.paymentWindowHours)return;
 const all=state.members.filter(m=>m.offerId===offer.id),active=all.filter(m=>['committed','paid'].includes(m.status));
 if(offer.initial+active.length<offer.threshold)return;
 const existing=all.map(m=>Date.parse(m.paymentDeadline)).filter(Number.isFinite);
 const deadline=new Date(existing.length?Math.min(...existing):now+offer.paymentWindowHours*3600000).toISOString();
 for(const m of active)m.paymentDeadline=deadline;
}
