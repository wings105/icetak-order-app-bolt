type Data=Record<string,any>;
export const formal=(text:string)=>text.replace(/\bnk\b|\bnak\b/gi,'ingin').replace(/\bdh\b|\bdah\b/gi,'sudah').replace(/\btp\b/gi,'tetapi').replace(/\btak\b/gi,'tidak').replace(/\bbagi\b/gi,'berikan').replace(/\bkn\b/gi,'kan').replace(/\bxde\b/gi,'tiada');
const norm=(s:string)=>formal(s.toLowerCase()).replace(/\b(?:saya|kami)\b/g,'kami').replace(/\b(?:hantar|berikan)\b/g,'berikan').replace(/^(?:baik|salam|assalamualaikum)[,.!\s]+/,'').replace(/terima kasih[.!\s]*$/,'').replace(/[^a-z0-9]+/g,' ').trim();
export function styleFeatures(text:string){
 const features:Data={};
 if(/\bsaya\b/i.test(text))features.pronoun='saya';else if(/\bkami\b/i.test(text))features.pronoun='kami';
 if(/\bberikan\b/i.test(text))features.request='berikan';else if(/\bhantar\b/i.test(text))features.request='hantar';
 features.greeting=/^baik[,!.\s]/i.test(text)?'Baik,':/^assalamualaikum[.!\s]/i.test(text)?'Assalamualaikum.':/^salam[.!\s]/i.test(text)?'Salam.':'none';
 features.closing=/terima kasih[.!\s]*$/i.test(text)?'Terima kasih.':'none';
 return features;
}
export function styleReply(text:string,profile:Data={}){
 if(!text)return '';
 let result=formal(text);const p=profile.enabled===false?{}:profile.preferences||{};
 if(p.pronoun)result=result.replace(/\b(?:saya|kami)\b/gi,p.pronoun);
 if(p.request)result=result.replace(/\b(?:hantar|berikan)\b/gi,p.request);
 if(p.greeting&&p.greeting!=='none'&&!/^(baik|salam|assalamualaikum|maaf)\b/i.test(result))result=p.greeting+' '+result;
 if(p.closing==='Terima kasih.'&&!/terima kasih[.!\s]*$/i.test(result))result+=' Terima kasih.';
 return result;
}
export function safeWording(actual:string,base:string){
 // Exact fact-preserving equivalence after a small whitelist of stylistic substitutions.
 return actual.length<=4000&&norm(actual)===norm(base)&&!/https?:|www\.|\b\d{7,}\b|@[a-z0-9]/i.test(actual)?formal(actual):null;
}
const stops=new Set('apa yang ni ini itu tu ke ker ka kah lah la eh kan boleh untuk dengan dan saya kami awak ada nak ingin macam mana bagaimana berapa boleh produk please hi hello'.split(' '));
export function tokens(text:string){return formal(text.toLowerCase()).replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>1&&!stops.has(x));}
export function chooseKnowledge(query:string,articles:Data[],channel:string,context=''){
 const q=new Set(tokens(query));if(!q.size)return null;
 const ranked=articles.filter(a=>a.published?.channels?.includes(channel)).map(a=>{
  const d=a.published;const title=new Set(tokens(d.title));const keys=new Set(tokens((d.keywords||'')+' '+d.title));
  const hits=[...q].filter(x=>keys.has(x));let score=hits.length/q.size;
  const exact=String(d.aliases||'').split('\n').map((x:string)=>tokens(x).join(' ')).filter(Boolean).includes(tokens(query).join(' '));
  if(exact)score=2;
  if(title.size&&hits.length===0)score=0;
  if(d.product_scope){const scope=String(d.product_scope).split(',').map((x:string)=>x.trim().toLowerCase()).filter(Boolean);if(scope.length&&!scope.some((s:string)=>(query+' '+context).toLowerCase().includes(s)))score=0;}
  return {article:a,score,hits:hits.length};
 }).filter(r=>r.score>=0.6&&(r.hits>=2||r.score===2||q.size===1)).sort((a,b)=>b.score-a.score||b.hits-a.hits);
 if(!ranked.length||ranked[1]&&ranked[0].score===ranked[1].score&&ranked[0].hits===ranked[1].hits)return null;
 return ranked[0].article;
}
export async function knowledgeReply(c:Data,analysis:Data,read:(path:string)=>Promise<Data[]>,rpc?:(name:string,body:unknown)=>Promise<any>){
 const messages=(c.messages||[]).filter((m:Data)=>m.direction==='inbound').slice(-5);
 const latest=messages.at(-1);const query=String(latest?.text_content||latest?.caption||'');
 // Order status, payment and complaints stay with canonical runtime evidence.
 const acknowledgement=analysis.acknowledgement||/^(?:(?:ok(?:ay|ey)?|baik|terima kasih|tq+|thanks?|thank you|ya|ye)[\s,.!🙏👍😊]*)+$/i.test(query);
 const eligible=query&&query.length<=1000&&!acknowledgement&&!/\bharga\b|\bprice\b|\brm\s*\d/i.test(query)&&!['complaint','shipping','payment','followup'].includes(analysis.intent)&&!(/^(ok(?:ay)?|tq|terima kasih|baik)[\s,.!]*$/i.test(query));
 const [profiles,articles]=await Promise.all([read(`reply_style?channel=eq.${c.channel}&select=enabled,preferences,version,samples&limit=1`),eligible?read('reply_knowledge?published=not.is.null&select=id,published,published_version&order=updated_at.desc&limit=200'):Promise.resolve([])]);
 const profile=profiles[0]||{};const cutoff=Date.parse(latest?.created_at||'')-48*3600000;
 const context=messages.filter((m:Data)=>Date.parse(m.created_at||'')>=cutoff).map((m:Data)=>m.text_content||m.caption||'').join(' ');
 const article=eligible?chooseKnowledge(query,articles,c.channel,context):null;
 let text=analysis.suggestion;let sources:Data[]=[];
 if(article){text=article.published.answer;sources=[{id:article.id,version:article.published_version,title:article.published.title,source:article.published.source}];
  if(profile.enabled!==false){const variants=await read(`reply_wording?article_id=eq.${article.id}&article_version=eq.${article.published_version}&channel=eq.${c.channel}&uses=gte.3&select=text&limit=1`);if(variants[0]&&safeWording(variants[0].text,text))text=variants[0].text;}
 }
 text=styleReply(text,profile);
 if(text&&rpc)await rpc('reply_suggestion_remember',{p_data:{conversation_id:c.id,inbound_revision:String(c.inbound_revision||''),text,article_id:article?.id||null,article_version:article?.published_version||null}});
 return {text,knowledge_sources:sources,style_version:profile.version||0,engine:sources.length?'Knowledge + SOP':'SOP + gaya balasan'};
}
export async function learnReplies(items:Data[],read:(path:string)=>Promise<Data[]>,rpc:(name:string,body:unknown)=>Promise<any>){
 const results=[];
 for(const item of items){
  if(!/^[0-9a-f-]{36}$/i.test(item.message_id||'')||!/^[0-9a-f-]{36}$/i.test(item.conversation_id||'')||!['whatsapp','shopee'].includes(item.channel)||typeof item.actual!=='string'||!item.actual.trim()||item.actual.length>4000)throw Error('INVALID_LEARNING_EVENT');
  if(!['icetak-panel','admin-ai-dashboard','api','business_app'].includes(item.source)||item.sender_type!=='seller'||item.is_history===true||!['sent','delivered','read'].includes(item.status))throw Error('NOT_A_HUMAN_REPLY');
  const [snapshot]=await read(`reply_suggestion_latest?conversation_id=eq.${item.conversation_id}&select=*&limit=1`);let article:Data|undefined,wording=null;
  const drafts=snapshot?.drafts||[];
  const generated=snapshot?.text?.trim()===item.actual.trim()||drafts.some((d:Data)=>d.text?.trim()===item.actual.trim());
  const draft=[...drafts].reverse().find((d:Data)=>d.article_id&&Date.parse(d.created_at)>Date.now()-86400000&&Date.parse(item.sent_at)>=Date.parse(d.created_at));
  if(draft&&!generated){
   [article]=await read(`reply_knowledge?id=eq.${draft.article_id}&published_version=eq.${draft.article_version}&select=id,published,published_version&limit=1`);
   if(article)wording=safeWording(item.actual,article.published.answer);
  }
  results.push(await rpc('reply_style_learn',{p_data:{...item,generated,features:styleFeatures(item.actual),wording,article_id:wording?article?.id:null,article_version:wording?article?.published_version:null}}));
 }
 return {ok:true,results};
}
