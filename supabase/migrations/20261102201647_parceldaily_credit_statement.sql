create schema if not exists shipping_credit;
revoke all on schema shipping_credit from public,anon,authenticated;
grant usage on schema shipping_credit to service_role;
create table shipping_credit.account (
 id boolean primary key default true check(id), balance numeric(14,2), provider_balance numeric(14,2),
 checked_at timestamptz, started_at timestamptz not null default now(), lease_until timestamptz,
 last_error text, threshold numeric not null default 20, episode uuid, alert_status text,
 alert_error text, alert_sent_at timestamptz, last_movement_at timestamptz
);
insert into shipping_credit.account(id) values(true);
create table shipping_credit.entries (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('opening','usage','refund','unclassified','topup','adjustment')),
 amount numeric(14,2) not null, shipment_id uuid, reference text, note text,
 occurred_at timestamptz not null default clock_timestamp(), created_at timestamptz not null default clock_timestamp(),
 classified_at timestamptz, classified_by uuid
);
create index on shipping_credit.entries(occurred_at desc);
create table shipping_credit.shipment_totals(shipment_id uuid primary key, amount numeric(14,2) not null);
create table shipping_credit.sync_log(id bigint generated always as identity primary key, checked_at timestamptz not null default clock_timestamp(), balance numeric, error text);
alter table shipping_credit.account enable row level security;
alter table shipping_credit.entries enable row level security;
alter table shipping_credit.shipment_totals enable row level security;
alter table shipping_credit.sync_log enable row level security;
grant all on all tables in schema shipping_credit to service_role;
grant usage,select on all sequences in schema shipping_credit to service_role;
-- Baseline existing shipment totals without inventing historical wallet movements.
insert into shipping_credit.shipment_totals
 select id,case when lower(coalesce(status_group,''))='refunded' then 0 else greatest(charged_amount,0) end
 from public.shipments where provider='parceldaily' and charged_amount is not null and (booked_at is not null or tracking_no is not null);
create function public.icetak_credit_kick() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 select setting_value into token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if coalesce(token,'')='' then return null; end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shipping-credit',headers:=jsonb_build_object('content-type','application/json','x-credit-token',token),body:='{"action":"sync"}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
create function shipping_credit.shipment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare previous numeric; target numeric; delta numeric; a shipping_credit.account;
begin
 if new.provider is distinct from 'parceldaily' or new.charged_amount is null or (new.booked_at is null and new.tracking_no is null) then return new; end if;
 select * into a from shipping_credit.account where id for update;
 insert into shipping_credit.shipment_totals values(new.id,0) on conflict do nothing;
 select amount into previous from shipping_credit.shipment_totals where shipment_id=new.id for update;
 target:=case when lower(coalesce(new.status_group,''))='refunded' then 0 else greatest(new.charged_amount,0) end;
 delta:=previous-target;
 if delta=0 then return new; end if;
 update shipping_credit.shipment_totals set amount=target where shipment_id=new.id;
 insert into shipping_credit.entries(kind,amount,shipment_id,reference,note) values(case when delta<0 then 'usage' else 'refund' end,delta,new.id,coalesce(new.reference,new.tracking_no,new.provider_order_id),'Confirmed shipment charge change');
 update shipping_credit.account set balance=balance+delta,last_movement_at=clock_timestamp() where id;
 perform public.icetak_credit_kick();
 return new;
end $$;
revoke all on function shipping_credit.shipment_changed() from public,anon,authenticated;
create trigger shipment_credit_changed after insert or update of charged_amount,booked_at,tracking_no,status_group on public.shipments for each row execute function shipping_credit.shipment_changed();
create function public.icetak_credit_claim() returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update shipping_credit.account set lease_until=now()+interval '90 seconds' where id and (lease_until is null or lease_until<now());
 return found;
