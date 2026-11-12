const inlineGroups=new Set(),expandedPanels=new Set();
import {buyerGuidance,findWatchedDeal} from './buyer-guidance.js';

import {availabilitySummary,dealStatus,formatTimeLeft} from './deal-status.js';

let state,results,selected,toastTimer,brief;

let exploringDirect=false;

let lastExpiryKey='';

let role='home',activeTab='deals',sellerId=null,sellerData=null;

const trackingDrafts=new Map();
let conversation=[],chatBusy=false,requirementsDirty=false;

let buyerId=sessionStorage.getItem('groupoffers-buyer')||'demo-buyer';

let currentRequestId=localStorage.getItem('groupoffers-request:'+buyerId)||null;

const $=id=>document.getElementById(id);

const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path,body){

 let response;try{response=await fetch('/api/'+path,{headers:{'X-Demo-Buyer':buyerId,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});}catch{throw Error('Cannot reach DealPod. Check that npm start is running.');}

 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error(response.status===404?'The running server is outdated. Restart it with Ctrl+C, then npm start, and refresh this page.':'The server returned an incomplete response. Your entries are still here; restart the server and try again.');}if(!response.ok)throw Error(data.error||'Request failed (HTTP '+response.status+')');return data;

}

function message(text){clearTimeout(toastTimer);$('message').textContent=text;$('message').style.display='block';toastTimer=setTimeout(()=>$('message').style.display='none',9000);}

async function refresh(){rememberPanels();state=await api('state');if(!Array.isArray(state.sellers))throw Error('Restart the server with Ctrl+C, then npm start, to load the new buyer and seller workspaces.');render();restorePanels();}

function countFor(offer){return state.groupCounts?.[offer.id]??offer.initial;}

function activeFor(id){return state.members.find(m=>m.offerId===id&&['committed','paid','waitlisted'].includes(m.status));}

function render(){

 $('buyer-switch').innerHTML='<option value="">Choose buyer</option>'+state.buyers.map(b=>'<option value="'+escape(b.id)+'">'+escape(b.name)+'</option>').join('');$('buyer-switch').value=role==='buyer'?buyerId:'';

 $('buyer-demands').innerHTML=renderCurrentDemands();const alreadyPosted=(state.demands||[]).some(d=>d.requestId===currentRequestId&&d.revision===brief?._revision);$('post-demand').disabled=!brief?._confirmed||requirementsDirty||alreadyPosted;$('post-demand').textContent=alreadyPosted?'Request already posted':'Submit request to sellers';$('demand-options').hidden=alreadyPosted;const joinedRequest=state.requests.some(r=>r.id===currentRequestId&&r.status==='joined');$('requirements-confirm').hidden=joinedRequest;

 $('saved-requests').innerHTML=state.requests.length?state.requests.map(r=>'<div class="member"><div><b>'+escape(r.brief.summary||'Laptop request')+'</b><small>'+escape(r.status==='open'?'Requirements saved':r.status==='clarifying'?'Needs your answer':r.status==='joined'?'Offer accepted':'Unsupported category')+' · '+new Date(r.createdAt).toLocaleDateString()+'</small></div><button class="quiet" data-resume="'+r.id+'">'+(r.status==='joined'?'View request':'Resume request')+'</button></div>').join(''):'<p>No saved requests yet. Describe what you need to start.</p>';



 $('payment-branding').hidden=state.paymentMode!=='paypal-sandbox';

 $('ai-status').textContent=state.aiEnabled?'You set your agent’s limits and approve every payment.':'The assistant is currently unavailable. Please try again after the demo host reconnects it.';

 document.querySelector('footer').textContent=state.paymentMode==='paypal-sandbox'?'PayPal sandbox checkout enabled · No real money moves. All supplier offers pay one sandbox merchant. Catalogs and seeded commitments are synthetic. Separate demo buyers · Profile switching is for demonstration; sign-in is not implemented.':'Simulated payments · Demo catalogs and seeded commitments. Separate demo buyers · Profile switching is for demonstration; sign-in is not implemented.';

 $('matches-panel').hidden=requirementsDirty||!brief?._confirmed;$('review').hidden=!brief||!brief.supported; $('workspace').classList.toggle('before-matches',requirementsDirty||!brief?._confirmed);$('workspace').classList.toggle('has-review',!!brief?.supported);

 if(brief?._confirmed){const guidance=buyerGuidance(brief,results||state.offers,state.groupCounts);$('buyer-guidance').innerHTML='<p>'+escape(guidance.message)+'</p>'+guidance.actions.map(a=>'<p>'+escape(a.detail)+'</p><button data-flex-fields="'+escape(a.fields.join(','))+'">'+escape(a.label)+'</button>').join('')+(guidance.actions.length?'<button class="quiet" data-keep-requirements>Keep my requirements</button>':'');}

 $('availability-summary').textContent=results?.length?availabilitySummary(results,state.groupCounts):'';

 $('offers').innerHTML=(results||[]).map(o=>{

  const count=countFor(o),dif=o.differences||[],existing=activeFor(o.id),handoff=handoffFor(o.id);const reviewWaiting=['pending','awaiting_approval'].includes(handoff?.status),closed=dealStatus(o,count).closed;

  return `<article class="offer"><div><div class="seller">${escape(o.seller)}</div><h3>${escape(o.name)}</h3>${dealIdBadge(o)}${o.demoLabel?'<span class="fit">'+escape(o.threshold+' buyers unlock this price')+'</span>':''}<div class="specs">${o.ram} GB RAM · ${o.ssd} GB SSD · US delivery included</div><span class="fit ${dif.length?'alternative':''}">${dif.length?'Alternative: '+escape(dif.join(' · ')):results?(count>=o.capacity?'Specifications match · Waitlist only':'Matches checked specifications'):'Exact SKU group offer'}</span>${o.flexibleTradeoffs?.length?'<small>Flexible preferences not met: '+escape(o.flexibleTradeoffs.join(' · '))+'</small>':''}${o.unverified?.length?`<small>Needs seller confirmation: ${escape(o.unverified.join(', '))}</small>`:''}<div class="group">${count} of ${o.threshold} committed · ${Math.max(0,o.capacity-count)} ${Math.max(0,o.capacity-count)===1?'place':'places'} available</div><div class="progress"><div style="width:${Math.min(100,count/o.threshold*100)}%"></div></div></div><div><div class="price">$${o.price}<del>$${o.retail} individual demo price</del></div><small>Published demo offer · Seller terms below</small><button ${existing?`data-view="${existing.id}"`:closed?'disabled':`data-offer="${o.id}"`}>${existing?'View your commitment':closed?'Deal closed':count>=o.capacity?'Review waitlist terms':'Review & join'} →</button></div></article>`;

 }).join('')||'<p class="panel">No offers to show yet. Answer your assistant’s question or start a new laptop search.</p>';

 $('members').innerHTML=state.members.length?state.members.map(m=>{

  const o=state.offers.find(o=>o.id===m.offerId),remaining=Math.max(0,o.threshold-countFor(o));

  const waiting=m.status==='committed'&&remaining>0,overdue=paymentFor(o)?.overdue;let actions='';

  if(m.status==='committed'&&!m.cancellationRequestedAt){

   if(overdue)actions='<button disabled>Payment window ended · Seller review</button>';

   else if(waiting)actions=`<button disabled>Waiting for ${remaining} more ${remaining===1?'buyer':'buyers'}</button>`;

   else if(state.paymentMode==='paypal-sandbox')actions=`<button data-checkout="${m.id}">${m.paypalOrderId?'Resume PayPal checkout':'Pay with PayPal (sandbox)'}</button>`;

   else actions=`<button data-pay="${m.id}">Simulate payment</button><button class="quiet" data-fail="${m.id}">Simulate failure</button>`;

  }

  if(['committed','waitlisted','paid'].includes(m.status))actions+=`<button class="quiet" data-cancel="${m.id}" ${m.cancellationRequestedAt?'disabled':''}>${m.cancellationRequestedAt?'Awaiting seller review':m.status==='waitlisted'?'Leave waitlist':'Request cancellation'}</button>`;

  return `<div class="member" id="member-${m.id}"><div><b>${escape(o.name)} · $${m.total}</b><small>Seller: ${escape(o.seller)}</small>${dealIdBadge(o)}${orderLifecycle(o,m,paymentFor(o))}<small>${escape(m.status.toUpperCase())} · Agreement v${escape(m.termsVersion)}${m.shippedAt?' · SHIPPED':m.paymentStatus?' · '+escape(m.paymentStatus):''}${m.promotedAt?' · Promoted from waitlist':''}</small>${paypalSummary(m)}${trackingDetails(m)}${waiting?'<small>Your place is reserved. Checkout unlocks when the group reaches its target.</small>':''}${m.cancellationApprovedAt?'<small>Seller approved cancellation. No payment was taken.</small>':m.cancellationRequestedAt?'<small>Cancellation requested. Seller review pending; no refund issued.</small>':''}</div><div class="actions">${actions}</div></div>`;

 }).join(''):'<p>No commitments yet. Review a group offer to get started.</p>';

 $('events').innerHTML=state.events.slice(0,8).map(e=>`<div class="event"><span>${new Date(e.at).toLocaleTimeString()}</span>${escape(e.action)} · ${escape(e.detail)}</div>`).join('')||'<p>Your group activity will appear here.</p>';

 renderPortal();

}

