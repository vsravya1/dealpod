import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import net from 'node:net';
import {laptopCatalog,laptopCommerce,LAPTOP_SETUP_KEY} from '../laptop-catalog.mjs';
import {resetDemoData} from '../reset-demo.mjs';
try{process.loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
function listening(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});}
for(const port of new Set([3000,3001,Number(process.env.PORT||3001)]))if(await listening(port))throw Error('Stop the app with Ctrl+C before resetting demo data (port '+port+' is active).');
const path=resolve('data/rehearsal.sqlite');if(!existsSync(path))throw Error('No rehearsal database found. Run npm run demo first.');
const backupPath=resolve('data/rehearsal-before-reset-'+new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomUUID().slice(0,8)+'.sqlite');
const now=Date.now();
const replacement=process.argv.includes('--new-catalog')
 ? {offers:laptopCatalog(now),commerce:laptopCommerce(),setupKey:LAPTOP_SETUP_KEY}
 : undefined;
const db=new DatabaseSync(path);try{resetDemoData(db,backupPath,now,replacement);console.log(replacement?'Rehearsal activity cleared and generic laptop catalog installed.':'Rehearsal activity cleared. Deals, profiles, inventory rules and credentials retained.');console.log('Backup: '+backupPath);console.log('PayPal sandbox transactions were not changed. Start with npm run demo.');}finally{db.close();}
