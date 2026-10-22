import assert from 'node:assert/strict';
import {orderBadge,conversationLifecycle,prospectStage,taskStage} from '../supabase/functions/_shared/conversation-lifecycle.ts';
import {lifecycleHandler} from '../supabase/inbox-functions/conversation-lifecycle/handler.ts';
const id='00000000-0000-4000-8000-000000000001',now=Date.parse('2026-10-22T17:00:00Z');let checks=0;
const task=(id,status,review_status=null)=>({id,status,review_status});
const order=(tasks,extra={})=>({id:'o',order_no:'DEMO-1',source_channel:'whatsapp',placed_at:'2026-10-22T16:00:00Z',payment_status:'paid',linked:true,is_primary:true,tasks,...extra});
for(const [status,expected] of [['acrylic','design'],['design editing -topper','design'],['design edible image','design'],['wafer paper','design'],['new custom','design'],['review','review'],['cake topper - printing','printing'],['edible image -printing','printing'],['print alamat','printing'],['ready stock','printing'],['complete','complete'],['closed','complete'],['printed','printed'],['selesai print','printed'],['cancelled','cancelled'],['prospect','unknown'],['','unknown']]){assert.equal(taskStage(task('x',status)),expected);checks++;}
assert.equal(taskStage(task('x','review','edit_requested')),'edit');checks++;
assert.equal(taskStage(task('x','complete','edit_requested')),'complete');checks++;
for(const [tasks,extra,expected] of [
 [[task('a','complete'),task('b','acrylic')],{},'design'],[[task('a','complete'),task('b','cake topper - printing')],{},'printing'],
 [[task('a','complete'),task('b','review')],{},'review'],[[task('a','complete'),task('b','review','edit_requested')],{},'edit'],
 [[task('a','complete'),task('b','printed')],{},'printed'],[[task('a','complete'),task('b','cancelled')],{},'task_complete'],
 [[task('a','cancelled')],{},'unknown'],[[],{},'unknown'],[[task('a','complete')],{order_status:'SHIPPED'},'shipped'],
 [[task('a','acrylic')],{order_status:'COMPLETED'},'completed'],[[task('a','complete')],{order_status:'IN_CANCEL'},'cancelling'],
 [[task('a','complete')],{order_status:'CANCELLED'},'cancelled'],[[task('a','complete')],{order_status:'TO_RETURN'},'return'],
 [[task('a','complete')],{order_status:'Ready for Pickup'},'pickup'],[[task('a','acrylic')],{payment_status:'unpaid'},'unpaid'],
 [[task('a','acrylic')],{payment_status:'unpaid',payment_method:'cash_counter'},'design'],
 [[task('a','acrylic')],{shipped_at:'2026-10-22T16:30:00Z'},'shipped'],
]){assert.equal(orderBadge(order(tasks,extra)).stage,expected);checks++;}
const mixed=orderBadge(order([task('a','complete'),task('b','cake topper - printing'),task('c','acrylic')]));assert.equal(mixed.complete,1);assert.equal(mixed.total,3);checks+=2;
const msg=(n,direction,text_content,sender_type=direction==='outbound'?'seller':'customer')=>({id:'m'+n,direction,text_content,sender_type,created_at:new Date(now+n*60000).toISOString()});
for(const [messages,expected] of [
 [[msg(0,'inbound','berapa harga edible?')],'survey'],[[msg(0,'inbound','nak edible A4 2 pcs')],'interested'],
 [[msg(0,'inbound','nak edible A4 2 pcs'),msg(1,'outbound','Total RM48, boleh confirm untuk teruskan?')],'awaiting_confirm'],
 [[msg(0,'inbound','tak jadi dulu')],'not_proceeding'],[[msg(0,'inbound','berapa harga?'),msg(1,'inbound','okay')],'survey'],
 [[msg(0,'inbound','nak tahu harga boleh ke?')],'survey'],
 [[msg(0,'inbound','nak tanya harga acrylic')],'survey'],
 [[msg(0,'inbound','berapa harga?'),msg(1,'outbound','Total RM48, boleh confirm?','system')],'survey'],
]){assert.equal(prospectStage(messages).stage,expected);checks++;}
const source={conversation:{id,channel:'whatsapp'},orders:[],messages:[msg(0,'inbound','berapa harga?')]};
let r=conversationLifecycle(source,{},now);assert.equal(r.stage,'survey');checks++;
const override={stage:'awaiting_confirm',scope_key:r.scope_key,updated_at:new Date(now).toISOString()};
assert.equal(conversationLifecycle({...source,prospect:override}, {},now).stage,'awaiting_confirm');checks++;
assert.equal(conversationLifecycle({...source,prospect:override,messages:[...source.messages,msg(1,'inbound','tq')]},{},now).stage,'awaiting_confirm');checks++;
assert.equal(conversationLifecycle({...source,prospect:override},{session:{session_id:'new',opened_at:new Date(now).toISOString()}},now).manual,false);checks++;
assert.equal(conversationLifecycle({...source,prospect:override,messages:[...source.messages,msg(1,'inbound','nak order acrylic A4')]},{},now).manual,false);checks++;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')])],messages:[]},{},now).stage,'task_complete');checks++;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')],{order_status:'COMPLETED'})],messages:[msg(1,'inbound','nak order edible A4 lagi')]},{},now).stage,'interested');checks++;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')],{order_status:'SHIPPED'})],messages:[msg(1,'inbound','tracking parcel mana?')]},{},now).stage,'shipped');checks++;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')],{order_status:'SHIPPED'})],messages:[msg(1,'inbound','semak order DEMO-1')]},{},now).stage,'shipped');checks++;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')])],messages:[]},{session:{session_id:'new',opened_at:new Date(now).toISOString()}},now).stage,'survey');checks++;
assert.equal(conversationLifecycle(source,{session:{session_id:'s'},drafts:[{id:'d',status:'ready_customer',order_session_id:'s',created_at:new Date(now).toISOString()}]},now).stage,'draft');checks++;
assert.equal(conversationLifecycle({...source,missing_links:1},{},now).stage,'unknown');checks++;
assert.equal(conversationLifecycle({...source,truncated:true},{},now).stage,'unknown');checks++;
assert.equal(conversationLifecycle({...source,identity_ambiguous:true},{},now).stage,'unknown');checks++;
assert.equal(conversationLifecycle({...source,can_edit_prospect:false},{},now).prospect_editable,false);checks++;
let saved=[];const deps={source:async()=>structuredClone(source),canonical:async()=>({canonical:{},works:[]}),save:async(...args)=>saved.push(args)};
const handler=lifecycleHandler(deps),req=(body,auth=true)=>new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fake'}:{})},body:JSON.stringify(body)});
assert.equal((await handler(req({conversation_id:id},false))).status,401);checks++;
assert.equal((await handler(req({conversation_id:'bad'}))).status,400);checks++;
let read=await (await handler(req({conversation_id:id,orders:[order([])],status:'completed'}))).json();assert.equal(read.lifecycle.stage,'survey');checks++;
assert.equal((await handler(req({conversation_id:id,action:'set_prospect',scope_key:'old',stage:'interested'}))).status,409);checks++;
assert.equal((await handler(req({conversation_id:id,action:'set_prospect',scope_key:read.lifecycle.scope_key,stage:'completed'}))).status,400);checks++;
assert.equal((await handler(req({conversation_id:id,action:'set_prospect',scope_key:read.lifecycle.scope_key,stage:'interested'}))).status,200);assert.equal(saved.length,1);checks+=2;
const failed=lifecycleHandler({...deps,canonical:async()=>{throw Error('down');}});assert.equal((await failed(req({conversation_id:id}))).status,503);checks++;
const denied=lifecycleHandler({...deps,source:async()=>{throw {code:'42501'};}});assert.equal((await denied(req({conversation_id:id}))).status,403);checks++;
// A previous completed primary cannot hide a newer unfinished order.
const currentOrder=order([task('a','acrylic')],{id:'new',order_no:'DEMO-2',is_primary:false});
const oldOrder=order([task('old','complete')],{id:'old',order_status:'COMPLETED',placed_at:'2026-10-01T00:00:00Z'});
r=conversationLifecycle({...source,orders:[oldOrder,currentOrder],messages:[]},{},now);assert.equal(r.stage,'design');assert.equal(r.history.length,1);checks+=2;
assert.equal(conversationLifecycle({...source,orders:[order([task('a','complete')],{order_status:'SHIPPED'})],messages:[msg(0,'tq')]},{},now).stage,'shipped');checks++;
assert.equal(conversationLifecycle({...source,can_edit_prospect:false,prospect:override},{},now).stage,'awaiting_confirm');checks++;
const withCanonical=lifecycleHandler({...deps,source:async()=>({...structuredClone(source),orders:[order([], {placed_at:null})],messages:[]}),canonical:async()=>({canonical:{session:{session_id:'s',opened_at:'2026-10-22T15:00:00Z'}},works:[{id:'o',source_channel:'whatsapp',placed_at:'2026-10-22T16:00:00Z',tasks:[task('exact','complete')]}]})});
read=await (await withCanonical(req({conversation_id:id}))).json();assert.equal(read.lifecycle.stage,'task_complete');assert.equal(read.lifecycle.tasks[0].id,'exact');checks+=2;
console.log(`${checks} lifecycle checks passed: task/fulfillment precedence, mixed progress, prospects, repeat/session isolation, exact links, draft, ambiguity, staff override and gateway boundaries.`);
