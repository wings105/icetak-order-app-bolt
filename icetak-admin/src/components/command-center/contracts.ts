export type Breakdown = { label: string; value: number; module?: string; filter?: string };
export type Focus = { key: string; name: string; reference: string; module: string; reason: string; deadline?: string; owner?: string };
export type Opportunity = { id: string; customer_name: string; phone?: string; source: string; stage: string; owner: string; estimated_value: number; version: number; identity_key: string; note?: string; updated_at: string };
export type Trend = { date: string; icetak: number; shopee: number; gmv?: number };
export type Snapshot = {
 ok: boolean; version: string; fetched_at: string; warnings: string[];
 capabilities: { finance: boolean; chat: boolean; manage_sales: boolean };
 order: {
  period: Record<string, number>; backlog: Record<string, number>; trend: Trend[];
  pipeline: Breakdown[]; production: Breakdown[]; products: Breakdown[]; couriers: Breakdown[];
  shipping_status: Breakdown[]; shipping_aging: Breakdown[]; payment_methods?: Breakdown[];
  ledger?: {income:number;expense:number;profit:number;lines:{name:string;account_type:string;amount:number}[]} | null;
  settlement?: { coverage: number; released: number|null; fees: number|null };
  returns: Breakdown[]; focus: Focus[]; opportunities: Opportunity[]; sales_funnel: Breakdown[];
  staff_activity: { actor: string; actions: number }[]; ai_training: Breakdown[];
  health: Record<string, number|string|null>; limitations: string[];
 };
 inbox: null | {
  period: Record<string, number>; attention: Record<string, number>; channels: Breakdown[];
  intents: Breakdown[]; aging: Breakdown[]; trend: { date: string; inbound: number; outbound: number }[];
  focus: { id: string; name: string; channel: string; snippet: string; priority: number; last_inbound_at: string }[];
  health: Record<string, number|string|null>; limitations: string[];
 };
};
export const stages: Record<string,string> = {new:'Lead baru',qualified:'Qualified',quoted:'Quotation',waiting_customer:'Tunggu customer',waiting_payment:'Tunggu bayaran',won:'Closed won',lost:'Closed lost'};
export const money=(v:unknown)=>v===null||v===undefined?'Belum tersedia':new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(Number(v));
export const number=(v:unknown)=>v===null||v===undefined?'—':Number(v).toLocaleString('en-MY');
export const dateTime=(v:unknown)=>v?new Date(String(v)).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Belum diterima';
export function adminHref(module:string,params:Record<string,string>={}){
 const u=new URL(window.location.origin+window.location.pathname);u.searchParams.set('admin','v2');u.searchParams.set('view',module);
 Object.entries(params).forEach(([k,v])=>{if(v)u.searchParams.set(k,v);});return u.toString();
}
export function phoneDigits(value:unknown){let d=String(value||'').replace(/\D/g,'');if(d.startsWith('0'))d='6'+d;return /^[1-9]\d{7,14}$/.test(d)?d:'';}
