-- Website checkout joins the same customer-phone lifecycle window after 15 minutes.
create or replace function public.icetak_autobrief_direct_scope(p_order_id uuid,p_task_id text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare o public.orders; i public.order_items; se public.order_sessions; d public.qrpay_order_drafts;
 v_phone text; start_at timestamptz; end_at timestamptz; n integer; selected uuid; convo uuid;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or not exists(select 1 from public.ai_clickup_work_snapshots s where s.task_id=p_task_id and s.order_id=o.id and s.marketplace_order_id is null and s.list_id='18375902' and lower(btrim(s.clickup_status))='design editing -topper') then return jsonb_build_object('eligible',false,'reason','EXACT_ORDER_TASK_REQUIRED');end if;
 if lower(coalesce(o.status,'')) ~ 'cancel|shipped|complete|delivered|collected' or lower(coalesce(o.shipment_status_group,'')) ~ 'shipped|delivered|collected' or o.production_completed_at is not null or o.pickup_collected_at is not null or o.delivered_at is not null then return jsonb_build_object('eligible',false,'reason','ORDER_CLOSED');end if;
 select count(*),min(pc.order_item_id::text)::uuid into n,selected from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id=p_task_id;
 if n<>1 or selected is null then return jsonb_build_object('eligible',false,'reason','EXACT_COMPONENT_REQUIRED');end if;
 select * into i from public.order_items where id=selected and order_id=o.id and product_type='printed';
 if not found then return jsonb_build_object('eligible',false,'reason','PRINTED_TOPPER_ONLY');end if;
 select count(*) into n from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_DRAFT_SESSIONS');end if;
 select * into d from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if d.id is not null then
  select * into se from public.order_sessions where id=d.order_session_id and order_id=o.id;
  if not found or (d.conversation_id is not null and se.conversation_id is distinct from d.conversation_id) then return jsonb_build_object('eligible',false,'reason','DRAFT_SESSION_MISMATCH');end if;
 else
  select count(*) into n from public.order_sessions where order_id=o.id;
  if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_ORDER_SESSIONS');end if;
  select * into se from public.order_sessions where order_id=o.id;
 end if;
 convo:=coalesce(se.conversation_id,d.conversation_id);
 select regexp_replace(coalesce(nullif(se.customer_phone,''),nullif(d.customer_phone,''),nullif(o.delivery_phone,''),c.phone,''),'[^0-9]','','g') into v_phone from public.customers c where c.id=o.customer_id;
 if left(v_phone,1)='0' then v_phone:='6'||v_phone;elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;end if;
 start_at:=coalesce(se.opened_at,o.created_at);
 if se.id is null and o.source in ('customer','customer_portal') then
  if coalesce(length(v_phone),0) not between 9 and 15 then return jsonb_build_object('eligible',false,'reason','CHECKOUT_PHONE_REQUIRED');end if;
  if exists(select 1 from public.order_sessions pending where pending.customer_phone=v_phone and pending.created_at<=o.created_at and pending.order_id is null and pending.status in ('open','draft_created','ready_customer','customer_confirmed','awaiting_payment','paid')) then return jsonb_build_object('eligible',false,'reason','UNBOUND_CHECKOUT_SESSION');end if;
  -- Same lifecycle boundary as a draft phone session, excluding this checkout
  -- and all future orders. Reading a session never creates or converts a draft.
  select greatest(o.created_at-interval '45 days',coalesce(max(b.at),o.created_at-interval '45 days')) into start_at
  from (
   select coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at) at
   from public.order_sessions previous
   where previous.order_id is distinct from o.id and previous.customer_phone=v_phone
    and previous.status in ('converted','closed')
    and coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at)<=o.created_at
   union all
   select previous.created_at from public.orders previous join public.customers pc on pc.id=previous.customer_id
   where previous.id<>o.id and previous.created_at<=o.created_at and
    (previous.customer_id=o.customer_id or
     case when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='0' then '6'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='1' then '60'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      else regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g') end=v_phone)
   union all
   select greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)
   from public.qrpay_order_drafts previous join public.orders po on po.id=previous.order_id
   where previous.order_id<>o.id and previous.status='confirmed' and po.created_at<=o.created_at
    and greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)<=o.created_at
    and (po.customer_id=o.customer_id or regexp_replace(coalesce(previous.customer_phone,''),'[^0-9]','','g')=v_phone)
  ) b;
 end if;
 -- The next session starts at its previous closed-order boundary, not its later trigger.
 select min(s.opened_at) into end_at from public.order_sessions s where s.id is distinct from se.id and s.created_at>coalesce(se.created_at,o.created_at) and ((convo is not null and s.conversation_id=convo) or (v_phone<>'' and s.customer_phone=v_phone));
 select least(end_at,min(other.created_at)) into end_at from public.orders other join public.customers c on c.id=other.customer_id where other.id<>o.id and other.created_at>o.created_at and (other.customer_id=o.customer_id or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone);
 if end_at is not null and end_at<=start_at then return jsonb_build_object('eligible',false,'reason','SESSION_BOUNDARY_CONFLICT');end if;
 return jsonb_build_object('eligible',true,'order_id',o.id,'order_no',o.order_no,'placed_at',o.created_at,'source',o.source,'delivery',o.delivery_method,'payment_status',o.payment_status,
 'session_source',case when se.id is not null then 'canonical_session' when o.source in ('customer','customer_portal') then 'website_phone_session' else 'checkout_window' end,'session_id',se.id,'draft_id',d.id,'conversation_id',convo,'phone',v_phone,'start_at',start_at,'end_at',end_at,
 'single_item_scope',(select count(*)=1 and coalesce(max(qty),0)=1 from public.order_items where order_id=o.id),
 'target_item_id',i.id,'note',case when coalesce(nullif(i.custom_text,''),i.wording,'') ~* '^(CN|YS)[0-9]{3,6}( SG)?$' then '' else coalesce(nullif(i.custom_text,''),i.wording,'') end,
 'items',(select jsonb_agg(jsonb_build_object('item_sku',coalesce(x.product_snapshot->>'sku',x.catalog_slug,x.title),'title',x.title,'quantity',x.qty,'provider_item_id',x.product_id,'local_item_id',x.id)) from public.order_items x where x.order_id=o.id));
end $$;
revoke all on function public.icetak_autobrief_direct_scope(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_autobrief_direct_scope(uuid,text) to service_role;
notify pgrst,'reload schema';
