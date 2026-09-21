-- UPU participates in the existing service-only admission/cooldown protocol.
begin;
alter table public.tracking_provider_health drop constraint tracking_provider_health_provider_check;
alter table public.tracking_provider_health add constraint tracking_provider_health_provider_check
  check (provider in ('17TRACK', 'ParcelsApp', 'Ship24', 'Postal Ninja', 'UPU'));
commit;
