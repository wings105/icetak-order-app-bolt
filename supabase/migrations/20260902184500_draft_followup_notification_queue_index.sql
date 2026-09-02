create index if not exists draft_followup_events_notification_queue_idx
  on public.draft_followup_events(notification_queue_id)
  where notification_queue_id is not null;
