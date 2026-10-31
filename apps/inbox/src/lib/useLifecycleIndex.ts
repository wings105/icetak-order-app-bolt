import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '../types';
import { supabase } from './supabase';
import { LIFECYCLE_LABELS, type LifecycleStage } from '../../../../supabase/functions/_shared/conversation-lifecycle';
export interface LifecycleIndexRow {conversation_id:string;stage:LifecycleStage;checked_at:string|null;pending?:boolean}
export const LIFECYCLE_EVENT='icetak-lifecycle-resolved';
export function useLifecycleIndex(conversations:Conversation[]){
 const [rows,setRows]=useState<Record<string,LifecycleIndexRow>>({}),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [revision,setRevision]=useState(0),generation=useRef(0);
 const idsKey=conversations.map(c=>c.id).filter(id=>!id.startsWith('order-only:')).join(',');
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  const ids=idsKey.split(',').filter(Boolean);let stopped=false;const run=++generation.current;
  if(!ids.length){setLoading(false);return;}
  setLoading(true);setError('');
  void(async()=>{
   try{
    // Bounded batches, no per-row canonical requests from the browser.
    const snapshot:any[]=[];
    for(let from=0;;from+=500){
     const page=await supabase.from('conversation_lifecycle_index').select('conversation_id,stage,checked_at,revision,resolved_revision,policy_version').order('conversation_id').range(from,from+499);
     if(page.error)throw Error('Status belum tersedia. Cuba semula.');
     snapshot.push(...page.data);if(page.data.length<500)break;
    }
    if(stopped||run!==generation.current)return;
    const active=new Set(conversations.filter(c=>Date.now()-(c.lastMessageAt?.getTime()||0)<86400000).map(c=>c.id));
    const fresh=snapshot.filter(r=>r.revision===r.resolved_revision&&r.policy_version===1&&r.checked_at&&Date.now()-Date.parse(r.checked_at)<(active.has(r.conversation_id)?300000:900000));
    const cached=new Set(fresh.map(r=>r.conversation_id));
    setRows(previous=>{const next={...previous};for(const row of fresh){const old=next[row.conversation_id];if(!old?.checked_at||Date.parse(row.checked_at)>=Date.parse(old.checked_at))next[row.conversation_id]=row;}for(const id of ids)if(!cached.has(id))delete next[id];return next;});
    const pending=ids.filter(id=>!cached.has(id));
    for(let offset=0;offset<pending.length;offset+=160){
     if(stopped||document.hidden)break;
     await Promise.all([offset,offset+40,offset+80,offset+120].filter(i=>i<pending.length).map(async i=>{
     const result=await supabase.functions.invoke('conversation-lifecycle',{body:{action:'list',conversation_ids:pending.slice(i,i+40)}});
     if(stopped||run!==generation.current)return;
     if(result.error||!result.data?.ok||!Array.isArray(result.data.statuses)){setRows(previous=>{const next={...previous};for(const id of pending.slice(i,i+40))delete next[id];return next;});throw Error('Semakan status belum lengkap. Cuba semula.');}
     setRows(previous=>{const next={...previous};for(const row of result.data.statuses)if(row.stage in LIFECYCLE_LABELS){const old=next[row.conversation_id];if(!old?.checked_at||!row.checked_at||Date.parse(row.checked_at)>=Date.parse(old.checked_at))next[row.conversation_id]=row;}return next;});
     }));
    }
   }catch(e){if(!stopped)setError(e instanceof Error?e.message:'Semakan status gagal.');}
   finally{if(!stopped&&run===generation.current)setLoading(false);}
  })();
  return()=>{stopped=true;};
 },[idsKey,revision]);
 useEffect(()=>{
  const resolved=(event:Event)=>{const row=(event as CustomEvent<LifecycleIndexRow>).detail;if(row?.conversation_id&&row.stage in LIFECYCLE_LABELS)setRows(previous=>({...previous,[row.conversation_id]:row}));};
  const visible=()=>{if(!document.hidden)refresh();};
  window.addEventListener(LIFECYCLE_EVENT,resolved);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
  const timer=window.setInterval(visible,60000);
  return()=>{window.clearInterval(timer);window.removeEventListener(LIFECYCLE_EVENT,resolved);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
 },[refresh]);
 // No stale stage participates in a filter while its source may have changed.
 const now=Date.now(),fresh:Record<string,LifecycleIndexRow>={};
 for(const c of conversations){const row=rows[c.id];if(row&&!row.pending&&row.checked_at&&now-Date.parse(row.checked_at)<(now-(c.lastMessageAt?.getTime()||0)<86400000?300000:900000)&&Date.parse(row.checked_at)>=Math.max(c.lastMessageAt?.getTime()||0,c.lastInboundAt?.getTime()||0))fresh[c.id]=row;}
 return {rows:fresh,loading,error,refresh,checked:Object.keys(fresh).length,total:conversations.length};
}
