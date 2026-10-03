import { supabase } from './supabase';
export const materialCategories={topper:'Topper',edible:'Edible',wafer:'Wafer',acrylic:'Acrylic'} as const;
export type MaterialCategory=keyof typeof materialCategories;
export const extraCostLabels={packaging:'Packaging',wastage:'Bahan rosak / pembaziran',reprint:'Reprint',labor:'Upah kerja',shipping:'Pos tambahan',ads:'Ads di luar potongan Shopee',affiliate:'Affiliate di luar potongan Shopee'} as const;
export type ExtraCostKey=keyof typeof extraCostLabels;
export type CostMode='actual'|'estimated'|'allocated';
export type MaterialLine={line_no:number;sku:string;parent_sku:string;title:string;variation:string|null;quantity:number;goods_value:number|null;category:MaterialCategory|null;rate:number|null;unit_cost:number|null;amount:number|null;mode:'actual'|'estimated';basis:string};
export type OrderProfitRow={
  order_id:string;order_sn:string;provider:string;buyer:string;status:string;placed_at:string;currency:string;buyer_paid:number|null;goods_value:number|null;
  nett:number|null;income_state:string;released_at:string|null;enriched_at:string|null;escrow_amount:number|null;released_amount:number|null;
  commission_fee:number|null;service_fee:number|null;transaction_fee:number|null;other_fees:number|null;shipping_fee:number|null;settlement_status:string;
  material_total:number|null;extra_total:number;cost_total:number|null;profit:number|null;margin:number|null;profit_state:string;cost_state:string;detail_changed:boolean;
  categories:MaterialCategory[];skus:string[];cost_version:number;settings_version:number;material_lines:MaterialLine[];extra_costs:Record<ExtraCostKey,{amount:number;mode:CostMode}>;
  reviewed:boolean;work_minutes:number|null;profit_per_hour:number|null;note:string;cost_updated_at:string|null;
};
export type MaterialSettings={version:number;rates:Record<MaterialCategory,number>;sku_costs:Record<string,{category:MaterialCategory;unit_cost:number}>;effective_at:string};
export type ProfitList={rows:OrderProfitRow[];total:number;currency:string;summary:{orders:number;released_nett:number;escrow_nett:number;actual_profit:number;estimated_profit:number;actual_orders:number;estimated_orders:number;incomplete_orders:number;loss_orders:number;low_margin_orders:number}};
export async function profitRequest<T>(body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke('finance-admin',{body});
  if(error){const context=(error as {context?:Response}).context;const payload=context&&typeof context.json==='function'?await context.json().catch(()=>null):null;throw new Error(payload?.error||error.message||'Finance gagal dimuatkan');}
  if(!data?.success)throw new Error(data?.error||'Finance request gagal');return data.data as T;
}
export const profitMoney=(v:number|null|undefined,c='MYR')=>v==null?'—':new Intl.NumberFormat('en-MY',{style:'currency',currency:c}).format(v);
export const profitDate=(v:string|null)=>v?new Date(v).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export const malaysiaDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const profitStateLabel=(r:OrderProfitRow)=>r.profit_state==='actual'?'Sebenar':r.profit_state==='estimated'?'Anggaran':r.profit_state==='lifecycle_review'?'Semak batal / refund':r.cost_state==='detail_changed'?'Item berubah':r.cost_state==='missing'?'Modal belum lengkap':'Menunggu finance';
