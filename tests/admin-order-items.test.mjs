import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminOrderItemsHandler} from '../supabase/functions/admin-order-items/handler.ts';
const order='11111111-1111-4111-8111-111111111111',keep='22222222-2222-4222-8222-222222222222',remove='33333333-3333-4333-8333-333333333333';
const component='44444444-4444-4444-8444-444444444444';
function fixture(options={}){
 const calls=[];let archived=Boolean(options.alreadyArchived),deleted=false;
 const reply=(value,status=200)=>Response.json(value,{status});
 const fetcher=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):undefined,method=init.method||'GET';calls.push({url,method,body,headers:init.headers});
  if(url.endsWith('/auth/v1/user'))return reply({id:'55555555-5555-4555-8555-555555555555'});
  const path=url.split('/rest/v1/')[1];
  if(path==='rpc/icetak_admin_has_permission')return reply(!options.forbidden);
  if(path?.startsWith('admin_users?'))return reply([{username:'admin1'}]);
  if(path?.startsWith('orders?'))return reply([{id:order,total:deleted?94:100,...(options.locked?{pickup_ready_at:'2026-10-25T00:00:00Z'}:{})}]);
  if(path?.startsWith('order_items?'))return reply(deleted?[]:path.includes('&id=in.')?[{id:remove}]:options.lastItem?[{id:remove}]:[{id:keep},{id:remove}]);
  if(path?.startsWith('production_components?order_id='))return reply([{id:component,order_item_id:remove,clickup_task_id:'task123'}]);
  if(path?.startsWith('clickup_tasks?'))return reply([{id:component,order_item_id:remove,component_id:component,clickup_task_id:'task123'}]);
  if(path?.startsWith('production_components?clickup_task_id='))return reply([{id:component,order_id:order,order_item_id:options.shared?keep:remove,clickup_task_id:'task123'}]);
  if(path?.startsWith('private_runtime_settings?'))return reply(options.noConnection?[]:[{setting_value:'test-provider-key'}]);
  if(url.includes('api.clickup.com/')){
   if(options.providerMissing)return reply({err:'missing'},404);
   if(method==='PUT')archived=options.archiveNotApplied?false:body.archived;
   return reply({id:'task123',archived,list:{id:'18375902'}});
  }
  if(path==='rpc/icetak_admin_order_items_reconcile'){
   assert.equal(archived,true,'task must be verified archived before DB delete');
   assert.deepEqual(body.p_payload._archived_task_ids,['task123']);
   assert.equal(body.p_payload._actor,'admin1');
   assert.equal(init.headers.authorization,'Bearer service-key');
   if(options.databaseRejects)return reply({message:'Order is locked'},409);
   deleted=true;if(options.commitResponseLost)throw Error('network timeout');
   return reply({ok:true,deleted:1,total:94});
  }
  if(path==='rpc/icetak_project_clickup_work')return reply({ok:true});
  throw Error('Unhandled request '+url);
 };
 const handler=createAdminOrderItemsHandler({url:'https://fixture.supabase.co',key:'service-key',fetcher});
 const run=()=>handler(new Request('https://fixture/admin-order-items',{method:'POST',headers:{authorization:'Bearer admin-token','content-type':'application/json'},body:JSON.stringify({order_db_id:order,delete_ids:[remove],items:options.lastItem?[]:[{id:keep,qty:1,price:24}],_actor:'forged-user',_archived_task_ids:['forged-task']})}));
 return {run,handler,calls,get archived(){return archived},get deleted(){return deleted}};
}
test('archive and verify before delete; trusted actor; updated total',async()=>{const f=fixture();const r=await f.run();assert.equal(r.status,200);assert.equal((await r.json()).total,94);assert(f.deleted);assert(f.archived)});
test('unauthenticated and forbidden requests cannot reach ClickUp',async()=>{const f=fixture({forbidden:true});assert.equal((await f.run()).status,403);assert(!f.calls.some(c=>c.url.includes('api.clickup.com/')));assert.equal((await f.handler(new Request('https://fixture',{method:'POST'}))).status,401)});
for(const [label,options,status] of [['ready pickup',{locked:true},409],['last item',{lastItem:true},400],['shared task',{shared:true},409],['missing connection',{noConnection:true},409]])test(label+' stops before archive',async()=>{const f=fixture(options);assert.equal((await f.run()).status,status);assert(!f.calls.some(c=>c.url.includes('api.clickup.com/')));assert(!f.deleted)});
test('archive must be verified before DB mutation',async()=>{const f=fixture({archiveNotApplied:true});assert.equal((await f.run()).status,409);assert(!f.deleted);assert(!f.archived)});
test('database rejection restores only tasks archived by this attempt',async()=>{const f=fixture({databaseRejects:true});assert.equal((await f.run()).status,409);assert(!f.deleted);assert(!f.archived);const already=fixture({databaseRejects:true,alreadyArchived:true});assert.equal((await already.run()).status,409);assert(already.archived);assert(!already.calls.some(c=>c.method==='PUT'))});
test('response lost after DB commit is reconciled without unarchiving',async()=>{const f=fixture({commitResponseLost:true});const r=await f.run();assert.equal(r.status,200);const result=await r.json();assert.equal(result.reconciled,true);assert.equal(result.total,94);assert(f.archived);assert(f.deleted);assert(!f.calls.some(c=>c.method==='PUT'&&c.body.archived===false))});
