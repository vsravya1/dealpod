import {createPayPalClient} from '../paypal.mjs';
try{
 process.loadEnvFile('.env');
 const client=createPayPalClient({clientId:process.env.PAYPAL_CLIENT_ID,secret:process.env.PAYPAL_CLIENT_SECRET,environment:process.env.PAYPAL_ENV||'sandbox'});
 await client.authenticate();console.log('PayPal sandbox credentials verified. No order or payment was created.');
}catch(e){console.error(e.message);process.exitCode=1;}
