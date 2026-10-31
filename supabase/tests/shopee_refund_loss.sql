-- Native calculator regression. Synthetic facts only; no order/payment mutations.
do $$
declare r jsonb:='{"status":"TO_RETURN","nett":30.02,"material_total":15.30,"extra_total":0.34,"goods_value":36,"cost_state":"estimated","income_state":"escrow","reviewed":false,"detail_changed":false,"finance_metrics":{"provider_nett":30.02,"refund_total":0,"shipping_net":0,"return_shipping":0}}';
 x jsonb;normal jsonb;
begin
 x:=finance.return_loss_row(r,'{"status":"PROCESSING"}',true);
 assert (x->>'profit')::numeric=-15.64 and (x->>'nett')::numeric=0,'Pending escrow inflated retained income';
 assert x->>'return_phase'='pending' and x->>'profit_state'='estimated' and x->>'reviewed'='false','Pending estimate labelled actual';
 r:=r||'{"nett":-5.19,"income_state":"released","material_total":1.27,"extra_total":0.21,"finance_metrics":{"provider_nett":-5.19,"refund_total":10,"shipping_net":0,"return_shipping":5.19}}';
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-6.67 and (x->>'return_loss_total')::numeric=6.67,'Refund consumed costs missing';
 r:=jsonb_set(jsonb_set(jsonb_set(r,'{nett}','-10.38'),'{finance_metrics,provider_nett}','-10.38'),'{finance_metrics,shipping_net}','-5.19');
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-11.86,'Shipping deducted twice';
 r:=r||'{"nett":8.25,"material_total":15.30,"extra_total":0.34,"finance_metrics":{"provider_nett":8.25,"refund_total":24,"shipping_net":0,"return_shipping":0}}';
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-7.39,'Retained partial-refund revenue lost';
 assert finance.return_loss_row(r,'{"status":"ACCEPTED"}',false)=r,'Unshipped material consumed';
 assert finance.return_loss_row(r,'{"status":"ACCEPTED"}',null)=r,'Unknown shipping assumed';
 x:=finance.return_loss_row(r||'{"material_total":null}','{"status":"ACCEPTED"}',true);
 assert x->>'profit' is null and x->>'profit_state'='incomplete','Unknown material became zero';
 x:=finance.return_loss_row(r||'{"detail_changed":true}','{"status":"ACCEPTED"}',true);
 assert x->>'profit' is null,'Stale material snapshot accepted';
 foreach normal in array array['{"status":"CANCELLED","profit":0}'::jsonb,'{"status":"IN_CANCEL","profit":0}'::jsonb,'{"status":"COMPLETED","profit":20}'::jsonb] loop
  assert finance.return_loss_row(normal,'{}',true)=normal,'Unrelated status changed';
 end loop;
 normal:='{"status":"TO_RETURN","profit":12,"lifecycle_review":true,"finance_metrics":{"refund_total":0}}';
 x:=finance.return_loss_row(normal,'{"status":"CANCELLED"}',true);
 assert x->>'profit'='12' and x->>'lifecycle_review'='false','Cancelled claim consumed revenue';
end $$;
