begin;

create or replace function public.after_whatsapp_message_insert()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_effective_at timestamptz;
begin
  if new.channel = 'whatsapp'
     and new.direction = 'inbound'
     and coalesce(new.is_history, false) = false then
    v_effective_at := coalesce(new.sent_at, new.created_at, now());

    update public.conversations as c
    set last_customer_message_at = greatest(
          coalesce(c.last_customer_message_at, v_effective_at),
          v_effective_at
        ),
        last_inbound_at = greatest(
          coalesce(c.last_inbound_at, v_effective_at),
          v_effective_at
        ),
        last_message_at = greatest(
          coalesce(c.last_message_at, v_effective_at),
          v_effective_at
        ),
        last_message_sender = case
          when c.last_message_at is null or v_effective_at >= c.last_message_at then 'customer'
          else c.last_message_sender
        end,
        window_expires_at = greatest(
          coalesce(c.window_expires_at, v_effective_at + interval '24 hours'),
          v_effective_at + interval '24 hours'
        ),
        window_status = case
          when greatest(
            coalesce(c.window_expires_at, v_effective_at + interval '24 hours'),
            v_effective_at + interval '24 hours'
          ) > now() then 'open'
          else 'expired'
        end,
        updated_at = now()
    where c.id = new.conversation_id
      and (
        c.last_customer_message_at is null
        or v_effective_at > c.last_customer_message_at
        or c.last_inbound_at is null
        or v_effective_at > c.last_inbound_at
        or c.window_expires_at is null
        or v_effective_at + interval '24 hours' > c.window_expires_at
      );
  end if;

  if new.media_url like 'wasapflow-media://%' then
    insert into public.message_media(
      message_id,
      provider_media_id,
      media_type,
      download_status
    ) values (
      new.id,
      replace(new.media_url, 'wasapflow-media://', ''),
      new.message_type,
      'pending'
    )
    on conflict (message_id) do nothing;
  end if;

  return new;
end;
$function$;

with latest_customer_message as (
  select
    conversation_id,
    max(coalesce(sent_at, created_at)) as latest_customer_at
  from public.messages
  where channel = 'whatsapp'
    and direction = 'inbound'
    and coalesce(is_history, false) = false
  group by conversation_id
)
update public.conversations as c
set last_customer_message_at = l.latest_customer_at,
    last_inbound_at = greatest(coalesce(c.last_inbound_at, l.latest_customer_at), l.latest_customer_at),
    last_message_at = greatest(coalesce(c.last_message_at, l.latest_customer_at), l.latest_customer_at),
    window_expires_at = l.latest_customer_at + interval '24 hours',
    window_status = case
      when l.latest_customer_at + interval '24 hours' > now() then 'open'
      else 'expired'
    end,
    updated_at = now()
from latest_customer_message as l
where c.id = l.conversation_id
  and c.channel = 'whatsapp'
  and (
    c.last_customer_message_at is distinct from l.latest_customer_at
    or c.last_inbound_at is null
    or c.last_inbound_at < l.latest_customer_at
    or c.window_expires_at is distinct from l.latest_customer_at + interval '24 hours'
  );

commit;
