create schema if not exists icetak_internal;
create or replace view icetak_internal.whatsapp_reply_examples with(security_invoker=true) as  WITH stream AS (
         SELECT m.id,
            m.conversation_id,
            m.order_id,
            m.channel,
            m.provider_message_id,
            m.direction,
            m.sender_type,
            m.message_type,
            m.text_content,
            m.media_url,
            m.media_metadata,
            m.reply_to_provider_message_id,
            m.status,
            m.failure_code,
            m.failure_reason,
            m.sent_at,
            m.delivered_at,
            m.read_at,
            m.failed_at,
            m.created_at,
            m.source,
            m.sender_phone,
            m.recipient_phone,
            m.recipient_bsuid,
            m.caption,
            m.is_history,
            m.raw_payload,
            m.updated_at,
            m.reactions,
            m.provider_message_type,
            m.source_event_id,
            m.source_received_at,
            m.sender_bsuid,
            m.sender_username,
                CASE
                    WHEN m.direction = 'inbound'::text AND m.sender_type = 'customer'::text THEN 'q'::text
                    WHEN m.direction = 'outbound'::text AND m.sender_type = 'seller'::text AND m.source = 'business_app'::text THEN 'a'::text
                    ELSE 'x'::text
                END AS kind
           FROM messages m
          WHERE m.channel = 'whatsapp'::text
        ), edges AS (
         SELECT stream.id,
            stream.conversation_id,
            stream.order_id,
            stream.channel,
            stream.provider_message_id,
            stream.direction,
            stream.sender_type,
            stream.message_type,
            stream.text_content,
            stream.media_url,
            stream.media_metadata,
            stream.reply_to_provider_message_id,
            stream.status,
            stream.failure_code,
            stream.failure_reason,
            stream.sent_at,
            stream.delivered_at,
            stream.read_at,
            stream.failed_at,
            stream.created_at,
            stream.source,
            stream.sender_phone,
            stream.recipient_phone,
            stream.recipient_bsuid,
            stream.caption,
            stream.is_history,
            stream.raw_payload,
            stream.updated_at,
            stream.reactions,
            stream.provider_message_type,
            stream.source_event_id,
            stream.source_received_at,
            stream.sender_bsuid,
            stream.sender_username,
            stream.kind,
                CASE
                    WHEN lag(stream.kind) OVER w = stream.kind AND (stream.sent_at - lag(stream.sent_at) OVER w) < '12:00:00'::interval THEN 0
                    ELSE 1
                END AS change
           FROM stream
          WINDOW w AS (PARTITION BY stream.conversation_id ORDER BY (COALESCE(stream.sent_at, stream.created_at)), stream.id)
        ), grouped AS (
         SELECT edges.id,
            edges.conversation_id,
            edges.order_id,
            edges.channel,
            edges.provider_message_id,
            edges.direction,
            edges.sender_type,
            edges.message_type,
            edges.text_content,
            edges.media_url,
            edges.media_metadata,
            edges.reply_to_provider_message_id,
            edges.status,
            edges.failure_code,
            edges.failure_reason,
            edges.sent_at,
            edges.delivered_at,
            edges.read_at,
            edges.failed_at,
            edges.created_at,
            edges.source,
            edges.sender_phone,
            edges.recipient_phone,
            edges.recipient_bsuid,
            edges.caption,
            edges.is_history,
            edges.raw_payload,
            edges.updated_at,
            edges.reactions,
            edges.provider_message_type,
            edges.source_event_id,
            edges.source_received_at,
            edges.sender_bsuid,
            edges.sender_username,
            edges.kind,
            edges.change,
            sum(edges.change) OVER (PARTITION BY edges.conversation_id ORDER BY (COALESCE(edges.sent_at, edges.created_at)), edges.id) AS g
           FROM edges
        ), turns AS (
         SELECT grouped.conversation_id,
            grouped.g,
            grouped.kind,
            min(COALESCE(grouped.sent_at, grouped.created_at)) AS first_at,
            max(COALESCE(grouped.sent_at, grouped.created_at)) AS last_at,
            array_agg(grouped.id ORDER BY (COALESCE(grouped.sent_at, grouped.created_at)), grouped.id) AS ids,
            string_agg(COALESCE(NULLIF(grouped.text_content, ''::text), grouped.caption), '
'::text ORDER BY (COALESCE(grouped.sent_at, grouped.created_at)), grouped.id) AS body
           FROM grouped
          GROUP BY grouped.conversation_id, grouped.g, grouped.kind
        )
 SELECT q.conversation_id,
    q.ids AS question_ids,
    a.ids AS answer_ids,
    q.body AS question,
    a.body AS answer
   FROM turns q
     JOIN turns a ON a.conversation_id = q.conversation_id AND a.g = (q.g + 1)
  WHERE q.kind = 'q'::text AND a.kind = 'a'::text AND (a.first_at - q.last_at) < '24:00:00'::interval AND length(TRIM(BOTH FROM q.body)) > 0 AND length(TRIM(BOTH FROM a.body)) > 0;
revoke all on icetak_internal.whatsapp_reply_examples from public,anon,authenticated;
create or replace view icetak_internal.whatsapp_reply_topics with(security_invoker=true) as  SELECT conversation_id,
    question_ids,
    answer_ids,
    question,
    answer,
    array_remove(ARRAY[
        CASE
            WHEN question ~* '(pos|tracking|courier|sampai|deliver)'::text THEN 'Penghantaran'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(pickup|pick up|ambil sendiri)'::text THEN 'Pickup'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(harga|price|berapa ringgit|quotation)'::text THEN 'Harga'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(bayar|payment|transfer|resit)'::text THEN 'Bayaran'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(design|gambar|pdf|format|wording|font)'::text THEN 'Fail dan design'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(simpan|peti ais|peti sejuk)'::text THEN 'Penyimpanan'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(makan|edible|wafer)'::text THEN 'Edible dan wafer'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(saiz|size|inci|inch)'::text THEN 'Saiz'::text
            ELSE NULL::text
        END,
        CASE
            WHEN question ~* '(terima kasih|thank you|tq)'::text THEN 'Penghargaan'::text
            ELSE NULL::text
        END], NULL::text) AS categories
   FROM icetak_internal.whatsapp_reply_examples e;
revoke all on icetak_internal.whatsapp_reply_topics from public,anon,authenticated;
create or replace function public.admin_read_whatsapp_examples(p_search text default '',p_category text default '',p_offset integer default 0) returns jsonb language sql stable security definer set search_path='' as $fn$
with classified as (select question_ids[1] id,question,answer,case when cardinality(categories)>0 then categories when question ~* '(order id|shopee|order|checkout)' then array['Tempahan'] when question ~* '(bila|urgent|sempat|siap|cepat)' then array['Masa dan urgent'] when question ~* '(acrylic|akrilik|topper)' then array['Topper'] when question ~* '(potong|cutting|cut)' then array['Potongan'] when question ~* '(confirm|review|semak)' then array['Semakan'] when question ~* '(salam|hello|pagi|^hi\M|^ok|tq|baik)' then array['Sapaan dan pengesahan'] when question ~* '^\s*\[' then array['Media dan lampiran'] else array['Lain-lain'] end topics from icetak_internal.whatsapp_reply_topics), filtered as materialized(select * from classified where (coalesce(p_category,'')='' or p_category=any(topics)) and (coalesce(p_search,'')='' or strpos(lower(question), lower(left(p_search,100)))>0)), page as(select id,left(question,1500) question,left(answer,2000) answer,topics from filtered order by id offset greatest(0,coalesce(p_offset,0)) limit 20) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by id) from page),'[]'::jsonb)); $fn$;
revoke all on function public.admin_read_whatsapp_examples(text,text,integer) from public,anon,authenticated; grant execute on function public.admin_read_whatsapp_examples(text,text,integer) to service_role; notify pgrst,'reload schema';