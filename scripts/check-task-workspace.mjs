import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {previewItem} from '../supabase/functions/awb-preview/preview.ts';
import {workMatches,dueAt} from '../icetak-admin/src/lib/taskWorkspace.ts';
const row={task_id:'task-1',title:'2x Gold A6',source_status:'acrylic',status:'acrylic',source_updated_at:'2026-10-19T01:00:00Z',version:0,assignee:'staff',phone:'01234',sets:['set1'],order_reference:'ORDER-1',due_date:'1792511940000',ship_by_at:'2026-11-01T00:00:00Z',attachments:[{extension:'png',url:'https://attachments.clickup.com/a.png',user:{email:'private@example.com'}}],comment_images:[],files:[]};
assert(workMatches(row,'mine','order-1','staff'));assert(!workMatches(row,'mine','','other'));
assert(workMatches({...row,status:'cake topper - printing'},'acrylic','',''));assert(!workMatches(row,'printing','',''));
assert.equal(dueAt(row),new Date(Number(row.due_date)).toISOString());assert.equal(dueAt({...row,due_date:'99999999999999999999'}),row.ship_by_at);
let handler,role='staff',permissions=['view_orders'],active=true,auth=true,savedBody,uploadCalls=0;
const source=readFileSync('supabase/functions/task-workspace/index.ts','utf8').replace("import 'jsr:@supabase/functions-js/edge-runtime.d.ts';",'').replace("import {previewItem} from '../awb-preview/preview.ts';",'');
const fetcher=async(url,options={})=>{
 const path=new URL(url).pathname;
 if(path==='/auth/v1/user')return Response.json(auth?{id:'authenticated-user'}:{},{status:auth?200:401});
 if(path.endsWith('/admin_users'))return Response.json(active?[{username:'staff',role}]:[]);
 if(path.endsWith('/admin_permissions'))return Response.json([{permissions}]);
 if(path.endsWith('/icetak_task_workspace_read'))return Response.json({items:[row],staff:[],truncated:false});
 if(path.endsWith('/icetak_task_workspace_save')){savedBody=JSON.parse(options.body);return Response.json({ok:true,version:1});}
 if(path.startsWith('/storage/v1/object/task-workspace/')){uploadCalls++;return Response.json({Key:'uploaded'});}
 throw Error('Unexpected route: '+path);
};
await new Function('Deno','fetch','previewItem',`return (async()=>{${stripTypeScriptTypes(source)}})()` )({env:{get:k=>k==='SUPABASE_URL'?'https://qa.supabase.co':'private-key'},serve:fn=>handler=fn},fetcher,previewItem);
const call=(body={},authorization=true)=>handler(new Request('https://qa.example',{method:'POST',headers:authorization?{authorization:'Bearer verified','content-type':'application/json'}:{'content-type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await call({},false)).status,401);auth=false;assert.equal((await call()).status,401);auth=true;
active=false;assert.equal((await call()).status,403);active=true;permissions=[];assert.equal((await call()).status,403);permissions=['view_orders'];
const list=await (await call({action:'list'})).json();assert.equal(list.can_edit,false);assert.equal(list.items[0].images.length,1);assert(!JSON.stringify(list).includes('private@example.com'));assert(!('attachments' in list.items[0]));
const save={action:'save',task_id:'task-1',version:0,request_id:crypto.randomUUID(),source_updated_at:row.source_updated_at,patch:{stage:'review',note:'QA'},p_actor:'attacker'};
assert.equal((await call(save)).status,403);permissions=['approve_production'];assert.equal((await call(save)).status,200);assert.equal(savedBody.p_actor,'staff');
assert.equal((await call({...save,patch:{order_id:'another-order'}})).status,400);
assert.equal((await call({...save,task_id:'bad/id'})).status,400);
assert.equal((await call({...save,version:-1})).status,400);
assert.equal((await call({action:'delete'})).status,400);
assert.equal((await handler(new Request('https://qa.example',{method:'GET'}))).status,405);
const data=new FormData();data.set('payload',JSON.stringify({...save,action:'upload'}));data.set('file',new File([new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0])],'design.png',{type:'image/png'}));
assert.equal((await handler(new Request('https://qa.example',{method:'POST',headers:{authorization:'Bearer verified'},body:data}))).status,200);
assert.equal(uploadCalls,1);assert(savedBody.p_patch.file.path.startsWith('task-1/'));assert.equal(savedBody.p_patch.file.mime,'image/png');
const bad=new FormData();bad.set('payload',JSON.stringify({...save,action:'upload'}));bad.set('file',new File(['<script>unsafe</script>'],'design.png',{type:'image/png'}));
assert.equal((await handler(new Request('https://qa.example',{method:'POST',headers:{authorization:'Bearer verified'},body:bad}))).status,400);assert.equal(uploadCalls,1);
console.log('Task Workspace: staff auth, read/write permissions, server actor, private DTO, grouping/search/due, input guards and authenticated file signature upload passed.');
