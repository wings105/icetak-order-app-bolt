import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { IconRefresh } from '../components/Icons';
import { supabase } from '../lib/supabase';
import './QrPayDailySummary.css';

type Totals = {
  total_count:number; total_amount:number|string; matched_count:number; matched_amount:number|string;
  review_count:number; review_amount:number|string; processing_count:number; processing_amount:number|string;
  missed_count:number; missed_amount:number|string; ignored_count:number; ignored_amount:number|string;
  unresolved_count:number; unresolved_amount:number|string;
};
type OrderComponentProgress = {
  id:string; label:string; customer_stage:string|null; customer_label:string; progress_percent:number;
  clickup_task_id:string|null; clickup_status:string|null; task_url:string|null; is_complete:boolean;
};
type OrderProgress = {
  order_status:string|null; admin_status:string|null; fulfillment_stage:string|null; delivery_method:string|null;
  production_approved:boolean; production_completed_at:string|null; pickup_ready_at:string|null;
  pickup_collected_at:string|null; delivered_at:string|null; components_total:number; components_complete:number;
  progress_percent:number; components:OrderComponentProgress[]; shipment_status:string|null;
  shipment_status_group:string|null; tracking_number:string|null; tracking_link:string|null; courier:string|null;
  overall_label:string; overall_tone:'success'|'warning'|'info'|'error'|'neutral';
  available_actions:('approve_production'|'ready_pickup'|'pickup_collected')[];
  task_status_source:'clickup_webhook'; shipment_status_source:'parceldaily';
};
type Row = {
  source:'matched'|'unmatched'; transaction_id:string; amount:number|string; paid_at:string; sender_name:string|null;
  provider:string; workflow_status:'matched_order'|'needs_review'|'processing'|'pending'|'missed'|'ignored';
  order_id:string|null; order_no:string|null; phone:string|null; whatsapp_link:string|null; order_link:string|null;
  job_status:string|null; review_status:string|null;
  workflow_state:'active'|'ignored'|null; review_category:string|null; review_remark:string|null;
  review_updated_at:string|null; review_updated_by:string|null; ignored_at:string|null; ignored_by:string|null;
  identity_confirmed:boolean; identity_confirmed_at:string|null; identity_confirmed_by:string|null;
  identity_original_name:string|null; identity_original_phone:string|null;
  order_progress:OrderProgress|null;
};
type Delivery = { slot:string; status:string; attempts:number; scheduled_at:string; sent_at:string|null; recipient_phone:string|null; last_error:string|null };
type Summary = {
  date:string; from_date?:string; to_date?:string; is_single_day?:boolean; day_count?:number;
  timezone:string; generated_at:string; totals:Totals; rows:Row[]; delivery:Delivery|null;
};
type Candidate = {
  order_id:string; order_no:string; total:number|string; delivery_fee:number|string; created_at:string;
  payment_status:string|null; payment_transaction_id:string|null; customer_name:string; phone:string|null;
  phone_match:boolean; linked_amount:number|string; outstanding_before:number|string; paid_after:number|string;
  remaining_after:number|string; overpaid_after:number|string; settlement_status:'partial'|'settled'|'overpaid';
  requires_confirmation:boolean; amount_difference:number|string; score:number; can_match:boolean; blocked_reason:string|null;
};
type CandidateData = {
  transaction?: { transaction_id:string; amount:number|string; paid_at:string; provider:string; phone:string|null; customer_name:string|null };
  already_matched:boolean;
  current_order?: {
    order_id:string; order_no:string; total:number|string; status:string|null; admin_status:string|null;
    payment_status:string|null; source:string|null; can_cancel_source:boolean; item_count:number;
    component_count:number; clickup_count:number; clickup_statuses:string[]; shipment_count:number;
    shipment_statuses:string[]; requires_processed_confirmation:boolean;
  }|null;
  candidates:Candidate[];
};
type MatchData = {
  success:boolean; requires_confirmation?:boolean; order_no?:string; payment_amount?:number|string;
  order_total?:number|string; amount_difference?:number|string; phone_match?:boolean;
  paid_after?:number|string; remaining_after?:number|string; overpaid_after?:number|string;
  settlement_status?:'partial'|'settled'|'overpaid';
};
type CorrectionData = {
  success:boolean; action:'unmatch'|'unmatch_create'|'relink'; transaction_id:string;
  amount:number|string; paid_at:string; sender_name:string|null; phone:string|null;
  source_order_no:string; target_order_no?:string|null; source_cancelled:boolean;
};
type ReviewAction = 'save_remark'|'ignore'|'reopen';
type ReviewActionData = { success:boolean; idempotent:boolean; transaction_id:string; action:ReviewAction };
type IdentityUpdateData = {
  success:boolean; transaction_id:string; name:string; phone:string; order_id:string|null; order_no:string|null;
  updated_order:boolean; confirmed_at:string; confirmed_by:string;
};
type FilterStatus = 'all'|'matched'|'review'|'processing'|'missed'|'ignored';
type ProgressFilter = 'all'|'approval'|'design'|'production'|'ready'|'shipping'|'completed'|'cancelled'|'active'|'unlinked';
type SortMode = 'newest'|'oldest'|'amount_high'|'amount_low'|'status';
type PeriodPreset = 'day'|'week'|'month'|'3months'|'6months'|'year'|'calendar_month'|'custom'|'all';
export type QrPayCreatePayload = {
  transactionId:string; amount:number; phone:string; customerName:string; paidAt:string;
};
type Props = {
  onOpenOrder?:(orderNo:string)=>void; canManage?:boolean;
  onCreateOrder?:(payment:QrPayCreatePayload)=>void;
};

