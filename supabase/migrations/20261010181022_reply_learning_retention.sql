select cron.schedule('reply-learning-retention','11 3 * * *',$retention$
 delete from public.reply_style_receipts where created_at<now()-interval '30 days';
 delete from public.reply_suggestion_latest where created_at<now()-interval '7 days';
 delete from public.reply_wording w where not exists(select 1 from public.reply_knowledge a where a.id=w.article_id and a.published_version=w.article_version);
$retention$);
