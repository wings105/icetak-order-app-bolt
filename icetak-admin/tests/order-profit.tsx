// Isolated QA entry. Not imported by the production entry/build; requests use local fixtures only.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import channelFixture from './sales-channel-report.json';
const extras=Object.fromEntries(['packaging','wastage','reprint','labor','shipping','ads','affiliate'].map(k=>[k,{amount:0,mode:'estimated'}]));
const first={order_id:'00000000-0000-4000-8000-000000000001',order_sn:'QA-ORDER-001',buyer:'sample.buyer',provider:'shopee',currency:'MYR',status:'COMPLETED',placed_at:new Date().toISOString(),buyer_paid:10,goods_value:10,nett:7.14,income_state:'escrow',released_at:null,enriched_at:new Date().toISOString(),escrow_amount:7.14,released_amount:null,commission_fee:1.67,service_fee:.7,transaction_fee:.38,other_fees:null,shipping_fee:0,settlement_status:'pending_release',material_total:1.27,extra_total:0,cost_total:1.27,profit:5.87,margin:58.7,profit_state:'estimated',cost_state:'estimated',detail_changed:false,categories:['topper'],skus:['CN0546'],cost_version:1,settings_version:1,material_lines:[{line_no:1,sku:'CN0546',parent_sku:'CN0546',title:'Custom Name Happy Birthday Cake Topper Liverpool Decoration Set',variation:null,quantity:1,goods_value:10,category:'topper',rate:12.7,unit_cost:null,amount:1.27,mode:'estimated',basis:'category_percent'}],extra_costs:extras,reviewed:false,work_minutes:null,note:'',cost_updated_at:null,profit_per_hour:null};
first['finance_fields' as keyof typeof first]={shipping_fee_sst:{code:'shipping_fee_sst',label:'SST shipping',group:'shipping',role:'reference',value:0,amount:0,source_path:'payload.order_income.shipping_fee_sst'},reverse_shipping_fee:{code:'reverse_shipping_fee',label:'Reverse shipping',group:'returns',role:'deduction',value:4.90,amount:4.90,source_path:'payload.order_income.reverse_shipping_fee'},voucher_from_seller:{code:'voucher_from_seller',label:'Voucher seller',group:'discounts',role:'seller',value:1,amount:1,source_path:'payload.order_income.voucher_from_seller'}} as any;
first['finance_metrics' as keyof typeof first]={shipping_net:0,return_shipping:4.90,fee_total:2.86,refund_total:0,seller_promotion:1,platform_ads:.11,affiliate:0,provider_nett:7.14,reconstructed_nett:7.14,reconciliation_delta:0,reconciliation:'matched',issues:[],reasons:['return_shipping','platform_ads'],field_count:3} as any;
first['finance_source' as keyof typeof first]='webhook' as any;
first['finance_history' as keyof typeof first]=[{id:1,source:'webhook',captured_at:new Date().toISOString(),metrics:(first as any).finance_metrics}] as any;
let rows:any[]=[first,{...structuredClone(first),order_id:'00000000-0000-4000-8000-000000000002',order_sn:'QA-MISSING-002',nett:null,escrow_amount:null,income_state:'missing',profit:null,margin:null,profit_state:'incomplete'},{...structuredClone(first),order_id:'00000000-0000-4000-8000-000000000003',order_sn:'QA-RELEASED-003',nett:7,released_amount:7,income_state:'released',released_at:new Date().toISOString(),profit:5.73,margin:57.3}];
let settings={version:1,rates:{topper:12.7,edible:42.5,wafer:23.33,acrylic:15.83},sku_costs:{},effective_at:'1970-01-01T00:00:00Z'};

