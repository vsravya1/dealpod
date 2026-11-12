import test from 'node:test';
import assert from 'node:assert/strict';
import {offers,accept} from './core.mjs';
import {openStore} from './storage.mjs';
import {preparePracticeDeals} from './practice-deals.mjs';

test('practice batches preserve purchases, deadlines and stock rules; fresh batches allow repeat testing',()=>{
 const original=structuredClone(offers),store=openStore({path:':memory:',legacyPath:null,catalog:original});
 try{
  const state={members:[],events:[]};const m=accept(state,'lenovo','1','buyer-alex');m.status='paid';m.shippedAt='2026-10-18T00:00:00Z';m.paypal={orderId:'keep',captureId:'keep-capture'};store.saveState(state);const commerce=store.getCommerce();const now=Date.now();
  assert.equal(preparePracticeDeals(store,'first',now).count,9);
  const fresh=store.loadOffers().filter(o=>o.demoBatch==='first');assert.equal(new Set(fresh.map(o=>o.seller)).size,3);assert.ok(fresh.every(o=>o.initial===0&&o.threshold===o.capacity&&o.capacity>=2&&Date.parse(o.closesAt)>now));
  assert.ok(fresh.filter(o=>o.inventorySource==='lenovo').every(o=>o.ram<16||o.ssd<512));
  assert.equal(preparePracticeDeals(store,'first',now+10000).applied,false);assert.deepEqual(store.loadOffers().filter(o=>o.demoBatch==='first'),fresh);
  const joined=accept(store.loadState(),fresh[0].id,'1','buyer-alex');assert.equal(joined.status,'committed');
  assert.equal(preparePracticeDeals(store,'second',now).count,9);assert.equal(store.loadOffers().length,21);assert.deepEqual(store.loadState(),state);assert.deepEqual(store.getCommerce(),commerce);
 }finally{store.close();offers.splice(0,offers.length,...original);}
});
