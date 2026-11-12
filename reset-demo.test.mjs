import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from './storage.mjs';
import {offers,accept} from './core.mjs';
import {resetDemoData} from './reset-demo.mjs';

test('reset backs up payments and clears activity, preserves profiles and deals, and releases stock once',()=>{
 const root=join(tmpdir(),'dealpod-reset-'+crypto.randomUUID()),path=root+'.sqlite',backup=root+'-backup.sqlite';
 const store=openStore({path,legacyPath:null,catalog:offers});const state={members:[],events:[]};const member=accept(state,'lenovo','1','buyer-alex');member.status='paid';member.shippedAt='2026-10-01';member.paypal={orderId:'ORDER',captureId:'CAPTURE'};store.saveState(state);
 const data=store.getCommerce();data.policies=[{sellerId:'lenovo',offerId:'lenovo',units:2,price:649,threshold:2}];data.demands=[{id:'old',status:'published'}];const generated={...offers[0],id:'demand-old',sourceDemandId:'old',initial:0,capacity:2,threshold:2};store.saveCommerce(data,generated);store.close();
 const db=new DatabaseSync(path);try{const before=db.prepare('SELECT count(*) AS n FROM buyers').get().n;resetDemoData(db,backup);assert.equal(db.prepare('SELECT count(*) AS n FROM commitments').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM buyers').get().n,before);assert.equal(db.prepare('SELECT count(*) AS n FROM offers').get().n,4);const saved=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='commerce'").get().value);assert.equal(saved.policies[0].units,4);assert.deepEqual(saved.demands,[]);const old=JSON.parse(db.prepare("SELECT payload FROM offers WHERE id='demand-old'").get().payload);assert.ok(Date.parse(old.closesAt)<Date.now());resetDemoData(db,root+'-second.sqlite');assert.equal(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='commerce'").get().value).policies[0].units,4);
  const copy=new DatabaseSync(backup,{readOnly:true});try{assert.equal(copy.prepare('SELECT count(*) AS n FROM payments').get().n,1);assert.equal(copy.prepare('SELECT count(*) AS n FROM commitments').get().n,1);}finally{copy.close();}
 }finally{db.close();}
});
