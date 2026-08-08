do $$
declare
  def text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef('public.icetak_admin_order_detail_v2(text)'::regprocedure) into def;
  old_text := '''id'',i.id,''k'',coalesce(i.k,i.product_type,''''),''title'',coalesce(i.title,i.product_type,''Item''),''qty'',coalesce(i.qty,1),''price'',coalesce(i.price,0),''size'',coalesce(i.size,''''),''style'',coalesce(i.style,''''),''customText'',coalesce(i.custom_text,i.wording,''''),''workflow'',coalesce(i.workflow,''''),''reviewRequired'',coalesce(i.review_required,false),''previewUrl'',coalesce(i.design_preview_url,''''),''components''';
  new_text := '''id'',i.id,''k'',coalesce(i.k,i.product_type,''''),''title'',coalesce(i.title,i.product_type,''Item''),''productId'',i.product_id,''catalogSlug'',coalesce(i.catalog_slug,''''),''catalogClickupTaskId'',coalesce(i.catalog_clickup_task_id,''''),''process'',coalesce(i.customization->>''admin_process'',''Pre-order''),''qty'',coalesce(i.qty,1),''price'',coalesce(i.price,0),''size'',coalesce(i.size,''''),''style'',coalesce(i.style,''''),''customText'',coalesce(i.custom_text,i.wording,''''),''workflow'',coalesce(i.workflow,''''),''reviewRequired'',coalesce(i.review_required,false),''previewUrl'',coalesce(i.design_preview_url,''''),''components''';
  if strpos(def,old_text)=0 then raise exception 'order detail item marker not found'; end if;
  def:=replace(def,old_text,new_text);
  execute def;
end $$;
