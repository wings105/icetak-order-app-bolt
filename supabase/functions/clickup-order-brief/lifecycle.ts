
type Data=Record<string,any>;
export function briefAction(route:Data|undefined,currentStatus:string,previous:Data={},now=Date.now()):string{
 if(!route)return "NO_CREATION_EVIDENCE";
 if(!["glossy","acrylic","edible","wafer"].includes(route.profile))return "RULE_NOT_CONFIGURED";
 if(route.confirmed_at||previous.confirmed===true)return "OBSERVE_CUSTOMER_ONLY";
 if(now-Date.parse(route.task_created_at)<15*60*1000)return "WAIT_15_MINUTES";
 if(String(currentStatus||"").trim().toLowerCase()!==route.initial_status)return "LEFT_INITIAL_STATUS";
 return "INITIAL_BRIEF";
}
export function newCustomerMessages(messages:Data[],seen:string[],confirmedAt:string):Data[]{
 const known=new Set(seen.map(String)),after=Date.parse(confirmedAt);
 if(!Number.isFinite(after))return [];
 return messages.filter(m=>m.direction==="inbound"&&!m.is_history&&m.id&&!known.has(String(m.id))
  &&Date.parse(m.sent_at||m.created_at)>after)
  .sort((a,b)=>Date.parse(a.sent_at||a.created_at)-Date.parse(b.sent_at||b.created_at));
}
