// Rehearsal-only maintenance. No PayPal API calls are made.
export function resetDemoData(db,backupPath,now=Date.now(),replacement){
 db.prepare('VACUUM INTO ?').run(backupPath);
 db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
 try{
  let commerce=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='commerce'").get()?.value||'{"policies":[],"demands":[]}');
  for(const table of ['payments','commitments','events','workflow_events','request_audit','handoffs','requests','seller_drafts'])db.exec('DELETE FROM '+table);
  if(replacement){
   db.exec('DELETE FROM offers');
   const insert=db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?)');
   for(const o of replacement.offers)insert.run(o.id,o.seller,o.name,Math.round(o.price*100),o.termsVersion,JSON.stringify(o));
   commerce=replacement.commerce;
   db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run(replacement.setupKey,new Date(now).toISOString());
  }else{
  const update=db.prepare('UPDATE offers SET payload=? WHERE id=?');
  for(const row of db.prepare('SELECT id,payload FROM offers').all()){
   const o=JSON.parse(row.payload);
   if(o.sourceDemandId){
    if(!o.resetStockReleased){const policy=commerce.policies.find(p=>p.sellerId===o.sellerId||p.sellerId===o.inventorySource||p.offerId===o.inventorySource||p.sellerId===({'Northstar Computing':'lenovo','Campus Supply Co.':'dell','Everyday Electronics':'asus'}[o.seller]));if(!policy)throw Error('Cannot safely release stock for '+o.id);policy.units+=o.capacity;o.resetStockReleased=true;}
    o.closesAt=new Date(now-1000).toISOString();
   }else if(o.demoScenario){o.closesAt=new Date(now+7*86400000).toISOString();}
   update.run(JSON.stringify(o),row.id);
  }
  }
  commerce.demands=[];
  db.prepare("INSERT INTO metadata VALUES('commerce',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(commerce));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
