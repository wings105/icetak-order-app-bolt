import assert from "node:assert/strict";
import {processAcrylic} from "../supabase/functions/clickup-order-brief/acrylic.ts";
globalThis.Deno={env:{get:()=>undefined}};
const scope={eligible:true,order_id:"order-1",target_item_id:"item-1",provider:"shopee",order_no:"TEST",placed_at:"2026-11-04T07:00Z",target:{quantity:1,colour:"Gold",size:"A7",title:"Acrylic",sku:"acrylic"},items:[{kind:"acrylic"}]};
const customer={id:"message-1",direction:"inbound",channel:"shopee",text_content:"tulis A & L",created_at:"2026-11-04T08:00Z",message_type:"text"};
const originalFetch=globalThis.fetch;
try{
 for(const mode of ["clear","staff-conflict","race"]){
  const writes=[], saved=[];let reads=0;
  const task={id:"task1",list:{id:"18375902"},status:{status:"acrylic"},custom_fields:mode==="staff-conflict"?[{id:"7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc",value:"Other name"}]:[]};
  globalThis.fetch=async url=>{assert(!String(url).includes("api.openai.com"));return Response.json({ok:true,context:{order_id:"order-1",messages:[customer]}});};
  const d={db:async(p,b)=>p.includes("scope")?scope:p.startsWith("task_detail")?[]:p.startsWith("clickup_order_brief_settings")?[{acrylic_ai_fallback:true}]:p.includes("record_order_brief")?(saved.push(b),true):[],
   clickup:async(token,p,method,body)=>{if(!method){reads++;return mode==="race"&&reads>1?{...task,status:{status:"complete"}}:task;}writes.push({p,method,body});return {id:"comment1"};},
   digest:async s=>String(s.length)+s.slice(-30),safeDownload:async()=>{throw Error("unexpected media");},clock:()=>"",rich:s=>[{text:s}],inbox:"https://example.invalid"};
  const r=await processAcrylic({task_id:"task1",source_fingerprint:"fp"},"token","bridge",d);
  if(mode==="clear"){assert.equal(r.state,"completed");assert(writes.some(w=>w.p.endsWith("/field/7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc")));assert.equal(saved[0].p_brief.ai,null);}
  if(mode==="staff-conflict"){assert.equal(r.state,"review");assert(!writes.some(w=>w.p.includes("/field/")));assert(saved[0].p_brief.conflicts.includes("STAFF_WORDING_CONFLICT"));}
  if(mode==="race"){assert.equal(r.state,"failed");assert.equal(writes.length,0);}
  console.log("PASS processor",mode);
 }
}finally{globalThis.fetch=originalFetch;}

