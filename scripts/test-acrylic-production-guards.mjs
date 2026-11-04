import assert from "node:assert/strict";
import {acrylicProjection} from "../supabase/functions/task-workspace/acrylic-projection.ts";
import {productionItem} from "../supabase/functions/acrylic-production/model.ts";
import {createAcrylicActionsHandler,acrylicDigest} from "../supabase/functions/acrylic-production-actions/handler.ts";
const brief={profile:"acrylic-internal-v1",state:"CHANGE_AFTER_CONFIRM",confirmed:false,wording:"50",quantity:1,colour:"Yellow",size:"A6",conflicts:["STAFF_WORDING_CONFLICT"],missing:[],content_changed_at:"2026-11-04T08:00Z"};
const readiness={values:{wording:"70"},print_ready:true,conflicts:[],warnings:[]};
assert.equal(acrylicProjection(readiness,{brief},null).values.wording,"50");
assert.equal(acrylicProjection(readiness,{brief},null).print_ready,false);
assert.equal(acrylicProjection(readiness,{brief},{confirmed:true,updated_at:"2026-11-04T09:00Z"}).print_ready,true);
console.log("PASS Workspace shows corrected candidate and requires human approval");
const row={task_id:"task1",title:"1x A6 acrylic Yellow",status:"acrylic",order_reference:"TEST",jobs:["Acrylic cake topper"],sets:[],sku:"",due_date:null,updated_at:"",autobrief:brief};
assert(productionItem(row).issues.some(x=>x.includes("HOLD")));
console.log("PASS production HOLD visible");
const token="ap_"+"a".repeat(64),digest=await acrylicDigest(token);
for(const acknowledged of [false,true]){
 let writes=0;
 const fetcher=async url=>{
  const p=String(url);
  const data=p.includes("private_runtime")?[{setting_value:JSON.stringify({enabled:true,digest,actor:"acrylic_station_1234abcd"})}]:
   p.includes("admin_users")?[{username:"acrylic_station_1234abcd",role:"staff"}]:
   p.includes("admin_permissions")?[{permissions:["view_orders","edit_order"]}]:
   p.includes("icetak_acrylic_production_snapshot")?{rows:[row]}:
   p.includes("clickup_order_brief_jobs")?[{brief}]:
   p.includes("task_workspace_briefs")?(acknowledged?[{confirmed:true,updated_at:"2026-11-04T09:00Z"}]:[]):[];
  return Response.json(data);
 };
 const handler=createAcrylicActionsHandler({url:"https://example.invalid",key:"test",fetcher,clickup:()=>async()=>{writes++;return Response.json({ok:true});}});
 const res=await handler(new Request("https://example.invalid/actions",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"status",task_id:"task1",status:"complete"})}));
 assert.equal(res.status,acknowledged?200:409);assert.equal(writes,acknowledged?1:0);
}
console.log("PASS production completion blocked until explicit human acknowledgement");

