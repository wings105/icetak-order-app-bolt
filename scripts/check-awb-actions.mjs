import './check-awb-native.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
// Exercise the actual Settings Edge handler with controlled Auth/REST responses.
let handler,role='owner',authenticated=true,saved=[],store='';
globalThis.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://controlled.test':name==='SUPABASE_SERVICE_ROLE_KEY'?'test-service-key':''},serve:fn=>{handler=fn}};
const source=readFileSync(new URL('../supabase/functions/webhook-forward-settings/index.ts',import.meta.url),'utf8').replace(/import "jsr:[^\n]+\n/,'').replace('../_shared/awb-action-url.ts',pathToFileURL(new URL('../supabase/functions/_shared/awb-action-url.ts',import.meta.url).pathname).href);
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(target,options={})=>{
 const path=new URL(target).pathname;
 if(path==='/auth/v1/user')return Response.json(authenticated?{id:'test-admin-id'}:{},{status:authenticated?200:401});
 if(path.endsWith('/admin_users'))return Response.json([{username:'tester',role}]);
 if(path.endsWith('/admin_permissions'))return Response.json([{permissions:[]}]);
 if(path.endsWith('/private_runtime_settings')){if(options.method==='POST'){const body=JSON.parse(options.body);saved.push(body);store=body.setting_value;return new Response(null,{status:201})}return Response.json([{setting_value:store}])}
 throw Error(`Unexpected request ${path}`);
};
await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const adminRequest=(body,auth=true)=>new Request('https://controlled.test/settings',{method:'POST',headers:auth?{authorization:'Bearer test-owner'}:{},body:JSON.stringify({kind:'awb_preview',...body})});
assert.equal((await handler(adminRequest({action:'get'},false))).status,401);
role='staff';assert.equal((await handler(adminRequest({action:'save',url:'https://hook.make.com/a'}))).status,403);assert.equal(saved.length,0);
role='owner';assert.equal((await handler(adminRequest({action:'get'}))).status,200);
assert.equal((await handler(adminRequest({action:'save',url:'https://localhost'}))).status,400);assert.equal(saved.length,0);
assert.equal((await handler(adminRequest({action:'save',url:'https://hook.make.com/a'}))).status,200);assert.equal(saved[0].setting_key,'awb_preview_action_webhook_url');assert.equal((await (await handler(adminRequest({action:'get'}))).json()).url,'https://hook.make.com/a');
assert.equal((await handler(adminRequest({action:'save',url:''}))).status,200);assert.equal(store,'');
globalThis.fetch=originalFetch;delete globalThis.Deno;
console.log('Native AWB actions and legacy Settings authorization: PASS');
