import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const oldScript=readFileSync('scripts/apply-acrylic-proof-v2.mjs','utf8');
const start=oldScript.indexOf('const changes=')+'const changes='.length;
const end=oldScript.indexOf(';\nconst hash=',start);
const changes=JSON.parse(oldScript.slice(start,end));
const baseline='e854160fb6977d61bad14cf7fb4b459c55513f6a';
const hash=b=>createHash('sha256').update(b).digest('hex');
const originals={},patched={};
for(const c of changes){
 const b=execFileSync('git',['show',baseline+':'+c.path]);assert.equal(hash(b),c.before);
 let next=b;for(const [off,len,text] of [...c.edits].reverse())next=Buffer.concat([next.subarray(0,off),Buffer.from(text),next.subarray(off+len)]);
 assert.equal(hash(next),c.after);originals[c.path]=b.toString();patched[c.path]=next.toString();
}
function once(s,a,b){assert.equal(s.split(a).length,2,'Unique source anchor required: '+a.slice(0,90));return s.replace(a,b);}
function section(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);}
const rp='supabase/functions/clickup-order-brief/acrylic-rules.ts',ap='supabase/functions/clickup-order-brief/acrylic.ts';
let r=readFileSync(rp,'utf8'),a=readFileSync(ap,'utf8');
assert.ok(r.includes('checkout-order-header-v7'),'Expected reconciled live revision');
r=once(r,'export const ACRYLIC_RULES_REVISION = "checkout-order-header-v7";','export const ACRYLIC_RULES_REVISION = "checkout-order-header-v8-proof";');
const helpers=section(patched[rp],'export const ACRYLIC_EVIDENCE_POLICY','const stamp');
r=once(r,'const stamp',helpers+'const stamp');
r=once(r,section(originals[rp],'function pair(s: string)','function topic'),section(patched[rp],'function pair(s: string)','function topic'));
r=once(r,'const p=pair(note), explicit=','const p=nameDateNote(note)||pair(note), explicit=');
r=once(r,'if(note && !placeholder(note) && (scope.single_item_scope || items.length===1))','if(note && !placeholder(note) && !isDesignInstruction(note) && (scope.single_item_scope || items.length===1))');
r=once(r,'if(existing && !placeholder(existing) && !','if(existing && !placeholder(existing) && !isDesignInstruction(existing) && !');
r=once(r,'  const p=pair(s), askedInitial=','  if(isDesignInstruction(s)){instructions.push(s.slice(0,450));continue;}\n  const p=pair(s), askedInitial=');
r=once(r,'(needsVision||conflicts.length>0||','(needsVision||conflicts.length>0||(!!note&&missing.includes("wording"))||');
a=once(a,'ACRYLIC_RULES_REVISION,norm,','ACRYLIC_RULES_REVISION,ACRYLIC_EVIDENCE_POLICY,isDesignInstruction,norm,');
a=once(a,section(originals[ap],'export function mergeAI','async function resolveReferenceLinks'),section(patched[ap],'export function mergeAI','async function resolveReferenceLinks'));
const extra=section(patched[ap],'A phrase such as Ini tulisan & font ya','Give a compact JSON result.');
a=once(a,'Give a compact JSON result.',extra+'Give a compact JSON result.');
a=once(a,'rules_revision:ACRYLIC_RULES_REVISION,artwork_policy:','rules_revision:ACRYLIC_RULES_REVISION,evidence_policy:ACRYLIC_EVIDENCE_POLICY,artwork_policy:');
const proofline=patched[ap].split('\n').find(x=>x.includes('Sebab keputusan AI:'));
a=once(a,'  "instruction: "+(r.instruction||"—"),',proofline+'\n  "instruction: "+(r.instruction||"—"),');
// Preserve the established multi-unit checkout proof parser, not substring guesses.
a=once(a,'isDesignInstruction,norm,','isDesignInstruction,parseCheckoutUnits,norm,');
a=once(a,'if(id==="buyer_note")return !!scope.note&&exactText(scope.note,u.wording);','if(id==="buyer_note")return !!scope.note&&exactText(scope.note,u.wording);');
// The replacement above occurs twice; handle both explicitly below in the final checked code.
writeFileSync(rp,r);writeFileSync(ap,a);
const testStart=oldScript.indexOf('const {acrylicRules}=await import');
assert.ok(testStart>0);
const testPath='scripts/.acrylic-proof-regression.mjs';
writeFileSync(testPath,"import assert from 'node:assert/strict';\n"+oldScript.slice(testStart));
try{execFileSync(process.execPath,['--experimental-strip-types',testPath],{stdio:'inherit'});}finally{unlinkSync(testPath);}
console.log('Reconciled live modules patched and regression-tested');