document.addEventListener('click',async e=>{

 const el=e.target.closest('button');if(!el)return;

 try{

  if(el.dataset.resume){openTab('search');await resumeRequest(el.dataset.resume);$('chat').scrollIntoView({behavior:'smooth',block:'center'});return;}

  if(el.dataset.view){showGroup(el.dataset.view);return;}

  if(el.hasAttribute('data-refresh')){await refresh();if(role==='seller'&&sellerId)await loadSeller();return;}

  if(el.dataset.handoff){if(chatBusy||!currentRequestId||requirementsDirty)return;const id=currentRequestId,rev=brief?._revision;el.disabled=true;el.textContent='Seller agent reviewing…';$('buyer-switch').disabled=true;$('seller-switch').disabled=true;try{await api('handoffs',{requestId:id,revision:rev,offerId:el.dataset.handoff});await refresh();message('Request sent to the seller. Their response will appear here.');}finally{$('buyer-switch').disabled=false;$('seller-switch').disabled=false;if(el.isConnected){el.disabled=false;el.textContent='Request seller review →';}}return;}

  if(el.dataset.reviewRequest){await resumeRequest(el.dataset.reviewRequest);openTab('search');$('matches-panel').scrollIntoView({behavior:'smooth',block:'start'});return;}

  if(el.hasAttribute('data-keep-requirements')){$('demand-options').scrollIntoView({behavior:'smooth'});message('Requirements kept. You can share them to request a new group deal.');return;}

  if(el.dataset.flexFields){el.disabled=true;try{const saved=await api('requests/flexibility',{requestId:currentRequestId,revision:brief._revision,fields:el.dataset.flexFields.split(',')});brief=saved.brief;results=saved.offers;fillRequirements();await refresh();message('Selected preferences are now flexible. Your budget is unchanged; no deal was joined.');}finally{if(el.isConnected)el.disabled=false;}return;}

  if(el.dataset.revokeAuto){await api('demands/revoke',{id:el.dataset.revokeAuto});await refresh();message('Auto-join permission revoked.');return;}

  if(el.dataset.declineDemand){await api('seller/decline-demand',{sellerId,id:el.dataset.declineDemand});await refresh();await loadSeller();message('Proposal declined. No deal published.');return;}

  if(el.dataset.publishDemand){el.disabled=true;try{const result=await api('seller/publish-demand',{sellerId,id:el.dataset.publishDemand});await refresh();await loadSeller();message('Deal published. '+(result.autoJoined||0)+' authorized buyers joined automatically. Payment remains manual.');}finally{if(el.isConnected)el.disabled=false;}return;}

  if(el.dataset.retryDemand){await api('demands/retry',{id:el.dataset.retryDemand});await refresh();return;}

  if(el.dataset.processShipment){el.disabled=true;try{const result=await api('seller/process-shipment',{sellerId,offerId:el.dataset.processShipment,tracking:[...el.closest('article').querySelectorAll('[data-tracking-member]')].map(row=>({memberId:row.dataset.trackingMember,carrier:row.querySelector('select').value,trackingNumber:row.querySelector('input').value.trim()}))});await refresh();await loadSeller();message(result.message);}finally{if(el.isConnected)el.disabled=false;}return;}

  if(el.dataset.approveCancellation){el.disabled=true;try{const result=await api('seller/cancellation-approve',{sellerId,id:el.dataset.approveCancellation});await refresh();await loadSeller();message(result.message);}finally{if(el.isConnected)el.disabled=false;}return;}

  if(el.dataset.sellerDecision){const owner=sellerId;el.disabled=true;try{await api('seller/decision',{sellerId:owner,id:el.dataset.handoffId,decision:el.dataset.sellerDecision});await refresh();if(owner===sellerId)await loadSeller();message(el.dataset.sellerDecision==='approve'?'Approved. The buyer can review and join this offer.':'Proposal declined. No commitment created.');}finally{if(el.isConnected)el.disabled=false;}return;}

  if(el.dataset.offer||el.dataset.explore){

   exploringDirect=!!el.dataset.explore;if(exploringDirect){role='buyer';renderPortal();}

   selected=(exploringDirect?state.offers:(results||[])).find(o=>o.id===(el.dataset.offer||el.dataset.explore));if(!selected)return;if(exploringDirect&&activeFor(selected.id)){showGroup(activeFor(selected.id).id);return;}$('confirm').textContent=countFor(selected)>=selected.capacity?'Accept terms & join waitlist':'Accept agreement & join';$('deal-name').textContent=selected.name;

   $('terms').innerHTML=`${selected.differences?.length?'<p class="review-note">Alternative: '+escape(selected.differences.join(' · '))+'</p>':''}${selected.unverified?.length?'<p class="review-note">Seller confirmation needed: '+escape(selected.unverified.join(', '))+'</p>':''}${countFor(selected)>=selected.capacity?'<p class="review-note"><b>This group is full. You are joining the waitlist.</b> A place is not guaranteed. You can pay only after promotion and when the group is ready.</p>':''}<b>$${selected.price} delivered · Agreement v${selected.termsVersion}</b><p>${selected.ram} GB RAM · ${selected.ssd} GB SSD · US delivery. Group target: ${selected.threshold} accepted units.</p>${selected.priceReason?'<p>'+escape(selected.priceReason)+'</p>':''}${selected.paymentWindowHours?'<p>Payment is due within '+selected.paymentWindowHours+' hours after the group reaches its target. Shipment waits for all required buyer payments. A missed deadline requires seller resolution; no automatic refund or cancellation.</p>':''}<p>Your acceptance reserves a place. Checkout unlocks when the group target is reached and requires your separate PayPal approval.</p><p>${selected.cancelBeforePayment?'You may cancel before checkout starts.':'After acceptance, cancellation requires seller review.'} Once checkout starts or payment completes, use Request cancellation for seller review. A request does not issue a refund. Vacant places go to the waitlist in order.</p><p>Demo deadline: ${escape(deadlineLabel(selected))}. Delivery estimate: 5–7 business days after group payments complete. New joining closes at this deadline. Cancellation review and refunds are not automated.</p>`;

   $('agreement-error').textContent='';$('consent').checked=false;$('confirm').disabled=true;$('agreement').showModal();return;

  }

  if(el.dataset.checkout){

   el.disabled=true;el.textContent='Opening PayPal…';

   try{const checkout=await api('paypal/create',{id:el.dataset.checkout});if(checkout.completed){message('PayPal sandbox payment confirmed.');await refresh();}else location.assign(checkout.approvalUrl);}finally{if(el.isConnected){el.disabled=false;el.textContent='Pay with PayPal (sandbox)';}}return;

  }

  if(el.dataset.pay||el.dataset.fail){await api('pay',{id:el.dataset.pay||el.dataset.fail,fail:!!el.dataset.fail});message(el.dataset.fail?'Payment failed. Commitment retained for retry.':'Simulated payment completed. No money moved.');await refresh();return;}

  if(el.dataset.cancel){el.disabled=true;try{const result=await api('cancel',{id:el.dataset.cancel});await refresh();message(result.message);}finally{if(el.isConnected)el.disabled=false;}}

 }catch(err){message(err.message);}

});

$('consent').onchange=()=>{$('confirm').disabled=!$('consent').checked;};

$('confirm').onclick=async()=>{

 if(!$('consent').checked||$('confirm').disabled)return;

 $('confirm').disabled=true;$('confirm').textContent='Joining…';$('agreement-error').textContent='';

 try{const m=await api('accept',{offerId:selected.id,termsVersion:selected.termsVersion,...(exploringDirect?{}:{requestId:currentRequestId,revision:brief?._revision})});$('agreement').close();await refresh();message(m.status==='waitlisted'?'You joined the waitlist.':'Your place is reserved. Find checkout under Your commitments.');openTab('groups');showGroup(m.id);}

 catch(e){$('agreement-error').textContent=e.message;}

 finally{$('confirm').textContent='Accept agreement & join';$('confirm').disabled=!$('consent').checked;}

};

function addChat(role,text){const p=document.createElement('p');p.className='chat-'+role;p.textContent=text;$('chat').appendChild(p);$('chat').scrollTop=$('chat').scrollHeight;}

