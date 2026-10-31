-- Derived read model only. Canonical orders/payments and custom tags are unchanged.
create table public.conversation_lifecycle_index (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 revision bigint not null default 1,
 resolved_revision bigint not null default 0,
 stage text not null default 'unknown' check(stage in ('survey','interested','awaiting_confirm','not_proceeding','draft','unpaid','design','review','edit','printing','printed','task_complete','pickup','shipped','completed','cancelling','cancelled','return','unknown')),
 checked_at timestamptz,
 policy_version integer not null default 1
);
alter table public.conversation_lifecycle_index enable row level security;
revoke all on public.conversation_lifecycle_index from public,anon,authenticated;
grant select on public.conversation_lifecycle_index to authenticated;
grant all on public.conversation_lifecycle_index to service_role;
create policy lifecycle_index_staff_read on public.conversation_lifecycle_index for select to authenticated using(exists(select 1 from public.workspace_members where auth_user_id=(select auth.uid()) and active and role in ('owner','admin','designer','production','support','viewer')));
insert into public.conversation_lifecycle_index(conversation_id) select id from public.conversations on conflict do nothing;

create or replace function private.invalidate_conversation_lifecycle_index() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 if tg_table_name='conversations' then
  ids:=array[new.id];
 elsif tg_table_name in ('messages','conversation_order_links','conversation_prospect_labels') then
  if tg_op='DELETE' then ids:=array[old.conversation_id];
  elsif tg_op='UPDATE' then ids:=array[old.conversation_id,new.conversation_id];else ids:=array[new.conversation_id];end if;
 elsif tg_table_name='external_order_summaries' then
  select array_agg(distinct c.id) into ids from public.conversations c
  where exists(select 1 from public.conversation_order_links l where l.conversation_id=c.id and l.unlinked_at is null and l.source_project=new.source_project and l.order_no=new.order_no)
   or (c.channel='shopee' and new.source_channel='shopee' and c.external_customer_id=new.shopee_buyer_id and (nullif(c.metadata->>'shop_id','') is null or c.metadata->>'shop_id'=new.shop_id))
   or exists(select 1 from public.customer_identities i where i.customer_id=c.customer_id and i.normalized_phone=new.customer_phone_normalized and nullif(i.normalized_phone,'') is not null);
 elsif tg_table_name='customer_identities' then
  select array_agg(c.id) into ids from public.conversations c where c.customer_id=case when tg_op='DELETE' then old.customer_id else new.customer_id end or (tg_op='UPDATE' and c.customer_id=old.customer_id);
 end if;
 insert into public.conversation_lifecycle_index(conversation_id) select distinct id from unnest(ids) id where id is not null
 on conflict(conversation_id) do update set revision=public.conversation_lifecycle_index.revision+1;
 return null;
end $$;
revoke all on function private.invalidate_conversation_lifecycle_index() from public,anon,authenticated;
create trigger lifecycle_index_conversation after insert or update of customer_id,external_customer_id,metadata on public.conversations for each row execute function private.invalidate_conversation_lifecycle_index();
create trigger lifecycle_index_message after insert or update of text_content,caption,direction,created_at,sender_type or delete on public.messages for each row execute function private.invalidate_conversation_lifecycle_index();
create trigger lifecycle_index_links after insert or update or delete on public.conversation_order_links for each row execute function private.invalidate_conversation_lifecycle_index();
create trigger lifecycle_index_prospect after insert or update or delete on public.conversation_prospect_labels for each row execute function private.invalidate_conversation_lifecycle_index();
create trigger lifecycle_index_order after insert or update on public.external_order_summaries for each row execute function private.invalidate_conversation_lifecycle_index();
create trigger lifecycle_index_identity after insert or update or delete on public.customer_identities for each row execute function private.invalidate_conversation_lifecycle_index();

create or replace function public.icetak_lifecycle_index_sources(p_ids uuid[],p_force boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb:='[]';r record;fresh boolean;
begin
 if not exists(select 1 from public.workspace_members where auth_user_id=auth.uid() and active and role in ('owner','admin','designer','production','support','viewer')) then raise exception 'Active staff required' using errcode='42501';end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 40 then raise exception 'Expected 1 to 40 IDs' using errcode='22023';end if;
 for r in select c.id,i.revision,i.resolved_revision,i.stage,i.checked_at,i.policy_version from public.conversations c left join public.conversation_lifecycle_index i on i.conversation_id=c.id where c.id=any(p_ids) loop
  fresh:=not p_force and r.revision=r.resolved_revision and r.policy_version=1 and r.checked_at>now()-interval '5 minutes';
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'revision',r.revision,'cached',case when fresh then jsonb_build_object('stage',r.stage,'checked_at',r.checked_at) end,'source',case when not coalesce(fresh,false) then public.icetak_conversation_lifecycle_source(r.id) end));
 end loop;
 return result;
end $$;
revoke all on function public.icetak_lifecycle_index_sources(uuid[],boolean) from public,anon;
grant execute on function public.icetak_lifecycle_index_sources(uuid[],boolean) to authenticated;

create or replace function public.icetak_lifecycle_index_store(p_id uuid,p_revision bigint,p_stage text,p_checked_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_checked_at is null or p_checked_at<now()-interval '2 minutes' or p_checked_at>now()+interval '1 minute' then return false;end if;
 update public.conversation_lifecycle_index set stage=p_stage,checked_at=p_checked_at,resolved_revision=p_revision,policy_version=1 where conversation_id=p_id and revision=p_revision and (checked_at is null or checked_at<=p_checked_at);
 return found;
end $$;
revoke all on function public.icetak_lifecycle_index_store(uuid,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.icetak_lifecycle_index_store(uuid,bigint,text,timestamptz) to service_role;
