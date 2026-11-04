import assert from "node:assert/strict";
import {acrylicRules,boundMessages} from "../supabase/functions/clickup-order-brief/acrylic-rules.ts";
const m=(id,text,direction="inbound",hours=0,extra={})=>({id,text_content:text,direction,created_at:new Date(Date.parse("2026-11-04T08:00Z")+hours*3600000).toISOString(),message_type:"text",...extra});
const scope=(target={},items=[{kind:"acrylic"}])=>({placed_at:"2026-11-04T07:59Z",single_item_scope:items.length===1,target:{quantity:1,colour:"Gold",size:"A6",...target},items});
const cases=[
 ["initial no age",scope(),[m("a","tulis A & L")],r=>{assert.equal(r.wording,"A & L");assert.equal(r.ready,true);assert.equal(r.needs_fallback,false);}],
 ["initial after checkout trigger and edible topic",scope({},{kind:"x"}),[],()=>{}],
 ["mixed acrylic and printed",scope({},[{kind:"acrylic"},{kind:"printed"}]),[m("a","A6 acrylic gold"),m("b","Aina & Eddy"),m("c","tukar kuromi"),m("d","Sample Child\nTurns3")],r=>assert.equal(r.wording,"Aina & Eddy")],
 ["material answer after wording",scope({},[{kind:"acrylic"},{kind:"printed"}]),[m("a","artpaper ke acrylic","outbound"),m("b","Aina & Eddy"),m("c","Axrylic")],r=>assert.equal(r.wording,"Aina & Eddy")],
 ["four distinct units",scope({quantity:4},[{kind:"acrylic"},{kind:"acrylic"}]),[m("a","topper gold size A6\nN&A\nA&D\nMira & Adam\nHana & Zaid")],r=>{assert.equal(r.units.length,4);assert.equal(r.units[3].wording,"Hana & Zaid");assert.equal(r.ready,true);}],
 ["correction exact target",scope({wording:"number 70"}),[m("a","This...number 3.. the topper number is 50.. not 70")],r=>{assert.equal(r.wording,"50");assert.equal(r.corrections[0].old,"70");}],
 ["cake measurement not wording",scope({wording:"custom 7inch kek"}),[m("a","size 7inch"),m("b","#ok initial apa?","outbound"),m("c","F&R")],r=>assert.equal(r.wording,"F&R")],
 ["ambiguous competing names held",scope(),[m("a","A & B"),m("b","C & D")],r=>{assert.equal(r.ready,false);assert(r.conflicts.includes("CONFLICTING_WORDING"));}],
 ["no customer detail uses no AI",scope(),[m("a","Hi seller")],r=>{assert.equal(r.ready,false);assert.equal(r.needs_fallback,false);}],
 ["reference image needs vision",scope(),[m("a","inspo acrylic"),m("b","[Image]","inbound",0,{message_type:"image",media_url:"https://img.sp.mms.shopee.sg/example"}),m("c","huruf A&A")],r=>{assert.equal(r.wording,"A&A");assert.equal(r.needs_vision,true);assert.equal(r.ready,false);}],
 ["future inquiry excluded",scope(),[m("a","A & B"),m("b","salam nak order topper lain", "inbound",48),m("c","C & D","inbound",48.1),m("d","nanti saya nk order hujung bulan","inbound",48.2)],r=>{assert.equal(r.wording,"A & B");assert.equal(r.excluded_later_count,3);}],
];
cases.splice(1,1);
for(const [name,s,messages,test] of cases){const r=acrylicRules(s,messages);test(r);console.log("PASS",name);}
const s=scope({},[{kind:"acrylic"},{kind:"edible"}]);
const r=acrylicRules(s,[m("i","nak topper design tu boleh","inbound",0,{message_type:"image",media_url:"wasapflow-media://1234"}),m("p","HARGA ACRYLIC CAKE TOPPER","outbound"),m("z","nak edible juga"),m("e","[Image]","inbound",0,{message_type:"image",media_url:"wasapflow-media://5678"}),m("q","initial apa?","outbound"),m("a","F&R")]);
assert.equal(r.wording,"F&R");assert.equal(r.references.length,1);assert.equal(r.references[0].id,"i");console.log("PASS mixed images and late initial");