$('buyer-message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!chatBusy&&e.currentTarget.value.trim())$('chat-form').requestSubmit();}});

$('chat-form').onsubmit=async e=>{

 e.preventDefault();if(chatBusy)return;const text=$('buyer-message').value.trim();if(!text)return;

 if(conversation.length>=12){$('chat-error').textContent='Start a new search to continue.';return;}

 chatBusy=true;$('chat-send').disabled=true;$('chat-new').disabled=true;$('buyer-switch').disabled=true;$('chat-send').textContent='Understanding your needs…';$('chat-error').textContent='';

 const messages=[...conversation,{role:'user',content:text}];

 try{const result=await api('assistant',{message:text,requestId:currentRequestId});currentRequestId=result.requestId;localStorage.setItem('groupoffers-request:'+buyerId,currentRequestId);addChat('user',text);addChat('assistant',result.reply);conversation=[...messages,{role:'assistant',content:result.reply}];brief=result.brief;results=null;fillRequirements();$('buyer-message').value='';await refresh();}

 catch(err){$('chat-error').textContent=err.message;}

 finally{chatBusy=false;$('chat-send').disabled=false;$('chat-new').disabled=false;$('buyer-switch').disabled=false;$('chat-send').textContent='Send →';}

};

$('chat-new').onclick=()=>{currentRequestId=null;localStorage.removeItem('groupoffers-request:'+buyerId);conversation=[];results=null;brief=null;$('chat').replaceChildren();addChat('assistant','What laptop are you looking for? Tell me your budget and what matters to you.');$('chat-error').textContent='';$('buyer-message').value='';render();};

function fillRequirements(){requirementsDirty=false;if(!brief)return;renderDemandOptions();$('requirements-summary').textContent=[brief.brand||'Laptop',brief.budget?'Up to $'+brief.budget:'Budget needed',brief.ram?brief.ram+' GB RAM':null,brief.ssd?brief.ssd+' GB storage':null,brief.location,brief.deliveryDays?'Receive within '+brief.deliveryDays+' days':null,brief.waitingDays?'Group wait up to '+brief.waitingDays+' days':null,...(brief.preferences||[])].filter(Boolean).join(' · ');$('requirements-form').querySelector('details').open=!brief.budget;$('requirements-confirm').disabled=!brief.budget;for(const k of ['budget','ram','ssd','brand','location','deliveryDays','waitingDays'])$('requirements-form').elements.namedItem(k).value=brief[k]??'';}

$('requirements-form').oninput=()=>{$('requirements-confirm').disabled=!Number($('requirements-form').elements.namedItem('budget').value);requirementsDirty=true;results=null;$('matches-panel').hidden=true;$('workspace').classList.add('before-matches');};

$('requirements-form').onsubmit=async e=>{e.preventDefault();if(chatBusy)return;$('requirements-confirm').disabled=true;$('requirements-error').textContent='';try{const f=new FormData(e.target),r=Object.fromEntries(f);for(const k of ['budget','ram','ssd','deliveryDays','waitingDays'])r[k]=r[k]?Number(r[k]):null;r.brand=r.brand.trim()||null;const saved=await api('requests/confirm',{requestId:currentRequestId,revision:brief._revision,requirements:r});brief=saved.brief;renderDemandOptions();requirementsDirty=false;results=saved.offers;await refresh();$('matches-panel').scrollIntoView({behavior:'smooth',block:'start'});}catch(err){$('requirements-error').textContent=err.message;}finally{$('requirements-confirm').disabled=false;}};

async function resumeRequest(id){

 const saved=await api('requests/'+encodeURIComponent(id));currentRequestId=id;localStorage.setItem('groupoffers-request:'+buyerId,id);conversation=saved.conversation;brief=saved.brief;results=saved.offers;fillRequirements();$('chat').replaceChildren();conversation.forEach(m=>addChat(m.role,m.content));$('buyer-message').value='';$('chat-error').textContent=saved.status==='joined'?'This request has an accepted offer. Use New search to change requirements.':'';render();

}

$('buyer-switch').onchange=async e=>{

 if(chatBusy||!e.target.value)return;role='buyer';activeTab='deals';buyerId=e.target.value;sessionStorage.setItem('groupoffers-buyer',buyerId);currentRequestId=null;conversation=[];results=null;brief=null;requirementsDirty=false;$('chat').replaceChildren();addChat('assistant','Tell me your laptop needs and budget.');$('chat-error').textContent='';$('buyer-message').value='';

 try{await refresh();}catch(err){message(err.message);}

};

async function initialize(){

 currentRequestId=null;await refresh();const params=new URLSearchParams(location.search);if(params.has('checkout')){role='buyer';activeTab='payments';renderPortal();}

 if(params.get('checkout')==='cancelled'){message('PayPal checkout closed. Your commitment remains; you can resume checkout or request cancellation.');history.replaceState({},'',location.pathname);}

 if(params.get('checkout')==='approved'){

  try{message('Verifying PayPal payment…');await api('paypal/capture',{id:params.get('member'),key:params.get('key'),orderId:params.get('token')});message('PayPal sandbox payment confirmed. No real money moved.');await refresh();history.replaceState({},'',location.pathname);}

  catch(e){message(e.message+' Refresh this page to retry verification.');}

 }

}



const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);

const stamp=at=>at?new Date(at).toLocaleString():'Time unavailable';

function paymentFor(o){return state.groupPayments?.[o.id];}

function paymentLabel(p){if(!p)return '';return p.paid+'/'+p.required+' buyer payments received'+(p.prefilled?' · '+p.prefilled+' prefilled demo places':'')+(p.deadline?' · Due '+stamp(p.deadline):'');}

function paypalSummary(m){const captured=m.status==='paid'&&m.paymentStatus==='paypal_sandbox_paid'&&!!m.paypalCaptureId;if(!captured&&!m.paypalOrderId)return '';return '<section class="paypal-summary" aria-label="PayPal payment summary"><div class="paypal-summary-heading"><b>PayPal sandbox</b><span class="status-pill">'+(captured?'Captured':'Checkout started')+'</span></div><p>'+(captured?'<strong>'+money(m.total)+'</strong> <span>Server-verified payment</span>':'Buyer approval and completed capture required')+'</p>'+(captured&&m.tracking?.status==='submitted'?'<small>Tracking submitted to PayPal sandbox</small>':'')+'<details><summary>View transaction details</summary><dl><dt>Order ID</dt><dd>'+escape(m.paypalOrderId||'Unavailable')+'</dd><dt>Capture ID</dt><dd>'+escape(m.paypalCaptureId||'Pending')+'</dd>'+(m.paidAt?'<dt>Captured at</dt><dd>'+escape(stamp(m.paidAt))+'</dd>':'')+'</dl></details></section>';}
function trackingDetails(m){return m.tracking?'<p class="tracking-details"><b>'+escape(m.tracking.carrier)+' tracking: '+escape(m.tracking.number)+'</b><small>'+escape(m.tracking.status==='submitted'?'Submitted to PayPal sandbox':'Submission pending - retry from seller workspace')+' - Demo shipment</small></p>':m.shippedAt?'<p class="review-note">Tracking has not been attached yet.</p>':'';}
function requestNumber(id){return 'RQ-'+String(id||'').replaceAll('-','').toUpperCase();}
function lifecycle(steps,index,note=''){return '<div class="lifecycle"><ol>'+steps.map((label,i)=>'<li class="'+(i<index?'complete':i===index?'current':'upcoming')+'" '+(i===index?'aria-current="step"':'')+'><span>'+(i<index?'✓':i+1)+'</span>'+escape(label)+'</li>').join('')+'</ol>'+(note?'<p class="lifecycle-note">'+escape(note)+'</p>':'')+'</div>';}
function requestLifecycle(d,m){const steps=['Request submitted','Collecting buyers','Agent assessment','Seller approval','Deal published','Joined','Paid','Shipped'];let i={posted:1,working:2,awaiting_approval:3,needs_review:2,failed:2,published:4,declined:3,stale:0}[d.status]??0;if(m)i=m.shippedAt?7:m.status==='paid'?6:m.status==='waitlisted'?4:5;const note=['failed','needs_review','declined','stale'].includes(d.status)?'Attention needed: '+({failed:'Assessment interrupted. Retry is available.',needs_review:'Required conditions need review.',declined:'Seller declined this proposal.',stale:'Requirements changed. Submit a current request.'}[d.status]):m?.status==='cancelled'?'Commitment cancelled':m?.status==='waitlisted'?'Waiting for an available place':m?.cancellationRequestedAt?'Cancellation review requested':'';return lifecycle(steps,i,note);}
function orderLifecycle(o,m,p){const steps=[m?.status==='waitlisted'?'Waitlisted':m?.status==='cancelled'?'Cancelled':'Joined','Group ready','Payment received','Ready to ship','Shipped'];const i=['waitlisted','cancelled'].includes(m?.status)?0:m?.shippedAt||p?.status==='shipped'?4:p?.ready?3:m?.status==='paid'?2:(p?.committed??countFor(o))>=o.threshold?1:0;return lifecycle(steps,i,m?.cancellationRequestedAt?'Cancellation review pending':p?.overdue?'Payment deadline passed - seller resolution required':'');}
function dealIdBadge(o){return '<small class="deal-id">Deal ID: <code>'+escape(o.id.replace(/^practice-/, 'DL-'))+'</code></small>';}
function groupLabel(o){return o.name+' - '+o.threshold+'-buyer group';}
function groupedActivity(offers,build){return offers.map(o=>{const items=build(o);return items.length?'<details class="group-activity" open><summary><b>'+escape(groupLabel(o))+'</b>'+dealIdBadge(o)+' - '+items.length+' updates</summary><div class="timeline">'+timeline(items)+'</div></details>':'';}).join('');}
function nextAction(m){if(m.shippedAt)return m.tracking?.status==='submitted'?'Shipped - Tracking submitted to PayPal sandbox':'Shipped - Demo fulfillment';const o=state.offers.find(o=>o.id===m.offerId);if(m.cancellationApprovedAt)return 'Cancellation approved';if(m.cancellationRequestedAt)return 'Cancellation awaiting seller review';const p=paymentFor(o);if(p?.overdue)return m.status==='paid'?'Payment received · Group needs seller resolution':'Payment deadline passed · Seller resolution required';if(m.status==='paid')return p?.ready?'All group payments received · Awaiting shipment':'Your payment received · Waiting for remaining group payments';if(m.status==='waitlisted')return 'On waitlist · awaiting an available place';if(m.status==='cancelled')return 'Cancelled';if(m.paymentStatus==='failed')return 'Payment failed · retry available';const left=Math.max(0,o.threshold-countFor(o));return left?'Waiting for '+left+' more '+(left===1?'buyer':'buyers'):'Group ready · approve your payment';}

