import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clickupCreateBody } from '../supabase/functions/clickup-production-outbox/create-body.ts';
// Independent contract assertions for the AP mapping supplied during migration.
const ids={order:'1bf24635-5405-47ec-9985-4b4d21f9c937',component:'1aa98168-cf59-4f52-a892-3acce4977e52',customer:'a8996f77-fcf9-4804-84bb-89f97905473d',courier:'55526fc6-8c57-4fc7-83b5-4c487c94c0c8'};
const o={id:'order-uuid',order_no:'IC261030-TEST',customer_name:'Test Customer',customer_phone:'60123456789',date_needed:'2026-10-31',delivery_method:'SPX',delivery_address:'A',delivery_city:'B',delivery_postcode:'C',delivery_state:'D',customer_token:'token'};
const c={webapp_order_id:o.id,webapp_component_id:'component-uuid',quantity:2,size:'A5',style:'Gold',component_type:'acrylic',title:'Acrylic',wording:'Test',initial_clickup_status:'design editing - acrylic',custom_fields:[{id:'money',value:40},{id:'set',value:['set2']} ]};
for(const [delivery,expected] of [['SPX','c7b7ad4d-7dc7-4bd9-8b64-9e182ed3a1b9'],['JNT','c036471c-ac91-42df-81f9-400575c9d121'],['NINJA','e8b8b6d2-2d80-42cc-8490-c84f7fea450d'],['Pickup','47332e86-6914-4d2f-a000-5a7a543d7c16']]){
 const b=await clickupCreateBody({order:{...o,delivery_method:delivery},components:[c]});
 const f=Object.fromEntries(b.custom_fields.map(f=>[f.id,f.value]));
 assert.equal(b.name,'2x A5 acrylic Gold');assert.equal(b.due_date,Date.parse('2026-10-31T12:00:00+08:00'));
 assert.equal(f[ids.order],o.id);assert.equal(f[ids.component],c.webapp_component_id);assert.equal(f[ids.courier],expected);
 assert.equal(f[ids.customer],delivery==='Pickup'?o.customer_name:o.order_no);assert.equal(f.money,40);assert.deepEqual(f.set,['set2']);assert.deepEqual(b.tags,['decoshop']);assert.equal(b.status,c.initial_clickup_status);
}
const b=await clickupCreateBody({order:{...o,date_needed:null},components:[{...c,component_type:'mirror'}]});assert.equal(b.name,'2x A5 artpaper Gold');assert.equal(b.due_date,null);
console.log('Native mapping contract: 5 scenarios passed');
