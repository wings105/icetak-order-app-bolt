import assert from 'node:assert/strict';
import {mapFields,parseDetail,splitAge} from '../supabase/functions/autobrief-render/mapping.js';
const sources=['name','age_number','age_prefix','age_suffix'];
const template={config:{layers:sources.map(field=>({field,label:field})),automation:{enabled:true,inputs:Object.fromEntries(sources.map(source=>[source,{source,required:source==='name',default:''}]))}}};
for(const [wording,expected] of [
 ['Lily Turns 4',['Lily','4','Turns','']],
 ['Lily 4 tahun',['Lily','4','','tahun']],
 ['Lily 4 years old',['Lily','4','','years old']],
 ['AQILAH SOFIA 6 TAHUN',['AQILAH SOFIA','6','','TAHUN']],
 ['Lily 4',['Lily','4','','']],
 ['Lily',['Lily','','','']],
 ['Nama: Lily\nUmur: turns 4',['Lily','4','turns','']],
 ['Nama: Lily\nUmur: 4 years old',['Lily','4','','years old']]
]){
 const result=mapFields(template,{wording},wording);assert.equal(result.ok,true,wording+': '+result.reason);assert.deepEqual(Object.values(result.fields),expected,wording);
}
for(const wording of ['Ali 4 dan Abu 6 tahun','Lily 4 tahun tukar jadi 5','Happy Birthday Lily 4 tahun','Lily 4/5 tahun','Lily 4 elephants','Nama: Lily\nUmur: Yang Ke-4 Tahun'])assert.equal(mapFields(template,{wording},wording).ok,false,wording);
assert.equal(splitAge('4 YEARS OLD').age_suffix,'YEARS OLD');
assert.equal(parseDetail('Nama: Lily\nUmur: 4').age_number,'4');
// Existing full-age mapping keeps the original unit; no silent digit-only conversion.
const full=structuredClone(template);full.config.layers=[{field:'name'},{field:'age'}];full.config.automation.inputs={name:{source:'name',required:true,default:''},age:{source:'age',required:false,default:''}};
assert.deepEqual(mapFields(full,{},'AQILAH SOFIA 6 TAHUN').fields,{name:'AQILAH SOFIA',age:'6 TAHUN'});
console.log('PASS: exact name, number, conditional prefix/suffix, Malay/English/case preservation, optional age, ambiguous wording held');
