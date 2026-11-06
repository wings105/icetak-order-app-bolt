import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const tmp=new URL('../supabase/functions/clickup-designflow-sync/.sync-test.ts',import.meta.url);
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'})[k]},serve:()=>{}};
await writeFile(tmp,(await readFile(new URL('../supabase/functions/clickup-designflow-sync/index.ts',import.meta.url),'utf8')).replace("import 'jsr:@supabase/functions-js/edge-runtime.d.ts';",''));let sync,selected;try{({sync,selected}=await import(tmp.href));}finally{await unlink(tmp);}
assert.equal(selected(undefined,{id:'x'}),false);assert.equal(selected({value:0},{id:'x',orderindex:0}),true);
for(const [field_id,option_id,option_name,field_name] of [
 ['01cec4ef-a30b-443d-a43a-9ab09835b78c','49c8b202-d985-4fa2-aae6-658ccca96433','Render ai','Review customer'],
 ['4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110','093279a0-80a5-49ea-bec8-a25981a87937','Ai QC pass','designflow'],
 ['4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110','60798603-fc52-43d3-91dd-b7e2e5396636','Ai QC hold','designflow'],
 ['4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110','1f772f47-060b-49f4-9241-f2b1f7fa7471','Ai QC fail','designflow'],
 ['4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110','9cccc7fb-0057-4c10-abd8-be6a416da06b','Ai QC retry','designflow']]){
 for(const mode of ['write','already_set','stale','renamed','unknown_post','wrong_readback','closed']){
  let posts=0,value=mode==='already_set'?7:null,ack;
  globalThis.fetch=async(url,opt={})=>{url=String(url);if(url.includes('icetak_designflow_sync')){const b=JSON.parse(opt.body);if(b.p_action==='check')return Response.json({valid:mode!=='stale'});ack=b.p_data;return Response.json({saved:true});}
   if(url.endsWith('/field'))return Response.json({fields:[{id:field_id,name:field_name,type:'drop_down',type_config:{options:[{id:option_id,name:mode==='renamed'?'Different':option_name,orderindex:7}]}}]});
   if(url.includes('/field/')){posts++;assert.equal(opt.method,'POST');assert.equal(JSON.parse(opt.body).value,option_id);value=option_id;if(mode==='unknown_post')throw Error('network');return Response.json({});}
   return Response.json({id:'test',list:{id:'18375902'},status:{status:mode==='closed'?'complete':'design editing -topper'},attachments:[{id:'asset'}],custom_fields:[{id:field_id,value:mode==='wrong_readback'?null:value}]});
  };
  await sync({task_id:'test',field_id,option_id,option_name,revision:1,lease:'lease',source:{attachment_id:'asset'}},'token');
  assert.equal(ack.ok,['write','already_set'].includes(mode));assert.equal(posts,['write','unknown_post','wrong_readback'].includes(mode)?1:0);
 }
}
console.log('PASS: all five options, UUID/ordinal readback, no duplicate write, superseded source, changed definitions, unknown POST and closed task guards');