let targetSettings={version:1,overhead:5000,owner_income:0,workdays:[0,1,2,3,4,6],holidays:[] as string[]};
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
let direct:any={order_id:'00000000-0000-4000-8000-000000000099',reference:'QA-DIRECT-024',channel:'deco',day:date,status:'Ready to Process',sales:24,customer_paid:28.5,shipping_charged:4.5,courier:4.5,courier_state:'estimated',fee:0,nett:24,material:10.2,extras:0,contribution:13.8,margin:57.5,state:'estimated',income_state:'transaction',included:true,reasons:[],version:0,signature:'qa-direct-sig',material_override:null,courier_override:null,material_actual:false,courier_actual:false,extras_actual:false,note:'',lines:[{title:'Edible Image',qty:1,category:'edible',goods:24,material:10.2}]};
let targetFailed=false;(window as any).__targetQA={setFailed:(b:boolean)=>{targetFailed=b},get settings(){return targetSettings},get direct(){return direct}};

const calls:any[]=[];(window as any).__profitQA={calls,get rows(){return rows},get settings(){return settings}};
const ok=(data:any)=>({data:{success:true,data},error:null});
const client={auth:{signOut:async()=>({error:null})},rpc:async(name:string)=>({data:name==='icetak_admin_marketplace_orders'?{rows:rows.map(r=>({id:r.order_id,provider:r.provider,orderSn:r.order_sn,buyerUsername:r.buyer,status:r.status,paymentStatus:'paid',fulfillmentStatus:'shipped',courier:'SPX',buyerPaid:r.buyer_paid,currency:r.currency,placedAt:r.placed_at,items:r.material_lines.map((l:any)=>({title:l.title,sku:l.sku,qty:l.quantity})),itemCount:r.material_lines.length})),total:rows.length,summary:{all:rows.length,completed:rows.length}}:{attention:0},error:null}),functions:{invoke:async(name:string,{body}:{body:any})=>{
  calls.push({name,body});if(name==='admin-command-center')return {data:{ok:true,fetched_at:new Date().toISOString(),warnings:[],capabilities:{finance:false,chat:false,manage_sales:false},order:{period:{},backlog:{},trend:[],pipeline:[],production:[],products:[],couriers:[],shipping_status:[],shipping_aging:[],returns:[],focus:[],opportunities:[],sales_funnel:[],staff_activity:[],ai_training:[],health:{},limitations:[]},inbox:null},error:null};if(name!=='finance-admin')return {data:{ok:true,url:''},error:null};

  if(body.action==='contribution_report'){
    if((window as any).__targetLive)return ok(structuredClone((window as any).__targetLive));
    if(targetFailed)return {data:{success:false,error:'QA finance connection failed'},error:null};
    const shoe={...direct,order_id:first.order_id,reference:first.order_sn,channel:'shopee',sales:10,customer_paid:10,fee:2.86,courier:null,courier_state:'in_nett',nett:7.14,material:1.27,contribution:5.87,margin:58.7};
    const miss={...shoe,order_id:rows[1].order_id,reference:'QA-MISSING-002',state:'incomplete',contribution:null,margin:null,nett:null,reasons:['Nett belum lengkap']};
    const loss={...shoe,order_id:'00000000-0000-4000-8000-000000000004',reference:'QA-LOSS-004',nett:0,contribution:-1.27,margin:-12.7};
    const known=direct.contribution+5.87-1.27,goal=targetSettings.overhead+targetSettings.owner_income;
    const all=body.month==='2000-01-01'?[]:[direct,shoe,miss,loss];
    let list=all.filter(o=>(!body.channel||body.channel==='all'||body.channel===o.channel)&&(!body.state||body.state==='all'||body.state===o.state||body.state==='loss'&&o.contribution<0)&&(!body.query||o.reference.includes(body.query)));
    if(body.sort==='contribution_asc')list.sort((a,b)=>(a.contribution??Infinity)-(b.contribution??Infinity));if(body.sort==='contribution_desc')list.sort((a,b)=>(b.contribution??-Infinity)-(a.contribution??-Infinity));
    return ok({month:body.month||date.slice(0,7)+'-01',today:date,fetched_at:new Date().toISOString(),settings:targetSettings,total:list.length,rows:list,channels:all.length?[{channel:'deco',orders:1,missing:0,contribution:direct.contribution,sales:24,margin:direct.margin},{channel:'shopee',orders:3,missing:1,contribution:4.60,sales:30,margin:null}]:[],summary:{goal,known:all.length?known:0,actual:direct.state==='actual'?direct.contribution:0,estimated:known-(direct.state==='actual'?direct.contribution:0),today:known,missing:all.length?1:0,included_orders:all.length,excluded_orders:0,remaining:goal-known,after_overhead:known-targetSettings.overhead,workdays:26,remaining_days:24,is_workday:true,daily_base:goal/26,daily_target:208.34,daily_gap:208.34-known}});
  }
  if(body.action==='contribution_detail')return ok(structuredClone(direct));
  if(body.action==='direct_costs_save'){
    const c=body.costs;direct={...direct,...c,material_override:c.material,courier_override:c.courier,material:c.material??10.2,courier:c.courier??4.5,version:direct.version+1,courier_state:c.courier_actual?'actual':'estimated'};
    direct.nett=28.5-direct.courier;direct.contribution=direct.nett-direct.material-direct.extras;direct.margin=direct.contribution/24*100;direct.state=c.material_actual&&c.courier_actual&&c.extras_actual?'actual':'estimated';return ok(structuredClone(direct));
  }
  if(body.action==='contribution_settings_save'){targetSettings={...body.settings,version:targetSettings.version+1};return ok(targetSettings)}

  if(body.action==='sales_channel_report'){
    const r:any=structuredClone(channelFixture);
    const own={...r.rows[0],channel:'deco',reference:'QA-DECO-001',order_id:'00000000-0000-4000-8000-000000000099',profit:null,profit_state:'incomplete',payment_evidence:'transaction',pending:12,included:true,repeat_customer:true};
    const shoe={...r.rows[0],channel:'shopee',reference:first.order_sn,order_id:first.order_id,pending:7.14,included:true,repeat_customer:false};
    r.rows=[shoe,own].filter(o=>(body.channel==='all'||!body.channel||o.channel===body.channel)&&(!body.query||o.reference.includes(body.query))&&(body.kind!=='loss'||o.profit<0)&&(body.kind!=='repeat'||o.repeat_customer));
    if(body.from==='2000-01-01'){r.rows=[];r.products=[];r.pending_aging=[];r.trend=[];r.summary={sales:0,known_sales:0,orders:0,missing_sales:0,basis_review_orders:0,foreign_orders:0};r.channels=r.channels.map(c=>({...c,sales:0,known_sales:0,sales_orders:0,sales_share:null,known_sales_share:null,missing_sales:0}));}
    r.total=r.rows.length;return ok(r);
  }
  if(body.action==='sales_sku_report'){
    const skus=[{sku_key:'QA-A',sku:'QA-A',title:'Topper A',variations:1,units:12,returned:2,net_units:10,orders:8,sales:120,profit:60,missing_profit_orders:0},{sku_key:'QA-B',sku:'QA-B',title:'Edible B',variations:1,units:5,returned:0,net_units:5,orders:3,sales:200,profit:null,missing_profit_orders:1}];
    return ok({rows:skus,summary:{sales:320,net_units:15,returned:2,orders:10,sku_count:2},coverage:{first_day:'2026-07-02',last_day:'2026-10-03',bucket:'day'},trend:[{day:'2026-10-01',units:5,sales:100,orders:3,profit:20},{day:'2026-10-02',units:0,sales:0,orders:0,profit:0},{day:'2026-10-03',units:10,sales:220,orders:7,profit:null}],orders:body.sku_key?[{order_id:first.order_id,order_sn:first.order_sn,day:'2026-10-03',units:1,sales:10,profit:5.87}]:[],order_count:body.sku_key?1:0});
  }
  if(body.action==='order_finance_options')return ok({couriers:['SPX'],shops:[{shop_id:188218638,currency:'MYR',orders:3}]});
  if(body.action==='order_finance_import')return ok({hash:'qa-preview',valid:true,committed:!!body.commit,inserted:body.commit?body.orders.length:0,reference_only:0,duplicates:0,rows:body.orders.map((o:any)=>({order_sn:o.order_sn,state:'incomplete_finance',nett:null}))});
  if(body.action==='snapshot')return ok({kpis:{month_in:0,month_out:0,review_transactions:0},accounts:[],connections:[],reconciliation:[],recent_transactions:[],shopee:{orders:3,released:7,fees:2.75,pending:1},raw_event_status:{}});
  if(body.action==='order_profit_list'||body.action==='order_finance_report'||body.action==='order_finance_export'){
    let list=rows.filter(r=>!body.query||`${r.order_sn} ${r.buyer} ${r.skus}`.toLowerCase().includes(body.query.toLowerCase()));if(body.category)list=list.filter(r=>r.categories.includes(body.category));if(body.state)list=list.filter(r=>body.state==='loss'?r.profit<0:r.profit_state===body.state);
    const sum=(key:string,pred:(r:any)=>boolean)=>list.filter(pred).reduce((n,r)=>n+Number(r[key]||0),0);
    return ok({rows:structuredClone(list),total:list.length,currency:'MYR',trend:[{day:'2026-10-03',orders:3,known_orders:2,profit:11.60,nett:14.14}],groups:[{name:'SPX',orders:3,known_orders:2,profit:11.60,shipping_net:0}],summary:{orders:list.length,released_nett:sum('nett',r=>r.income_state==='released'),escrow_nett:sum('nett',r=>r.income_state==='escrow'),actual_profit:0,estimated_profit:sum('profit',r=>r.profit_state==='estimated'),actual_orders:0,estimated_orders:list.filter(r=>r.profit_state==='estimated').length,incomplete_orders:list.filter(r=>r.profit_state==='incomplete').length,loss_orders:list.filter(r=>r.profit<0).length,low_margin_orders:list.filter(r=>r.margin!=null&&r.margin<20).length}});
  }
  if(body.action==='order_profit_detail')return ok(structuredClone(rows.find(r=>r.order_id===body.order_id)));
  if(body.action==='order_profit_summaries')return ok(structuredClone(rows.filter(r=>body.order_ids.includes(r.order_id))));
  if(body.action==='material_cost_settings')return ok(structuredClone(settings));
  if(body.action==='material_cost_settings_save'){settings={...settings,version:settings.version+1,rates:body.rates,sku_costs:body.sku_costs,effective_at:new Date().toISOString()};return ok(structuredClone(settings))}
  if(body.action==='order_costs_save'){
    const r=structuredClone(rows.find(r=>r.order_id===body.order_id));r.cost_version++;r.material_lines=r.material_lines.map((l:any)=>({...l,...body.lines.find((v:any)=>v.line_no===l.line_no)}));r.extra_costs=body.extras;r.work_minutes=body.work_minutes;r.note=body.note;r.reviewed=body.reviewed;r.material_total=r.material_lines.some((l:any)=>l.amount==null)?null:r.material_lines.reduce((n:number,l:any)=>n+(l.amount||0),0);r.extra_total=Object.values(r.extra_costs).reduce((n:number,v:any)=>n+v.amount,0);r.cost_total=r.material_total==null?null:r.material_total+r.extra_total;r.profit=r.nett==null||r.cost_total==null?null:r.nett-r.cost_total;r.margin=r.profit==null?null:r.profit/r.goods_value*100;r.cost_state=r.reviewed?'actual':'estimated';r.profit_state=r.profit==null?'incomplete':r.reviewed&&r.income_state==='released'?'actual':'estimated';r.cost_updated_at=new Date().toISOString();rows=rows.map(v=>v.order_id===r.order_id?r:v);return ok(r);
  }return ok({rows:[],counts:{}});
}}};
(globalThis as any).__ICETAK_SUPABASE__=client;
const App=(await import('../src/App')).default;
const role=new URLSearchParams(location.search).get('qa_role');const permissions=role==='staff'?['view_orders']:['view_orders','view_finance',...(role==='reader'?[]:['manage_finance'])];
createRoot(document.getElementById('root')!).render(<React.StrictMode><App adminData={{admin:{username:role==='staff'?'qa-staff':'admin1',display_name:'Finance QA',role:role==='staff'?'staff':'owner',permissions}}}/></React.StrictMode>);