end $$;
create function public.icetak_credit_snapshot(p_balance numeric,p_started timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a shipping_credit.account; delta numeric; k text;
begin
 if p_balance is null or abs(p_balance)>99999999 then raise exception 'INVALID_BALANCE'; end if;
 select * into a from shipping_credit.account where id for update;
 if a.last_movement_at>=p_started then
 update shipping_credit.account set lease_until=null,last_error='Shipment changed during provider read; retry next sync' where id;
 return '{"retry":true}'::jsonb; end if;
 delta:=round(p_balance,2)-case when a.checked_at is null then coalesce((select sum(amount) from shipping_credit.entries),0) else coalesce(a.balance,0) end;
 k:=case when a.checked_at is null then 'opening' else 'unclassified' end;
 if delta<>0 or a.checked_at is null then insert into shipping_credit.entries(kind,amount,note) values(k,delta,case when k='opening' then 'Opening provider balance; earlier topups not reconstructed' else 'Provider reconciliation; classify using receipt or statement' end);end if;
 update shipping_credit.account set balance=round(p_balance,2),provider_balance=round(p_balance,2),checked_at=clock_timestamp(),lease_until=null,last_error=null,
 episode=case when p_balance>=threshold then null else coalesce(episode,gen_random_uuid()) end,
 alert_status=case when p_balance>=threshold then null when episode is null then 'pending' else alert_status end,
 alert_error=case when p_balance>=threshold then null else alert_error end where id;
 insert into shipping_credit.sync_log(balance) values(p_balance);
 return jsonb_build_object('success',true,'balance',p_balance);
end $$;
create function public.icetak_credit_claim_alert() returns jsonb language plpgsql security invoker set search_path='' as $$
declare a shipping_credit.account;
begin
 update shipping_credit.account set alert_status='sending',alert_error=null where id and balance<threshold and checked_at>now()-interval '5 minutes' and alert_status in ('pending','blocked') returning * into a;
 if not found then return null; end if;
 return jsonb_build_object('episode',a.episode,'balance',a.balance,'threshold',a.threshold);
end $$;
create function public.icetak_credit_read(p_month text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('account',(select to_jsonb(a)-'lease_until' from shipping_credit.account a),
 'monthly',(select jsonb_build_object('topup',coalesce(sum(amount) filter(where kind='topup'),0),'usage',-coalesce(sum(amount) filter(where kind='usage'),0),'refund',coalesce(sum(amount) filter(where kind='refund'),0),'unclassified',coalesce(sum(amount) filter(where kind='unclassified'),0),'unclassified_count',count(*) filter(where kind='unclassified')) from shipping_credit.entries where to_char(occurred_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM')=p_month),
 'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at desc),'[]') from (select * from shipping_credit.entries where to_char(occurred_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM')=p_month order by occurred_at desc limit 200)e));
$$;
create function public.icetak_credit_classify(p_id uuid,p_kind text,p_reference text,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_actor is null or p_kind not in ('topup','refund','adjustment') or length(trim(coalesce(p_reference,'')))<3 then raise exception 'RECEIPT_REFERENCE_REQUIRED';end if;
 update shipping_credit.entries set kind=p_kind,reference=trim(p_reference),classified_at=clock_timestamp(),classified_by=p_actor
 where id=p_id and kind='unclassified' and (p_kind='adjustment' or amount>0);
 if not found then raise exception 'ENTRY_NOT_CLASSIFIABLE';end if;
end $$;
revoke all on function public.icetak_credit_kick(),public.icetak_credit_claim(),public.icetak_credit_snapshot(numeric,timestamptz),public.icetak_credit_claim_alert(),public.icetak_credit_read(text),public.icetak_credit_classify(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.icetak_credit_kick(),public.icetak_credit_claim(),public.icetak_credit_snapshot(numeric,timestamptz),public.icetak_credit_claim_alert(),public.icetak_credit_read(text),public.icetak_credit_classify(uuid,text,text,uuid) to service_role;
select cron.schedule('icetak-parceldaily-credit','*/5 * * * *','select public.icetak_credit_kick()');
create function public.icetak_credit_error(p_error text) returns void language sql security invoker set search_path='' as $$
 update shipping_credit.account set lease_until=null,last_error=left(p_error,300) where id;
 insert into shipping_credit.sync_log(error) values(left(p_error,300));
$$;
create function public.icetak_credit_alert_result(p_episode uuid,p_status text,p_error text) returns void language sql security invoker set search_path='' as $$
 update shipping_credit.account set alert_status=p_status,alert_error=left(p_error,300),alert_sent_at=case when p_status='sent' then now() else alert_sent_at end where episode=p_episode and p_status in ('sent','blocked','unknown');
$$;
revoke all on function public.icetak_credit_error(text),public.icetak_credit_alert_result(uuid,text,text) from public,anon,authenticated;
grant execute on function public.icetak_credit_error(text),public.icetak_credit_alert_result(uuid,text,text) to service_role;
