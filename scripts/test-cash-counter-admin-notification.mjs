import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../supabase/functions/admin-order-control/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm,'');
const baseOrder = {id:'order-1',order_no:'IC261007-6196',public_token:'public-token',source:'customer',customer_confirmed:true,production_approved:false,payment_status:'cash_counter',payment_method:'Cash at Counter',delivery_method:'pickup',delivery_name:'Test Customer',delivery_phone:'60122222222',total:20,date_need:'2026-10-09'};
function setup(overrides={}, queueStatus='sending') {
  const order = {...baseOrder,...overrides}, queue={id:'queue-1',order_id:order.id,status:queueStatus,attempts:1};
  const sent=[];
  class Query {
    constructor(table){this.table=table;this.filters=[];this.write=null;}
    select(){return this;}
    eq(k,v){this.filters.push([k,v]);return this;}
    order(k){if(this.table==='order_items')assert.equal(k,'sort_index');return this;}
    limit(){return this;}
    update(v){this.write=v;return this;}
    single(){return this.exec();}
    maybeSingle(){return this.exec();}
    then(a,b){return this.exec().then(a,b);}
    async exec(){
      let data=this.table==='admin_order_notification_queue'?queue:this.table==='orders'?order:this.table==='order_items'?[{title:'Acrylic Cake Topper',qty:1,price:20,size:'A6 Standard',wording:'Hello'}]:this.table==='clickup_tasks'?[]:this.table==='payment_transactions'?null:null;
      if(this.table==='whatsapp_settings') { const key=this.filters.find(([k])=>k==='key')?.[1]; data={text_value:{admin_order_notify_phone:'60111111111',customer_app_base_url:'https://shop.decocake.my',partner_key:'mock',waba_id:'mock'}[key]||''};}
      if(data && !Array.isArray(data) && this.table!=='whatsapp_settings' && !this.filters.every(([k,v])=>data[k]===v))return {data:null,error:null};
      if(this.write&&data)Object.assign(data,this.write);
      return {data: data && !Array.isArray(data)?{...data}:data,error:null};
    }
  }
  const ctx=vm.createContext({createClient:()=>({from:table=>new Query(table)}),Deno:{env:{get:()=>''},serve:()=>{}},Response,AbortController,setTimeout,clearTimeout,console,fetch:async(url,init)=>{sent.push(JSON.parse(init.body));return {ok:true,json:async()=>({message_id:'provider-1'})};}});
  vm.runInContext(source+'\n globalThis.api={finalNotification,isCashCounterReview};',ctx);
  return {api:ctx.api,order,queue,sent};
}
{
 const x=setup();assert.equal(x.api.isCashCounterReview(x.order),true);
 const r=await x.api.finalNotification('queue-1');assert.equal(r.sent,true);assert.equal(x.sent.length,1);
 const m=x.sent[0];assert.equal(m.to,'60111111111');assert.match(m.text,/CASH AT COUNTER/);assert.match(m.text,/BELUM BAYAR.*RM20.00/);assert.match(m.text,/Acrylic Cake Topper/);assert.match(m.text,/Wording: Hello/);assert.match(m.text,/Confirm Production/);assert.match(m.text,/admin=v2&order=IC261007-6196/);assert.equal(x.queue.status,'sent');
 assert.equal((await x.api.finalNotification('queue-1')).duplicate,true);assert.equal(x.sent.length,1);
}
for(const override of [{production_approved:true},{customer_confirmed:false},{source:'pickup_ai'},{source:'admin'},{delivery_method:'shipping'},{payment_status:'paid'},{payment:'Paid'},{fulfillment_stage:'completed'}]){
 const x=setup(override);assert.equal(x.api.isCashCounterReview(x.order),false,JSON.stringify(override));
}
{
 const x=setup({status:'Cancelled'});assert.equal((await x.api.finalNotification('queue-1')).cancelled,true);assert.equal(x.sent.length,0);assert.equal(x.queue.status,'cancelled');
}
{
 const x=setup({production_approved:true,payment_status:'paid',payment_method:'QRPay'});
 await x.api.finalNotification('queue-1');assert.match(x.sent[0].text,/ORDER AUTO CREATED/);assert.doesNotMatch(x.sent[0].text,/PERLU KELULUSAN/);
}
console.log('PASS: cash review message, links, actual item ordering, duplicate guard, cancelled orders and paid/AI exclusions');

