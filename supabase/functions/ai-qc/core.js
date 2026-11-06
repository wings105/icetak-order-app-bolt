export const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
export function verdict(result,expected){
 if(!result||!Object.keys(expected).length||!Array.isArray(result.observed)||result.observed.some(v=>typeof v.field!=='string'||typeof v.text!=='string')||!Array.isArray(result.issues)||result.issues.some(x=>typeof x!=='string'))return {state:'HOLD',reason:'INVALID_VISION_RESULT'};
 if(result.issues.length||result.customer_matches!==true||result.layout_ok!==true||result.text_readable!==true||result.no_extra_text!==true)return {state:result.customer_matches===false?'FAIL':'HOLD',reason:'QC_ISSUES',vision:result};
 if(result.observed.length!==Object.keys(expected).length||Object.entries(expected).some(([field,text])=>result.observed.filter(v=>v.field===field&&norm(v.text)===norm(text)).length!==1))return {state:'FAIL',reason:'VISIBLE_TEXT_MISMATCH',vision:result};
 return {state:'PASS',reason:'ALL_CHECKS_PASSED',vision:result};
}
export function sourceGuard(job,current,brief,template){return job.state==='completed'&&current?.state==='completed'&&current.source_hash===job.source_hash&&current.attachment_id===job.attachment_id&&current.filename===job.filename&&brief?.state==='completed'&&brief.brief?.confirmed===true&&brief.brief.wording===job.brief.wording&&!brief.brief.pending_change_ids?.length&&!brief.brief.change_detected&&template?.version===job.template_version;}
