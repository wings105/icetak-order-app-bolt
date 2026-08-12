-- QRPay AI Draft Review + Human Feedback Learning V1
-- Production migration applied 2026-08-13.
-- Drafts are NOT orders. Real order/payment/ClickUp creation only happens in
-- icetak_confirm_qrpay_order_draft after an admin review.

create table if not exists public.qrpay_order_drafts (
  id uuid primary key default gen_random_uuid(),
  review_token text not null unique default ('qrd_'||replace(gen_random_uuid()::text,'-','')),
  qrpay_job_id uuid unique references public.qrpay_ai_jobs(id) on delete set null,
  unmatched_payment_id uuid references public.unmatched_payment_transactions(id) on delete set null,
  transaction_id text not null unique,
  provider text,
  payment_amount numeric(12,2) not null,
  payment_received_at timestamptz not null,
  payment_snapshot jsonb not null default '{}'::jsonb,
  conversation_id uuid,
  customer_phone text,
  customer_name text,
  match_score numeric,
  match_reason text,
  ai_draft jsonb not null default '{}'::jsonb,
  working_draft jsonb not null default '{}'::jsonb,
  confirmed_draft jsonb,
  evidence jsonb not null default '{}'::jsonb,
  item_subtotal numeric(12,2) not null default 0,
  shipping_fee numeric(12,2) not null default 0,
  draft_total numeric(12,2) not null default 0,
  payment_difference numeric(12,2) not null default 0,
  ai_worker_version text,
  prompt_version text,
  status text not null default 'pending_admin' check(status in('pending_admin','saved','needs_rematch','rejected','confirmed')),
  version integer not null default 1,
  admin_link_sent_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by text,
  rejected_at timestamptz,
  rejected_by text,
  order_id uuid references public.orders(id) on delete set null,
  order_no text,
  last_error text,
  learning_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qrpay_order_drafts_status_idx on public.qrpay_order_drafts(status,updated_at desc);
create index if not exists qrpay_order_drafts_payment_time_idx on public.qrpay_order_drafts(payment_received_at desc);
create index if not exists qrpay_order_drafts_conversation_idx on public.qrpay_order_drafts(conversation_id,payment_received_at desc);

create table if not exists public.qrpay_order_draft_events(
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.qrpay_order_drafts(id) on delete cascade,
  event_type text not null,
  actor text not null default 'system',
  before_data jsonb,
  after_data jsonb,
  diff jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists qrpay_order_draft_events_draft_idx on public.qrpay_order_draft_events(draft_id,created_at);

create table if not exists public.qrpay_ai_learning_rules(
  id uuid primary key default gen_random_uuid(),
  signature text not null unique,
  strategy_key text not null,
  field_group text not null,
  title text not null,
  lesson text not null,
  status text not null default 'candidate' check(status in('candidate','active','rejected')),
  occurrence_count integer not null default 1,
  examples jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by text,
  rejected_at timestamptz,
  rejected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qrpay_ai_learning_rules_status_idx on public.qrpay_ai_learning_rules(status,occurrence_count desc,updated_at desc);

create table if not exists public.qrpay_ai_corrections(
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.qrpay_order_drafts(id) on delete cascade,
  transaction_id text not null,
  field_path text not null,
  correction_type text not null,
  ai_value jsonb,
  human_value jsonb,
  signature text not null,
  strategy_key text not null,
  learning_rule_id uuid references public.qrpay_ai_learning_rules(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(draft_id,field_path,signature)
);
create index if not exists qrpay_ai_corrections_strategy_idx on public.qrpay_ai_corrections(strategy_key,created_at desc);

alter table public.qrpay_order_drafts enable row level security;
alter table public.qrpay_order_draft_events enable row level security;
alter table public.qrpay_ai_learning_rules enable row level security;
alter table public.qrpay_ai_corrections enable row level security;
revoke all on public.qrpay_order_drafts,public.qrpay_order_draft_events,public.qrpay_ai_learning_rules,public.qrpay_ai_corrections from anon,authenticated;
grant all on public.qrpay_order_drafts,public.qrpay_order_draft_events,public.qrpay_ai_learning_rules,public.qrpay_ai_corrections to service_role;

alter table public.admin_order_reviews add column if not exists draft_id uuid references public.qrpay_order_drafts(id) on delete set null;
do $$ begin
  if exists(select 1 from pg_constraint where conname='admin_order_reviews_source_type_check' and conrelid='public.admin_order_reviews'::regclass) then alter table public.admin_order_reviews drop constraint admin_order_reviews_source_type_check; end if;
end $$;
alter table public.admin_order_reviews add constraint admin_order_reviews_source_type_check check(source_type in('qrpay','qrpay_draft','pickup_ai','manual'));
do $$ begin
  if exists(select 1 from pg_constraint where conname='qrpay_ai_jobs_status_check' and conrelid='public.qrpay_ai_jobs'::regclass) then alter table public.qrpay_ai_jobs drop constraint qrpay_ai_jobs_status_check; end if;
end $$;
alter table public.qrpay_ai_jobs add constraint qrpay_ai_jobs_status_check check(status in('waiting','processing','retry','matched','draft_created','order_created','completed','needs_review','unmatched','failed','dry_run_complete'));

create or replace function public.icetak_qrpay_draft_totals(p_payload jsonb)
returns jsonb language sql immutable set search_path='public','pg_temp' as $$
with x as(
  select coalesce(sum(coalesce(nullif(i->>'price','')::numeric,0)*greatest(coalesce(nullif(i->>'qty','')::integer,1),1)),0)::numeric(12,2) item_subtotal,
         coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0)::numeric(12,2) shipping_fee
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))='array' then coalesce(p_payload->'items','[]'::jsonb) else '[]'::jsonb end)i
) select jsonb_build_object('item_subtotal',item_subtotal,'shipping_fee',shipping_fee,'draft_total',round(item_subtotal+shipping_fee,2)) from x;
$$;