function dealCard(o){const count=countFor(o),places=Math.max(0,o.capacity-count);return `<article class="store-deal"><div class="product-art art-${escape(o.artTheme||o.inventorySource||o.id)}" aria-hidden="true"><div class="laptop-screen"><span>◈</span><small>${escape(o.name.split(' ')[0])}</small></div><div class="laptop-base"></div><span class="saving-chip">Save ${money(o.retail-o.price)}</span></div><div class="store-deal-body"><p class="seller">${escape(o.seller)}</p><h3>${escape(o.name)}</h3>${dealIdBadge(o)}${o.demoLabel?'<span class="fit">'+escape(o.threshold+' buyers unlock this price')+'</span>':''}<p class="specs">${o.ram} GB RAM · ${o.ssd} GB SSD</p><div class="store-price"><b>${money(o.price)}</b><del>${money(o.retail)}</del><span>per buyer</span></div><div class="progress"><div style="width:${Math.min(100,count/o.threshold*100)}%"></div></div><div class="card-progress"><span>${count}/${o.threshold} buyers</span><span>${places?places+' '+(places===1?'place':'places')+' left':'Waitlist open'}</span></div><div class="deal-window"><span>${dealStatus(o,count).closed?'Window ended':'Closes in'}</span><time class="card-countdown" data-deadline="${escape(o.closesAt)}" datetime="${escape(o.closesAt)}" title="${escape(deadlineLabel(o))}">${formatTimeLeft(dealStatus(o,count).remaining)}</time></div><small>${escape(deadlineLabel(o))} · US delivery included</small><button data-explore="${escape(o.id)}" ${dealStatus(o,count).closed?'disabled':''}>${dealStatus(o,count).closed?'Deal closed':places?'Explore deal & join group':'Explore deal & waitlist'} →</button></div></article>`;}

function activityActor(actor){const name=String(actor||'');if(/^buyer agent/i.test(name))return {name:'Buyer assistant',kind:'AI / authorized action'};if(/^buyer assistant/i.test(name))return {name:'Buyer assistant',kind:'Automated check'};if(/^buyer$/i.test(name))return {name:'Buyer',kind:'Human action'};if(/^seller$/i.test(name))return {name:'Seller',kind:'Human action'};if(/^seller agent/i.test(name))return {name:'Seller assistant',kind:'AI assessment'};if(/^coordinator/i.test(name))return {name:'Coordinator',kind:'Application rule'};if(/^paypal/i.test(name))return {name:'PayPal',kind:/tracking|sandbox/i.test(name)?'Sandbox':'Server verified'};return {name,kind:''};}
function activityText(text){if(text?.startsWith('Buyer assistant received group readiness.'))return 'Group readiness received. Checkout is available when payment and cancellation checks pass. You approve the payment.';if(text?.startsWith('Group target reached. Coordinator notified'))return 'Group target reached. Buyer assistant notified to check checkout availability.';return text;}
function timeline(items){if(!items.length)return '<p class="empty-state">No activity yet. Actions will appear here as they happen.</p>';return [...items].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).map(e=>{const actor=activityActor(e.actor);return `<article class="timeline-item"><div class="timeline-dot"></div><div class="timeline-body"><div class="timeline-meta"><div class="timeline-actor"><b>${escape(actor.name)}</b><span class="actor-kind">${escape(actor.kind)}</span></div><time datetime="${escape(e.at||'')}">${escape(stamp(e.at))}</time></div><p>${escape(activityText(e.text))}</p><details><summary>View audit details</summary><dl>${Object.entries(e.details||{}).filter(([,v])=>v!=null).map(([k,v])=>'<dt>'+escape(k)+'</dt><dd>'+escape(v)+'</dd>').join('')}</dl></details></div></article>`;}).join('');}


function memberActivity(m){const o=state.offers.find(o=>o.id===m.offerId)||sellerData?.offers.find(o=>o.id===m.offerId);const events=[{actor:m.acceptedBy==='buyer-agent'?'Buyer agent · authorized action':'Buyer',at:m.acceptedAt,text:m.acceptedBy==='buyer-agent'?'Joined one matching unit under explicit buyer authorization; payment remains manual.':(m.buyerName?m.buyerName+' accepted':'Accepted')+' the seller agreement for '+o.name+'.',details:{'Commitment ID':m.id,'Authorization ID':m.authorizationId,'Agreement version':m.termsVersion||o.termsVersion,'Agreed total':money(m.total)}}];if(m.status==='waitlisted')events.push({actor:'Coordinator · automated rule',at:m.acceptedAt,text:'The group was full. Added to the waitlist.',details:{'Commitment ID':m.id}});if(m.promotedAt)events.push({actor:'Coordinator · automated rule',at:m.promotedAt,text:'A place became available. Promoted from the waitlist.',details:{'Commitment ID':m.id}});if(m.cancellationRequestedAt)events.push({actor:'Buyer',at:m.cancellationRequestedAt,text:m.cancellationApprovedAt?'Requested cancellation; subsequently approved by seller.':'Requested cancellation. Seller review pending; no refund issued.',details:{'Commitment ID':m.id}});if(m.cancellationApprovedAt)events.push({actor:'Seller',at:m.cancellationApprovedAt,text:'Approved unpaid cancellation and released the place.',details:{'Commitment ID':m.id}});if(m.tracking?.status==='submitted')events.push({actor:'PayPal sandbox',at:m.tracking.submittedAt,text:'Shipment tracking submitted. Demo fulfillment; no real carrier booking.',details:{Carrier:m.tracking.carrier,'Tracking number':m.tracking.number}});if(m.shippedAt)events.push({actor:'Seller',at:m.shippedAt,text:'Processed shipment. One unit dispatched (demo fulfillment).',details:{'Commitment ID':m.id}});if(m.paidAt)events.push({actor:'PayPal · server verified',at:m.paidAt,text:'Sandbox payment capture completed.',details:{'Commitment ID':m.id,'Capture ID':m.paypalCaptureId,'Amount':money(m.total)}});return events.map(e=>({...e,offerId:m.offerId,details:{...e.details,'Group':groupLabel(o)}}));}

function requestActivity(requestId){return (state.audit||[]).filter(e=>!requestId||e.requestId===requestId).map(e=>({actor:e.actor,at:e.at,text:(e.action==='auto_joined'?'':e.action==='requirements_confirmed'?'Confirmed requirements: ':'Interpreted requirements: ')+e.summary,details:{'Event ID':e.id,'Request ID':e.requestId,'Event type':e.action}}));}

function buyerActivity(){const items=[...state.members.flatMap(memberActivity),...requestActivity(),...workflowItems(state.workflow)];for(const e of state.events)if(['accept','pay','cancel'].includes(e.action))items.push({offerId:e.offerId,actor:e.action==='paypal_capture'?'PayPal · server verified':'Coordinator · automated rule',at:e.at,text:({'accept':'','pay':'Payment attempt recorded: ','cancel':'Cancellation result: ','paypal_capture':''}[e.action])+e.detail,details:{'Event type':e.action,'Commitment ID':e.memberId,'Offer ID':e.offerId}});return items;}

function stats(items){return items.map(([value,label])=>`<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`).join('');}

function paymentRows(members,seller=false,nested=false){if(!members.length)return '<p class="empty-state">No payments to show yet. Join a group to get started.</p>';return members.map(m=>{const o=state.offers.find(o=>o.id===m.offerId);const ready=m.status==='committed'&&!m.cancellationRequestedAt&&countFor(o)>=o.threshold&&!paymentFor(o)?.overdue;return `<div class="payment-row"><div>${nested?'<b>'+escape(m.buyerName)+'</b>':'<b>'+escape(o.name)+'</b><small>Seller: '+escape(o.seller)+'</small>'+dealIdBadge(o)+orderLifecycle(o,m,paymentFor(o))}<small>${seller&&!nested?escape(m.buyerName)+' · ':''}${escape(m.paymentStatus||'Not paid')}${m.paidAt?' · '+escape(stamp(m.paidAt)):''}</small>${paypalSummary(m)}${trackingDetails(m)}</div><strong>${money(m.total)}</strong>${!seller&&ready?(state.paymentMode==='paypal-sandbox'?'<button data-checkout="'+m.id+'">Pay with PayPal (sandbox)</button>':'<button data-pay="'+m.id+'">Simulate payment</button>'):!seller?'<span class="status-pill">'+escape(nextAction(m))+'</span>':'<span class="status-pill">'+escape(m.shippedAt?'Shipped':m.status)+'</span>'}</div>`;}).join('');}

function openTab(tab){activeTab=tab;renderPortal();window.scrollTo({top:0,behavior:'smooth'});}

