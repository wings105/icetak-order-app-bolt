// Signed double-submit token. Browser cookie + hidden field bind the exact OAuth request.
const encoder=new TextEncoder();
export const CONSENT_COOKIE='__Host-icetak-mcp-consent';
const fields=['client_id','redirect_uri','code_challenge','code_challenge_method','response_type','state','scope','resource'];
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret:string){if(!secret)throw Error('CONSENT_KEY_MISSING');return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function requestHash(q:URLSearchParams){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(fields.map(k=>[k,q.get(k)||'']))))));}
export async function createConsent(q:URLSearchParams,secret:string,now=Date.now()){
 const value=b64(encoder.encode(JSON.stringify({v:1,expires:now+600000,nonce:crypto.randomUUID(),request:await requestHash(q)})));
 const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('icetak-mcp-consent-v1.'+value));
 return value+'.'+b64(new Uint8Array(signature));
}
export function consentCookieName(token:string){
 const value=JSON.parse(new TextDecoder().decode(unb64(token.split('.')[0])));
 if(typeof value.nonce!=='string'||!/^[-a-f0-9]{36}$/i.test(value.nonce))throw Error('INVALID_CONSENT_NONCE');
 return CONSENT_COOKIE+'-'+value.nonce.replace(/-/g,'');
}
export const CONSENT_REVISION='popup-cookie-1';
export async function checkConsent(q:URLSearchParams,cookieHeader:string,secret:string,now=Date.now()):Promise<{ok:true}|{ok:false;reason:string}>{
 try{
  const token=q.get('_csrf')||'';
  if(!token)return {ok:false,reason:'form_missing'};
  if(token.length>2000)return {ok:false,reason:'form_invalid'};
  const pieces=token.split('.');if(pieces.length!==2)return {ok:false,reason:'form_invalid'};
  if(!await crypto.subtle.verify('HMAC',await key(secret),unb64(pieces[1]),encoder.encode('icetak-mcp-consent-v1.'+pieces[0])))return {ok:false,reason:'signature_invalid'};
  const value=JSON.parse(new TextDecoder().decode(unb64(pieces[0])));
  if(value.v!==1||!Number.isFinite(value.expires)||value.expires<=now||value.expires>now+600000)return {ok:false,reason:'expired'};
  if(value.request!==await requestHash(q))return {ok:false,reason:'request_changed'};
  const name=consentCookieName(token),cookie=cookieHeader.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
  if(!cookie)return {ok:false,reason:'cookie_missing'};
  if(token!==cookie)return {ok:false,reason:'cookie_mismatch'};
  return {ok:true};
 }catch{return {ok:false,reason:'form_invalid'};}
}
export async function validConsent(q:URLSearchParams,cookieHeader:string,secret:string,now=Date.now()){
 return (await checkConsent(q,cookieHeader,secret,now)).ok;
}
// Opaque-origin OAuth popups send the form as cross-site POST. The signed
// per-form double-submit binding remains mandatory; SameSite is not our CSRF proof.
export const consentCookie=(token:string,clear=false)=>`${consentCookieName(token)}=${clear?'':token}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${clear?0:600}`;
