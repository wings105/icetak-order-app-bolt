import {P,price,burnawayPrice,edibleStyles} from './shop-options.ts';
import {PRODUCT_DETAILS} from './shop-details.ts';
type K=keyof typeof P;
const kinds:K[]=['burnaway','acrylic','mirror','wafer','edible','printed'];
const patterns=[/burn\s*-?\s*away|combo/,/acr[yie]lic|akrilik/,/mirror|artpaper gold/,/wafer/,/edible|icing/,/topper|printed|glossy/];
const slugs=['burn-away-combo','acrylic-cake-topper','mirror-gold-artpaper','wafer-paper','edible-image','cake-topper'];
const kind=(q:string)=>kinds[patterns.findIndex(r=>r.test(q))];
const link=(s:string)=>'https://shop.decocake.my/#/product/'+encodeURIComponent(s);
export async function productReply(input:string,context:string,rpc?:(n:string,b:any)=>Promise<any>){
 const q=input.toLowerCase().trim();if(!q||/refund|tracking|dah bayar|status order/.test(q))return '';
 const k=kind(q)||context.toLowerCase().split('\n').map(kind).find(Boolean);
 const buying=/harga|berapa|brp|brapa|price|hrga|how much|saiz|size|inci|inch|urgent|pre-order|bentuk|shape|warna|material|sesuai|cadang|spesifikasi|pilihan|tebal/.test(q);
 const code=q.match(/\b[a-z]{1,6}[-_]?\d{3,8}[a-z]?\b/i)?.[0];
 const terms=q.replace(/\d+(?:\.\d+)?\s*(?:inch|inci|cm)/g,' ').split(/[^a-z0-9]+/).filter(t=>t.length>1&&!/^(ada|ke|tak|nak|boleh|berapa|brp|harga|price|saiz|size|design|tema|theme|gambar|edible|image|wafer|cake|kek|topper|printed|glossy|acrylic|custom|untuk|yang|ready|stock|sku|kod|ya|ni|inch|inci)$/.test(t));
 if(rpc&&(code||terms.length&&(/tema|theme|design|katalog|ada .*topper/.test(q)||buying)&&!/(review|urgent|petak|square|bulat|hati|sesuai|cadang|shape|bentuk|warna)/.test(q))){
  const hits=await rpc('icetak_reply_product_search',{p_terms:terms.slice(0,8),p_code:code||''});
  if(Array.isArray(hits)&&hits.length)return hits.slice(0,3).map(h=>{const vs=h.variants||[];const prices=vs.map((v:any)=>Number(v.price));return h.name+' — '+(vs.length?(vs.length<=5?vs.map((v:any)=>v.name+' RM'+Number(v.price)).join(', '):'RM'+Math.min(...prices)+'–RM'+Math.max(...prices)+' ikut variasi'):'variasi belum tersedia')+'\n'+link(h.slug);}).join('\n\n');
  if(code)return 'Kod '+code.toUpperCase()+' belum dijumpai dalam katalog aktif. Boleh bagi pautan produk?';
 }
 if(!k)return /produk apa|cadang.*produk|jenis produk/.test(q)?kinds.map(key=>P[key].name+' — '+P[key].desc+' '+P[key].range).join('\n'):'';
 if(!buying)return '';
 const p=P[k],d=PRODUCT_DETAILS[k],url='\n'+link(slugs[kinds.indexOf(k)]);
 const dims=[...q.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:inch(?:es)?|inci|["″”])/g)].map(m=>Number(m[1].replace(',','.'))+' inch');
 const paper=q.match(/\ba[4567]\b/i)?.[0].toUpperCase();
 const size=paper?p.size.find(s=>s.startsWith(paper)):dims[0];
 const shape=/petak|square/.test(q)?'Square / Petak':/hati|love/.test(q)?'Love Shape / Hati':'Round / Bulat';
 if(/sesuai|cadang/.test(q)){const widths:Record<string,string>={'4 inch':'3.5–4.5','5 inch':'4–4.5','6 inch':'5–5.5','7 inch':'5.5–6','8 inch':'6–6.5'};return (['printed','acrylic','mirror'].includes(k)&&widths[dims[0]]?'Untuk kek '+dims[0]+', cadangan lebar topper '+widths[dims[0]]+' inci. ':k==='edible'?'Ukur ruang rata selepas hiasan tepi untuk pilih saiz edible. ':'')+d.specs.join('. ')+url;}
 if(/bentuk|shape/.test(q)&&!/berapa|harga/.test(q))return p.name+': '+(k==='wafer'||k==='edible'?edibleStyles(size||''):p.style).join(', ')+url;
 if(/warna|material|tebal|spesifikasi/.test(q))return d.intro+' '+d.specs.join('. ')+(k==='acrylic'?' Pilihan: '+p.style.join(', '):'')+url;
 if(!size&&/size|saiz/.test(q)&&!/harga|berapa/.test(q))return p.name+': '+p.size.join(', ')+'. '+d.specs.join('. ')+url;
 if(k==='printed')return 'Printed Cake Topper RM10 satu set. '+d.specs.slice(0,3).join('. ')+url;
 if(k==='mirror')return 'Mirror Gold Artpaper RM15 pre-order atau RM18 urgent. Maksimum A5.'+url;
 if((size&&!p.size.includes(size))||(paper&&!size)||/\d\s*(?:cm|[x×])/.test(q))return p.name+' tersedia dalam '+p.size.join(', ')+'. Untuk ukuran khas, boleh bagi bentuk, lebar dan tinggi?'+url;
 if(!size)return (k==='acrylic'?p.size.map(s=>s+' RM'+price(k,'Pre-order',s)+' pre-order / RM'+price(k,'Urgent',s)+' urgent').join('; '):p.name+' '+p.range+'. Nak saiz dan bentuk apa ya?')+url;
 if(k==='burnaway'){let a=size,b=dims[1]||a;if(/wafer.*\d.*edible.*\d/.test(q))[a,b]=[b,a];if(!p.size.includes(a)||![...p.size,'8 inch'].includes(b))return 'Boleh semak semula saiz edible bawah dan wafer atas?'+url;return 'Burn Away Combo: edible '+a+', wafer '+b+' RM'+burnawayPrice({edible:{size:a,shape},wafer:{size:b,shape}})+'.'+url;}
 if(k==='acrylic')return p.name+' '+size+' RM'+price(k,'Pre-order',size)+' pre-order atau RM'+price(k,'Urgent',size)+' urgent.'+url;
 const base=price(k,'Pre-order',size,shape),urgent=price(k,'Urgent',size,shape,'Need Review');
 if(k==='edible'&&size==='4 inch'&&!/petak|square|bulat|round|hati|love/.test(q))return 'Edible 4 inci: bulat atau hati RM6, petak RM12. Urgent dengan review: RM7 atau RM14 mengikut bentuk.'+url;
 return p.name+' '+size.replace(' inch',' inci')+' RM'+base+' sekeping. Kalau urgent dengan review design, RM'+urgent+' sekeping.'+url;
}
