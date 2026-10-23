import assert from 'node:assert/strict';
import {createTaskStationHandler,stationDigest} from '../supabase/functions/task-workspace-station/handler.ts';
import {createTaskWorkspaceHandler} from '../supabase/functions/task-workspace/handler.ts';
import {createTaskClickUpHandler} from '../supabase/functions/task-clickup/handler.ts';

const token='tw_'+'a'.repeat(64),actor='task_station_1234abcd';
const state={enabled:true,active:true,role:'staff',auth_user_id:null,permissions:['view_orders','edit_order','manage_admins'],calls:[],forwarded:[]};
const config={enabled:true,actor,digest:await stationDigest(token)};
const fetcher=async(url,options={})=>{
 const u=new URL(url);state.calls.push(u.pathname);assert.equal(options.headers.authorization,'Bearer fixture-service');
 if(u.pathname.endsWith('/private_runtime_settings'))return Response.json([{setting_value:JSON.stringify({...config,enabled:state.enabled})}]);
 if(u.pathname.endsWith('/admin_users'))return Response.json(state.active?[{username:actor,role:state.role,auth_user_id:state.auth_user_id}]:[]);
 if(u.pathname.endsWith('/admin_permissions'))return Response.json([{permissions:state.permissions}]);
 if(u.pathname.endsWith('/icetak_task_workspace_read'))return Response.json({items:[],staff:[],truncated:false});
 throw Error('Unexpected route '+u.pathname);
};
const factory=options=>async req=>{state.forwarded.push({actor:options.trustedActor,headers:Object.fromEntries(req.headers),bytes:new Uint8Array(await req.arrayBuffer())});return Response.json({ok:true,can_manage:false});};
const handler=createTaskStationHandler({url:'https://fixture.supabase.co',key:'fixture-service',fetcher,workspace:factory,clickup:factory});
const call=(body={action:'list'},options={})=>handler(new Request('https://fixture/task-workspace-station',{method:'POST',headers:{authorization:'Bearer '+token,'x-task-service':'workspace','content-type':'application/json',...options.headers},body:JSON.stringify(body)}));
assert.equal((await call({},{headers:{authorization:''}})).status,401);assert.equal(state.calls.length,0);
assert.equal((await call({},{headers:{authorization:'Bearer tw_'+'b'.repeat(64)}})).status,401);assert.equal(state.forwarded.length,0);
assert.equal((await call({action:'list'},{headers:{origin:'https://evil.example'}})).status,403);
assert.equal((await handler(new Request('https://fixture',{method:'GET'}))).status,405);
assert.equal((await handler(new Request('https://fixture',{method:'OPTIONS'}))).status,200);
state.enabled=false;assert.equal((await call()).status,401);state.enabled=true;
state.active=false;assert.equal((await call()).status,403);state.active=true;
state.role='owner';assert.equal((await call()).status,403);state.role='staff';
state.auth_user_id='person';assert.equal((await call()).status,403);state.auth_user_id=null;
state.permissions=['view_orders'];assert.equal((await call()).status,403);state.permissions=['view_orders','edit_order','manage_admins'];
for(const action of ['connect','connection','delete'])assert.equal((await call({action},{headers:{'x-task-service':'clickup'}})).status,400);
assert.equal((await call({},{headers:{'x-task-service':'finance-admin'}})).status,400);
assert.equal((await call({},{headers:{'content-length':String(17*1024*1024)}})).status,413);
const result=await call({action:'save',actor:'owner',trustedActor:{username:'owner',role:'owner'}});assert.equal(result.status,200);
assert.equal(result.headers.get('access-control-allow-origin'),'https://shop.decocake.my');assert.equal(result.headers.get('cache-control'),'no-store');
assert.deepEqual(state.forwarded.at(-1).actor,{username:actor,role:'staff',permissions:['view_orders','edit_order']});
assert(!state.forwarded.at(-1).headers.authorization,'capability never reaches an underlying provider handler');
const original=new Uint8Array([137,80,78,71,13,10,26,10,42,43]);
const form=new FormData();form.set('payload',JSON.stringify({action:'direct_upload',task_id:'exact-task'}));form.set('file',new File([original],'original.png',{type:'image/png'}));
const upload=await handler(new Request('https://fixture',{method:'POST',headers:{authorization:'Bearer '+token,'x-task-service':'clickup'},body:form}));assert.equal(upload.status,200);
const forwarded=state.forwarded.at(-1),received=await new Response(forwarded.bytes,{headers:{'content-type':forwarded.headers['content-type']}}).formData();assert.deepEqual(new Uint8Array(await received.get('file').arrayBuffer()),original);assert.equal(received.get('file').name,'original.png');
const real=createTaskStationHandler({url:'https://fixture.supabase.co',key:'fixture-service',fetcher});
const list=await real(new Request('https://fixture',{method:'POST',headers:{authorization:'Bearer '+token,'x-task-service':'workspace','content-type':'application/json'},body:JSON.stringify({action:'list'})}));
assert.equal(list.status,200);const data=await list.json();assert.equal(data.actor,actor);assert.equal(data.can_edit,true);assert.equal(data.can_confirm,true);assert.deepEqual(data.items,[]);
assert(!state.calls.some(path=>path.includes('/auth/')),'station uses its scoped device identity without person login');
for(const make of [createTaskWorkspaceHandler,createTaskClickUpHandler]){
 const protectedHandler=make({url:'https://fixture.supabase.co',key:'fixture-service',fetcher});assert.equal((await protectedHandler(new Request('https://fixture',{method:'POST',body:'{}'}))).status,401,'normal admin entry still requires login');
}
state.enabled=false;assert.equal((await call()).status,401,'revocation takes effect on the next request without a warm-process cache');
console.log('PASS task station: scoped revocable capability, no person session, active non-login staff identity, server-derived actor, permission clamp, service/action/origin/size boundaries, unchanged binary multipart, existing workspace integration, original admin auth and immediate revocation.');
