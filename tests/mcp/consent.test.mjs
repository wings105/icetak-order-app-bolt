import {test} from 'node:test';import assert from 'node:assert/strict';
import {createConsent,validConsent,consentCookie,CONSENT_COOKIE} from '../../supabase/functions/icetak-mcp/consent.ts';
const params=()=>new URLSearchParams({client_id:'client',redirect_uri:'https://chatgpt.com/connector/oauth/qa',code_challenge:'a'.repeat(43),code_challenge_method:'S256',response_type:'code',state:'bound-state',scope:'briefs:read',resource:'https://icetak-mcp.msg-ebye.workers.dev/mcp'});
test('signed consent binds hidden field, browser cookie, server key, request and expiry',async()=>{
 const q=params(),now=1700000000000,token=await createConsent(q,'fixture-key',now);q.set('_csrf',token);const cookie=CONSENT_COOKIE+'='+token;
 assert.equal(await validConsent(q,cookie,'fixture-key',now+100),true);
 assert.equal(await validConsent(q,'','fixture-key',now+100),false);
 assert.equal(await validConsent(q,cookie,'wrong-key',now+100),false);
 assert.equal(await validConsent(q,cookie,'fixture-key',now+600001),false);
 q.set('state','changed');assert.equal(await validConsent(q,cookie,'fixture-key',now+100),false);q.set('state','bound-state');
 q.set('_csrf',token+'x');assert.equal(await validConsent(q,CONSENT_COOKIE+'='+token+'x','fixture-key',now+100),false);
 assert.match(consentCookie(token),/Secure; HttpOnly; SameSite=Lax/);assert.match(consentCookie(''),/Max-Age=0/);
});
