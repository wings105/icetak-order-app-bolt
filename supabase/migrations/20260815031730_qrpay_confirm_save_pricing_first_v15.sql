do $block$
begin
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='icetak_confirm_qrpay_order_draft'
  ) and not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='icetak_confirm_qrpay_order_draft_v14_core'
  ) then
    alter function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text)
      rename to icetak_confirm_qrpay_order_draft_v14_core;
  end if;
end
$block$;

create or replace function public.icetak_confirm_qrpay_order_draft(
  p_review_token text,
  p_payload jsonb,
  p_corrections jsonb default '[]'::jsonb,
  p_learning_candidates jsonb default '[]'::jsonb,
  p_actor text default 'admin-link'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_saved jsonb;
begin
  p_payload:=public.icetak_apply_draft_price_overrides_v15(coalesce(p_payload,'{}'::jsonb));
  v_saved:=public.icetak_save_qrpay_order_draft(p_review_token,p_payload,p_actor);
  return public.icetak_confirm_qrpay_order_draft_v14_core(
    p_review_token,p_payload,p_corrections,p_learning_candidates,p_actor
  );
end
$function$;

revoke all on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.icetak_confirm_qrpay_order_draft_v14_core(text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text) to service_role;
grant execute on function public.icetak_confirm_qrpay_order_draft_v14_core(text,jsonb,jsonb,jsonb,text) to service_role;
