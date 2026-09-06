import { useState } from 'react';
import DraftOrders from './DraftOrders';
import DraftFollowUps from './DraftFollowUps';
import './DraftWorkspace.css';

type DraftTab='all'|'followup';

export default function DraftWorkspace({canManage=false,onOpenOrder,onCreateOrder,initialTab='all'}:{canManage?:boolean;onOpenOrder?:(orderNo:string)=>void;onCreateOrder?:()=>void;initialTab?:DraftTab}){
  const [tab,setTab]=useState<DraftTab>(initialTab);
  const selectTab=(next:DraftTab)=>{
    setTab(next);
    const url=new URL(window.location.href);
    url.searchParams.set('view','draft-orders');
    if(next==='followup')url.searchParams.set('draft_tab','followup');else url.searchParams.delete('draft_tab');
    window.history.replaceState({},'',url);
  };
  return <div className="draft-workspace">
    <div className="draft-workspace-head"><div><h1>Draft Orders</h1><p>Semua draft aktif dalam satu tempat. Follow-up ialah draft prepaid yang sudah dihantar kepada customer tetapi belum dibayar.</p></div></div>
    <div className="draft-workspace-tabs" role="tablist" aria-label="Draft workspace views">
      <button role="tab" aria-selected={tab==='all'} className={tab==='all'?'active':''} onClick={()=>selectTab('all')}><span>Semua Draft</span><small>Semak, edit dan payment</small></button>
      <button role="tab" aria-selected={tab==='followup'} className={tab==='followup'?'active':''} onClick={()=>selectTab('followup')}><span>Customer Follow-up</span><small>Prepaid · sudah dihantar · belum bayar</small></button>
    </div>
    <div role="tabpanel">{tab==='all'?<DraftOrders embedded canManage={canManage} onOpenOrder={onOpenOrder} onCreateOrder={onCreateOrder}/>:<DraftFollowUps embedded canManage={canManage}/>}</div>
  </div>;
}
