import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chooseKnowledge,formal,styleFeatures,styleReply,safeWording,knowledgeReply,learnReplies} from '../supabase/functions/_shared/reply-knowledge.ts';
const seed=JSON.parse(await readFile('supabase/knowledge/reply-knowledge-seed.json','utf8'));
const articles=seed.filter(x=>x.publish).map((x,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,published:x.draft,published_version:1}));
const id=articles.find(x=>x.published.title.includes('boleh makan')).id;
for(const channel of ['whatsapp','shopee']){
 assert.equal(chooseKnowledge('edible image boleh makan ke?',articles,channel).id,id);
 assert.equal(chooseKnowledge('boleh makan ke?',articles,channel,'saya nak edible').id,id);
 assert.equal(chooseKnowledge('boleh makan ke?',articles,channel),null,'Do not assume an edible product');
 assert.match(chooseKnowledge('burn away combo dapat apa?',articles,channel).published.answer,/dua cetakan/);
 assert.match(chooseKnowledge('macam mana nak order?',articles,channel).published.answer,/kuantiti/);
 assert.equal(chooseKnowledge('halal ada sijil ke?',articles,channel),null);
 assert.equal(chooseKnowledge('Acrylic A6 urgent berapa harga?',articles,channel),null);
 assert.equal(chooseKnowledge('petak 4 inci harga?',articles,channel),null);
}
assert.equal(chooseKnowledge('edible boleh makan?',articles.map(a=>({...a,published:{...a.published,channels:['shopee']}})),'whatsapp'),null);
assert.equal(chooseKnowledge('edible boleh makan?', [...articles,articles.find(a=>a.id===id)],'shopee'),null,'Ambiguous exact matches fail closed');
assert.equal(formal('nak bagi detail tapi tak dah'), 'ingin berikan detail tapi tidak sudah');
assert.equal(styleReply('Kami boleh hantar wording.',{enabled:true,preferences:{pronoun:'saya',request:'berikan',greeting:'Baik,',closing:'Terima kasih.'}}),'Baik, saya boleh berikan wording. Terima kasih.');
assert.equal(styleReply('Kami boleh hantar wording.',{enabled:false,preferences:{pronoun:'saya'}}),'Kami boleh hantar wording.');
assert.equal(safeWording('Baik, saya boleh berikan wording. Terima kasih.','Kami boleh hantar wording.'),'Baik, saya boleh berikan wording. Terima kasih.');
for(const actual of ['Kami boleh hantar wording. Harga RM10.','Kami boleh hantar wording ke 60123456789.','Kami tidak boleh hantar wording.','Kami boleh hantar wording. Dijamin siap esok.'])assert.equal(safeWording(actual,'Kami boleh hantar wording.'),null);
assert.equal(safeWording('Harga RM11.','Harga RM10.'),null);
assert.deepEqual(styleFeatures('Baik, saya boleh berikan maklumat. Terima kasih.'),{pronoun:'saya',request:'berikan',greeting:'Baik,',closing:'Terima kasih.'});
const c={id:'33333333-3333-4333-8333-333333333333',channel:'shopee',inbound_revision:'rev',messages:[{direction:'inbound',text_content:'edible image boleh makan ke?',created_at:new Date().toISOString()}]};
const reads=[],writes=[];
const read=async p=>{reads.push(p);if(p.startsWith('reply_knowledge?'))return articles;if(p.startsWith('reply_style?'))return[{enabled:true,preferences:{},version:3}];return[];};
const rpc=async(n,b)=>{writes.push([n,b]);return{};};
const reply=await knowledgeReply(c,{intent:'enquiry',suggestion:'generic'},read,rpc);assert.equal(reply.knowledge_sources[0].id,id);assert.match(reply.text,/icing paper/);assert.equal(writes.length,1);
for(const intent of ['complaint','shipping','payment','followup']){reads.length=0;const r=await knowledgeReply(c,{intent,suggestion:'Runtime order status'},read,rpc);assert.equal(r.text,'Runtime order status');assert.equal(r.knowledge_sources.length,0);assert.ok(!reads.some(p=>p.startsWith('reply_knowledge?')));}
reads.length=0;assert.equal((await knowledgeReply({...c,messages:[{direction:'inbound',text_content:'ok tq'}]},{intent:'other',suggestion:''},read,rpc)).text,'');assert.ok(!reads.some(p=>p.startsWith('reply_knowledge?')));
const item={message_id:'44444444-4444-4444-8444-444444444444',conversation_id:c.id,channel:c.channel,source:'icetak-panel',sender_type:'seller',is_history:false,status:'sent',actual:'Baik, saya boleh berikan maklumat.',sent_at:new Date().toISOString()};
writes.length=0;await learnReplies([item],read,rpc);assert.equal(writes[0][0],'reply_style_learn');assert.equal(writes[0][1].p_data.features.pronoun,'saya');assert.equal(writes[0][1].p_data.wording,null);
for(const invalid of [{source:'icetak_api'},{sender_type:'system'},{status:'failed'},{is_history:true},{channel:'fake'}])await assert.rejects(()=>learnReplies([{...item,...invalid}],read,rpc));
console.log('PASS: seeded FAQ retrieval, channel/product/ambiguity guards, unpublished price/certification exclusion, formal language, exact fact-preserving wording, runtime order precedence, no acknowledgement retrieval, confirmed-human learning guards.');
