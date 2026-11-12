const base = 'https://api-m.sandbox.paypal.com';
export function createPayPalClient({clientId,secret,environment='sandbox',request=fetch}) {
 if(environment!=='sandbox')throw Error('This prototype supports PayPal sandbox only');
 let token,expires=0;
 async function authenticate(){
  if(!clientId||!secret)throw Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env');
  if(token&&expires>Date.now())return token;
  const r=await request(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(clientId+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('PayPal sandbox authentication failed (HTTP '+r.status+'). Check your sandbox app credentials.');
  const data=await r.json();if(!data.access_token)throw Error('PayPal did not return an access token');token=data.access_token;expires=Date.now()+Math.max(0,data.expires_in-60)*1000;return token;
 }
 async function call(path,{method='GET',body,key}={}){
  const access=await authenticate();
  let r;try{r=await request(base+path,{method,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Prefer:'return=representation',...(key?{'PayPal-Request-Id':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Error('PayPal connection interrupted. Retry to reconcile the same order.');}
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{};}catch{throw Error('PayPal returned an unreadable response. Retry to reconcile.');}if(!r.ok)throw Error('PayPal request failed (HTTP '+r.status+'): '+(data.details?.[0]?.issue||data.name||'unknown error'));
  return data;
 }
 return {authenticate,track:(id,body)=>call('/v2/checkout/orders/'+encodeURIComponent(id)+'/track',{method:'POST',body}),create:(body,key)=>call('/v2/checkout/orders',{method:'POST',body,key}),get:id=>call('/v2/checkout/orders/'+encodeURIComponent(id)),capture:(id,key)=>call('/v2/checkout/orders/'+encodeURIComponent(id)+'/capture',{method:'POST',body:{},key})};
}
