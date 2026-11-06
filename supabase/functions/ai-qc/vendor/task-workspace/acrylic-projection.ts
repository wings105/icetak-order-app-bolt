type Data=Record<string,any>;
export function acrylicProjection(readiness:Data,record:Data|undefined,saved:Data|null,context:Data={}) {
 const b=record?.brief;if(!b||b.profile!=="acrylic-internal-v1")return readiness;
 const seen=new Set(b.observed_message_ids||b.checked_message_ids||[]);
 const fresh=(context.messages||[]).some((m:Data)=>m.direction==='inbound'&&!m.is_history&&!seen.has(m.id)&&Date.parse(m.created_at)>Date.parse(b.content_changed_at||'')&&
  !/^(?:ok(?:ay)?|baik|noted|thanks?|thank you|tq|👍|🙏)[.!\s]*$/i.test(String(m.text_content||m.caption||'')));
 if(fresh)return {...readiness,status:'review',label:'Mesej baharu · Menunggu AutoBrief Acrylic',print_ready:false,can_confirm:false,acrylic_autobrief:b};
 // A later explicit human confirmation remains authoritative for this exact saved source.
 if(saved?.confirmed&&Date.parse(saved.updated_at)>Date.parse(b.content_changed_at||""))return {...readiness,acrylic_autobrief:b};
 const ready=b.state==="BRIEF_READY"&&b.confirmed===true;
 const reference=b.references?.[0]?.media_url||"";
 const values={...readiness.values,product:"acrylic",quantity:String(b.quantity||readiness.values.quantity||""),size:b.size||readiness.values.size,
  colour:b.colour||readiness.values.colour,mode:reference?"image_wording":"wording",wording:b.wording||"",name:"",age:"",
  artwork:reference,instructions:b.instruction||""};
 const conflicts=(b.conflicts||[]).map((reason:string)=>({field:"wording",label:"AutoBrief Acrylic",value:reason,source:"Sesi order tepat"}));
 return {...readiness,values,status:ready?"ready":b.missing?.length?"missing":"review",
  label:ready?"Info lengkap · AutoBrief Acrylic":"AutoBrief Acrylic · Perlu semakan",
  print_ready:false,confirmed_by:null,can_confirm:ready,confidence:b.confidence,
  missing:(b.missing||[]).map((key:string)=>({key,label:key==="wording_each_unit"?"Wording setiap unit":key})),
  conflicts,evidence:b.proof||[],warnings:[...(b.conflicts||[]),...(b.ai_unavailable?["Analisis tambahan belum tersedia: "+b.ai_unavailable]:[])],
  automation:{...readiness.automation,values,status:ready?'ready':'review',info_status:ready?'ready':'review',remark:'AutoBrief Acrylic: '+b.state},
  confidence_reason:"AutoBrief acrylic: aturan dalaman dahulu; OpenAI hanya jika tidak yakin.",
  acrylic_autobrief:b};
}


