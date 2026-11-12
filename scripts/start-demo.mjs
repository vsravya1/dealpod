// A separate, persistent rehearsal database. Restarting never clears a payment.
import {resolve} from 'node:path';
try{process.loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
process.env.GROUPOFFERS_DEMO_SETUP='two-path-v1';
if(process.argv.includes('--new-deals'))process.env.DEALPOD_PRACTICE_BATCH='practice-'+crypto.randomUUID();
process.env.PORT=process.env.PORT||'3001';
process.env.GROUPOFFERS_DB_PATH=resolve('data/rehearsal.sqlite');
process.env.GROUPOFFERS_LEGACY_PATH=resolve('data/rehearsal-no-import.json');
console.log('Rehearsal workspace · Separate database · Existing application records retained');
console.log('Restart with npm run demo to resume this rehearsal.');
await import('../server.mjs');