function renderPortal(){renderBuyerAlerts();renderRequestRoute();const interestMatches=renderDealWatches();

 $('home-page').hidden=role!=='home';$('portal-page').hidden=role==='home';$('buyer-content').hidden=role!=='buyer';$('seller-content').hidden=role!=='seller';

 $('buyer-switch').value=role==='buyer'?buyerId:'';$('seller-switch').innerHTML='<option value="">Choose seller</option>'+state.sellers.map(s=>'<option value="'+escape(s.id)+'">'+escape(s.name)+'</option>').join('');$('seller-switch').value=role==='seller'?sellerId:'';

 lastExpiryKey=expiryKey();const approvedIds=new Set((state.demands||[]).filter(d=>d.status==='published').map(d=>d.offer?.id));const featured=state.offers.filter(o=>!o.inventoryOnly).sort((a,b)=>Number(approvedIds.has(b.id))-Number(approvedIds.has(a.id))||Number(!!b.demoScenario)-Number(!!a.demoScenario));$('home-deals').innerHTML=featured.map(dealCard).join('');$('buyer-deals').innerHTML=featured.map(dealCard).join('');

 const seller=role==='seller';const tabs=seller?[['deals','My deals'],['inventory','Inventory'],['create','Create a deal'],['requests','Review unmet deal proposals'],['fulfillment','Fulfillment'],['payments','Payments']]:[['deals','Top deals'],['search','New search'],['requests','My requests'+((state.demands||[]).some(d=>d.status==='published'&&!state.members.some(m=>m.offerId===d.offer?.id&&!['cancelled','refunded'].includes(m.status)))?' • New deal':'')+(interestMatches?' • '+interestMatches+' '+(interestMatches===1?'match':'matches'):'')],['groups','My groups'],['payments','Payments']];

 $('portal-tabs').innerHTML=tabs.map(([id,label])=>'<button data-tab="'+id+'" aria-current="'+(activeTab===id?'page':'false')+'" class="'+(activeTab===id?'active':'')+'">'+label+'</button>').join('');

 $('portal-role').textContent=seller?'SELLER WORKSPACE':'BUYER WORKSPACE';$('portal-title').textContent=seller?(sellerData?.seller.name||'Loading seller…'):'Hello, '+(state.buyers.find(b=>b.id===buyerId)?.name||'buyer')+'.';$('portal-description').textContent='Demo profile · '+(seller?'Manage your offers and follow your groups.':'Your next good deal starts here.');

 document.querySelectorAll('[data-buyer-tab]').forEach(el=>el.hidden=el.dataset.buyerTab!==activeTab);document.querySelectorAll('[data-seller-tab]').forEach(el=>el.hidden=el.dataset.sellerTab!==activeTab);

 $('buyer-reviews').innerHTML=renderBuyerReviews();$('legacy-reviews').hidden=!state.handoffs?.length;

 $('buyer-stats').innerHTML=stats([[state.members.filter(m=>m.status==='committed').length,'Active groups'],[state.members.filter(m=>m.status==='waitlisted').length,'Waitlisted'],[state.members.filter(m=>m.status==='paid').length,'Payments completed']]);

 $('events').innerHTML='';$('events').closest('section').hidden=true;$('buyer-payments').innerHTML=paymentRows(state.members.filter(m=>m.status!=='cancelled'));

 for(const m of state.members){const el=$('member-'+m.id);if(el){el.querySelector('.next-action')?.remove();el.querySelector('[data-view]')?.remove();const note=document.createElement('p');note.className='next-action';note.textContent=nextAction(m)+(paymentFor(state.offers.find(o=>o.id===m.offerId))?' · '+paymentLabel(paymentFor(state.offers.find(o=>o.id===m.offerId))):'');el.firstElementChild.appendChild(note);const b=document.createElement('button');b.className='quiet';b.dataset.view=m.id;b.textContent=inlineGroups.has(m.id)?'Hide activity':'Show activity';el.querySelector('.actions').prepend(b);}}renderInlineGroups();

 if(sellerData&&seller&&sellerData.seller.id===sellerId)renderSeller();

}

function showGroup(id){const card=$('member-'+id);if(card){if(inlineGroups.has(id))inlineGroups.delete(id);else inlineGroups.add(id);renderInlineGroups();card.scrollIntoView({behavior:'smooth',block:'nearest'});return;}showGroupDialog(id);}
function showGroupDialog(id){const m=state.members.find(m=>m.id===id);if(!m)return;const o=state.offers.find(o=>o.id===m.offerId);$('group-title').textContent=o.name;$('group-detail').innerHTML=dealIdBadge(o)+'<p class="next-action">'+escape(nextAction(m))+'</p><p>'+countFor(o)+' of '+o.threshold+' buyers · '+money(m.total)+' per buyer</p><p>'+escape(paymentLabel(paymentFor(o)))+'</p>'+paypalSummary(m)+trackingDetails(m)+'<button data-go-payments>View payments →</button>';$('group-events').innerHTML=timeline([...memberActivity(m),...(m.requestId?requestActivity(m.requestId):[]),...workflowItems((state.workflow||[]).filter(e=>(state.handoffs||[]).some(h=>h.id===e.handoffId&&h.requestId===m.requestId&&h.offerId===m.offerId))),...state.events.filter(e=>e.memberId===m.id&&e.action==='accept').map(e=>({actor:'Coordinator · automated rule',at:e.at,text:e.detail,details:{'Event type':e.action,'Commitment ID':m.id}}))]);$('group-dialog').showModal();}

function renderSeller(){const d=sellerData;

 $('seller-demands').innerHTML=renderDemands(d.demands||[],true);
 const sharedRequests = d.opportunities || [];
 $('seller-demand-inbox').innerHTML = '<h3>Shared buyer demand</h3>' +
  '<p class="muted">All demo sellers can see these requests. Only the seller assigned to a proposal can publish it.</p>' +
  (sharedRequests.length ? sharedRequests.map(request => '<div class="request-notice">' +
   (request.requestId ? '<small class="request-number">'+escape(requestNumber(request.requestId))+'</small>' : '') +
   '<p>'+escape(request.summary)+'</p>' +
   (request.routing ? '<span class="status-pill">'+escape(request.routing)+'</span>' : '') +
   '</div>').join('') : '<p class="empty-state">No current buyer requests.</p>') +
  '<h3>Your assigned proposals</h3>';

 const publishToggle=$('seller-auto-publish');
 const policyKey=d.seller.id+':'+(d.policy?.revision||'');
 if(publishToggle.dataset.policyKey!==policyKey){
  publishToggle.checked=d.policy?.autoPublish===true;
  publishToggle.dataset.policyKey=policyKey;
 }
 const picker=$('agent-product'),previous=picker.value;picker.innerHTML=d.offers.filter(o=>!o.sourceDemandId&&!o.demoScenario).map(o=>'<option value="'+escape(o.id)+'">'+escape(o.name)+'</option>').join('');if([...picker.options].some(o=>o.value===previous))picker.value=previous;

 $('policy-summary').textContent=d.policy?'Agent enabled: '+d.policy.units+' additional units remaining · '+(d.policy.tiers||[{quantity:d.policy.threshold,price:d.policy.price}]).map(t=>t.quantity+' buyers: '+money(t.price)+' each').join(' · ')+' · '+(d.policy.autoPublish?'Automatic publication authorized':'Seller approval required')+'. Stock is allocated on publication.':'No agent stock declared yet.';



 $('seller-shipments').innerHTML=d.offers.filter(o=>!o.inventoryOnly).map(o=>{const members=d.members.filter(m=>m.offerId===o.id),p=d.groupPayments?.[o.id],pending=members.filter(m=>m.status==='paid'&&!m.cancellationRequestedAt&&(!m.shippedAt||m.tracking?.status!=='submitted')).length;return '<article class="panel"><h3>'+escape(o.name)+'</h3>'+dealIdBadge(o)+orderLifecycle(o,null,p)+'<p>'+d.groupCounts[o.id]+'/'+o.threshold+' buyers joined · '+escape(paymentLabel(p))+'</p><p class="next-action">'+(p?.overdue?'Seller resolution required. Reconcile existing checkouts before considering replacements. No automatic refund.':p?.pendingCancellation?'Resolve pending cancellation requests before shipment.':p?.ready?'All required payments received. Ready for group shipment.':'Awaiting remaining buyers or payments. Shipment stays locked.')+'</p>'+paymentRows(members.filter(m=>['committed','paid','waitlisted'].includes(m.status)),true,true)+members.filter(m=>m.status==='paid'&&!m.cancellationRequestedAt&&(!m.shippedAt||m.tracking?.status!=='submitted')).map(m=>'<div class="member" data-tracking-member="'+escape(m.id)+'"><div><b>'+escape(m.buyerName)+'</b><small>Sandbox demo tracking · No real shipment booked</small></div><label>Carrier<select '+(m.tracking?'disabled':'')+'>'+['UPS','USPS','FEDEX','DHL'].map(c=>'<option '+((m.tracking?.carrier||trackingDrafts.get(m.id)?.carrier)===c?'selected':'')+'>'+c+'</option>').join('')+'</select></label><label>Tracking number<input maxlength="64" placeholder="Sandbox test tracking number" value="'+escape(m.tracking?.number||trackingDrafts.get(m.id)?.trackingNumber||'')+'" '+(m.tracking?'readonly':'')+'></label></div>').join('')+'<button data-process-shipment="'+escape(o.id)+'" '+(!p?.ready||!pending?'disabled':'')+'>'+(members.some(m=>m.shippedAt&&m.tracking?.status!=='submitted')?'Add PayPal tracking':'Process group shipment')+'</button><small>'+ (o.initial?'Existing demo places remain prefilled; payment counts cover recorded buyers.':'Every required buyer payment must be received before this group ships.')+'</small>'+sellerDealActivity(d,o)+'</article>';}).join('');

$('seller-proposals').innerHTML=renderSellerProposals(d);$('seller-inventory').innerHTML=d.offers.filter(o=>!o.inventoryOnly).map(o=>'<div class="member"><div><b>'+escape(o.name)+'</b><small>'+o.ram+' GB RAM · '+o.ssd+' GB SSD · '+money(o.price)+' group price</small></div><span class="status-pill">'+Math.max(0,o.capacity-d.groupCounts[o.id])+' available to join · '+(o.capacity-d.members.filter(m=>m.offerId===o.id&&m.shippedAt).length)+' on hand · '+d.members.filter(m=>m.offerId===o.id&&m.shippedAt).length+' dispatched</span></div>').join('');const paid=d.members.filter(m=>m.status==='paid');$('seller-stats').innerHTML=stats([[d.offers.length,'Posted deals'],[d.members.filter(m=>['committed','paid'].includes(m.status)).length,'Recorded demo buyers'],[money(paid.reduce((n,m)=>n+m.total,0)),'Recorded payments']]);$('seller-deals').innerHTML=d.offers.filter(o=>!o.inventoryOnly).map(o=>{const count=d.groupCounts[o.id];return '<article class="seller-deal panel"><div><p class="seller">'+escape(o.seller)+'</p><h3>'+escape(o.name)+'</h3>'+dealIdBadge(o)+orderLifecycle(o,null,d.groupPayments?.[o.id])+'<p>'+money(o.price)+' per buyer · '+count+'/'+o.threshold+' committed · '+Math.max(0,o.capacity-count)+' places left</p><span class="status-pill">'+(count>=o.threshold?'Group target reached':'Recruiting buyers')+'</span><small>Closes '+escape(deadlineLabel(o))+' · Agreement v'+escape(o.termsVersion)+'</small></div><button class="quiet" data-seller-activity="'+escape(o.id)+'">View activity →</button></article>';}).join('');$('seller-drafts').innerHTML=d.drafts.map(r=>'<div class="member"><div><b>'+escape(r.name)+'</b><small>'+money(r.price)+' · '+r.threshold+' buyers needed · Saved '+escape(stamp(r.createdAt))+'</small></div><span class="status-pill">Draft · Not published</span></div>').join('')||'<p class="empty-state">No drafts yet. Create a deal to save one.</p>';

 if(d.policy){const product=d.offers.find(o=>o.id===d.policy.offerId);$('seller-inventory').insertAdjacentHTML('beforeend','<div class="member"><div><b>'+escape(product?.name||'Seller product')+' · Additional demo inventory</b><small>Stock available for agent-prepared deals; not yet allocated to a published group.</small></div><span class="status-pill">'+d.policy.units+' unallocated units</span></div>');}

 const requests=d.members.filter(m=>m.cancellationRequestedAt&&!m.cancellationApprovedAt);$('seller-requests').innerHTML=requests.map(m=>'<div class="request-notice"><b>'+escape(m.buyerName)+' · Cancellation requested</b><p>'+escape(d.offers.find(o=>o.id===m.offerId).name)+' · '+money(m.total)+'. Seller review required; no refund issued.</p>'+(!m.checkoutStarted&&["committed","waitlisted"].includes(m.status)?'<button data-approve-cancellation="'+escape(m.id)+'">Approve cancellation & release place</button>':'<small>Payment reconciliation or refund review required. This place cannot be released here.</small>')+'</div>').join('')||'<p class="empty-state">No cancellation requests awaiting review.</p>';$('seller-events').innerHTML='';$('seller-payments').innerHTML=paymentRows(d.members,true);

}

