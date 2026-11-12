import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {openStore} from './storage.mjs';
import {offers,accept,requestCancellation} from './core.mjs';
function clean(dir){assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&basename(dir).startsWith('groupoffers-db-'));rmSync(dir,{recursive:true,force:true});}

test('JSON import retains payment keys, captures, chronology and original file; runs once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'groupoffers-db-')),path=join(dir,'app.sqlite'),legacyPath=join(dir,'state.json');
 const state={members:[],events:[{at:'2026-10-11T20:00:00Z',action:'paypal_capture',detail:'completed'}]};
 const m=accept(state,'lenovo','1');m.status='paid';m.paymentStatus='paypal_sandbox_paid';m.paypal={orderId:'ORDER',captureId:'CAPTURE',createKey:'CREATE',captureKey:'CAPTUREKEY',returnKey:'RETURN',paidAt:'2026-10-11T20:00:00Z'};
 const source=JSON.stringify(state);writeFileSync(legacyPath,source);let store;
 try{store=openStore({path,legacyPath,catalog:offers});assert.deepEqual(store.loadState(),state);assert.equal(store.integrity(),'ok');assert.equal(store.counts().payments,1);assert.equal(readFileSync(legacyPath,'utf8'),source);assert.equal(readFileSync(path+'.legacy.json','utf8'),source);store.close();store=null;
 writeFileSync(legacyPath,'{"members":[],"events":[]}');store=openStore({path,legacyPath,catalog:offers});assert.deepEqual(store.loadState(),state);
 }finally{store?.close();clean(dir);}
});
test('transaction rollback preserves prior payments when an invalid commitment is saved',()=>{
 const store=openStore({path:':memory:',legacyPath:null,catalog:offers});try{const state={members:[],events:[]};const m=accept(state,'lenovo','1');m.paypal={orderId:'ORDER',captureKey:'KEY'};store.saveState(state);const invalid=structuredClone(state);invalid.members[0].offerId='unknown';assert.throws(()=>store.saveState(invalid));assert.deepEqual(store.loadState(),state);assert.equal(store.counts().payments,1);}finally{store.close();}
});
test('requests and cancellations survive reopening without affecting payment records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'groupoffers-db-')),path=join(dir,'app.sqlite');let store;
 try{store=openStore({path,legacyPath:null,catalog:offers});const state={members:[],events:[]};const m=accept(state,'dell','1');requestCancellation(state,m.id);store.saveState(state);store.saveRequest({brief:{supported:true,budget:700},messages:[{role:'user',content:'Laptop under $700'}],reply:'Here are offers.'});store.close();store=null;store=openStore({path,legacyPath:null,catalog:offers});assert.deepEqual(store.loadState(),state);assert.equal(store.counts().requests,1);assert.equal(store.counts().buyers,7);assert.equal(store.loadOffers().length,3);}finally{store?.close();clean(dir);}
});
test('malformed legacy state fails closed rather than silently losing records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'groupoffers-db-'));try{const legacyPath=join(dir,'state.json');writeFileSync(legacyPath,'broken');assert.throws(()=>openStore({path:join(dir,'app.sqlite'),legacyPath,catalog:offers}),/Cannot import legacy state/);assert.equal(readFileSync(legacyPath,'utf8'),'broken');}finally{clean(dir);}
});
