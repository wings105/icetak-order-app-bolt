-- QRPay AI draft-first flow: 3-minute settlement window and production safety.
create or replace function public.queue_qrpay_ai_job()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if new.transaction_id is null or coalesce(new.amount,0)<=0 then return new; end if;
  insert into public.qrpay_ai_jobs(unmatched_payment_id,transaction_id,provider,amount,payment_received_at,process_after,mode,status,next_attempt_at)
  values(new.id,new.transaction_id,coalesce(new.provider,'duitnow'),new.amount,coalesce(new.paid_at,new.created_at,now()),coalesce(new.paid_at,new.created_at,now())+interval '3 minutes','live','waiting',coalesce(new.paid_at,new.created_at,now())+interval '3 minutes')
  on conflict(transaction_id) do nothing;
  return new;
end $$;

create or replace function public.icetak_guard_ai_production_release()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if lower(coalesce(new.source,'')) in ('qrpay_ai','pickup_ai') and coalesce(new.production_approved,false) then
    if not exists(select 1 from public.order_items i where i.order_id=new.id)
       or exists(select 1 from public.order_items i where i.order_id=new.id and (nullif(trim(coalesce(i.title,'')),'') is null or coalesce(i.qty,0)<1 or nullif(trim(coalesce(i.size,'')),'') is null)) then
      new.production_approved:=false;
      new.status:='AI Draft — Check Needed';
      new.admin_status:='AI Draft — Check Needed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_ai_production_release on public.orders;
create trigger trg_guard_ai_production_release before update of production_approved on public.orders for each row execute function public.icetak_guard_ai_production_release();

-- Production readiness for AI orders additionally requires production_approved.
-- Admin notifications for AI drafts are dispatched immediately; ClickUp remains gated until the order is production-ready.
