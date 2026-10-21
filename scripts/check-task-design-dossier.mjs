import assert from 'node:assert/strict';
import {taskDossier,readAsset,safeAssetUrl} from '../supabase/functions/task-workspace/dossier.ts';
const loaded={source:{fields:{'customize name':'Aina','noted':'White'}},order:{order_note:'Nama: Aina',items:[{id:'a'},{id:'b'}]},readiness:{values:{wording:'Aina',artwork:'wasapflow-media://12'},sources:{wording:{source:'whatsapp · current'}},evidence:[{id:'current'}]},context:{bindings:[{id:'c',usable:true,start_at:'2026-10-20T00:00:00Z',end_at:'2026-10-21T00:00:00Z'},{id:'unsafe',usable:false}],media_access:{'wasapflow-media://12':{url:'https://uujcqcsfghqkukaydruc.supabase.co/storage/v1/object/sign/whatsapp-media/a?token=fixture'}},messages:[
{id:'old',conversation_id:'c',created_at:'2026-10-19T23:59:59Z',text_content:'OLD ORDER'},
{id:'later',conversation_id:'c',created_at:'2026-10-21T00:00:00Z',text_content:'NEXT ORDER'},
{id:'unsafe',conversation_id:'unsafe',created_at:'2026-10-20T00:01:00Z',text_content:'UNSAFE'},
{id:'history',conversation_id:'c',created_at:'2026-10-20T00:01:00Z',is_history:true,text_content:'HISTORY'},
{id:'current',conversation_id:'c',channel:'whatsapp',direction:'inbound',message_type:'image',media_url:'wasapflow-media://12',text_content:'Nama: Aina',created_at:'2026-10-20T00:01:00Z'},
{id:'reply',conversation_id:'c',channel:'whatsapp',direction:'outbound',message_type:'text',text_content:'Background putih?',created_at:'2026-10-20T00:02:00Z'}]}};
const result=taskDossier(loaded,{},[],[]);
assert.deepEqual(result.messages.map(m=>m.id),['current','reply']);assert.equal(result.sources.wording.message_id,'current');assert(result.assets[0].selected);assert(result.assets[0].available);assert(result.multi_item);assert.equal(result.channels.find(c=>c.channel==='whatsapp').status,'unmatched','channel requires explicit binding channel');
for(const secret of ['OLD ORDER','NEXT ORDER','UNSAFE','HISTORY','conversation_id','media_access'])assert(!JSON.stringify(result).includes(secret));
assert.equal(result.messages[1].direction,'outbound');assert.equal(result.messages[0].text,'Nama: Aina');
const unavailable=taskDossier({...loaded,context:{unavailable:true}}, {},[],[]);assert(unavailable.unavailable);assert(!unavailable.messages.length);
for(const url of ['http://attachments.clickup.com/a.png','https://evil.example/a','https://uujcqcsfghqkukaydruc.supabase.co.evil.example/a','https://127.0.0.1/a','https://attachments.clickup.com:444/a','https://user:secret@attachments.clickup.com/a'])assert.equal(safeAssetUrl(url),'');
await assert.rejects(readAsset('https://127.0.0.1/private',()=>{throw Error('must not fetch');}),/INVALID_ASSET_HOST/);
await assert.rejects(readAsset('https://attachments.clickup.com/a',async()=>new Response(null,{status:302,headers:{location:'https://169.254.169.254/latest'}})),/INVALID_ASSET_REDIRECT/);
await assert.rejects(readAsset('https://attachments.clickup.com/a',async()=>new Response('<html>login</html>',{headers:{'content-type':'image/png'}})),/INVALID_ASSET_FORMAT/);
await assert.rejects(readAsset('https://attachments.clickup.com/a',async()=>new Response('x',{headers:{'content-length':'15728641'}})),/ASSET_TOO_LARGE/);
const image=await readAsset('https://attachments.clickup.com/a',async()=>new Response(new Uint8Array([0x89,0x50,0x4e,0x47,0,0])));assert.equal(image.mime,'image/png');assert.equal(image.bytes.length,6);
console.log('PASS design dossier: exact order boundaries, inbound/outbound original messages, per-field provenance, media availability, multi-item context, private DTO and bounded authenticated binary asset host/redirect/signature guards.');
