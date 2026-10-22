import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '../types';
import { supabase } from './supabase';
import { getExternalOrderSummary } from './externalOrderSummaries';
import { conversationLifecycle, type LifecycleResult, type ProspectStage } from '../../../../supabase/functions/_shared/conversation-lifecycle.ts';

export function useConversationLifecycle(conversation:Conversation) {
 const id=conversation.id;
 const [state,setState]=useState<{id:string;data?:LifecycleResult;loading:boolean;error?:string}>({id,loading:true});
 const [revision,setRevision]=useState(0),generation=useRef(0);
 const latestInbound=[...conversation.messages].reverse().find(m=>m.direction==='inbound');
 const latestSeller=[...conversation.messages].reverse().find(m=>m.direction==='outbound');
 const evidenceKey=JSON.stringify([id,latestInbound?.id,latestInbound?.content,latestSeller?.id,latestSeller?.content,conversation.orderSession?.session_id,conversation.orderSession?.opened_at,conversation.orderSession?.session_status,conversation.orderSession?.state,conversation.orderSession?.closed_at]);
 const orderOnlyId=typeof conversation.metadata?.orderSummaryId==='string'&&id.startsWith('order-only:')?conversation.metadata.orderSummaryId:null;
 const refresh=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{
  const current=++generation.current;let disposed=false;
  setState(previous=>({id,data:previous.id===id?previous.data:undefined,loading:true}));
  const timer=window.setTimeout(()=>{void(async()=>{
   try{
    let data:LifecycleResult;
    if(orderOnlyId){const order=await getExternalOrderSummary(orderOnlyId);data=conversationLifecycle({conversation:{id,channel:conversation.channel},orders:[{...order,metadata:order.metadata??{},items:order.items.map(i=>({title:i.title??undefined,quantity:i.quantity??undefined})),linked:true,is_primary:true}],messages:[]});}
    else {const response=await supabase.functions.invoke('conversation-lifecycle',{body:{conversation_id:id,action:'read'}});if(response.error||!response.data?.ok||!response.data.lifecycle)throw Error('Status belum tersedia. Cuba semak semula.');data=response.data.lifecycle;}
    if(!disposed&&generation.current===current)setState({id,data,loading:false});
   }catch(e){if(!disposed&&generation.current===current)setState({id,loading:false,error:e instanceof Error?e.message:'Status belum tersedia.'});}
  })();},250);
  return()=>{disposed=true;window.clearTimeout(timer);};
 },[id,evidenceKey,orderOnlyId,revision,conversation.channel]);
 const orderKeys=state.id===id?(state.data?.orders??[]).map(o=>o.id).sort().join(','):'';
 useEffect(()=>{
  let debounce:number|undefined;
  const changed=()=>{window.clearTimeout(debounce);debounce=window.setTimeout(refresh,500);};
  const channel=supabase.channel(`header-lifecycle-${id}`);
  if(!orderOnlyId)channel.on('postgres_changes',{event:'*',schema:'public',table:'conversation_order_links',filter:`conversation_id=eq.${id}`},changed)
   .on('postgres_changes',{event:'*',schema:'public',table:'conversation_prospect_labels',filter:`conversation_id=eq.${id}`},changed);
  for(const orderId of orderKeys.split(',').filter(Boolean))channel.on('postgres_changes',{event:'*',schema:'public',table:'external_order_summaries',filter:`id=eq.${orderId}`},changed);
  channel.subscribe();
  const visible=()=>{if(!document.hidden)refresh();};
  const timer=window.setInterval(visible,60000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
  return()=>{window.clearTimeout(debounce);window.clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);void supabase.removeChannel(channel);};
 },[id,orderOnlyId,orderKeys,refresh]);
 async function setProspect(stage:ProspectStage|null){
  const current=state.id===id?state.data:undefined;if(!current?.prospect_editable)throw Error('Tahap prospek tidak tersedia untuk order ini.');
  const currentGeneration=generation.current;
  const request=await supabase.functions.invoke('conversation-lifecycle',{body:{conversation_id:id,action:'set_prospect',stage,scope_key:current.scope_key}});
  if(request.error||!request.data?.ok)throw Error(request.data?.error||'Gagal menyimpan tahap prospek.');
  // A late save from another conversation must not replace the active header.
  if(generation.current!==currentGeneration){refresh();return;}
  setState(previous=>previous.id===id?{id,data:request.data.lifecycle,loading:false}:previous);
 }
 return {data:state.id===id?state.data:undefined,loading:state.id!==id||state.loading,error:state.id===id?state.error:undefined,refresh,setProspect};
}