create or replace function public.icetak_create_or_update_qrpay_draft(p_job_id uuid,p_payload jsonb,p_internal_token text)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_expected text;v_job public.qrpay_ai_jobs%rowtype;v_unmatched public.unmatched_payment_transactions%rowtype;v_existing public.qrpay_order_drafts%rowtype;v_draft public.qrpay_order_drafts%rowtype;v_totals jsonb;v_work jsonb;v_review_id uuid;v_worker text;
begin
 select setting_value into v_expected from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if v_expected is null or p_internal_token is distinct from v_expected then raise exception 'Unauthorized qrpay AI worker';end if;
 select * into v_job from public.qrpay_ai_jobs where id=p_job_id for update;if not found then raise exception 'qrpay_ai_job_not_found';end if;
 if v_job.order_id is not null then return jsonb_build_object('success',true,'duplicate',true,'reason','job_already_has_order','order_db_id',v_job.order_id,'order_id',v_job.order_no);end if;
 select * into v_existing from public.qrpay_order_drafts where transaction_id=v_job.transaction_id for update;
 if found then return jsonb_build_object('success',true,'duplicate',true,'draft_id',v_existing.id,'review_token',v_existing.review_token,'status',v_existing.status,'transaction_id',v_existing.transaction_id);end if;
 if v_job.unmatched_payment_id is not null then select * into v_unmatched from public.unmatched_payment_transactions where id=v_job.unmatched_payment_id;end if;
 if v_unmatched.id is null then select * into v_unmatched from public.unmatched_payment_transactions where transaction_id=v_job.transaction_id order by created_at desc limit 1;end if;
 if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'AI extracted no order items';end if;
 v_totals:=public.icetak_qrpay_draft_totals(p_payload);
 v_work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('payment_amount',v_job.amount,'total',(v_totals->>'draft_total')::numeric,'draft_total',(v_totals->>'draft_total')::numeric,'delivery_fee',(v_totals->>'shipping_fee')::numeric,'transaction_id',v_job.transaction_id,'payment_received_at',v_job.payment_received_at);
 v_worker:=coalesce(p_payload#>>'{evidence,worker_version}',p_payload#>>'{evidence,extractor}','qrpay-ai-draft-v1');
 insert into public.qrpay_order_drafts(qrpay_job_id,unmatched_payment_id,transaction_id,provider,payment_amount,payment_received_at,payment_snapshot,conversation_id,customer_phone,customer_name,match_score,match_reason,ai_draft,working_draft,evidence,item_subtotal,shipping_fee,draft_total,payment_difference,ai_worker_version,status)
 values(v_job.id,v_unmatched.id,v_job.transaction_id,coalesce(v_job.provider,v_unmatched.provider),v_job.amount,v_job.payment_received_at,jsonb_build_object('provider',coalesce(v_unmatched.provider,v_job.provider),'transaction_id',v_job.transaction_id,'amount',v_job.amount,'paid_at',coalesce(v_unmatched.paid_at,v_job.payment_received_at),'sender_name',v_unmatched.sender_name,'raw_payload',coalesce(v_unmatched.raw_payload,'{}'::jsonb),'raw',coalesce(v_unmatched.raw,'{}'::jsonb)),v_job.matched_conversation_id,nullif(regexp_replace(coalesce(p_payload#>>'{customer,phone}',v_job.matched_phone,''),'[^0-9]','','g'),''),coalesce(nullif(p_payload#>>'{customer,name}',''),v_job.matched_customer_name),coalesce(v_job.match_score,nullif(p_payload->>'match_score','')::numeric),coalesce(v_job.match_reason,p_payload->>'match_reason'),v_work,v_work,coalesce(p_payload->'evidence','{}'::jsonb),(v_totals->>'item_subtotal')::numeric,(v_totals->>'shipping_fee')::numeric,(v_totals->>'draft_total')::numeric,round((v_totals->>'draft_total')::numeric-v_job.amount,2),v_worker,'pending_admin') returning * into v_draft;
 insert into public.qrpay_order_draft_events(draft_id,event_type,actor,after_data,metadata)values(v_draft.id,'ai_draft_created','qrpay-ai-worker',v_work,jsonb_build_object('payment_snapshot',v_draft.payment_snapshot,'worker_version',v_worker));
 insert into public.admin_order_reviews(draft_id,source_type,source_key,qrpay_job_id,transaction_id,amount,candidate_phone,candidate_name,match_score,extraction,evidence,status)
 values(v_draft.id,'qrpay_draft','qrpay:'||v_job.transaction_id,v_job.id,v_job.transaction_id,v_job.amount,v_draft.customer_phone,v_draft.customer_name,v_draft.match_score,v_work,v_draft.evidence,'pending_admin')
 on conflict(source_type,source_key) do update set draft_id=excluded.draft_id,qrpay_job_id=excluded.qrpay_job_id,transaction_id=excluded.transaction_id,amount=excluded.amount,candidate_phone=excluded.candidate_phone,candidate_name=excluded.candidate_name,match_score=excluded.match_score,extraction=excluded.extraction,evidence=excluded.evidence,status='pending_admin',completed_at=null,approved_at=null,rejected_at=null,updated_at=now() returning id into v_review_id;
 update public.qrpay_ai_jobs set status='draft_created',extraction=v_work,evidence=coalesce(v_job.evidence,'{}'::jsonb)||jsonb_build_object('draft_id',v_draft.id,'review_id',v_review_id,'draft_review_token',v_draft.review_token),locked_at=null,completed_at=now(),updated_at=now(),last_error=null where id=v_job.id;
 return jsonb_build_object('success',true,'draft_created',true,'draft_id',v_draft.id,'review_token',v_draft.review_token,'admin_review_id',v_review_id,'transaction_id',v_draft.transaction_id,'payment_amount',v_draft.payment_amount,'draft_total',v_draft.draft_total,'payment_difference',v_draft.payment_difference,'status',v_draft.status);
end;$$;

create or replace function public.icetak_save_qrpay_order_draft(p_review_token text,p_payload jsonb,p_actor text default 'admin-link')
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v public.qrpay_order_drafts%rowtype;x jsonb;w jsonb;
begin select * into v from public.qrpay_order_drafts where review_token=p_review_token for update;if not found then raise exception 'draft_not_found';end if;if v.status in('confirmed','rejected')then raise exception 'draft_locked:%',v.status;end if;if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'At least one item is required';end if;x:=public.icetak_qrpay_draft_totals(p_payload);w:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('payment_amount',v.payment_amount,'total',(x->>'draft_total')::numeric,'draft_total',(x->>'draft_total')::numeric,'delivery_fee',(x->>'shipping_fee')::numeric,'transaction_id',v.transaction_id,'payment_received_at',v.payment_received_at);insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data)values(v.id,'admin_saved',coalesce(nullif(p_actor,''),'admin-link'),v.working_draft,w);update public.qrpay_order_drafts set working_draft=w,customer_phone=nullif(regexp_replace(coalesce(w#>>'{customer,phone}',customer_phone,''),'[^0-9]','','g'),''),customer_name=coalesce(nullif(w#>>'{customer,name}',''),customer_name),item_subtotal=(x->>'item_subtotal')::numeric,shipping_fee=(x->>'shipping_fee')::numeric,draft_total=(x->>'draft_total')::numeric,payment_difference=round((x->>'draft_total')::numeric-payment_amount,2),status='saved',version=version+1,updated_at=now(),last_error=null where id=v.id;update public.admin_order_reviews set extraction=w,candidate_phone=nullif(regexp_replace(coalesce(w#>>'{customer,phone}',candidate_phone,''),'[^0-9]','','g'),''),candidate_name=coalesce(nullif(w#>>'{customer,name}',''),candidate_name),status='pending_admin',updated_at=now()where draft_id=v.id;return(select to_jsonb(q)from public.qrpay_order_drafts q where q.id=v.id);end;$$;

create or replace function public.icetak_reject_qrpay_order_draft(p_review_token text,p_actor text default 'admin-link',p_reason text default null)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v public.qrpay_order_drafts%rowtype;begin select * into v from public.qrpay_order_drafts where review_token=p_review_token for update;if not found then raise exception 'draft_not_found';end if;if v.status='confirmed'then raise exception 'confirmed_draft_cannot_be_rejected';end if;update public.qrpay_order_drafts set status='rejected',rejected_at=now(),rejected_by=coalesce(nullif(p_actor,''),'admin-link'),updated_at=now()where id=v.id;insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,metadata)values(v.id,'admin_rejected',coalesce(nullif(p_actor,''),'admin-link'),v.working_draft,jsonb_build_object('reason',p_reason));update public.admin_order_reviews set status='rejected',rejected_at=now(),completed_at=now(),updated_at=now()where draft_id=v.id;update public.qrpay_ai_jobs set status='needs_review',completed_at=null,locked_at=null,match_reason=coalesce(match_reason,'')||case when coalesce(match_reason,'')=''then''else','end||'admin_rejected_draft',updated_at=now()where id=v.qrpay_job_id and order_id is null;return jsonb_build_object('success',true,'draft_id',v.id,'status','rejected');end;$$;

create or replace function public.icetak_mark_qrpay_draft_needs_rematch(p_review_token text,p_actor text default 'admin-link')
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v public.qrpay_order_drafts%rowtype;begin select * into v from public.qrpay_order_drafts where review_token=p_review_token for update;if not found then raise exception 'draft_not_found';end if;if v.status in('confirmed','rejected')then raise exception 'draft_locked:%',v.status;end if;update public.qrpay_order_drafts set status='needs_rematch',updated_at=now()where id=v.id;insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data)values(v.id,'admin_marked_wrong_customer',coalesce(nullif(p_actor,''),'admin-link'),v.working_draft);update public.admin_order_reviews set status='awaiting_admin_detail',updated_at=now()where draft_id=v.id;update public.qrpay_ai_jobs set status='needs_review',completed_at=null,locked_at=null,match_reason='admin_wrong_customer_needs_rematch',updated_at=now()where id=v.qrpay_job_id and order_id is null;return jsonb_build_object('success',true,'draft_id',v.id,'status','needs_rematch');end;$$;

create or replace function public.icetak_upsert_qrpay_learning_candidates(p_draft_id uuid,p_candidates jsonb,p_actor text default 'system')
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v public.qrpay_order_drafts%rowtype;c jsonb;rid uuid;ids jsonb:='[]'::jsonb;begin select * into v from public.qrpay_order_drafts where id=p_draft_id;if not found then raise exception 'draft_not_found';end if;if jsonb_typeof(coalesce(p_candidates,'[]'::jsonb))<>'array'then return ids;end if;for c in select*from jsonb_array_elements(coalesce(p_candidates,'[]'::jsonb))loop if nullif(c->>'signature','')is null or nullif(c->>'strategy_key','')is null then continue;end if;insert into public.qrpay_ai_learning_rules(signature,strategy_key,field_group,title,lesson,status,occurrence_count,examples,metadata,last_seen_at,updated_at)values(c->>'signature',c->>'strategy_key',coalesce(nullif(c->>'field_group',''),'other'),coalesce(nullif(c->>'title',''),'QRPay correction pattern'),coalesce(nullif(c->>'lesson',''),'Use the human-confirmed value when evidence supports it.'),'candidate',1,jsonb_build_array(jsonb_build_object('draft_id',p_draft_id,'transaction_id',v.transaction_id,'field_path',c->>'field_path','ai_value',c->'ai_value','human_value',c->'human_value')),jsonb_build_object('created_by',p_actor),now(),now())on conflict(signature)do update set occurrence_count=public.qrpay_ai_learning_rules.occurrence_count+1,examples=case when jsonb_array_length(public.qrpay_ai_learning_rules.examples)>=20 then public.qrpay_ai_learning_rules.examples else public.qrpay_ai_learning_rules.examples||excluded.examples end,last_seen_at=now(),updated_at=now()returning id into rid;ids:=ids||jsonb_build_array(rid);end loop;return ids;end;$$;

create or replace function public.icetak_set_qrpay_learning_rule_status(p_rule_id uuid,p_status text,p_actor text default 'admin-link')
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v public.qrpay_ai_learning_rules%rowtype;begin if p_status not in('active','candidate','rejected')then raise exception 'invalid_learning_rule_status';end if;update public.qrpay_ai_learning_rules set status=p_status,activated_at=case when p_status='active'then now()else activated_at end,activated_by=case when p_status='active'then coalesce(nullif(p_actor,''),'admin-link')else activated_by end,rejected_at=case when p_status='rejected'then now()else null end,rejected_by=case when p_status='rejected'then coalesce(nullif(p_actor,''),'admin-link')else null end,updated_at=now()where id=p_rule_id returning*into v;if v.id is null then raise exception 'learning_rule_not_found';end if;insert into public.admin_audit(order_db_id,order_id,action,actor,payload)values(null,null,'qrpay_learning_rule_'||p_status,coalesce(nullif(p_actor,''),'admin-link'),jsonb_build_object('rule_id',v.id,'signature',v.signature,'strategy_key',v.strategy_key,'occurrence_count',v.occurrence_count));return to_jsonb(v);end;$$;

create or replace function public.icetak_qrpay_active_learning_context()
returns jsonb language sql stable security definer set search_path='public','pg_temp' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',id,'signature',signature,'strategy_key',strategy_key,'field_group',field_group,'title',title,'lesson',lesson,'occurrence_count',occurrence_count,'examples',case when jsonb_array_length(examples)>3 then jsonb_build_array(examples->(jsonb_array_length(examples)-3),examples->(jsonb_array_length(examples)-2),examples->(jsonb_array_length(examples)-1))else examples end)order by occurrence_count desc,last_seen_at desc),'[]'::jsonb)from public.qrpay_ai_learning_rules where status='active';
$$;

revoke all on function public.icetak_qrpay_draft_totals(jsonb),public.icetak_create_or_update_qrpay_draft(uuid,jsonb,text),public.icetak_save_qrpay_order_draft(text,jsonb,text),public.icetak_reject_qrpay_order_draft(text,text,text),public.icetak_mark_qrpay_draft_needs_rematch(text,text),public.icetak_upsert_qrpay_learning_candidates(uuid,jsonb,text),public.icetak_set_qrpay_learning_rule_status(uuid,text,text),public.icetak_qrpay_active_learning_context() from public,anon,authenticated;
grant execute on function public.icetak_qrpay_draft_totals(jsonb),public.icetak_create_or_update_qrpay_draft(uuid,jsonb,text),public.icetak_save_qrpay_order_draft(text,jsonb,text),public.icetak_reject_qrpay_order_draft(text,text,text),public.icetak_mark_qrpay_draft_needs_rematch(text,text),public.icetak_upsert_qrpay_learning_candidates(uuid,jsonb,text),public.icetak_set_qrpay_learning_rule_status(uuid,text,text),public.icetak_qrpay_active_learning_context() to service_role;