async function loadSeller(){const id=sellerId;const data=await api('seller?id='+encodeURIComponent(id));if(sellerId!==id)return;rememberPanels();sellerData=data;renderPortal();restorePanels();}

$('seller-switch').onchange=async e=>{if(chatBusy||!e.target.value)return;role='seller';sellerId=e.target.value;sellerData=null;activeTab='deals';for(const id of ['seller-deals','seller-drafts','seller-events','seller-payments','seller-requests','seller-stats','seller-proposals','seller-inventory'])$(id).replaceChildren();renderPortal();try{await loadSeller();}catch(err){message(err.message);}};

$('home-link').onclick=e=>{e.preventDefault();role='home';renderPortal();window.scrollTo({top:0,behavior:'smooth'});};

document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-home')){role='home';renderPortal();window.scrollTo({top:0,behavior:'smooth'});}if(el.dataset.tab)openTab(el.dataset.tab);if(el.hasAttribute('data-start')){role='buyer';activeTab='search';renderPortal();$('buyer-message').focus();}if(el.hasAttribute('data-go-payments')){$('group-dialog').close();openTab('payments');}if(el.hasAttribute('data-seller-activity')){openTab('fulfillment');const offer=sellerData.offers.find(o=>o.id===el.dataset.sellerActivity);const group=offer&&[...$('seller-events').querySelectorAll('.group-activity')].find(e=>e.querySelector('summary').textContent.includes(groupLabel(offer)));if(group){group.open=true;group.scrollIntoView({behavior:'smooth',block:'start'});}}});

$('seller-form').onsubmit=async e=>{e.preventDefault();if(!sellerId)return;const owner=sellerId;const button=$('seller-save');button.disabled=true;$('seller-error').textContent='';try{const draft=Object.fromEntries(new FormData(e.target));for(const k of ['price','ram','ssd','threshold','capacity','deliveryDays','waitingDays'])draft[k]=Number(draft[k]);await api('seller/drafts',{sellerId:owner,draft});e.target.reset();if(owner===sellerId){await loadSeller();openTab('deals');}message('Draft saved. It is not published to buyers.');}catch(err){$('seller-error').textContent=err.message;}finally{button.disabled=false;}};





function handoffFor(offerId){return (state.handoffs||[]).find(h=>h.requestId===currentRequestId&&h.revision===brief?._revision&&h.offerId===offerId);}

function reviewLabel(status){return {pending:'Seller agent is reviewing',awaiting_approval:'Waiting for seller approval',approved:'Seller approved · Ready for your review',declined:'Seller declined',failed:'Review interrupted · Retry available',stale:'Requirements changed · Start a fresh review',used:'Buyer joined'}[status]||status;}

function workflowItems(events=[]){return events.map(e=>({actor:e.actor,at:e.at,text:e.text,details:{'Event ID':e.id,'Handoff ID':e.handoffId,'Event type':e.action}}));}

function renderBuyerReviews(){return (state.handoffs||[]).length?state.handoffs.map(h=>'<article class="proposal"><div class="section-title"><h3>'+escape(h.snapshot.name)+'</h3><span class="status-pill">'+escape(reviewLabel(h.status))+'</span></div><p class="seller">'+escape(h.snapshot.seller)+'</p><p>'+money(h.snapshot.price)+' · '+h.snapshot.ram+' GB RAM · '+h.snapshot.ssd+' GB SSD</p>'+(h.proposal?'<p><b>Seller agent summary:</b> '+escape(h.proposal.reason)+'</p>':'')+(h.proposal?.caveats.length?'<p class="review-note">AI limitations: '+escape(h.proposal.caveats.join(' · '))+'</p>':'')+'<p class="review-note">Delivery and waiting limits still need seller confirmation. Approval reserves no stock and makes no payment.</p><button class="quiet" data-review-request="'+h.requestId+'">'+(h.status==='approved'?'Open approved offer':'View request')+' →</button></article>').join(''):'<p class="empty-state">Confirm requirements in Find a deal, then request seller review.</p>';}

function renderSellerProposals(d){return d.handoffs?.length?d.handoffs.map(h=>'<article class="proposal"><div class="section-title"><h3>'+escape(h.snapshot.name)+'</h3><span class="status-pill">'+escape(reviewLabel(h.status))+'</span></div><p class="request-notice"><b>Buyer requirements:</b> '+escape(h.snapshot.requirements?.summary||'See the agent summary below.')+'</p><p>'+money(h.snapshot.price)+' per buyer · Group target '+h.snapshot.threshold+' · Agreement v'+escape(h.snapshot.termsVersion)+'</p>'+(h.proposal?'<p><b>Seller agent:</b> '+escape(h.proposal.reason)+'</p><p class="review-note">'+escape(h.proposal.caveats.join(' · '))+'</p>':'<p>Review is pending or interrupted. Buyer can retry an interrupted review.</p>')+'<p class="review-note">Approval offers this existing catalog deal to this buyer. Price, specifications and cancellation terms stay fixed. Delivery estimates are not verified. Joining and payment require separate buyer approval.</p>'+(h.status==='awaiting_approval'?'<div class="actions">'+(h.proposal.decision==='offer'?'<button data-seller-decision="approve" data-handoff-id="'+h.id+'">Approve offer for buyer</button>':'')+'<button class="quiet" data-seller-decision="decline" data-handoff-id="'+h.id+'">Decline</button></div>':'')+'</article>').join(''):'<p class="empty-state">No special catalog reviews. Agent-prepared new deals appear above.</p>';}





