import test from 'node:test';
import assert from 'node:assert/strict';
import {accept,cancel,pay} from './core.mjs';
import {createCheckout,captureCheckout,validatePayment} from './checkout.mjs';
import {createPayPalClient} from './paypal.mjs';
function fixture(){const state={members:[],events:[]};const member=accept(state,'lenovo','1');return {state,member};}
function complete(member){return {status:'COMPLETED',purchase_units:[{custom_id:member.id,payments:{captures:[{id:'CAPTURE1',status:'COMPLETED',amount:{currency_code:'USD',value:'649.00'}}]}}]};}
test('create saves retry keys before network call and uses server total',async()=>{
 const {state,member}=fixture();let saves=0,calls=0;
 const client={create:async(body,key)=>{assert.ok(saves>0);assert.equal(body.purchase_units[0].amount.value,'649.00');assert.equal(body.purchase_units[0].custom_id,member.id);assert.equal(key,member.paypal.createKey);calls++;return {id:'ORDER1',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1'}]};},get:async()=>({status:'CREATED'})};
 const save=async()=>{saves++;};await createCheckout(state,member.id,client,save,'http://localhost:3000');await createCheckout(state,member.id,client,save,'http://localhost:3000');assert.equal(calls,1);assert.throws(()=>cancel(state,member.id));assert.throws(()=>pay(state,member.id));
});
test('capture binds order and return key, rejects unapproved orders, and verifies total',async()=>{
 const {state,member}=fixture();member.paypal={orderId:'ORDER1',returnKey:'KEY',captureKey:'CAPTUREKEY'};
 const input={id:member.id,orderId:'ORDER1',key:'KEY'};
 await assert.rejects(captureCheckout(state,{...input,orderId:'OTHER'},{},async()=>{}));
 await assert.rejects(captureCheckout(state,input,{get:async()=>({status:'CREATED'})},async()=>{}));
 const wrong=complete(member);wrong.purchase_units[0].payments.captures[0].amount.value='1.00';assert.throws(()=>validatePayment(wrong,member));assert.equal(member.status,'committed');
});
test('capture timeout reconciles completed payment and prevents repeated capture',async()=>{
 const {state,member}=fixture();member.paypal={orderId:'ORDER1',returnKey:'KEY',captureKey:'CAPTUREKEY'};let gets=0,captures=0;
 const client={get:async()=>++gets===1?{status:'APPROVED'}:complete(member),capture:async(id,key)=>{assert.equal(key,'CAPTUREKEY');captures++;throw Error('timeout');}};
 const input={id:member.id,orderId:'ORDER1',key:'KEY'};await captureCheckout(state,input,client,async()=>{});await captureCheckout(state,input,client,async()=>{});assert.equal(captures,1);assert.equal(member.status,'paid');assert.equal(member.paymentStatus,'paypal_sandbox_paid');assert.equal(member.paypal.captureId,'CAPTURE1');
});
test('sandbox client caches token and refuses live environment',async()=>{
 assert.throws(()=>createPayPalClient({environment:'live'}));let calls=0;
 const client=createPayPalClient({clientId:'test',secret:'test',request:async(url)=>{assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));calls++;return {ok:true,json:async()=>({access_token:'test-token',expires_in:3600})};}});
 await client.authenticate();await client.authenticate();assert.equal(calls,1);
});
