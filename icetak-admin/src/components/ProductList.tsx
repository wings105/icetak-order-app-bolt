import {Fragment,useEffect,useRef,useState} from 'react';

export type ProductRow={
 id:string;display_name:string;parent_sku:string|null;main_image_url:string|null;is_published:boolean;
 item_id?:string;shop_id?:string;listing_id?:string;provider_status?:string;revision?:number;updated_at?:string;last_verified_at?:string;
 model_count:number;base_price:number|null;
 shopee_summary?:{price_min:number|null;price_max:number|null;stock:number|null;captured_at:string|null};
};
export type ProductModelRow={id:string;model_id?:string;name:string;sku?:string;image?:string;price:number|null;stock:number|null;website_price:number|null};
export const productMoney=(value:number|null|undefined)=>value==null?'—':`RM${Number(value).toFixed(2)}`;
export const productStatus=(value?:string)=>({NORMAL:'Aktif',UNLIST:'Tidak aktif',BANNED:'Disekat',DELETED:'Dipadam',UNKNOWN:'Belum disemak'}[value||'UNKNOWN']||value);
function ProductImage({src,size=56}:{src?:string|null;size?:number}){
 const [failed,setFailed]=useState(false);
 return <span className="product-list-image" style={{width:size,height:size}}>{src&&!failed?<img src={src} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span aria-label="Tiada gambar">▧</span>}</span>;
}
function ProductLine({row,owner,busy,onOpen,loadModels,selected,onSelect}:{row:ProductRow;owner:boolean;busy:boolean;onOpen:(id:string)=>void;loadModels:(id:string)=>Promise<ProductModelRow[]>;selected:boolean;onSelect:()=>void}){
 const [expanded,setExpanded]=useState(false),[models,setModels]=useState<ProductModelRow[]|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const toggle=async()=>{if(expanded){setExpanded(false);return;}setExpanded(true);if(models||loading)return;setLoading(true);setError('');try{const data=await loadModels(row.id);if(mounted.current)setModels(data);}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setLoading(false);}};
 const summary=row.shopee_summary;const price=summary?.price_min==null?'—':summary.price_max!==summary.price_min?`${productMoney(summary.price_min)} – ${productMoney(summary.price_max)}`:productMoney(summary.price_min);
 return <Fragment><tr className={selected?'product-list-selected':''}>
  {owner&&<td className="product-list-check"><input aria-label={`Pilih ${row.display_name}`} type="checkbox" disabled={busy} checked={selected} onChange={onSelect}/></td>}
  <td className="product-list-product"><div className="product-list-identity"><button className="product-list-thumb" disabled={busy} aria-label={`Lihat ${row.display_name}`} onClick={()=>onOpen(row.id)}><ProductImage src={row.main_image_url}/></button><div className="product-list-copy"><button className="product-list-title" disabled={busy} onClick={()=>onOpen(row.id)}>{row.display_name}</button><p>Parent SKU: <span>{row.parent_sku||'—'}</span></p><p>Product ID: <span>{row.item_id||'—'}</span></p>{row.model_count>0&&<button className="product-list-expand" aria-expanded={expanded} aria-controls={`models-${row.id}`} disabled={loading} onClick={()=>void toggle()}><span aria-hidden="true">{expanded?'⌃':'⌄'}</span> {row.model_count} variasi</button>}</div></div></td>
  <td className="product-list-price"><strong>{price}</strong><small>Website: {productMoney(row.base_price)}</small></td>
  <td className="product-list-stock">{summary?.stock==null?'—':Number(summary.stock).toLocaleString()}</td>
  <td><span className={`product-list-badge ${row.listing_id?row.provider_status?.toLowerCase()||'unknown':'none'}`}>{row.listing_id?productStatus(row.provider_status):'Tiada listing'}</span>{row.last_verified_at&&<small className="product-list-date">Disemak {new Date(row.last_verified_at).toLocaleDateString('ms-MY')}</small>}</td>
  <td><span className={`product-list-badge ${row.is_published?'published':'draft'}`}>{row.is_published?'Diterbitkan':'Draf'}</span></td>
  <td className="product-list-actions"><button disabled={busy} onClick={()=>onOpen(row.id)}>{owner?'Edit':'Lihat'}</button>{row.item_id&&row.shop_id&&<a href={`https://shopee.com.my/product/${row.shop_id}/${row.item_id}`} target="_blank" rel="noreferrer">Buka Shopee ↗</a>}</td>
 </tr>{expanded&&<tr className="product-list-models"><td colSpan={owner?7:6}><div id={`models-${row.id}`} className="product-list-model-panel" aria-label={`Variasi ${row.display_name}`}>
  {loading?<p role="status">Memuatkan variasi…</p>:error?<div role="alert">{error} <button onClick={()=>void toggle()}>Tutup</button></div>:<table aria-label={`Senarai variasi ${row.display_name}`}><thead><tr><th>Variasi</th><th>SKU / Model ID</th><th>Harga Shopee</th><th>Stok Shopee</th><th>Harga website</th></tr></thead><tbody>{models?.map(m=><tr key={m.id}><td><div className="product-list-model-name"><ProductImage src={m.image} size={32}/><span>{m.name||'Default'}</span></div></td><td>{m.sku||'—'}<small>{m.model_id||'—'}</small></td><td>{productMoney(m.price)}</td><td>{m.stock==null?'—':m.stock.toLocaleString()}</td><td>{productMoney(m.website_price)}</td></tr>)}</tbody></table>}
 </div></td></tr>}</Fragment>;
}
export default function ProductList({rows,loading,busy,owner,total,filter,counts,onFilter,onOpen,onRefresh,loadModels}:{rows:ProductRow[];loading:boolean;busy:boolean;owner:boolean;total:number;filter:string;counts:Record<string,number>;onFilter:(value:string)=>void;onOpen:(id:string)=>void;onRefresh:(ids:string[])=>void;loadModels:(id:string)=>Promise<ProductModelRow[]>}){
 const [selected,setSelected]=useState<Set<string>>(()=>new Set());const selectedRows=rows.filter(r=>selected.has(r.id)),allSelected=rows.length>0&&selectedRows.length===rows.length;
 const refreshIds=selectedRows.flatMap(r=>r.listing_id?[r.listing_id]:[]);
 const tabs=[['','Semua'],['NORMAL','Aktif'],['UNLIST','Tidak aktif'],['BANNED','Disekat'],['UNKNOWN','Belum disemak']];
 return <section className="product-list" aria-label="Senarai produk">
 <div className="product-list-tabs" role="tablist" aria-label="Status produk Shopee">{tabs.map(([value,label])=><button role="tab" key={value} aria-selected={filter===value} onClick={()=>onFilter(value)}>{label}{counts[value||'ALL']!=null&&<span>{counts[value||'ALL'].toLocaleString()}</span>}</button>)}</div>
 <div className="product-list-info"><div><strong>{total.toLocaleString()} produk</strong><small>Harga & stok Shopee mengikut import / kemas kini terakhir.</small></div>{selectedRows.length>0&&<div className="product-list-selection"><span>{selectedRows.length} dipilih</span>{owner&&<button className="btn btn-outline btn-sm" disabled={busy||!refreshIds.length} onClick={()=>onRefresh(refreshIds)}>Semak status dipilih</button>}<button className="product-list-clear" onClick={()=>setSelected(new Set())}>Batal pilihan</button></div>}</div>
 <div className="product-list-scroll" tabIndex={0} aria-label="Jadual produk, leret untuk lajur seterusnya"><table className="product-list-table" aria-busy={loading}><thead><tr>{owner&&<th className="product-list-check"><input aria-label="Pilih semua produk halaman ini" type="checkbox" disabled={loading||busy} checked={allSelected} ref={el=>{if(el)el.indeterminate=selectedRows.length>0&&!allSelected;}} onChange={()=>setSelected(allSelected?new Set():new Set(rows.map(r=>r.id)))}/></th>}<th>Nama produk</th><th>Harga Shopee</th><th>Stok Shopee</th><th>Status Shopee</th><th>Website</th><th>Tindakan</th></tr></thead><tbody>{loading?<tr><td colSpan={owner?7:6} className="product-list-empty" role="status">Memuatkan produk…</td></tr>:rows.length?rows.map(row=><ProductLine key={`${row.id}:${row.revision}:${row.updated_at}`} row={row} owner={owner} busy={busy} selected={selected.has(row.id)} onSelect={()=>setSelected(previous=>{const next=new Set(previous);if(next.has(row.id))next.delete(row.id);else next.add(row.id);return next;})} onOpen={onOpen} loadModels={loadModels}/>):<tr><td colSpan={owner?7:6} className="product-list-empty">Tiada produk dijumpai.</td></tr>}</tbody></table></div>
 </section>;
}
