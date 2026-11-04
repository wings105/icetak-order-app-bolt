
import {briefAction,newCustomerMessages} from "./lifecycle.ts";
const assert=(value:unknown)=>{if(!value)throw new Error("assertion failed");};
const at=Date.parse("2026-11-04T12:00:00Z");
const route={profile:"glossy",initial_status:"design editing -topper",task_created_at:new Date(at-20*60000).toISOString()};
Deno.test("creation profile never follows a later status",()=>{
 assert(briefAction(route,"design editing -topper",{},at)==="INITIAL_BRIEF");
 assert(briefAction(route,"acrylic",{},at)==="LEFT_INITIAL_STATUS");
 assert(briefAction({...route,confirmed_at:new Date(at-1000).toISOString()},"complete",{},at)==="OBSERVE_CUSTOMER_ONLY");
});
Deno.test("future profiles and unknown creation evidence cannot run another rule",()=>{
 assert(briefAction({...route,profile:"edible"},"design edible image",{},at)==="RULE_NOT_CONFIGURED");
 assert(briefAction({...route,profile:"wafer"},"wafer paper",{},at)==="RULE_NOT_CONFIGURED");
 assert(briefAction(undefined,"acrylic",{},at)==="NO_CREATION_EVIDENCE");
});
Deno.test("delay is measured from task creation",()=>{
 assert(briefAction({...route,task_created_at:new Date(at-1000).toISOString()},"design editing -topper",{},at)==="WAIT_15_MINUTES");
});
Deno.test("only unseen, live inbound after confirmation produces update evidence",()=>{
 const messages=[
  {id:"old",direction:"inbound",created_at:new Date(at-2000).toISOString()},
  {id:"seen",direction:"inbound",created_at:new Date(at).toISOString()},
  {id:"seller",direction:"outbound",created_at:new Date(at).toISOString()},
  {id:"history",direction:"inbound",is_history:true,created_at:new Date(at).toISOString()},
  {id:"new",direction:"inbound",created_at:new Date(at).toISOString()}
 ];
 const confirmed=new Date(at-1000).toISOString();
 const fresh=newCustomerMessages(messages,["seen"],confirmed);
 assert(fresh.length===1&&fresh[0].id==="new");
 assert(newCustomerMessages(messages,["seen","new"],confirmed).length===0);
});
