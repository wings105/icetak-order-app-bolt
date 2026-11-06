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
export async function validConsent(q:URLSearchParams,cookieHeader:string,secret:string,now=Date.now()){
 try{
  const token=q.get('_csrf')||'',cookie=cookieHeader.split(';').map(x=>x.trim()).find(x=>x.startsWith(CONSENT_COOKIE+'='))?.slice(CONSENT_COOKIE.length+1)||'';
  if(!token||token.length>2000||token!==cookie)return false;
  const pieces=token.split('.');if(pieces.length!==2)return false;
  if(!await crypto.subtle.verify('HMAC',await key(secret),unb64(pieces[1]),encoder.encode('icetak-mcp-consent-v1.'+pieces[0])))return false;
  const value=JSON.parse(new TextDecoder().decode(unb64(pieces[0])));
  return value.v===1&&Number.isFinite(value.expires)&&value.expires>now&&value.expires<=now+600000&&value.request===await requestHash(q);
 }catch{return false;}
}
export const consentCookie=(token:string)=>`${CONSENT_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${token?600:0}`;
