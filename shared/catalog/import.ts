export type SheetRow={row:number;cells:Record<string,string>};
export type ExportSheet={name:string;rows:SheetRow[]};
export type Model={model_id:string;name:string;sku:string;price:number;stock:number;image_url:string;direct_prices:Record<string,string>};
export type ImportProduct={item_id:string;sku:string;name:string;description:string;category:string;image_url:string;images:string[];price:number;models:Model[];options:Array<{name:string;image_url:string}>};
const str=(x:unknown)=>String(x??'').trim();
const id=(x:unknown)=>{const v=str(x);if(!/^\d+$/.test(v))throw Error('ID Shopee tidak sah');return v;};
const num=(x:unknown)=>{const n=Number(x);if(str(x)===''||!Number.isFinite(n)||n<0)throw Error('Harga / stok tidak sah');return n;};
const col=(n:number)=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function normalizeExports(sheets:ExportSheet[],expectedShop?:string){
 const maps:Record<string,Map<string,Record<string,string>[]> >= {basic_info:new Map(),media_info:new Map(),sales_info:new Map()};let shop='';
 for(const sheet of sheets){const h=sheet.rows.find(x=>x.row===2)?.cells||{};const kind=str(h.A);if(!maps[kind])continue;
  const s=id(h.D);if(shop&&shop!==s||expectedShop&&s!==expectedShop)throw Error('Fail daripada shop berlainan');shop=s;
  for(const {row,cells:c} of sheet.rows){if(row<7||!/^\d+$/.test(str(c.A)))continue;const key=id(c.A);const list=maps[kind].get(key)||[];list.push(c);maps[kind].set(key,list);}
 }
 if(!shop||Object.values(maps).some(m=>!m.size))throw Error('Pilih basic info, media info dan sales info lengkap (ZIP diterima).');
 const products:ImportProduct[]=[];
 for(const [item,bs] of maps.basic_info){if(bs.length!==1||maps.media_info.get(item)?.length!==1||!maps.sales_info.has(item))throw Error('Fail bertindih atau produk tidak lengkap: '+item);
  const b=bs[0],m=maps.media_info.get(item)![0];if(str(b.C)!==str(m.C))throw Error('Tajuk fail tidak sepadan: '+item);
  const images=[m.E,...Array.from({length:8},(_,i)=>m[col(6+i)])].map(str).filter(Boolean);
  if(images.some(u=>!/^https:\/\//.test(u))||!images.length)throw Error('URL gambar tidak sah: '+item);
  const options=Array.from({length:20},(_,i)=>({name:str(m[col(17+i*2)]),image_url:str(m[col(18+i*2)])})).filter(o=>o.name);
  const seen=new Set<string>();const models=maps.sales_info.get(item)!.map(c=>{const model=id(c.C);if(seen.has(model))throw Error('Model berulang: '+model);seen.add(model);
   const parts=str(c.D).split(',').map(str);const matches=options.filter(o=>o.image_url&&parts.includes(o.name));const image=matches.length===1?matches[0].image_url:images[0];
   const stock=num(c.L);if(!Number.isInteger(stock))throw Error('Stok bukan integer');
   return {model_id:model,name:str(c.D),sku:str(c.F)==='.'?'':str(c.F),price:num(c.G),stock,image_url:image,direct_prices:{PHP:str(c.H),SGD:str(c.I),THB:str(c.J)}};
  });
  products.push({item_id:item,sku:str(b.B),name:str(b.C),description:str(b.D),category:str(m.D),image_url:images[0],images:[...new Set(images)],price:Math.min(...models.map(x=>x.price)),models,options});
 }
 if(Object.values(maps).some(m=>m.size!==products.length))throw Error('Senarai product ID antara fail tidak sama');
 return {shop_id:shop,products,model_count:products.reduce((n,p)=>n+p.models.length,0)};
}
