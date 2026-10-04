import { profitRequest } from './orderProfit';
export { profitMoney as money, malaysiaDate } from './orderProfit';
export type ContributionRow = {
 order_id:string;reference:string;channel:'shopee'|'deco';day:string;status:string;included:boolean;
 sales:number|null;customer_paid:number|null;shipping_charged:number|null;fee:number|null;courier:number|null;courier_state:string;
 nett:number|null;material:number|null;extras:number;contribution:number|null;margin:number|null;
 state:'actual'|'estimated'|'incomplete'|'excluded';income_state:string;reasons:string[];
 version?:number;signature?:string;material_override?:number|null;courier_override?:number|null;
 material_actual?:boolean;courier_actual?:boolean;extras_actual?:boolean;note?:string;
 lines?:{title:string;qty:number;category:string|null;goods:number|null;material:number|null}[];
};
export type TargetSettings = {version:number;overhead:number;owner_income:number;workdays:number[];holidays:string[]};
export type ContributionReport = {
 month:string;today:string;fetched_at:string;settings:TargetSettings;rows:ContributionRow[];total:number;
 summary:{goal:number;known:number;actual:number;estimated:number;today:number;missing:number;included_orders:number;excluded_orders:number;remaining:number;after_overhead:number;workdays:number;remaining_days:number;is_workday:boolean;daily_base:number|null;daily_target:number|null;daily_gap:number|null};
 channels:{channel:string;orders:number;missing:number;contribution:number;sales:number|null;margin:number|null}[];
};
export const request = profitRequest;
export const stateLabels={actual:'Sebenar',estimated:'Anggaran',incomplete:'Belum lengkap',excluded:'Tidak dikira'};
export function costNumber(value:string,nullable=false){
 if(nullable&&!value.trim())return null;
 const n=Number(value);if(!value.trim()||!Number.isFinite(n)||n<0||n>1000000)throw new Error('Isi kos antara RM0 dan RM1,000,000.');return n;
}
