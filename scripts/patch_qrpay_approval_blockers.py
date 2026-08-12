from pathlib import Path
p=Path('icetak-admin/src/pages/QrPayDailySummary.tsx')
s=p.read_text()
old="""  shipment_status_group:string|null; tracking_number:string|null; tracking_link:string|null; courier:string|null;\n  overall_label:string; overall_tone:'success'|'warning'|'info'|'error'|'neutral';\n"""
new="""  shipment_status_group:string|null; tracking_number:string|null; tracking_link:string|null; courier:string|null;\n  approval_blockers?:string[];\n  overall_label:string; overall_tone:'success'|'warning'|'info'|'error'|'neutral';\n"""
if old not in s: raise SystemExit('OrderProgress type marker not found')
s=s.replace(old,new,1)

marker="""    {progress.tracking_number&&<div className=\"qrpay-tracking-line\"><span>{progress.courier||'Courier'} · {progress.tracking_number}</span>{progress.tracking_link&&<a href={progress.tracking_link} target=\"_blank\" rel=\"noreferrer\">Track parcel</a>}</div>}\n"""
insert="""    {!!progress.approval_blockers?.length&&<div style={{marginTop:6,padding:'6px 8px',borderRadius:8,background:'#fff7ed',color:'#b45309',fontSize:12,fontWeight:700}}>Fix order before approval: {progress.approval_blockers.join(' · ')}</div>}\n"""+marker
if marker not in s: raise SystemExit('tracking marker not found')
s=s.replace(marker,insert,1)

old_action="""{canManage&&progress?.available_actions.map((action)=><button key={action} className=\"btn btn-primary btn-sm\" disabled={orderActionKey!==null} onClick={()=>void runOrderAction(row,action)}>{orderActionKey===`${row.transaction_id}:${action}`?'Updating…':actionLabels[action]}</button>)}"""
new_action="""{canManage&&progress&&!progress.production_approved&&Boolean(progress.approval_blockers?.length)&&<button className=\"btn btn-outline btn-sm\" onClick={()=>onOpenOrder?.(row.order_no!)}>Fix Order</button>}{canManage&&progress?.available_actions.map((action)=><button key={action} className=\"btn btn-primary btn-sm\" disabled={orderActionKey!==null} onClick={()=>void runOrderAction(row,action)}>{orderActionKey===`${row.transaction_id}:${action}`?'Updating…':actionLabels[action]}</button>)}"""
if old_action not in s: raise SystemExit('proceed action marker not found')
s=s.replace(old_action,new_action,1)
p.write_text(s)
