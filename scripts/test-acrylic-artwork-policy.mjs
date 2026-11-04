import assert from "node:assert/strict";
import {mergeAI} from "../supabase/functions/clickup-order-brief/acrylic.ts";
const base={messages:[{id:"im",direction:"inbound",message_type:"image",text_content:"[Image]"}],units:[],quantity:1,missing:["wording"],conflicts:[],colour:"Gold",size:"A7",instruction:""};
const ai={ok:true,artwork_kind:"ready_black_artwork",units:[{wording:"Test & Pair",evidence_ids:["im"]}],image_message_ids:["im"],failed_image_ids:[],needs_review:false,confidence:94,instruction:"",image_description:"black artwork"};
const result=mergeAI(base,ai,{note:"",target:{}});
assert(result.ready);assert(result.use_original_artwork);assert(result.wording_transcription_unverified);
for(const phrase of ["contoh","sample","tukar nama"]){
 const r=mergeAI({...base,messages:[...base.messages,{id:"txt",direction:"inbound",text_content:phrase}]},ai,{note:"",target:{}});
 assert(!r.ready);
}
assert(!mergeAI(base,{...ai,artwork_kind:"photo"},{note:"",target:{}}).ready);
console.log("PASS final black artwork and four exclusions");
