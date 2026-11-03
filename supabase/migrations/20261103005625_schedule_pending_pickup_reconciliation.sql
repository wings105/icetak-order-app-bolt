-- Periodic webhook recovery plus one fresh check before the daily admin digest.
select cron.schedule('icetak-pending-pickup-reconcile','*/30 * * * *','select public.icetak_pending_pickup_poll_kick()');
select cron.schedule('icetak-pending-pickup-pre-digest','55 8 * * *','select public.icetak_pending_pickup_poll_kick()');
