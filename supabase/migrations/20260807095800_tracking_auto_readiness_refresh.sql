-- Provider readiness is recalculated whenever the dashboard switch changes.
-- Keep Auto Send OFF after deployment; activation must only happen through the admin dashboard.
update public.tracking_system_settings
set provider_ready = coalesce((public.icetak_tracking_auto_provider_status()->>'ready')::boolean,false),
    provider_error = case
      when coalesce((public.icetak_tracking_auto_provider_status()->>'ready')::boolean,false) then null
      else 'Wasapflow credential, dispatcher or approved tracking template is incomplete'
    end,
    last_provider_check_at = now(),
    auto_send_enabled = false,
    updated_at = now()
where singleton = true;
