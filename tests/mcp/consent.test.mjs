import {test} from 'node:test';import assert from 'node:assert/strict';
import {createConsent,validConsent,consentCookie,consentCookieName,checkConsent} from '../../supabase/functions/icetak-mcp/consent.ts';
const params=()=>new URLSearchParams({client_id:'client',redirect_uri:'https://chatgpt.com/connector/oauth/qa',code_challenge:'a'.repeat(43),code_challenge_method:'S256',response_type:'code',state:'bound-state',scope:'briefs:read',resource:'https://icetak-mcp.msg-ebye.workers.dev/mcp'});
test('signed consent binds hidden field, browser cookie, server key, request and expiry',async()=>{
 const q=params(),now=1700000000000,token=await createConsent(q,'fixture-key',now);q.set('_csrf',token);const cookie=consentCookie(token).split(';')[0];
 assert.equal(await validConsent(q,cookie,'fixture-key',now+100),true);
 assert.equal(await validConsent(q,'','fixture-key',now+100),false);
 assert.equal(await validConsent(q,cookie,'wrong-key',now+100),false);
 assert.equal(await validConsent(q,cookie,'fixture-key',now+600001),false);
 q.set('state','changed');assert.equal(await validConsent(q,cookie,'fixture-key',now+100),false);q.set('state','bound-state');
 q.set('_csrf',token+'x');assert.equal(await validConsent(q,consentCookieName(token)+'='+token+'x','fixture-key',now+100),false);
 assert.match(consentCookie(token),/Secure; HttpOnly; SameSite=None/);assert.match(consentCookie(token,true),/Max-Age=0/);
});

test('parallel forms keep independent cookies and clear only the submitted form',async()=>{
 const a=params(),b=params(),now=1700000000000;b.set('state','another-attempt');
 const ta=await createConsent(a,'fixture-key',now),tb=await createConsent(b,'fixture-key',now);a.set('_csrf',ta);b.set('_csrf',tb);
 assert.notEqual(consentCookieName(ta),consentCookieName(tb));
 const jar=consentCookie(ta).split(';')[0]+'; '+consentCookie(tb).split(';')[0];
 assert.equal(await validConsent(a,jar,'fixture-key',now+100),true);
 assert.equal(await validConsent(b,jar,'fixture-key',now+100),true);
 assert.equal(await validConsent(a,consentCookie(tb).split(';')[0],'fixture-key',now+100),false);
 assert.ok(consentCookie(ta,true).startsWith(consentCookieName(ta)+'='));
});


test('consent diagnostics distinguish browser loss from expired or changed requests without disclosing tokens',async()=>{
 const q=params(),now=1700000000000;
 assert.deepEqual(await checkConsent(q,'','fixture-key',now),{ok:false,reason:'form_missing'});
 const token=await createConsent(q,'fixture-key',now);q.set('_csrf',token);const cookie=consentCookie(token).split(';')[0];
 assert.deepEqual(await checkConsent(q,'','fixture-key',now+1),{ok:false,reason:'cookie_missing'});
 assert.deepEqual(await checkConsent(q,consentCookieName(token)+'=other','fixture-key',now+1),{ok:false,reason:'cookie_mismatch'});
 assert.deepEqual(await checkConsent(q,cookie,'wrong-key',now+1),{ok:false,reason:'signature_invalid'});
 assert.deepEqual(await checkConsent(q,cookie,'fixture-key',now+600001),{ok:false,reason:'expired'});
 q.set('resource','https://other.example/mcp');assert.deepEqual(await checkConsent(q,cookie,'fixture-key',now+1),{ok:false,reason:'request_changed'});
});
