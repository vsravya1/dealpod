import {offerSnapshot,validateSellerProposal} from './seller-agent.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export function openStore({path='data/groupoffers.sqlite',legacyPath='data/state.json',catalog=[]}={}){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path,{timeout:5000});
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS buyers(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS offers(id TEXT PRIMARY KEY,seller TEXT NOT NULL,sku_name TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>=0),terms_version TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES buyers(id),created_at TEXT NOT NULL,status TEXT NOT NULL,brief TEXT NOT NULL CHECK(json_valid(brief)),conversation TEXT NOT NULL CHECK(json_valid(conversation)));
 CREATE TABLE IF NOT EXISTS request_audit(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES buyers(id),request_id TEXT NOT NULL REFERENCES requests(id),at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL CHECK(json_valid(detail)));
 CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES requests(id),buyer_id TEXT NOT NULL REFERENCES buyers(id),seller_id TEXT NOT NULL,offer_id TEXT NOT NULL REFERENCES offers(id),revision TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,proposal TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(request_id,revision,offer_id));
 CREATE TABLE IF NOT EXISTS workflow_events(id TEXT PRIMARY KEY,handoff_id TEXT NOT NULL REFERENCES handoffs(id),actor TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,text TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS seller_drafts(id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
 CREATE TABLE IF NOT EXISTS commitments(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES buyers(id),offer_id TEXT NOT NULL REFERENCES offers(id),position INTEGER NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('committed','waitlisted','paid','cancelled','refunded')),total_cents INTEGER NOT NULL CHECK(total_cents>=0),terms_version TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
 CREATE TABLE IF NOT EXISTS payments(commitment_id TEXT PRIMARY KEY REFERENCES commitments(id) ON DELETE CASCADE,order_id TEXT UNIQUE,capture_id TEXT UNIQUE,payload TEXT NOT NULL CHECK(json_valid(payload)));
 CREATE TABLE IF NOT EXISTS events(position INTEGER PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
 CREATE INDEX IF NOT EXISTS requests_buyer_status ON requests(buyer_id,status);
 CREATE INDEX IF NOT EXISTS commitments_offer_status ON commitments(offer_id,status);
 CREATE INDEX IF NOT EXISTS commitments_buyer ON commitments(buyer_id);`);
 function transaction(action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function handoffRow(row){if(!row)return null;return {id:row.id,requestId:row.request_id,buyerId:row.buyer_id,sellerId:row.seller_id,offerId:row.offer_id,revision:row.revision,status:row.status,snapshot:JSON.parse(row.snapshot),proposal:row.proposal?JSON.parse(row.proposal):null,createdAt:row.created_at,updatedAt:row.updated_at};}
 function workflowEvent(id,actor,action,text){db.prepare('INSERT INTO workflow_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),id,actor,action,new Date().toISOString(),text);}
 function currentHandoff(h){const req=db.prepare('SELECT * FROM requests WHERE id=?').get(h.requestId);const offer=db.prepare('SELECT payload FROM offers WHERE id=?').get(h.offerId);if(!req||req.status==='joined'||JSON.parse(req.brief)._revision!==h.revision||!JSON.parse(req.brief)._confirmed||!offer||JSON.stringify(offerSnapshot(JSON.parse(offer.payload)))!==JSON.stringify(offerSnapshot(h.snapshot)))throw Error('Request or offer changed. Ask for a fresh seller review.');return req;}
 function writeState(state){
  if(!Array.isArray(state.members)||!Array.isArray(state.events))throw Error('Invalid stored state');
  db.exec('DELETE FROM commitments; DELETE FROM events;');
  const insert=db.prepare('INSERT INTO commitments VALUES(?,?,?,?,?,?,?,?)');
  const payment=db.prepare('INSERT INTO payments VALUES(?,?,?,?)');
  state.members.forEach((member,index)=>{
   const {paypal,buyerId,...payload}=member;
   insert.run(member.id,buyerId||'demo-buyer',member.offerId,index,member.status,Math.round(member.total*100),member.termsVersion,JSON.stringify(payload));
   if(paypal)payment.run(member.id,paypal.orderId||null,paypal.captureId||null,JSON.stringify(paypal));
  });
  const event=db.prepare('INSERT INTO events VALUES(?,?,?,?)');
  state.events.forEach((item,index)=>event.run(index,item.at,item.action,JSON.stringify(item)));
 }
 try{
  if(!db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()){
   let legacy={members:[],events:[]},source;
   if(legacyPath){try{source=readFileSync(legacyPath,'utf8');legacy=JSON.parse(source);}catch(e){if(e.code!=='ENOENT')throw Error('Cannot import legacy state: '+e.message);}}
   if(!Array.isArray(legacy.members)||!Array.isArray(legacy.events))throw Error('Legacy state must contain members and events arrays');
   if(source&&path!==':memory:'){
    const backup=path+'.legacy.json';try{writeFileSync(backup,source,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
   }
   transaction(()=>{
    db.prepare('INSERT INTO buyers VALUES(?,?)').run('demo-buyer','Demo buyer');
    const seed=db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?)');
    catalog.forEach(o=>seed.run(o.id,o.seller,o.name,Math.round(o.price*100),o.termsVersion,JSON.stringify(o)));
    writeState(legacy);
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('schema_version','1');
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('initialized',new Date().toISOString());
   });
  }
  transaction(()=>{for(const row of db.prepare('SELECT id,payload FROM offers').all()){const offer=JSON.parse(row.payload);const deadline=catalog.find(o=>o.id===row.id)?.closesAt;if(!offer.closesAt&&deadline)db.prepare('UPDATE offers SET payload=? WHERE id=?').run(JSON.stringify({...offer,closesAt:deadline}),row.id);}});
  transaction(()=>{for(const row of db.prepare("SELECT id FROM handoffs WHERE status='pending'").all())workflowEvent(row.id,'Coordinator · automated rule','review_interrupted','Server restarted during seller review. Buyer can retry.');db.prepare("UPDATE handoffs SET status='failed',updated_at=? WHERE status='pending'").run(new Date().toISOString());});
  transaction(()=>{const seed=db.prepare('INSERT OR IGNORE INTO buyers VALUES(?,?)');for(const [id,name] of [['buyer-alex','Alex'],['buyer-jordan','Jordan'],['buyer-sam','Sam'],['buyer-mia','Mia'],['buyer-noah','Noah'],['buyer-priya','Priya']])seed.run(id,name);});
 }catch(e){db.close();throw e;}
 return {
  loadState(){
   const members=db.prepare('SELECT c.*,p.payload AS payment FROM commitments c LEFT JOIN payments p ON p.commitment_id=c.id ORDER BY c.position').all().map(row=>({...JSON.parse(row.payload),id:row.id,offerId:row.offer_id,status:row.status,total:row.total_cents/100,termsVersion:row.terms_version,...(row.buyer_id!=='demo-buyer'?{buyerId:row.buyer_id}:{}),...(row.payment?{paypal:JSON.parse(row.payment)}:{})}));
   const events=db.prepare('SELECT payload FROM events ORDER BY position').all().map(row=>JSON.parse(row.payload));return {members,events};
  },
  hasSetup(key){return !!db.prepare('SELECT value FROM metadata WHERE key=?').get(key);},
  addDemoOffers(batchKey,items){return transaction(()=>{if(db.prepare('SELECT value FROM metadata WHERE key=?').get(batchKey))return false;for(const o of items)db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?)').run(o.id,o.seller,o.name,Math.round(o.price*100),o.termsVersion,JSON.stringify(o));db.prepare('INSERT INTO metadata VALUES(?,?)').run(batchKey,new Date().toISOString());return true;});},
  getCommerce(){const row=db.prepare("SELECT value FROM metadata WHERE key='commerce'").get();return row?JSON.parse(row.value):{policies:[],demands:[]};},
  saveCommerce(data,offer=null,{state:nextState,joined=[],setupKey=null}={}){return transaction(()=>{if(setupKey&&db.prepare('SELECT value FROM metadata WHERE key=?').get(setupKey))return false;if(offer)db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?)').run(offer.id,offer.seller,offer.name,Math.round(offer.price*100),offer.termsVersion,JSON.stringify(offer));if(nextState)writeState(nextState);for(const item of joined){const saved=this.getRequest(item.requestId,item.buyerId);if(saved.status==='joined'||!saved.brief._confirmed||saved.brief._revision!==item.revision)throw Error('Buyer request changed before automatic joining.');db.prepare("UPDATE requests SET status='joined' WHERE id=? AND buyer_id=?").run(item.requestId,item.buyerId);db.prepare('INSERT INTO request_audit VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),item.buyerId,item.requestId,new Date().toISOString(),'Buyer agent · authorized action','auto_joined',JSON.stringify({summary:'Joined one matching deal under explicit authorization. Payment remains manual.'}));}db.prepare("INSERT INTO metadata VALUES('commerce',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(data));if(setupKey)db.prepare('INSERT INTO metadata VALUES(?,?)').run(setupKey,new Date().toISOString());return true;});},
  loadOffers(){return db.prepare('SELECT payload FROM offers ORDER BY rowid').all().map(row=>JSON.parse(row.payload));},
  saveState(state,{requestId,buyerId}={}){transaction(()=>{writeState(state);if(requestId){const result=db.prepare("UPDATE requests SET status='joined' WHERE id=? AND buyer_id=?").run(requestId,buyerId);if(!result.changes)throw Error('Saved request not found for this buyer');const joined=state.members.find(m=>m.requestId===requestId&&(m.buyerId||'demo-buyer')===buyerId);if(joined){const approved=db.prepare("SELECT id FROM handoffs WHERE request_id=? AND offer_id=? AND status='approved'").get(requestId,joined.offerId);if(approved){db.prepare("UPDATE handoffs SET status='used',updated_at=? WHERE id=?").run(new Date().toISOString(),approved.id);workflowEvent(approved.id,'Coordinator · automated rule','buyer_joined','Buyer accepted the agreement. Commitment recorded; checkout still requires separate approval.');}db.prepare("UPDATE handoffs SET status='stale',updated_at=? WHERE request_id=? AND status IN ('pending','awaiting_approval','approved')").run(new Date().toISOString(),requestId);}}});},
  buyers(){return db.prepare('SELECT id,name FROM buyers ORDER BY rowid').all();},
  listRequests(buyerId){return db.prepare('SELECT id,created_at,status,brief FROM requests WHERE buyer_id=? ORDER BY rowid DESC').all(buyerId).map(r=>({id:r.id,createdAt:r.created_at,status:r.status,brief:JSON.parse(r.brief)}));},
  getRequest(id,buyerId){const row=db.prepare('SELECT * FROM requests WHERE id=? AND buyer_id=?').get(id,buyerId);if(!row)throw Error('Saved request not found for this buyer');return {id:row.id,createdAt:row.created_at,status:row.status,brief:JSON.parse(row.brief),conversation:JSON.parse(row.conversation)};},
  saveRequest({id,buyerId='demo-buyer',brief,messages,reply,expectedTurns}){
   return transaction(()=>{
    brief={...brief,_confirmed:false,_revision:crypto.randomUUID()};
    if(id)db.prepare("UPDATE handoffs SET status='stale',updated_at=? WHERE request_id=? AND status IN ('pending','awaiting_approval','approved')").run(new Date().toISOString(),id);
    const status=!brief.supported?'unsupported':brief.budget===null?'clarifying':'open';
    const conversation=JSON.stringify([...messages,{role:'assistant',content:reply}]);
    if(id){const existing=this.getRequest(id,buyerId);if(expectedTurns!==undefined&&existing.conversation.length!==expectedTurns)throw Error('This request changed in another window. Resume it before replying.');if(existing.status==='joined')throw Error('This request has an accepted offer. Start a new search to change requirements.');db.prepare('UPDATE requests SET status=?,brief=?,conversation=? WHERE id=? AND buyer_id=?').run(status,JSON.stringify(brief),conversation,id,buyerId);}
    else{id=crypto.randomUUID();db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(id,buyerId,new Date().toISOString(),status,JSON.stringify(brief),conversation);}
    db.prepare('INSERT INTO request_audit VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),buyerId,id,new Date().toISOString(),'Buyer assistant · OpenAI','requirements_interpreted',JSON.stringify({summary:brief.summary}));
    return id;
   });
  },
  confirmRequest(id,buyerId,revision,requirements){return transaction(()=>{const saved=this.getRequest(id,buyerId);if(saved.status==='joined')throw Error('Start a new search to change an accepted request');if(saved.brief._revision!==revision)throw Error('Requirements changed. Resume this request and review again.');db.prepare("UPDATE handoffs SET status='stale',updated_at=? WHERE request_id=? AND status IN ('pending','awaiting_approval','approved')").run(new Date().toISOString(),id);const brief={...saved.brief,...requirements,_confirmed:true,_revision:crypto.randomUUID()};brief.summary='Laptop under $'+brief.budget+(brief.ram?', at least '+brief.ram+' GB RAM':'')+(brief.ssd?', '+brief.ssd+' GB storage':'')+(brief.brand?', brand '+brief.brand:'')+(brief.location?', delivery to '+brief.location:'')+(brief.deliveryDays?' within '+brief.deliveryDays+' days':'')+(brief.waitingDays?'; group wait up to '+brief.waitingDays+' days':'')+'.';db.prepare("UPDATE requests SET brief=?,status='open' WHERE id=? AND buyer_id=?").run(JSON.stringify(brief),id,buyerId);db.prepare('INSERT INTO request_audit VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),buyerId,id,new Date().toISOString(),'Buyer','requirements_confirmed',JSON.stringify({summary:brief.summary}));return this.getRequest(id,buyerId);});},
  requestAudit(buyerId){return db.prepare('SELECT * FROM request_audit WHERE buyer_id=? ORDER BY rowid DESC LIMIT 100').all(buyerId).map(r=>({id:r.id,requestId:r.request_id,at:r.at,actor:r.actor,action:r.action,summary:JSON.parse(r.detail).summary}));},
  handoffsForBuyer(buyerId){return db.prepare('SELECT * FROM handoffs WHERE buyer_id=? ORDER BY rowid DESC').all(buyerId).map(handoffRow);},
  handoffsForSeller(sellerId){return db.prepare('SELECT * FROM handoffs WHERE seller_id=? ORDER BY rowid DESC').all(sellerId).map(handoffRow);},
  workflowForBuyer(buyerId){return db.prepare('SELECT e.* FROM workflow_events e JOIN handoffs h ON h.id=e.handoff_id WHERE h.buyer_id=? ORDER BY e.rowid DESC').all(buyerId).map(r=>({id:r.id,handoffId:r.handoff_id,actor:r.actor,action:r.action,at:r.at,text:r.text}));},
  workflowForSeller(sellerId){return db.prepare('SELECT e.* FROM workflow_events e JOIN handoffs h ON h.id=e.handoff_id WHERE h.seller_id=? ORDER BY e.rowid DESC').all(sellerId).map(r=>({id:r.id,handoffId:r.handoff_id,actor:r.actor,action:r.action,at:r.at,text:r.text}));},
  approvedHandoff(requestId,buyerId,offerId,revision){const h=this.handoffsForBuyer(buyerId).find(h=>h.requestId===requestId&&h.offerId===offerId&&h.revision===revision&&h.status==='approved');if(!h)throw Error('Request seller review and wait for seller approval before joining.');currentHandoff(h);return h;},
  getHandoff(id){const h=handoffRow(db.prepare('SELECT * FROM handoffs WHERE id=?').get(id));if(!h)throw Error('Seller review not found');return h;},
  startHandoff({requestId,buyerId,sellerId,offer,revision}){return transaction(()=>{const req=this.getRequest(requestId,buyerId);if(req.status==='joined'||!req.brief._confirmed||req.brief._revision!==revision)throw Error('Confirm the latest requirements before requesting seller review.');let existing=handoffRow(db.prepare('SELECT * FROM handoffs WHERE request_id=? AND revision=? AND offer_id=?').get(requestId,revision,offer.id));if(existing){if(existing.status==='failed'){db.prepare("UPDATE handoffs SET status='pending',updated_at=? WHERE id=?").run(new Date().toISOString(),existing.id);workflowEvent(existing.id,'Coordinator · automated rule','review_retried','Retrying seller agent review.');return {handoff:this.getHandoff(existing.id),run:true};}return {handoff:existing,run:false};}const id=crypto.randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO handoffs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,requestId,buyerId,sellerId,offer.id,revision,'pending',JSON.stringify({...offerSnapshot(offer),requirements:Object.fromEntries(['budget','ram','ssd','brand','preferences','summary','location','deliveryDays','waitingDays'].map(k=>[k,req.brief[k]??null]))}),null,at,at);workflowEvent(id,'Buyer','seller_review_requested','Requested seller review for '+offer.name+'.');workflowEvent(id,'Coordinator · automated rule','seller_handoff','Validated the confirmed request and routed it to the seller agent.');return {handoff:this.getHandoff(id),run:true};});},
  completeHandoff(id,proposal){return transaction(()=>{const h=this.getHandoff(id);if(h.status!=='pending')throw Error('This seller review is no longer pending.');currentHandoff(h);const clean=validateSellerProposal(proposal,h.snapshot);db.prepare("UPDATE handoffs SET status='awaiting_approval',proposal=?,updated_at=? WHERE id=?").run(JSON.stringify(clean),new Date().toISOString(),id);workflowEvent(id,'Seller agent · OpenAI','seller_proposed',clean.reason);workflowEvent(id,'Coordinator · automated rule','proposal_validated','Checked product identity and fixed catalog terms. Waiting for seller approval.');return this.getHandoff(id);});},
  failHandoff(id,message){return transaction(()=>{const h=this.getHandoff(id);if(h.status!=='pending')return h;db.prepare("UPDATE handoffs SET status='failed',updated_at=? WHERE id=?").run(new Date().toISOString(),id);workflowEvent(id,'Coordinator · automated rule','review_failed',message);return this.getHandoff(id);});},
  decideHandoff(id,sellerId,decision){return transaction(()=>{const h=this.getHandoff(id);if(h.sellerId!==sellerId)throw Error('Seller review not found for this seller');if(!['approve','decline'].includes(decision))throw Error('Choose approve or decline');if(h.status==='approved'&&decision==='approve'||h.status==='declined'&&decision==='decline'){currentHandoff(h);return h;}if(h.status!=='awaiting_approval')throw Error('This proposal is no longer awaiting approval.');currentHandoff(h);if(decision==='approve'&&h.proposal.decision!=='offer')throw Error('Seller agent declined this match. Request a new review instead.');if(decision==='approve')validateSellerProposal(h.proposal,h.snapshot);const status=decision==='approve'?'approved':'declined';db.prepare('UPDATE handoffs SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),id);workflowEvent(id,'Seller',decision==='approve'?'seller_approved':'seller_declined',decision==='approve'?'Approved this catalog offer for buyer review. No stock reserved or payment made.':'Declined this proposal. No commitment or payment created.');if(decision==='approve')workflowEvent(id,'Coordinator · automated rule','buyer_handoff','Revalidated catalog terms and returned the approved offer to the buyer. Joining still requires buyer consent.');return this.getHandoff(id);});},
  sellerDrafts(sellerId){return db.prepare('SELECT id,created_at,payload FROM seller_drafts WHERE seller_id=? ORDER BY rowid DESC').all(sellerId).map(r=>({id:r.id,createdAt:r.created_at,...JSON.parse(r.payload)}));},
  saveSellerDraft(sellerId,draft){const id=crypto.randomUUID();db.prepare('INSERT INTO seller_drafts VALUES(?,?,?,?)').run(id,sellerId,new Date().toISOString(),JSON.stringify(draft));return id;},
  counts(){return Object.fromEntries(['buyers','requests','offers','commitments','payments','events'].map(table=>[table,db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count]));},
  integrity(){return db.prepare('PRAGMA integrity_check').get().integrity_check;},
  close(){db.close();}
 };
}
