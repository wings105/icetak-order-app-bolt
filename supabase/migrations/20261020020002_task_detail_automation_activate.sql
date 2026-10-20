-- Deploy task-detail-worker before applying. Disabling this runtime flag pauses every dispatch.
update task_detail_private.runtime set enabled=true where id;
select cron.schedule('icetak-task-detail-automation','* * * * *','select task_detail_private.dispatch();')
where not exists(select 1 from cron.job where jobname='icetak-task-detail-automation');
select task_detail_private.dispatch();