const money=(value:number|string|null|undefined)=>`RM ${Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const time=(value:string)=>new Date(value).toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'});
const paymentDateTime=(value:string)=>new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'—';
const malaysiaDate=()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find((item)=>item.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const validDate=(value:string|null)=>/^\d{4}-\d{2}-\d{2}$/.test(value||'');
const parseDate=(value:string)=>new Date(`${value}T00:00:00Z`);
const formatDate=(value:Date)=>value.toISOString().slice(0,10);
const addDays=(value:string,days:number)=>{const date=parseDate(value);date.setUTCDate(date.getUTCDate()+days);return formatDate(date);};
const shiftMonths=(value:string,months:number)=>{
  const date=parseDate(value);const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,lastDay));
  return formatDate(date);
};
const monthEnd=(value:string)=>{const [year,month]=value.split('-').map(Number);return formatDate(new Date(Date.UTC(year,month,0)));};
const displayDate=(value:string)=>parseDate(value).toLocaleDateString('en-MY',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
const periodLabel=(from:string,to:string)=>from===to?displayDate(from):`${displayDate(from)} – ${displayDate(to)}`;

async function invokeFinance<T>(body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke('finance-admin',{body});
  if(error)throw new Error(error.message);
  if(!data?.success)throw new Error(data?.error||'Finance request failed');
  return data.data as T;
}

const loadRange=(from:string|null,to:string)=>invokeFinance<Summary>({action:'qrpay_range',from,to});
const statusInfo=(row:Row)=>{
  if(row.workflow_status==='matched_order')return {label:row.provider==='qrpay_ai'?'Order auto-created':'Matched to order',cls:'badge-success'};
  if(row.workflow_status==='needs_review')return {label:'Needs review',cls:'badge-warning'};
  if(row.workflow_status==='missed')return {label:'Missed / failed',cls:'badge-error'};
  if(row.workflow_status==='ignored')return {label:'Ignored for order',cls:'badge-neutral'};
  return {label:'Processing',cls:'badge-info'};
};
const progressBadgeClass=(tone:OrderProgress['overall_tone'])=>tone==='success'?'badge-success':tone==='warning'?'badge-warning':tone==='error'?'badge-error':tone==='info'?'badge-info':'badge-neutral';
const actionLabels:Record<OrderProgress['available_actions'][number],string>={
  approve_production:'Approve Production',ready_pickup:'Ready Pickup',pickup_collected:'Customer Collected',
};
const actionPrompts:Record<OrderProgress['available_actions'][number],string>={
  approve_production:'Approve order ini untuk production?',ready_pickup:'Sahkan semua task siap dan tandakan Ready for Pickup?',
  pickup_collected:'Sahkan customer sudah ambil order ini?',
};
const categoryLabels:Record<string,string>={
  old_debt:'Bayaran hutang lama',personal_transfer:'Personal / bukan jualan',supplier_refund:'Refund supplier',
  internal_transfer:'Transfer dalaman',duplicate_or_test:'Duplicate / test',other:'Lain-lain',
};
const filterMatches=(row:Row,filter:FilterStatus)=>filter==='all'
  ||(filter==='matched'&&row.workflow_status==='matched_order')
  ||(filter==='review'&&row.workflow_status==='needs_review')
  ||(filter==='processing'&&(row.workflow_status==='processing'||row.workflow_status==='pending'))
  ||(filter==='missed'&&row.workflow_status==='missed')
  ||(filter==='ignored'&&row.workflow_status==='ignored');
const progressFilterOptions:[ProgressFilter,string][]=[
  ['all','All Progress'],['approval','Need Approval'],['design','Design / Review'],['production','Production'],
  ['ready','Ready / Pickup'],['shipping','Shipping'],['completed','Completed'],['cancelled','Cancelled'],
  ['active','Other Active'],['unlinked','No Order'],
];
const progressCategory=(row:Row):Exclude<ProgressFilter,'all'>=>{
  const progress=row.order_progress;
  if(!progress)return 'unlinked';
  const label=progress.overall_label.toLowerCase();
  const fulfillment=String(progress.fulfillment_stage||'').toLowerCase();
  const shipment=String(progress.shipment_status_group||'').toLowerCase();
  if(label.includes('cancel')||fulfillment==='cancelled')return 'cancelled';
  if(progress.pickup_collected_at||progress.delivered_at||['collected','delivered','completed'].includes(fulfillment)||label==='customer collected'||label==='delivered')return 'completed';
  if(['awb_created','picked_up','shipped','in_transit','out_for_delivery'].includes(shipment))return 'shipping';
  if(progress.pickup_ready_at||fulfillment==='ready_for_pickup'||(progress.components_total>0&&progress.components_complete===progress.components_total))return 'ready';
  if(progress.available_actions.includes('approve_production'))return 'approval';
  const stages=progress.components.map((component)=>String(component.customer_stage||component.customer_label||'').toLowerCase());
  if(stages.some((stage)=>['order received','design editing','waiting review','approved'].includes(stage)||stage.includes('design')||stage.includes('review')))return 'design';
  if(stages.some((stage)=>['production','finishing'].includes(stage))||progress.progress_percent>0)return 'production';
  return 'active';
};
const progressMatches=(row:Row,filter:ProgressFilter)=>filter==='all'||progressCategory(row)===filter;

export default function QrPayDailySummary({onOpenOrder,canManage=false,onCreateOrder}:Props){
  const params=new URLSearchParams(window.location.search);
  const today=malaysiaDate();
  const periodValues:PeriodPreset[]=['day','week','month','3months','6months','year','calendar_month','custom','all'];
  const requestedPeriod=params.get('period') as PeriodPreset|null;
  const initialPeriod=periodValues.includes(requestedPeriod||'day')?(requestedPeriod||'day') as PeriodPreset:'day';
  const initialDate=validDate(params.get('date'))&&params.get('date')!<=today?params.get('date')!:today;
  const initialMonth=/^\d{4}-\d{2}$/.test(params.get('month')||'')&&params.get('month')!<=today.slice(0,7)?params.get('month')!:today.slice(0,7);
  const initialTo=validDate(params.get('to'))&&params.get('to')!<=today?params.get('to')!:today;
  const initialFrom=validDate(params.get('from'))&&params.get('from')!<=initialTo?params.get('from')!:addDays(initialTo,-6);
  const [period,setPeriod]=useState<PeriodPreset>(initialPeriod);
  const [date,setDate]=useState(initialDate);
  const [calendarMonth,setCalendarMonth]=useState(initialMonth);
  const [customFrom,setCustomFrom]=useState(initialFrom);
  const [customTo,setCustomTo]=useState(initialTo);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [matchRow,setMatchRow]=useState<Row|null>(null);
  const [matchQuery,setMatchQuery]=useState('');
  const [candidateData,setCandidateData]=useState<CandidateData|null>(null);
  const [selected,setSelected]=useState<Candidate|null>(null);
  const [matchLoading,setMatchLoading]=useState(false);
  const [matchError,setMatchError]=useState<string|null>(null);
  const [confirmProcessed,setConfirmProcessed]=useState(false);
  const [cancelSource,setCancelSource]=useState(false);
  const [statusFilter,setStatusFilter]=useState<FilterStatus>('all');
  const progressFilterValues=progressFilterOptions.map(([value])=>value);
  const requestedProgressFilter=params.get('progress') as ProgressFilter|null;
  const [progressFilter,setProgressFilter]=useState<ProgressFilter>(progressFilterValues.includes(requestedProgressFilter||'all')?(requestedProgressFilter||'all'):'all');
  const [sortMode,setSortMode]=useState<SortMode>('newest');
  const [search,setSearch]=useState('');
  const [reviewRow,setReviewRow]=useState<Row|null>(null);
  const [reviewCategory,setReviewCategory]=useState('');
  const [reviewRemark,setReviewRemark]=useState('');
  const [reviewLoading,setReviewLoading]=useState(false);
  const [reviewError,setReviewError]=useState<string|null>(null);
  const [identityRow,setIdentityRow]=useState<Row|null>(null);
  const [identityName,setIdentityName]=useState('');
  const [identityPhone,setIdentityPhone]=useState('');
  const [identityUpdateOrder,setIdentityUpdateOrder]=useState(false);
  const [identityLoading,setIdentityLoading]=useState(false);
  const [identityError,setIdentityError]=useState<string|null>(null);
  const [orderActionKey,setOrderActionKey]=useState<string|null>(null);
  const loadRequestId=useRef(0);

  const requestedRange=useMemo(()=>{
    if(period==='day')return {from:date,to:date};
    if(period==='week')return {from:addDays(today,-6),to:today};
    if(period==='month')return {from:addDays(shiftMonths(today,-1),1),to:today};
    if(period==='3months')return {from:addDays(shiftMonths(today,-3),1),to:today};
    if(period==='6months')return {from:addDays(shiftMonths(today,-6),1),to:today};
    if(period==='year')return {from:addDays(shiftMonths(today,-12),1),to:today};
    if(period==='calendar_month')return {from:`${calendarMonth}-01`,to:monthEnd(calendarMonth)>today?today:monthEnd(calendarMonth)};
    if(period==='custom')return {from:customFrom,to:customTo};
    return {from:null,to:today};
  },[calendarMonth,customFrom,customTo,date,period,today]);

  const load=useCallback(async()=>{
    const requestId=++loadRequestId.current;
    setLoading(true);setError(null);
    try{
      const next=await loadRange(requestedRange.from,requestedRange.to);
      if(requestId!==loadRequestId.current)return;
      setSummary(next);
      const url=new URL(window.location.href);url.searchParams.set('admin','v2');url.searchParams.set('view','qrpay-summary');url.searchParams.set('period',period);
      ['date','month','from','to'].forEach((key)=>url.searchParams.delete(key));
      if(period==='day')url.searchParams.set('date',date);
      if(period==='calendar_month')url.searchParams.set('month',calendarMonth);
      if(period==='custom'){url.searchParams.set('from',customFrom);url.searchParams.set('to',customTo);}
      window.history.replaceState({},'',url);
    }catch(e){if(requestId===loadRequestId.current)setError(e instanceof Error?e.message:'QRPay summary failed to load');}
    finally{if(requestId===loadRequestId.current)setLoading(false);}
  },[calendarMonth,customFrom,customTo,date,period,requestedRange]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(progressFilter==='all')url.searchParams.delete('progress');else url.searchParams.set('progress',progressFilter);
    window.history.replaceState({},'',url);
  },[progressFilter]);

  const searchCandidates=useCallback(async(row:Row,query:string)=>{
    setMatchLoading(true);setMatchError(null);setSelected(null);
    try{
      const data=await invokeFinance<CandidateData>({action:'qrpay_match_candidates',transaction_id:row.transaction_id,query:query.trim()||null});
      setCandidateData(data);
      setSelected(data.already_matched?null:data.candidates.find((candidate)=>candidate.can_match)||null);
    }catch(e){setCandidateData(null);setMatchError(e instanceof Error?e.message:'Order search failed');}
    finally{setMatchLoading(false);}
  },[]);

  const openMatch=(row:Row)=>{
    const query=row.phone||'';
    setMatchRow(row);setMatchQuery(query);setCandidateData(null);setSelected(null);setMatchError(null);setConfirmProcessed(false);setCancelSource(false);
    void searchCandidates(row,'');
  };
  const closeMatch=()=>{if(!matchLoading){setMatchRow(null);setCandidateData(null);setSelected(null);setMatchError(null);setConfirmProcessed(false);setCancelSource(false);}};
  const submitSearch=(event:FormEvent)=>{event.preventDefault();if(matchRow)void searchCandidates(matchRow,matchQuery);};
  const confirmMatch=async()=>{
    if(!matchRow||!selected)return;
    setMatchLoading(true);setMatchError(null);
    try{
      const mismatch=Number(selected.overpaid_after||0)>=0.01||!selected.phone_match;
      const data=await invokeFinance<MatchData>({
        action:'qrpay_manual_match',transaction_id:matchRow.transaction_id,order_no:selected.order_no,confirm_mismatch:mismatch,
      });
      setSuccess(`${matchRow.transaction_id} sudah dipadankan kepada ${data.order_no||selected.order_no}.`);
      setMatchRow(null);setCandidateData(null);setSelected(null);
      await load();
    }catch(e){setMatchError(e instanceof Error?e.message:'Manual match failed');}
    finally{setMatchLoading(false);}
  };
  const correctMatch=async(correctionAction:'unmatch'|'unmatch_create'|'relink')=>{
    if(!matchRow||!candidateData?.already_matched)return;
    if(correctionAction==='relink'&&!selected)return;
    setMatchLoading(true);setMatchError(null);
    try{
      const data=await invokeFinance<CorrectionData>({
        action:'qrpay_correct_match',transaction_id:matchRow.transaction_id,correction_action:correctionAction,
        target_order_no:correctionAction==='relink'?selected?.order_no:null,
        confirm_processed:confirmProcessed,confirm_mismatch:correctionAction==='relink'&&Boolean(selected&&(!selected.phone_match||Number(selected.overpaid_after||0)>=0.01)),
        cancel_source:cancelSource,
      });
      const message=correctionAction==='relink'
        ?`${matchRow.transaction_id} dipindahkan daripada ${data.source_order_no} kepada ${data.target_order_no||selected?.order_no}.`
        :`${matchRow.transaction_id} sudah di-unmatch daripada ${data.source_order_no}${data.source_cancelled?' dan order asal dibatalkan':''}.`;
      setSuccess(message);setMatchRow(null);setCandidateData(null);setSelected(null);setConfirmProcessed(false);setCancelSource(false);
      if(correctionAction==='unmatch_create'&&onCreateOrder){
        onCreateOrder({transactionId:data.transaction_id,amount:Number(data.amount),phone:data.phone||matchRow.phone||'',customerName:data.sender_name||matchRow.sender_name||'',paidAt:data.paid_at});
      }else await load();
    }catch(e){setMatchError(e instanceof Error?e.message:'QRPay correction failed');}
    finally{setMatchLoading(false);}
  };

  const openReview=(row:Row)=>{
    setReviewRow(row);setReviewCategory(row.review_category||'');setReviewRemark(row.review_remark||'');setReviewError(null);
  };
  const closeReview=()=>{if(!reviewLoading){setReviewRow(null);setReviewError(null);}};
  const submitReview=async(action:ReviewAction)=>{
    if(!reviewRow)return;
    setReviewLoading(true);setReviewError(null);
    try{
      await invokeFinance<ReviewActionData>({
        action:'qrpay_review_action',review_action:action,transaction_id:reviewRow.transaction_id,
        category:reviewCategory||null,remark:reviewRemark,
      });
      const message=action==='ignore'
        ?`${reviewRow.transaction_id} dikeluarkan daripada queue order. Rekod duit masuk Finance dikekalkan.`
        :action==='reopen'?`${reviewRow.transaction_id} dibuka semula untuk Match / Create Order.`
        :`Remark ${reviewRow.transaction_id} sudah disimpan.`;
      setSuccess(message);setReviewRow(null);await load();
    }catch(e){setReviewError(e instanceof Error?e.message:'QRPay review update failed');}
    finally{setReviewLoading(false);}
  };

  const openIdentity=(row:Row)=>{
    setIdentityRow(row);setIdentityName(row.sender_name||'');setIdentityPhone(row.phone||'');
    setIdentityUpdateOrder(Boolean(row.order_id));setIdentityError(null);
  };
  const closeIdentity=()=>{if(!identityLoading){setIdentityRow(null);setIdentityError(null);}};
  const submitIdentity=async(event:FormEvent)=>{
    event.preventDefault();
    if(!identityRow)return;
    setIdentityLoading(true);setIdentityError(null);
    try{
      const data=await invokeFinance<IdentityUpdateData>({
        action:'qrpay_identity_update',transaction_id:identityRow.transaction_id,
        name:identityName,phone:identityPhone,update_order:identityUpdateOrder,
      });
      setSuccess(`${data.transaction_id}: ${data.name} · ${data.phone} disahkan oleh admin${data.updated_order&&data.order_no?` dan dikemas kini pada ${data.order_no}`:''}.`);
      setIdentityRow(null);await load();
    }catch(e){setIdentityError(e instanceof Error?e.message:'Customer contact gagal dikemas kini');}
    finally{setIdentityLoading(false);}
  };

  const runOrderAction=async(row:Row,action:OrderProgress['available_actions'][number])=>{
    if(!row.order_id||!window.confirm(actionPrompts[action]))return;
    const actionKey=`${row.transaction_id}:${action}`;
    setOrderActionKey(actionKey);setError(null);
    try{
      const {error:rpcError}=await supabase.rpc('finance_admin_qrpay_order_action',{p_order_id:row.order_id,p_action:action});
      if(rpcError)throw rpcError;
      setSuccess(`${row.order_no||'Order'}: ${actionLabels[action]} sudah dikemas kini.`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Order status gagal dikemas kini');}
    finally{setOrderActionKey(null);}
  };

  const filterStats=useMemo(()=>{
    const rows=summary?.rows||[];
    const filters:FilterStatus[]=['all','matched','review','processing','missed','ignored'];
    return Object.fromEntries(filters.map((filter)=>{
      const selectedRows=rows.filter((row)=>filterMatches(row,filter));
      return [filter,{count:selectedRows.length,amount:selectedRows.reduce((sum,row)=>sum+Number(row.amount||0),0)}];
    })) as Record<FilterStatus,{count:number;amount:number}>;
  },[summary]);
  const progressFilterStats=useMemo(()=>{
    const rows=(summary?.rows||[]).filter((row)=>filterMatches(row,statusFilter));
    const counts=Object.fromEntries(progressFilterOptions.map(([filter])=>[filter,0])) as Record<ProgressFilter,number>;
    for(const row of rows){counts.all+=1;counts[progressCategory(row)]+=1;}
    return counts;
  },[statusFilter,summary]);
  const visibleRows=useMemo(()=>{
    const query=search.trim().toLowerCase();
    const rows=(summary?.rows||[]).filter((row)=>filterMatches(row,statusFilter)&&progressMatches(row,progressFilter)).filter((row)=>{
      if(!query)return true;
      return [row.transaction_id,row.order_no,row.phone,row.sender_name,row.identity_original_name,row.identity_original_phone,row.provider,row.review_remark,
        row.order_progress?.overall_label,row.order_progress?.shipment_status,
        ...(row.order_progress?.components||[]).flatMap((component)=>[component.label,component.customer_label,component.clickup_status]),
        row.review_category?categoryLabels[row.review_category]||row.review_category:'']
        .some((value)=>String(value||'').toLowerCase().includes(query));
    });
    const statusRank:Record<Row['workflow_status'],number>={needs_review:1,missed:2,processing:3,pending:3,matched_order:4,ignored:5};
    return [...rows].sort((left,right)=>{
      if(sortMode==='oldest')return new Date(left.paid_at).getTime()-new Date(right.paid_at).getTime();
      if(sortMode==='amount_high')return Number(right.amount)-Number(left.amount);
      if(sortMode==='amount_low')return Number(left.amount)-Number(right.amount);
      if(sortMode==='status')return statusRank[left.workflow_status]-statusRank[right.workflow_status]||new Date(right.paid_at).getTime()-new Date(left.paid_at).getTime();
      return new Date(right.paid_at).getTime()-new Date(left.paid_at).getTime();
    });
  },[progressFilter,search,sortMode,statusFilter,summary]);

  const totals=summary?.totals;
  const summaryFrom=summary?.from_date||summary?.date||requestedRange.from||requestedRange.to;
  const summaryTo=summary?.to_date||summary?.date||requestedRange.to;
  const singleDay=summary?.is_single_day??summaryFrom===summaryTo;
  const displayedDays=summary?.day_count||Math.floor((parseDate(summaryTo).getTime()-parseDate(summaryFrom).getTime())/86400000)+1;
  return <div className="fade-in qrpay-summary-page">
    <div className="page-header"><div><h1 className="page-title">QRPay Summary & Review</h1><p className="page-subtitle">Semak QRPay mengikut hari, bulan atau julat—termasuk status order, remark dan transaksi terlepas.</p></div><div className="qrpay-summary-actions"><button className="btn btn-outline" disabled={loading} onClick={()=>void load()}><IconRefresh size={16}/> Refresh</button></div></div>
    <section className="qrpay-period-control" aria-label="QRPay date period">
      <div className="qrpay-period-presets">{([
        ['day','Day'],['week','1 Week'],['month','1 Month'],['3months','3 Months'],['6months','6 Months'],
        ['year','1 Year'],['calendar_month','Pilih Bulan'],['custom','Date Range'],['all','All'],
      ] as [PeriodPreset,string][]).map(([value,label])=><button type="button" key={value} aria-pressed={period===value} className={period===value?'active':''} onClick={()=>setPeriod(value)}>{label}</button>)}</div>
      <div className="qrpay-period-inputs">
        {period==='day'&&<label><span>Tarikh</span><input type="date" value={date} max={today} onChange={(event)=>{if(event.target.value)setDate(event.target.value);}}/></label>}
        {period==='calendar_month'&&<label><span>Bulan</span><input type="month" value={calendarMonth} max={today.slice(0,7)} onChange={(event)=>{if(event.target.value)setCalendarMonth(event.target.value);}}/></label>}
        {period==='custom'&&<><label><span>Dari</span><input type="date" value={customFrom} max={customTo||today} onChange={(event)=>{const value=event.target.value;if(!value)return;setCustomFrom(value);if(value>customTo)setCustomTo(value);}}/></label><label><span>Hingga</span><input type="date" value={customTo} min={customFrom} max={today} onChange={(event)=>{if(event.target.value)setCustomTo(event.target.value);}}/></label></>}
        <div className="qrpay-period-result"><b>{period==='all'?'Semua rekod':periodLabel(requestedRange.from||summaryFrom,requestedRange.to)}</b><span>{period==='all'?'Daripada transaksi QRPay pertama hingga hari ini':'Kedua-dua tarikh termasuk dalam kiraan'}</span></div>
      </div>
    </section>
    {success&&<div className="finance-alert qrpay-match-success"><b>QRPay updated</b><span>{success}</span></div>}
    {error&&<div className="finance-alert"><b>QRPay error</b><span>{error}</span></div>}
    {loading&&!summary?<div className="loading"><span className="spinner"/> Loading QRPay summary…</div>:summary&&<>
      <div className="qrpay-summary-metrics">
        <Metric label="Jumlah QRPay Masuk" value={money(totals?.total_amount)} hint={`${totals?.total_count||0} transaksi`} cls="green"/>
        <Metric label="Sudah Masuk Order" value={money(totals?.matched_amount)} hint={`${totals?.matched_count||0} matched / auto-created`} cls="blue"/>
        <Metric label="Perlu Semakan" value={money(totals?.review_amount)} hint={`${totals?.review_count||0} tunggu tindakan`} cls="amber"/>
        <Metric label="Terlepas / Failed" value={money(totals?.missed_amount)} hint={`${totals?.missed_count||0} perlu diperiksa`} cls="red"/>
        <Metric label="Ignored for Order" value={money(totals?.ignored_amount)} hint={`${totals?.ignored_count||0} bukan order baru`} cls="slate"/>
      </div>
      <div className="qrpay-summary-note"><div><b>Automation 10:00 AM & 10:00 PM</b><span>{singleDay?'WhatsApp dihantar ke nombor admin order. Setiap slot mempunyai idempotency dan retry.':`Paparan ini gabungan ${displayedDays} hari. WhatsApp automation kekal dihantar sebagai summary harian.`}</span></div><div><b>{singleDay?(summary.delivery?.status?summary.delivery.status.toUpperCase():'WAITING'):'PERIOD VIEW'}</b><span>{singleDay?(summary.delivery?.sent_at?`Last sent ${dateTime(summary.delivery.sent_at)}`:'Belum dihantar untuk tarikh ini'):`${displayDate(summaryFrom)} hingga ${displayDate(summaryTo)}`}</span></div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">QRPay {periodLabel(summaryFrom,summaryTo)}</div><div className="panel-subtitle">{summary.rows.length} transaksi · {displayedDays} hari · Generated {dateTime(summary.generated_at)} · MYT</div></div><div className="qrpay-unresolved"><b>{totals?.unresolved_count||0}</b><span>belum masuk order</span></div></div>
        <div className="qrpay-review-toolbar">
          <div className="qrpay-filter-chips" aria-label="Filter QRPay status">{([
            ['all','All'],['matched','Matched'],['review','Needs Review'],['processing','Unmatched / Processing'],['missed','Failed'],['ignored','Ignored'],
          ] as [FilterStatus,string][]).map(([value,label])=><button key={value} className={statusFilter===value?'active':''} onClick={()=>setStatusFilter(value)}><span>{label}</span><b>{filterStats[value].count}</b><small>{money(filterStats[value].amount)}</small></button>)}</div>
          <div className="qrpay-progress-filter-layer"><span className="qrpay-progress-filter-label">Order Progress</span><div className="qrpay-progress-filter-chips" aria-label="Filter order progress">{progressFilterOptions.map(([value,label])=><button type="button" key={value} aria-pressed={progressFilter===value} className={progressFilter===value?'active':''} onClick={()=>setProgressFilter(value)}><span>{label}</span><b>{progressFilterStats[value]}</b></button>)}</div></div>
          <div className="qrpay-review-tools"><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Cari transaction, order, phone, nama, remark…" aria-label="Search QRPay"/><select value={sortMode} onChange={(event)=>setSortMode(event.target.value as SortMode)} aria-label="Sort QRPay"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_high">Amount: high to low</option><option value="amount_low">Amount: low to high</option><option value="status">Priority status</option></select></div>
        </div>
        <div className="table-wrap">{summary.rows.length===0
          ?<div className="empty"><div className="empty-title">Tiada QRPay diterima dalam period ini.</div></div>
          :visibleRows.length===0
            ?<div className="empty"><div className="empty-title">Tiada payment sepadan dengan filter.</div><div className="cell-sub">Cuba All atau kosongkan carian.</div></div>
            :<table className="qrpay-progress-table">
              <thead><tr><th>{singleDay?'Time':'Date / Time'}</th><th>Transaction</th><th>Customer / Phone</th><th>Amount</th><th>Payment</th><th>Order Progress</th><th>Remark</th><th>Proceed</th></tr></thead>
              <tbody>{visibleRows.map((row)=>{
                const status=statusInfo(row);
                const progress=row.order_progress;
                return <tr key={row.transaction_id} className={row.workflow_status==='missed'?'qrpay-row-missed':row.workflow_status==='ignored'?'qrpay-row-ignored':'row-hover'}>
                  <td className="cell-sub qrpay-payment-date">{singleDay?time(row.paid_at):paymentDateTime(row.paid_at)}</td>
                  <td><div className="cell-id">{row.transaction_id}</div><div className="cell-sub">{row.provider}</div></td>
                  <td><div className="cell-name">{row.sender_name||'Customer belum dikenal pasti'}</div>{row.phone?<a className="qrpay-phone" href={row.whatsapp_link||undefined} target="_blank" rel="noreferrer">{row.phone}</a>:<div className="cell-sub">Phone belum jumpa</div>}<div className="qrpay-identity-meta">{row.identity_confirmed&&<span className="qrpay-confirmed-badge" title={`${row.identity_confirmed_by||'admin'} · ${dateTime(row.identity_confirmed_at)}`}>Admin confirmed</span>}{canManage&&<button type="button" className="qrpay-edit-contact" onClick={()=>openIdentity(row)}>{row.identity_confirmed?'Edit confirmed contact':'Edit customer'}</button>}</div></td>
                  <td className="cell-amount">{money(row.amount)}</td>
                  <td><span className={`badge ${status.cls}`}>{status.label}</span>{row.job_status&&<div className="cell-sub">AI: {row.job_status.replaceAll('_',' ')}</div>}{row.review_category&&<div className="cell-sub">{categoryLabels[row.review_category]||row.review_category}</div>}</td>
                  <td><OrderProgressCell progress={progress}/></td>
                  <td className="qrpay-remark-cell">{row.review_remark?<><span>{row.review_remark}</span><small>{row.review_updated_by||'admin'} · {dateTime(row.review_updated_at)}</small></>:<span className="cell-sub">—</span>}</td>
                  <td><div className="qrpay-proceed-actions">
                    {row.order_no
                      ?<><button className="finance-order-link" onClick={()=>onOpenOrder?.(row.order_no!)}>{row.order_no}</button>{canManage&&<button className="btn btn-outline btn-sm" onClick={()=>openMatch(row)}>Manage Match</button>}{canManage&&progress?.available_actions.map((action)=><button key={action} className="btn btn-primary btn-sm" disabled={orderActionKey!==null} onClick={()=>void runOrderAction(row,action)}>{orderActionKey===`${row.transaction_id}:${action}`?'Updating…':actionLabels[action]}</button>)}</>
                      :row.workflow_status==='ignored'
                        ?canManage&&<button className="btn btn-outline btn-sm" onClick={()=>openReview(row)}>Review / Reopen</button>
                        :canManage
                          ?<><button className="btn btn-primary btn-sm" onClick={()=>openMatch(row)}>Match Order</button>{onCreateOrder&&<button className="btn btn-outline btn-sm" onClick={()=>onCreateOrder({transactionId:row.transaction_id,amount:Number(row.amount),phone:row.phone||'',customerName:row.sender_name||'',paidAt:row.paid_at})}>Create Order</button>}</>
                          :row.whatsapp_link?<a className="btn btn-outline btn-sm" href={row.whatsapp_link} target="_blank" rel="noreferrer">WhatsApp</a>:<span className="cell-sub">Semak payment</span>}
                    {canManage&&row.workflow_status!=='ignored'&&<button className="btn btn-outline btn-sm" onClick={()=>openReview(row)}>{row.review_remark?'Edit Remark':'Remark / Ignore'}</button>}
                    {!row.order_no&&row.workflow_status!=='ignored'&&canManage&&row.whatsapp_link&&<a className="btn btn-outline btn-sm" href={row.whatsapp_link} target="_blank" rel="noreferrer">WhatsApp</a>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table>}</div>
      </div>
    </>}
    {matchRow&&<div className="qrpay-match-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)closeMatch();}}><section className="qrpay-match-dialog" role="dialog" aria-modal="true" aria-labelledby="qrpay-match-title">
      <div className="qrpay-match-head"><div><h2 id="qrpay-match-title">{matchRow.order_no?'Manage QRPay Match':'Match QRPay ke Order'}</h2><p>{matchRow.transaction_id} · {money(matchRow.amount)} · {matchRow.phone||'phone belum jumpa'}</p></div><button className="qrpay-match-close" onClick={closeMatch} aria-label="Close">×</button></div>
      <form className="qrpay-match-search" onSubmit={submitSearch}><input autoFocus value={matchQuery} onChange={(event)=>setMatchQuery(event.target.value)} placeholder="Order ID, phone atau nama customer"/><button className="btn btn-outline" disabled={matchLoading}>Cari</button></form>
      {matchError&&<div className="finance-alert"><b>Match error</b><span>{matchError}</span></div>}
      {matchLoading&&!candidateData?<div className="loading"><span className="spinner"/> Mencari order…</div>:candidateData&&<div className="qrpay-match-body">
        {candidateData.current_order&&<div className="qrpay-current-match"><div><b>Current: {candidateData.current_order.order_no}</b><span>{money(candidateData.current_order.total)} · {candidateData.current_order.status||'-'} · {candidateData.current_order.admin_status||'-'}</span></div><div><span>{candidateData.current_order.clickup_count} ClickUp · {candidateData.current_order.shipment_count} shipment</span></div></div>}
        {candidateData.current_order?.requires_processed_confirmation&&<div className="finance-alert"><b>Order ini sudah diproses</b><span>Item dan ClickUp tidak akan dipadam. Semak kerja sedia ada sebelum unmatch atau relink.</span></div>}
        {candidateData.candidates.length===0?<div className="empty"><div className="empty-title">Order lain tidak dijumpai.</div><div className="cell-sub">Masukkan Order ID penuh seperti IC260808-3730 untuk relink.</div></div>:<div className="qrpay-candidate-list">{candidateData.candidates.map((candidate)=>{const active=selected?.order_id===candidate.order_id;return <button type="button" key={candidate.order_id} disabled={!candidate.can_match} className={`qrpay-candidate ${active?'active':''}`} onClick={()=>setSelected(candidate)}><div><b>{candidate.order_no}</b><span>{candidate.customer_name} · {candidate.phone||'phone tiada'}</span></div><div><b>{money(candidate.total)}</b><span>{candidate.phone_match?'Phone sama':'Phone tidak sama'} · Dibayar {money(candidate.linked_amount)} · Baki {money(candidate.outstanding_before)}</span></div>{candidate.blocked_reason&&<em>{candidate.blocked_reason}</em>}</button>})}</div>}
        {selected&&<div className="qrpay-match-confirm"><div className={selected.settlement_status==='overpaid'||!selected.phone_match?'qrpay-match-warning':'qrpay-match-ok'}><b>QRPay {money(matchRow.amount)} → {selected.order_no} ({money(selected.total)})</b><span>{selected.settlement_status==='partial'?`Selepas match: ${money(selected.paid_after)} dibayar, baki ${money(selected.remaining_after)}. Ini partial/add-on payment.`:selected.settlement_status==='overpaid'?`Gabungan bayaran lebih ${money(selected.overpaid_after)} daripada total order.`:`Gabungan bayaran cukup ${money(selected.paid_after)}.`} {selected.phone_match?'Nombor telefon sepadan.':'Nombor telefon tidak sepadan.'}</span></div><button className="btn btn-primary" disabled={matchLoading||!selected.can_match||(Boolean(candidateData.current_order?.requires_processed_confirmation)&&!confirmProcessed)} onClick={()=>void (candidateData.already_matched?correctMatch('relink'):confirmMatch())}>{matchLoading?'Working…':candidateData.already_matched?'Relink ke Order Ini':selected.settlement_status==='overpaid'||!selected.phone_match?'Confirm Match Dengan Amaran':selected.settlement_status==='partial'?'Confirm Partial Payment':'Confirm Match'}</button></div>}
        {candidateData.already_matched&&candidateData.current_order&&<div className="qrpay-correction-controls">
          {candidateData.current_order.can_cancel_source&&<label className="qrpay-check"><input type="checkbox" checked={cancelSource} onChange={(event)=>setCancelSource(event.target.checked)}/><span><b>Cancel order auto-created asal</b><small>Order ditanda Cancelled; item dan ClickUp kekal untuk audit.</small></span></label>}
          {candidateData.current_order.requires_processed_confirmation&&<label className="qrpay-check qrpay-check-warning"><input type="checkbox" checked={confirmProcessed} onChange={(event)=>setConfirmProcessed(event.target.checked)}/><span><b>Saya faham order ini sudah diproses</b><small>Saya telah semak status ClickUp, kerja production dan shipment.</small></span></label>}
          <div className="qrpay-correction-actions"><button className="btn btn-outline" disabled={matchLoading||(candidateData.current_order.requires_processed_confirmation&&!confirmProcessed)} onClick={()=>void correctMatch('unmatch')}>Unmatch Only</button>{onCreateOrder&&<button className="btn btn-primary" disabled={matchLoading||(candidateData.current_order.requires_processed_confirmation&&!confirmProcessed)} onClick={()=>void correctMatch('unmatch_create')}>Unmatch & Create New Order</button>}</div>
        </div>}
      </div>}
    </section></div>}
    {reviewRow&&<div className="qrpay-match-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)closeReview();}}><section className="qrpay-match-dialog qrpay-review-dialog" role="dialog" aria-modal="true" aria-labelledby="qrpay-review-title">
      <div className="qrpay-match-head"><div><h2 id="qrpay-review-title">{reviewRow.workflow_status==='ignored'?'Review Ignored Payment':'QRPay Remark & Disposition'}</h2><p>{reviewRow.transaction_id} · {money(reviewRow.amount)} · {statusInfo(reviewRow).label}</p></div><button className="qrpay-match-close" onClick={closeReview} aria-label="Close">×</button></div>
      <div className="qrpay-review-form">
        <div className="qrpay-review-policy"><b>Duit masuk kekal dalam Finance</b><span>Ignore hanya keluarkan payment ini daripada queue order baru. Ia tidak memadam transaksi bank atau jumlah QRPay harian.</span></div>
        <label><span>Category</span><select value={reviewCategory} onChange={(event)=>setReviewCategory(event.target.value)}><option value="">Pilih jika mahu ignore…</option>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Remark</span><textarea autoFocus value={reviewRemark} onChange={(event)=>setReviewRemark(event.target.value)} maxLength={2000} rows={5} placeholder="Contoh: Bayaran hutang order lama bulan Julai; bukan order baru."/><small>{reviewRemark.length}/2000</small></label>
        {reviewError&&<div className="finance-alert"><b>Review error</b><span>{reviewError}</span></div>}
        <div className="qrpay-review-actions"><button className="btn btn-outline" disabled={reviewLoading||(reviewRow.workflow_status==='ignored'&&!reviewRemark.trim())} onClick={()=>void submitReview('save_remark')}>{reviewLoading?'Saving…':'Save Remark'}</button>{reviewRow.workflow_status==='ignored'?<button className="btn btn-primary" disabled={reviewLoading} onClick={()=>void submitReview('reopen')}>Reopen for Order</button>:reviewRow.order_no?<span className="cell-sub">Unmatch dahulu sebelum Ignore for Order.</span>:<button className="btn qrpay-ignore-button" disabled={reviewLoading||!reviewCategory||!reviewRemark.trim()} onClick={()=>void submitReview('ignore')}>Ignore for Order</button>}</div>
      </div>
    </section></div>}
    {identityRow&&<div className="qrpay-match-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)closeIdentity();}}><section className="qrpay-match-dialog qrpay-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="qrpay-identity-title">
      <div className="qrpay-match-head"><div><h2 id="qrpay-identity-title">Confirm QRPay Customer</h2><p>{identityRow.transaction_id} · {money(identityRow.amount)}{identityRow.order_no?` · ${identityRow.order_no}`:''}</p></div><button className="qrpay-match-close" onClick={closeIdentity} aria-label="Close">×</button></div>
      <form className="qrpay-identity-form" onSubmit={submitIdentity}>
        <div className="qrpay-review-policy"><b>Admin override untuk transaksi ini sahaja</b><span>Rekod asal bank dan hasil AI tidak diubah. Match Order, Create Order dan WhatsApp selepas ini akan guna contact yang admin sahkan.</span></div>
        {(identityRow.identity_original_name||identityRow.identity_original_phone)&&<div className="qrpay-identity-original"><span>Rekod asal / AI</span><b>{identityRow.identity_original_name||'Nama tidak dikenal pasti'} · {identityRow.identity_original_phone||'phone tiada'}</b></div>}
        <label><span>Customer name</span><input type="text" autoFocus required maxLength={200} value={identityName} onChange={(event)=>setIdentityName(event.target.value)} placeholder="Nama sebenar customer"/></label>
        <label><span>WhatsApp / phone</span><input required inputMode="tel" maxLength={30} value={identityPhone} onChange={(event)=>setIdentityPhone(event.target.value)} placeholder="Contoh: 60123456789"/><small>Format 01…, +601… atau 601… diterima.</small></label>
        {identityRow.order_no&&<label className="qrpay-check"><input type="checkbox" checked={identityUpdateOrder} onChange={(event)=>setIdentityUpdateOrder(event.target.checked)}/><span><b>Update contact pada {identityRow.order_no}</b><small>Nama dan telefon delivery order ini turut dibetulkan. Customer master tidak diubah.</small></span></label>}
        {identityError&&<div className="finance-alert"><b>Update error</b><span>{identityError}</span></div>}
        <div className="qrpay-review-actions"><button type="button" className="btn btn-outline" disabled={identityLoading} onClick={closeIdentity}>Cancel</button><button className="btn btn-primary" disabled={identityLoading||!identityName.trim()||!identityPhone.trim()}>{identityLoading?'Saving…':'Save Admin Confirmation'}</button></div>
      </form>
    </section></div>}
  </div>;
}

function Metric({label,value,hint,cls}:{label:string;value:string;hint:string;cls:string}){return <div className={`stat-card ${cls}`}><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;}

function OrderProgressCell({progress}:{progress:OrderProgress|null}){
  if(!progress)return <span className="cell-sub">Belum linked ke order</span>;
  return <div className="qrpay-order-progress">
    <div className="qrpay-order-progress-head"><span className={`badge ${progressBadgeClass(progress.overall_tone)}`}>{progress.overall_label}</span>{progress.components_total>0&&<b>{progress.progress_percent}%</b>}</div>
    {progress.components_total>0&&<><div className="qrpay-progress-track" aria-label={`${progress.progress_percent}% complete`}><span style={{width:`${progress.progress_percent}%`}}/></div><div className="cell-sub">{progress.components_complete}/{progress.components_total} task complete</div><div className="qrpay-component-list">{progress.components.map((component)=><div className="qrpay-component-chip" key={component.id}><span>{component.label}</span>{component.task_url?<a href={component.task_url} target="_blank" rel="noreferrer" title={component.clickup_status||'Open ClickUp task'}>{component.customer_label||component.clickup_status||'Order Received'} · {component.progress_percent}%</a>:<small>{component.customer_label||'Belum linked ClickUp'} · {component.progress_percent}%</small>}</div>)}</div></>}
    {progress.tracking_number&&<div className="qrpay-tracking-line"><span>{progress.courier||'Courier'} · {progress.tracking_number}</span>{progress.tracking_link&&<a href={progress.tracking_link} target="_blank" rel="noreferrer">Track parcel</a>}</div>}
    <small className="qrpay-progress-source">{progress.shipment_status_group?'Courier status: ParcelDaily':'Task status: ClickUp webhook'}</small>
  </div>;
}
