-- Private aggregate bridge; provider needs_reply is descriptive, not resolution authority.
create or replace function public.icetak_command_center_inbox(p_from date,p_to date,p_source text default 'all',p_reviews jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r jsonb; a timestamptz:=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'; b timestamptz:=(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 or p_source not in ('all','icetak','shopee') or jsonb_array_length(p_reviews)>10000 then raise exception 'Invalid request'; end if;
 with c as materialized (
  select c.*,cu.display_name,
   coalesce(msg.id::text||'@'||coalesce(msg.updated_at,msg.created_at)::text,'empty') inbound_revision,
   coalesce(msg.text_content,msg.caption,'[Media]') snippet
  from public.conversations c join public.customers cu on cu.id=c.customer_id
  left join lateral (select id,updated_at,created_at,text_content,caption from public.messages where conversation_id=c.id and direction='inbound' order by created_at desc,id desc limit 1) msg on true
  where c.channel in ('whatsapp','shopee') and (p_source='all' or (p_source='icetak' and c.channel='whatsapp') or (p_source='shopee' and c.channel='shopee'))
 ), reviews as (select * from jsonb_to_recordset(p_reviews) as x(conversation_id uuid,inbound_revision text,status text,snoozed_until timestamptz)),
 reviewed as materialized (
  select c.*,case when r.inbound_revision=c.inbound_revision and r.status='snoozed' and r.snoozed_until>now() then 'snoozed'
   when r.inbound_revision=c.inbound_revision and r.status in ('resolved','waiting_customer') then r.status else 'needs_review' end review_state
  from c left join reviews r on r.conversation_id=c.id
 ), msgs as materialized (
  select m.* from public.messages m where m.created_at>=a and m.created_at<b and m.channel in ('whatsapp','shopee')
   and (p_source='all' or (p_source='icetak' and m.channel='whatsapp') or (p_source='shopee' and m.channel='shopee'))
 ), days as (select generate_series(p_from::timestamp,p_to::timestamp,'1 day')::date d)
 select jsonb_build_object('fetched_at',now(),
 'period',jsonb_build_object('inbound',(select count(*) from msgs where direction='inbound' and not coalesce(is_history,false)),
  'outbound',(select count(*) from msgs where direction='outbound' and not coalesce(is_history,false)),
  'new_conversations',(select count(*) from c where created_at>=a and created_at<b),
  'active_customers',(select count(distinct customer_id) from c where last_inbound_at>=a and last_inbound_at<b),
  'failed',(select count(*) from msgs where status='failed')),
 'attention',jsonb_build_object('needs_review',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at>=now()-interval '30 days'),
  'urgent',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at>=now()-interval '30 days' and (ai_priority_score>=80 or ai_urgency in ('urgent','high'))),
  'waiting_customer',(select count(*) from reviewed where review_state='waiting_customer'),
  'snoozed',(select count(*) from reviewed where review_state='snoozed'),
  'legacy_backlog',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at<now()-interval '30 days')),
 'channels',coalesce((select jsonb_agg(jsonb_build_object('label',channel,'value',n)) from (select channel,count(*) n from msgs where direction='inbound' and not coalesce(is_history,false) group by 1)x),'[]'::jsonb),
 'intents',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(ai_intent,'Belum dianalisis') label,count(*) value from reviewed where last_inbound_at>=a and last_inbound_at<b group by 1 order by 2 desc)x),'[]'::jsonb),
 'aging',jsonb_build_array(
  jsonb_build_object('label','<1 jam','value',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at>now()-interval '1 hour')),
  jsonb_build_object('label','1–4 jam','value',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at between now()-interval '4 hours' and now()-interval '1 hour')),
  jsonb_build_object('label','4–24 jam','value',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at between now()-interval '24 hours' and now()-interval '4 hours')),
  jsonb_build_object('label','1–30 hari','value',(select count(*) from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at between now()-interval '30 days' and now()-interval '24 hours'))),
 'focus',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,display_name name,channel,last_inbound_at,ai_intent intent,ai_priority_score priority,left(snippet,180) snippet
  from reviewed where review_state='needs_review' and not coalesce(archived,false) and last_inbound_at>=now()-interval '30 days'
  order by ai_priority_score desc nulls last,last_inbound_at desc limit 20)x),'[]'::jsonb),
 'trend',coalesce((select jsonb_agg(jsonb_build_object('date',d,'inbound',(select count(*) from msgs where direction='inbound' and not coalesce(is_history,false) and (created_at at time zone 'Asia/Kuala_Lumpur')::date=d),
  'outbound',(select count(*) from msgs where direction='outbound' and not coalesce(is_history,false) and (created_at at time zone 'Asia/Kuala_Lumpur')::date=d)) order by d) from days),'[]'::jsonb),
 'health',jsonb_build_object('last_whatsapp_webhook',(select max(created_at) from public.wasapflow_webhook_events),
  'last_message',(select max(last_message_at) from c),
  'ai_failed',(select count(*) from public.conversation_ai_jobs where status in ('failed','error'))),
 'limitations',jsonb_build_array('Needs review ikut inbound revision dan semakan admin; balasan automation tidak menutup kes.','Priority chat berdasarkan triage sedia ada; customer baru bukan bukti lead jualan.','Perlu tindakan meliputi 30 hari terkini; backlog lebih lama dipisahkan.','Outbound termasuk automation. Masa respons manusia belum dapat disahkan daripada semua provider.')) into r;
 return r;
end $$;
revoke all on function public.icetak_command_center_inbox(date,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_command_center_inbox(date,date,text,jsonb) to service_role;

