import { number } from './contracts';
import type { Breakdown, Trend } from './contracts';
export function Bars({rows,color='blue',onSelect}:{rows:Breakdown[];color?:string;onSelect?:(r:Breakdown)=>void}){
 const max=Math.max(1,...rows.map(r=>r.value));
 if(!rows.length)return <p className="cc-empty">Tiada rekod dalam skop ini.</p>;
 return <div className={`cc-bars ${color}`}>{rows.map((r,i)=>{
  const content=<><span className="cc-bar-label" title={r.label}>{r.label}</span><span className="cc-track"><span style={{width:`${r.value/max*100}%`}} /></span><b>{number(r.value)}</b></>;
  return onSelect?<button key={`${r.label}-${i}`} onClick={()=>onSelect(r)}>{content}</button>:<div className="cc-bar-row" key={`${r.label}-${i}`}>{content}</div>;
 })}</div>;
}
export function OrdersChart({rows,onDay}:{rows:Trend[];onDay?:(day:string)=>void}){
 const max=Math.max(1,...rows.map(r=>r.icetak+r.shopee));
 return <><div className="cc-chart-legend"><span><i className="blue"/> iCetak</span><span><i className="orange"/> Shopee</span></div><div className="cc-chart-scroll"><div className="cc-chart" style={{minWidth:rows.length>31?rows.length*20:undefined}}>
  <div className="cc-chart-grid"><span>{max}</span><span>{Math.round(max/2)}</span><span>0</span></div>
  <div className="cc-chart-columns">{rows.map((r,i)=><button className="cc-chart-column" key={r.date} title={`${r.date}: iCetak ${r.icetak}, Shopee ${r.shopee}`} aria-label={`Order ${r.date}: ${r.icetak+r.shopee}`} onClick={()=>onDay?.(r.date)}>
   <span className="cc-chart-stack"><span className="orange" style={{height:`${r.shopee/max*100}%`}}/><span className="blue" style={{height:`${r.icetak/max*100}%`}}/></span>
   <small>{rows.length<16||i%Math.ceil(rows.length/8)===0?`${r.date.slice(8)}/${r.date.slice(5,7)}`:'·'}</small>
  </button>)}</div>
 </div></div></>;
}
