import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const src=stripTypeScriptTypes(readFileSync('supabase/functions/clickup-order-brief/index.ts','utf8').replace(/^import .*;\n/gm,''));
const api=new Function('Deno',src+';return {explicitChatWording,namedWordingFromMessage,decide};')({env:{get:()=>''},serve:()=>{}});
const samples=[
 ['Latest Tulis:\\nHappy Birthday Sample Child 6 Years Old','Happy Birthday Sample Child 6 Years Old'],
 ['Tulis:\nHappy Birthday\nSample Child\n6 Years','Happy Birthday Sample Child 6 Years'],
 ['Hi, saya ada order topper. Custom name:\\nHappy Birthday \\nSample Child \\n6 Years','Happy Birthday Sample Child 6 Years'],
 ['Nama: Sample Child\nUmur: 6','Sample Child'],
 ['Sample Child turns 6','Sample Child turns 6']
];
for(const [input,expected]of samples)assert.equal(api.namedWordingFromMessage(input),expected);
for(const input of ['Saya lupa nk letak nama sebelum checkout','Tulis: https://example.com','Tulis: CN1001','Tulis: berapa harga?','Tulis: Nama A\nCN1001: Nama B'])assert.equal(api.explicitChatWording(input),null);
const m=(text,at)=>({text_content:text,created_at:at,message_type:'text'});
const history=[m(samples[2][0],'2026-11-04T08:11:26Z'),m('Tulis:\\nHappy Birthday Sample Child 6 Year','2026-11-04T08:15:50Z'),m(samples[0][0],'2026-11-04T08:21:42Z')];
const d=api.decide('','',history,{},false,history);
assert.equal(d.wording,samples[0][1]);assert.equal(d.confidence,90);assert.equal(d.name_conflict,false);assert.equal(d.age_conflict,false);
for(const ctx of [{ambiguous:true},{truncated:true},{unavailable:true}])assert(api.decide('','',history,ctx,false,history).confidence<80);
assert(api.decide('','',history,{},true,history).confidence<80);
assert(api.decide('','Staff Name',history,{},false,history).confidence<80);
assert(api.decide('Other Name','',history,{},false,history).confidence<80);
const conflicts=[m('Nama: Sample A\nUmur: 6','2026-11-04T08:00:00Z'),m('Nama: Sample B\nUmur: 7','2026-11-04T08:05:00Z')];
assert(api.decide('','',conflicts,{},false,conflicts).confidence<80);
console.log('PASS actual explicit wording parser/decision: labels, multiline/escaped text, latest correction, context/multi/staff/note/conflict guards.');
