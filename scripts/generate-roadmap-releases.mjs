/**
 * Build-time read-only release feed from production CHANGELOG.md.
 * This never touches Supabase, customer data, or item status.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const raw=readFileSync(resolve(root,'CHANGELOG.md'),'utf8');
const rules=[
  {code:'IC-014',category:'orders',rx:/task workspace|side panel|sidepanel/i},
  {code:'IC-018',category:'inbox',rx:/AI (?:Action )?Dashboard|designer workspace|Task & design/i},
  {code:'IC-049',category:'inbox',rx:/shopee (?:reply|chat|read receipt)|provider readback|needs_reply/i},
  {code:'IC-020',category:'inbox',rx:/order cards|product cards|native Shopee card/i},
  {code:'IC-021',category:'inbox',rx:/inbox.*(?:search|active orders|to ship|category|deadline|urgent|lifecycle)|conversation header/i},
  {code:'IC-022',category:'inbox',rx:/reply suggestions|inline suggestion|suggestion cost/i},
  {code:'IC-046',category:'inbox',rx:/Knowledge|FAQ|style learning/i},
  {code:'IC-050',category:'inbox',rx:/sticker|image composer/i},
  {code:'IC-051',category:'inbox',rx:/WhatsApp API outbound|Inbox logging/i},
  {code:'IC-052',category:'automation',rx:/24.hour.*window|WhatsApp safety|opt.out/i},
  {code:'IC-047',category:'shopee',rx:/Shopee webhook recovery|Shop.*Monitor|Shopee.*operations/i},
  {code:'IC-048',category:'shopee',rx:/Shopee SG|SG token|SGD wallet/i},
  {code:'IC-011',category:'shopee',rx:/catalogue.*Shopee|shared Shopee|products uses a compact|2,004 MY listings/i},
  {code:'IC-042',category:'orders',rx:/storefront|catalogue.*purchase|glossy product purchase|customer purchase sheet/i},
  {code:'IC-043',category:'design',rx:/Cake Mockup|edible sizes, shapes/i},
  {code:'IC-065',category:'design',rx:/SKU renderer|PNG renderer|template renderer/i},
  {code:'IC-027',category:'production',rx:/stock management|material stock/i},
  {code:'IC-028',category:'production',rx:/acrylic.*production|standalone acrylic/i},
  {code:'IC-054',category:'orders',rx:/ClickUp job|production queue.*CF|custom.fields/i},
  {code:'IC-055',category:'orders',rx:/AWB reference|Print AWB/i},
  {code:'IC-056',category:'automation',rx:/task.detail worker|detail automation|task readiness|task customer.detail/i},
  {code:'IC-058',category:'orders',rx:/SPX tracking|customer tracking|courier status/i},
  {code:'IC-057',category:'orders',rx:/Customer.*CRM|address.*merge|phone reconcile/i},
  {code:'IC-044',category:'finance',rx:/Business Command Center/i},
  {code:'IC-045',category:'orders',rx:/Customer Focus|Fokus Customer/i},
  {code:'IC-059',category:'finance',rx:/Sales SKU|Acrylic colour filters/i},
  {code:'IC-060',category:'finance',rx:/contribution target|overhead/i},
  {code:'IC-038',category:'finance',rx:/Shopee order finance|order contribution|material settings|full Shopee/i},
  {code:'IC-064',category:'finance',rx:/QRPay|unmatched payment/i},
  {code:'IC-023',category:'inbox',rx:/WhatsApp username/i},
  {code:'IC-024',category:'automation',rx:/auto.cancel|quotation.*cancel|draft follow.up/i},
  {code:'IC-040',category:'orders',rx:/draft engine|draft.to.order|prepaid chat|customer checkout/i},
  {code:'IC-053',category:'automation',rx:/webhook backup|missing.order/i},
  {code:'IC-035',category:'automation',rx:/completeness|detail evidence|per.task missing/i}
];
const lines=raw.split(/\r?\n/);
let date='',sectionTitle='',sequence=0;
const releases=[];
for(let idx=0;idx<lines.length;idx++){
 const line=lines[idx];
 if(/^#{1,3}\s/.test(line)){
   const heading=line.replace(/^#{1,3}\s*/,'').trim();
   const match=heading.match(/\b(20\d\d-\d{2}-\d{2})\b/);
   if(match)date=match[1];
   sectionTitle=heading.replace(/^20\d\d-\d{2}-\d{2}\s*(?:[—:-]\s*)?/,'').trim()||'Release notes';
   continue;
 }
 if(!/^-\s+/.test(line) || line.length<30)continue;
 const rawBody=line.slice(2).trim();
 if(!/^\[(?:PRODUCTION|VERIFIED|ATTEMPTED|PLANNED|BUILDING|IN PROGRESS|RELEASE)/i.test(rawBody))continue;
 const stage=rawBody.match(/^\[([^\]]+)\]/)?.[1]||'Release';
 const summary=rawBody
   .replace(/^\[[^\]]+\]\s*/,'')
   .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
   .replace(/\x60([^\x60]+)\x60/g,'$1')
   .replace(/\s+/g,' ').trim();
 const matching=rules.filter(r=>r.rx.test(sectionTitle+' '+summary)).slice(0,3);
 releases.push({
   id:'changelog-L'+(idx+1),line:idx+1,date:date||null,
   heading:sectionTitle||'Release note',stage:stage.slice(0,75),
   summary:summary.slice(0,850),
   feature_codes:matching.map(r=>r.code),
   category:matching[0]?.category||'general',
   source_url:'https://github.com/wings105/icetak-order-app-bolt/blob/production/CHANGELOG.md#L'+(idx+1),
   order:sequence++
 });
}
releases.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.order-b.order);
const output={source:'CHANGELOG.md',generated_at:new Date().toISOString(),total:releases.length,releases};
mkdirSync(resolve(root,'public'),{recursive:true});
writeFileSync(resolve(root,'public/roadmap-changelog.json'),JSON.stringify(output,null,2)+'\n','utf8');
if(releases.length<50)throw new Error('Refusing unexpectedly incomplete changelog release index');
console.log('Roadmap changelog feed:',releases.length,'release records; latest',releases[0]?.date);