function deadlineLabel(o){const d=dealStatus(o,0).deadline;return d===null?'Schedule pending':new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Chicago'}).format(new Date(d))+' CT';}

function expiryKey(){return state.offers.map(o=>o.id+':'+dealStatus(o,countFor(o)).closed).join('|');}

function tickDealCountdowns(){if(!state||document.hidden)return;for(const el of document.querySelectorAll('[data-deadline]')){const value=el.dataset.deadline;el.textContent=formatTimeLeft(dealStatus({closesAt:value,threshold:1,capacity:1},0).remaining);}if(expiryKey()!==lastExpiryKey)render();}

setInterval(tickDealCountdowns,1000);

setInterval(()=>{if(state&&(role==='home'||role==='buyer'&&['groups','payments'].includes(activeTab))&&!document.hidden&&!chatBusy&&!document.activeElement?.closest('select,input,textarea'))refresh().catch(()=>{});},30000);

initialize().catch(e=>message(e.message));



function renderDemands(items,seller=false){if(seller)return items.length?items.map(renderSellerDemandTile).join(''):'<p class="empty-state">No shared proposals yet.</p>';return items.length?items.map(d=>{const joined=!seller&&memberForDemand(d);const labels={posted:'Request posted · Collecting compatible demand',working:'Buyers matched - agents checking seller stock and fit',awaiting_approval:'Agent checks complete - waiting for seller approval',published:'Seller approved - deal published',needs_review:'Required conditions need review',failed:'Assessment interrupted · Retry available',declined:'Seller declined · No deal published',stale:'Requirements changed · Post a new request'};return '<article class="proposal request-tile"><small class="request-number">Request # '+escape(requestNumber(d.requestId||d.id))+'</small>'+requestLifecycle(d,joined)+'<h3>'+escape(d.brief.summary)+'</h3><p class="status-pill">'+escape(joined?'Joined - follow progress in My groups':labels[d.status]||d.status)+'</p><p>'+(d.groupSize?d.groupSize+' buyers matched for one shared proposal · Your request remains separate'+(d.buyerChecksPassed!=null?' · '+d.buyerChecksPassed+'/'+d.groupSize+' buyer checks passed':''):escape(d.progress||'Waiting for matching seller stock and compatible requests.'))+'</p>'+(seller&&d.pooledRequirements?'<p><b>Combined must-haves:</b> '+money(d.pooledRequirements.maxUnitPrice)+' maximum per buyer · '+d.pooledRequirements.minRam+' GB RAM minimum · '+d.pooledRequirements.minStorage+' GB storage minimum · '+escape(d.pooledRequirements.brands.join(', ')||'Any brand')+'</p>':'')+(d.offer?dealIdBadge(d.offer)+'<p>'+escape(d.offer.name)+' · '+money(d.offer.price)+' · '+d.offer.ram+' GB RAM · '+d.offer.ssd+' GB storage · '+d.offer.threshold+' buyers needed</p>':'')+(d.sellerAssessment?'<p><b>Seller agent:</b> '+escape(d.sellerAssessment.explanation)+'</p>':'')+(d.buyerAssessment?'<p><b>Buyer agent:</b> '+escape(d.buyerAssessment.explanation)+'</p>':'')+(d.offer?.priceReason?'<p class="next-action">'+escape(d.offer.priceReason)+'</p>':'')+(d.offer?'<p class="review-note">'+escape([...new Set([...(d.sellerAssessment?.limitations||[]),...(d.buyerAssessment?.limitations||[]),'Delivery and group timing are not guaranteed.'])].join(' · '))+'</p>':'')+(!seller&&d.authorization?'<p><b>Auto-join:</b> '+escape(d.autoJoinMessage||(d.authorization.revokedAt?'Permission revoked':d.authorization.usedAt?'Authorization used': 'One unit · Up to '+money(d.authorization.budget)+' · Expires '+stamp(d.authorization.expiresAt)))+'</p>':'')+(seller&&d.status==='awaiting_approval'?'<button data-publish-demand="'+escape(d.id)+'">Approve & publish shared deal</button><button class="quiet" data-decline-demand="'+escape(d.id)+'">Decline draft</button>':'')+(!seller&&(joined||d.autoJoinedMemberId)?'<button data-open-approved-group="'+escape(joined?.id||d.autoJoinedMemberId)+'">View my group & payment →</button>':!seller&&d.status==='published'?'<button data-explore="'+escape(d.offer.id)+'">Review new deal & join →</button>':'')+(!seller&&d.authorization?.enabled&&!d.authorization.usedAt&&!d.authorization.revokedAt?'<button class="quiet" data-revoke-auto="'+escape(d.id)+'">Revoke auto-join permission</button>':'')+(!seller&&['failed','needs_review'].includes(d.status)?'<button class="quiet" data-retry-demand="'+escape(d.id)+'">Retry assessment</button>':'')+'<details data-panel-key="demand-'+escape(d.id)+'"><summary>Agent activity · '+d.events.length+' recorded actions</summary>'+timeline(d.events)+'</details></article>';}).join(''):'<p class="empty-state">No requested deals yet.</p>';}

function renderDemandOptions(){if(!brief)return;const names={brand:'Brand: '+brief.brand,ram:'Minimum RAM: '+brief.ram+' GB',ssd:'Minimum storage: '+brief.ssd+' GB',deliveryDays:'Receive within '+brief.deliveryDays+' days',waitingDays:'Group ready within '+brief.waitingDays+' days'};

 $('demand-options').innerHTML='<details class="assistant-about"><summary>Optional: adjust requirements</summary><h4>Must-haves & flexible preferences</h4><p>Checked items are required. Uncheck only what you are willing to compromise on. Your '+money(brief.budget)+' budget is always a hard limit.</p>'+Object.entries(names).filter(([k])=>brief[k]!=null).map(([k,label])=>'<label class="consent"><input type="checkbox" data-required-field="'+k+'" '+(!(brief.flexibleFields||[]).includes(k)?'checked':'')+'>'+escape(label)+' is required</label>').join('')+(brief.preferences||[]).map((p,i)=>'<label class="consent"><input type="checkbox" data-required-preference="'+i+'" '+(!(brief.flexiblePreferences||[]).includes(p)?'checked':'')+'>'+escape(p)+' is required</label>').join('')+'</details><details class="assistant-about"><summary>Optional: let my agent join one matching deal</summary><p>No payment is made. Auto-join creates a commitment under the selected seller’s displayed cancellation terms. Unverified must-haves pause the action. No automatic waitlisting.</p><label class="consent"><input type="checkbox" id="auto-enable">Authorize my agent to join one unit in one matching deal</label><div id="auto-sellers">'+state.sellers.map(s=>{const o=state.offers.find(o=>o.id===s.id);return '<label class="consent"><input type="checkbox" data-auto-seller="'+escape(s.id)+'">'+escape(s.name)+' · Agreement v'+escape(o.termsVersion)+' · US delivery included · '+(o.cancelBeforePayment?'May cancel before checkout starts.':'Cancellation after joining requires seller review.')+' Payment is due within 24 hours after the group fills. After checkout starts or payment, cancellation requires seller review; no automatic refund.</label>';}).join('')+'</div><div class="requirements-fields"><label>Permission valid for (days)<input id="auto-days" type="number" min="1" max="7" value="3"></label><label>Maximum group size<input id="auto-group-size" type="number" min="2" max="100" value="2"></label></div><label class="consent"><input type="checkbox" id="auto-terms">I accept the selected sellers’ displayed terms for one automatic commitment within my budget and must-haves. I will approve payment separately.</label></details>';

}

$('post-demand').onclick=async()=>{const b=$('post-demand');b.disabled=true;$('demand-error').textContent='';try{const flexibleFields=[...document.querySelectorAll('[data-required-field]')].filter(e=>!e.checked).map(e=>e.dataset.requiredField),flexiblePreferences=[...document.querySelectorAll('[data-required-preference]')].filter(e=>!e.checked).map(e=>brief.preferences[Number(e.dataset.requiredPreference)]);const options={flexibleFields,flexiblePreferences,authorization:{enabled:$('auto-enable').checked,acceptTerms:$('auto-terms').checked,sellerIds:[...document.querySelectorAll('[data-auto-seller]:checked')].map(e=>e.dataset.autoSeller),terms:[...document.querySelectorAll('[data-auto-seller]:checked')].map(e=>{const o=state.offers.find(o=>o.id===e.dataset.autoSeller);return {sellerId:o.id,seller:o.seller,termsVersion:o.termsVersion,cancelBeforePayment:o.cancelBeforePayment,region:o.region,currency:'USD',paymentWindowHours:24};}),days:Number($('auto-days').value),maxGroupSize:Number($('auto-group-size').value)}};await api('demands/post',{requestId:currentRequestId,revision:brief?._revision,options});await refresh();openTab('requests');$('buyer-demands').scrollIntoView({behavior:'smooth'});message('Your request was submitted. My requests shows matching progress; seller approval is still required.');}catch(e){$('demand-error').textContent=e.message;}finally{render();}};

$('agent-policy-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('policy-error').textContent='';try{const data=Object.fromEntries(new FormData(e.target));if(data.tierQuantity||data.tierPrice){if(!data.tierQuantity||!data.tierPrice)throw Error('Enter both the larger group size and its price.');data.tiers=[{quantity:Number(data.tierQuantity),price:Number(data.tierPrice)}];}data.autoPublish=e.target.elements.autoPublish.checked;await api('seller/agent-policy',{sellerId,...data});await loadSeller();message(data.autoPublish?'Seller rules saved. Eligible proposals can publish automatically.':'Seller rules saved. Proposals await your approval.');}catch(err){$('policy-error').textContent=err.message;}finally{b.disabled=false;}};

setInterval(()=>{if(!state||document.hidden||chatBusy||document.activeElement?.closest('input,textarea,select'))return;if(role==='buyer')refresh().catch(()=>{});if(role==='seller'&&sellerId)loadSeller().catch(()=>{});},5000);


document.addEventListener('input',e=>{const row=e.target.closest('[data-tracking-member]');if(row)trackingDrafts.set(row.dataset.trackingMember,{carrier:row.querySelector('select').value,trackingNumber:row.querySelector('input').value});});

function rememberPanels(){document.querySelectorAll('details').forEach((el,i)=>{const key=el.dataset.panelKey||('panel-'+i);if(el.open)expandedPanels.add(key);else expandedPanels.delete(key);});}
function restorePanels(){document.querySelectorAll('details').forEach((el,i)=>{el.open=expandedPanels.has(el.dataset.panelKey||('panel-'+i));});}
function renderInlineGroups(){for(const m of state.members){const card=$('member-'+m.id);if(!card)continue;card.querySelector('.inline-activity')?.remove();const button=card.querySelector('[data-view]');if(button)button.textContent=inlineGroups.has(m.id)?'Hide activity':'Show activity';if(!inlineGroups.has(m.id))continue;const panel=document.createElement('div');panel.className='inline-activity';panel.innerHTML='<h3>Activity for this group</h3>'+dealIdBadge(state.offers.find(o=>o.id===m.offerId))+timeline([...memberActivity(m),...state.events.filter(e=>e.memberId===m.id&&['accept','group_ready','buyer_checkout_ready'].includes(e.action)).map(e=>({actor:e.action==='buyer_checkout_ready'?'Buyer assistant - automated check':'Coordinator - automated rule',at:e.at,text:e.detail,details:{'Group':groupLabel(state.offers.find(o=>o.id===m.offerId)),'Group ID':m.offerId}}))]);card.appendChild(panel);}}

function renderBuyerAlerts(){let box=$('buyer-approval-alerts');if(!box){box=document.createElement('div');box.id='buyer-approval-alerts';box.setAttribute('aria-live','polite');$('buyer-request-updates').append(box);}box.innerHTML=(state.demands||[]).filter(d=>d.status==='published'&&d.offer&&!isPastDemand(d)).map(d=>{const m=state.members.find(m=>m.offerId===d.offer.id&&!['cancelled','refunded'].includes(m.status));return '<article class="request-notice"><b>'+escape(d.offer.seller)+(d.publishedByPolicy?' published a deal under seller rules':' approved a deal for your request')+'</b><p>'+escape(d.offer.name)+' - '+money(d.offer.price)+' per buyer</p><p>'+escape(m?'You have joined this group. Check its status and approve payment when ready.':d.autoJoinMessage||'Review the seller agreement and join this new deal. Sharing interest alone does not join a group.')+'</p>'+(m?'<button data-open-approved-group="'+escape(m.id)+'">View my group</button>':'<button data-explore="'+escape(d.offer.id)+'">Review approved deal & join</button>')+'</article>';}).join('');}
document.addEventListener('click',e=>{const el=e.target.closest('[data-open-approved-group]');if(el){openTab('groups');showGroup(el.dataset.openApprovedGroup);}});

function memberForDemand(d){return d.offer&&state.members.find(m=>m.offerId===d.offer.id);}
function isPastDemand(d){return !!memberForDemand(d)||['declined','stale'].includes(d.status)||(d.status==='published'&&d.offer?.closesAt&&Date.parse(d.offer.closesAt)<=Date.now());}
function renderCurrentDemands(){const all=state.demands||[],past=all.filter(isPastDemand),active=all.filter(d=>!isPastDemand(d));const unshared=(state.requests||[]).filter(r=>!all.some(d=>d.requestId===r.id)&&r.status!=='joined');const fresh=unshared.map(r=>'<article class="proposal request-tile"><small class="request-number">Request # '+escape(requestNumber(r.id))+'</small>'+lifecycle(['Request submitted','Confirm requirements','Share with sellers'],r.brief?._confirmed?2:1)+'<h3>'+escape(r.brief.summary||'Laptop request')+'</h3><button data-resume="'+escape(r.id)+'">'+(r.brief?._confirmed?'Review & share request':'Continue request')+'</button></article>').join('');return fresh+(active.length?renderDemands(active):unshared.length?'':'<p class="empty-state">No active requests. Start a new search to request a deal.</p><button data-tab="search">Start a new search</button>')+(past.length?'<details class="request-history" data-panel-key="request-history"><summary>Past requests ('+past.length+')</summary>'+renderDemands(past)+'</details>':'');}

function sellerDealActivity(d,o){const items=[...d.members.filter(m=>m.offerId===o.id).flatMap(memberActivity),...workflowItems(d.workflow.filter(e=>d.handoffs.some(h=>h.id===e.handoffId&&h.offerId===o.id))),...(d.events||[]).filter(e=>e.offerId===o.id&&e.action==='accept').map(e=>({actor:'Coordinator',at:e.at,text:e.detail,details:{'Commitment ID':e.memberId}}))];return '<details class="deal-activity" data-panel-key="seller-deal-'+escape(o.id)+'"><summary>Deal activity ('+items.length+')</summary>'+timeline(items)+'</details>';}

function renderRequestRoute(){if(!brief?._confirmed)return;const available=(results||[]).some(o=>!(o.differences||[]).length&&countFor(o)<o.capacity&&!dealStatus(o,countFor(o)).closed);const panel=$('request-new-deal'),alternatives=$('alternative-deals');if(!panel||!alternatives)return;if(!available){alternatives.before(panel);$('availability-summary').textContent='No available deal meets all your requirements. Submit a request below; we will look for compatible buyers and seller stock.';}else{alternatives.after(panel);alternatives.open=true;}}

function assessmentBlock(label,a,key){return '<div class="assessment-block"><b>'+escape(label)+'</b><span class="status-pill">'+(a?(a.suitable?'Fit confirmed':'Review needed'):'Pending')+'</span>'+(a?'<details data-panel-key="'+escape(key)+'"><summary>Assessment details</summary><p>'+escape(a.explanation)+'</p>'+((a.limitations||[]).length?'<p class="review-note">'+escape(a.limitations.join(' · '))+'</p>':'')+'</details>':'')+'</div>';}
function renderSellerDemandTile(d){if(!Array.isArray(d.participants))return '<article class="proposal request-tile"><h3>Shared proposal - '+Number(d.groupSize||1)+' buyers</h3><p class="request-notice">The running server needs a restart to show every request and buyer assessment. Stop it with Ctrl+C, run npm run demo, then refresh this tab. Your saved requests are retained.</p>'+(d.offer?dealIdBadge(d.offer):'')+'</article>';const people=d.participants||[{requestId:d.requestId,summary:d.brief.summary,buyerName:'Buyer',buyerAssessment:d.buyerAssessment,events:d.events}];const stage={posted:0,working:1,needs_review:1,failed:1,awaiting_approval:2,published:3,declined:2,stale:0}[d.status]??0;const events=people.flatMap(p=>(p.events||[]).map(e=>({...e,text:p.buyerName+' - '+e.text,details:{...e.details,'Request #':requestNumber(p.requestId)}})));return '<article class="proposal request-tile"><h3>Shared proposal - '+people.length+' buyer requests</h3>'+lifecycle(['Collect buyers','Assess stock and buyer fit','Seller decision','Published'],stage,['needs_review','failed','declined','stale'].includes(d.status)?'Attention needed: '+d.status.replaceAll('_',' '):'')+'<h4>Included requests</h4><div class="included-requests">'+people.map(p=>'<div><b>'+escape(p.buyerName)+'</b><small class="request-number">Request # '+escape(requestNumber(p.requestId))+'</small><p>'+escape(p.summary||'Requirements unavailable')+'</p></div>').join('')+'</div>'+(d.offer?'<h4>Proposed deal</h4>'+dealIdBadge(d.offer)+'<p><b>'+escape(d.offer.name)+' - '+money(d.offer.price)+' per buyer</b><br>'+d.offer.ram+' GB RAM · '+d.offer.ssd+' GB storage · '+d.offer.threshold+' buyers needed</p>':'')+(d.offer?.priceReason?'<p class="next-action">'+escape(d.offer.priceReason)+'</p>':'')+'<h4>Agent checks</h4>'+assessmentBlock('Seller assistant - inventory and group fit',d.sellerAssessment,'seller-check-'+d.id)+people.map(p=>assessmentBlock('Buyer assistant - '+p.buyerName,d.participants?p.buyerAssessment:d.buyerAssessment,'buyer-check-'+d.id+'-'+p.requestId)).join('')+(d.status==='awaiting_approval'?'<button data-publish-demand="'+escape(d.id)+'">Approve & publish shared deal</button><button class="quiet" data-decline-demand="'+escape(d.id)+'">Decline proposal</button>':d.status==='published'?'<p class="next-action">'+(d.publishedByPolicy?'Published under authorized seller rules.':'Seller approved and published this deal.')+' Follow purchases in Fulfillment.</p>':'')+'<details data-panel-key="proposal-audit-'+escape(d.id)+'"><summary>Full activity by request</summary>'+timeline(events)+'</details></article>';}


function savedWatches(){
 try{return JSON.parse(localStorage.getItem('dealpod-deal-watches:'+buyerId)||'{}')||{};}
 catch{return {};}
}

function renderDealWatches(){
 const watches=savedWatches();
 const button=$('watch-current-request');
 const request=state.requests.find(r=>r.id===currentRequestId);
 const canWatch=request?.status==='open'&&brief?._confirmed&&!requirementsDirty&&
  !brief.deliveryDays&&!brief.waitingDays&&!(brief.requiredPreferences??brief.preferences??[]).length&&
  (!brief.location||/^(US|USA|United States)$/i.test(brief.location.trim()));
 button.hidden=!canWatch;
 button.textContent=request&&watches[request.id]===request.brief._revision?'View saved interest':'Save as an interest';

 const watched=state.requests.filter(r=>r.status==='open'&&watches[r.id]===r.brief._revision);
 const availableOffers=state.offers.filter(o=>!activeFor(o.id)&&!state.groupPayments?.[o.id]?.overdue);
 const interests=watched.map(request=>({
  request,
  match:findWatchedDeal(request.brief,availableOffers,state.groupCounts)
 }));
 const panel=$('buyer-deal-watches');
 const html=interests.length?'<section class="panel"><h2>Saved interests</h2>'+
  interests.map(({request,match})=>
   '<article class="request-notice"><b>'+escape(request.brief.summary)+'</b>'+
    (match?'<p><strong>Matching deal available</strong> · '+escape(match.name)+' · '+money(match.price)+'</p>'+
      '<button data-explore="'+escape(match.id)+'">Review deal</button>':
      '<p>Your buyer assistant is checking for an open deal within your budget and specs.</p>')+
    '<button class="quiet" data-stop-watch="'+escape(request.id)+'">Remove interest</button></article>'
  ).join('')+'</section>':'';
 if(panel.innerHTML!==html)panel.innerHTML=html;
 return interests.filter(interest=>interest.match).length;
}

$('watch-current-request').onclick=()=>{
 const request=state.requests.find(r=>r.id===currentRequestId);
 if(!request||$('watch-current-request').hidden)return;
 const watches=savedWatches();
 watches[request.id]=request.brief._revision;
 localStorage.setItem('dealpod-deal-watches:'+buyerId,JSON.stringify(watches));
 openTab('requests');
};

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-stop-watch]');
 if(!button)return;
 const watches=savedWatches();
 delete watches[button.dataset.stopWatch];
 localStorage.setItem('dealpod-deal-watches:'+buyerId,JSON.stringify(watches));
 renderPortal();
});
