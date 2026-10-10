-- Deny browser access explicitly; staff services authorize before reading.
do $$declare t text;begin foreach t in array array['reply_knowledge','reply_knowledge_events','reply_style','reply_suggestion_latest','reply_style_receipts','reply_wording'] loop execute format('create policy server_only on public.%I for all to anon, authenticated using (false) with check (false)',t);end loop;end;$$;
create index reply_knowledge_event_history on public.reply_knowledge_events(article_id,id desc);
create index reply_suggestion_latest_article on public.reply_suggestion_latest(article_id);
