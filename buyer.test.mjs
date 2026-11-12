import test from 'node:test';import assert from 'node:assert/strict';
import {offers,accept,ownedMember,requestCancellation} from './core.mjs';
import {openStore} from './storage.mjs';
test('different buyers share group capacity and waitlist without duplicate commitments',()=>{
 const state={members:[],events:[]};const alex=accept(state,'lenovo','1','buyer-alex');const jordan=accept(state,'lenovo','1','buyer-jordan');const sam=accept(state,'lenovo','1','buyer-sam');
 assert.equal(alex.status,'committed');assert.equal(jordan.status,'waitlisted');assert.equal(sam.status,'waitlisted');assert.throws(()=>accept(state,'lenovo','1','buyer-alex'));requestCancellation(state,alex.id);assert.equal(jordan.status,'committed');assert.equal(sam.status,'waitlisted');
});
test('ownership guards preserve the legacy demo buyer and reject another buyer',()=>{
 const state={members:[],events:[]};const demo=accept(state,'dell','1');assert.equal(ownedMember(state,demo.id,'demo-buyer'),demo);assert.throws(()=>ownedMember(state,demo.id,'buyer-alex'));const alex=accept(state,'dell','1','buyer-alex');assert.equal(ownedMember(state,alex.id,'buyer-alex'),alex);assert.throws(()=>ownedMember(state,alex.id,'buyer-jordan'));
});
test('request conversations update one saved request and are isolated by buyer',()=>{
 const store=openStore({path:':memory:',legacyPath:null,catalog:offers});try{
 const brief={supported:true,budget:null,summary:'Laptop for college'};const messages=[{role:'user',content:'College laptop'}];const id=store.saveRequest({buyerId:'buyer-alex',brief,messages,reply:'What budget?'});
 assert.equal(store.getRequest(id,'buyer-alex').conversation.length,2);assert.throws(()=>store.getRequest(id,'buyer-jordan'));assert.equal(store.listRequests('buyer-jordan').length,0);assert.equal(store.listRequests('buyer-alex').length,1);assert.equal(store.listRequests('buyer-alex')[0].id,id);
 const previous=store.getRequest(id,'buyer-alex');const updated=store.saveRequest({id,buyerId:'buyer-alex',expectedTurns:2,brief:{...brief,budget:700},messages:[...previous.conversation,{role:'user',content:'$700'}],reply:'Here are offers.'});assert.equal(updated,id);assert.equal(store.counts().requests,1);assert.equal(store.getRequest(id,'buyer-alex').conversation.length,4);
 assert.throws(()=>store.saveRequest({id,buyerId:'buyer-alex',expectedTurns:2,brief,messages,reply:'stale'}),/another window/);assert.equal(store.getRequest(id,'buyer-alex').brief.budget,700);
 }finally{store.close();}
});
test('acceptance links request atomically and prevents changing accepted requirements',()=>{
 const store=openStore({path:':memory:',legacyPath:null,catalog:offers});try{
 const brief={supported:true,budget:700,summary:'Laptop'};const messages=[{role:'user',content:'Laptop under $700'}];const id=store.saveRequest({buyerId:'buyer-alex',brief,messages,reply:'Offer found'});const state={members:[],events:[]};accept(state,'lenovo','1','buyer-alex');
 assert.throws(()=>store.saveState(state,{requestId:id,buyerId:'buyer-jordan'}));assert.equal(store.loadState().members.length,0);
 store.saveState(state,{requestId:id,buyerId:'buyer-alex'});assert.equal(store.getRequest(id,'buyer-alex').status,'joined');assert.throws(()=>store.saveRequest({id,buyerId:'buyer-alex',brief,messages,reply:'Changed'}),/accepted offer/);assert.equal(store.loadState().members[0].buyerId,'buyer-alex');
 }finally{store.close();}
});

test('confirmation is owned, versioned and invalidated by a new message',()=>{const store=openStore({path:':memory:',legacyPath:null,catalog:offers});try{const id=store.saveRequest({buyerId:'buyer-alex',brief:{supported:true,budget:700,summary:'Laptop'},messages:[{role:'user',content:'Laptop'}],reply:'Review'});const saved=store.getRequest(id,'buyer-alex');assert.equal(saved.brief._confirmed,false);assert.throws(()=>store.confirmRequest(id,'buyer-jordan',saved.brief._revision,{}));assert.throws(()=>store.confirmRequest(id,'buyer-alex','stale',{}));const confirmed=store.confirmRequest(id,'buyer-alex',saved.brief._revision,{deliveryDays:14,waitingDays:3,location:'US'});assert.equal(confirmed.brief._confirmed,true);assert.equal(store.loadState().members.length,0);store.saveRequest({id,buyerId:'buyer-alex',expectedTurns:2,brief:confirmed.brief,messages:confirmed.conversation,reply:'Changed'});assert.equal(store.getRequest(id,'buyer-alex').brief._confirmed,false);}finally{store.close();}});
test('seller drafts and request audit are isolated by profile',()=>{const store=openStore({path:':memory:',legacyPath:null,catalog:offers});try{const id=store.saveSellerDraft('lenovo',{name:'Test draft',price:500});assert.equal(store.sellerDrafts('lenovo')[0].id,id);assert.equal(store.sellerDrafts('dell').length,0);const requestId=store.saveRequest({buyerId:'buyer-alex',brief:{supported:true,budget:700,summary:'Laptop'},messages:[{role:'user',content:'Laptop'}],reply:'Review'});let saved=store.getRequest(requestId,'buyer-alex');store.confirmRequest(requestId,'buyer-alex',saved.brief._revision,{budget:700,location:'US',deliveryDays:14,waitingDays:3});assert.deepEqual(store.requestAudit('buyer-alex').map(e=>e.action),['requirements_confirmed','requirements_interpreted']);assert.equal(store.requestAudit('buyer-jordan').length,0);assert.equal(store.loadState().members.length,0);}finally{store.close();}});
