// Recover current buyer identity inside the Order project; historical replay is skipped by the caller.
export function buyerIdentity(payload:any,receivedAt:string){
 const d=payload?.data,m=d?.content;if(d?.type!=="message"||!m)return null;
 const txt=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
 const shop=txt(payload.shop_id),from=txt(m.from_shop_id),to=txt(m.to_shop_id),status=txt(m.status).toLowerCase();
 const inbound=(shop&&to===shop)||status==='user_chat',outbound=(shop&&from===shop)||status==='shop_chat';
 if(!inbound&&!outbound)return null;
 const username=txt(inbound?m.from_user_name:m.to_user_name),id=txt(inbound?m.from_id:m.to_id);
 if(!username||!id)return null;
 const stamp=Number(m.created_timestamp);const observed=Number.isFinite(stamp)&&stamp>0&&stamp<8640000000000?new Date(stamp*1000).toISOString():receivedAt;
 return {p_username:username,p_user_id:id,p_buyer_shop_id:txt(inbound?m.from_shop_id:m.to_shop_id)||null,p_region:shop==='1635364464'?'SG':shop==='188218638'?'MY':txt(d.region).toUpperCase()||'MY',p_observed_at:observed};
}
