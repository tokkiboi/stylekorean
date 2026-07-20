begin;

create extension if not exists pgcrypto;

create type public.member_role as enum ('viewer', 'dispatcher', 'admin');
create type public.shipment_direction as enum ('inbound', 'outbound', 'parcel');
create type public.shipment_state as enum ('scheduled', 'shipping', 'delivered', 'received', 'completed', 'cancelled', 'exception');
create type public.sync_state as enum ('pending', 'processing', 'succeeded', 'failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text not null unique check (email_domain = lower(email_domain)),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  email text not null,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_key text not null,
  label text not null,
  provider text not null,
  direction public.shipment_direction,
  source_url text,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_id uuid not null references public.sources(id),
  external_id text not null,
  direction public.shipment_direction not null,
  mode text,
  status public.shipment_state not null default 'scheduled',
  shipment_number text,
  order_number text,
  invoice_number text,
  container_number text,
  tracking_number text,
  carrier text,
  customer text,
  origin text,
  destination text,
  scheduled_at timestamptz,
  eta_at timestamptz,
  delivered_at timestamptz,
  pallets numeric,
  cartons numeric,
  quantity numeric,
  weight_lbs numeric,
  rate numeric(14,2),
  currency text not null default 'USD',
  notes text,
  source_version text,
  source_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (source_id, external_id)
);

create table public.shipment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_id uuid references public.sources(id),
  state public.sync_state not null default 'pending',
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  rows_rejected integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sync_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  operation text not null check (operation in ('insert', 'update', 'delete')),
  payload jsonb not null,
  state public.sync_state not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index profiles_organization_idx on public.profiles (organization_id, user_id);
create index sources_organization_idx on public.sources (organization_id, enabled);
create index shipments_source_idx on public.shipments (source_id, external_id);
create index shipments_active_schedule_idx on public.shipments (organization_id, direction, scheduled_at)
  where deleted_at is null and status not in ('delivered', 'received', 'completed', 'cancelled');
create index shipments_active_eta_idx on public.shipments (organization_id, direction, eta_at)
  where deleted_at is null and status not in ('delivered', 'received', 'completed', 'cancelled');
create index shipments_tracking_idx on public.shipments (organization_id, tracking_number) where tracking_number is not null;
create index shipment_events_shipment_idx on public.shipment_events (shipment_id, created_at desc);
create index sync_outbox_pending_idx on public.sync_outbox (available_at, id) where state = 'pending';

create or replace function public.current_organization_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where user_id = (select auth.uid())
$$;

create or replace function public.current_member_role() returns public.member_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare org_id uuid;
begin
  if lower(split_part(new.email, '@', 2)) <> 'stylekoreanus.com' then
    raise exception 'Only stylekoreanus.com members are allowed';
  end if;
  select id into org_id from public.organizations where email_domain = 'stylekoreanus.com';
  insert into public.profiles(user_id, organization_id, email, role)
  values (new.id, org_id, lower(new.email), 'viewer');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.update_shipment(
  p_id uuid, p_expected_version bigint, p_patch jsonb
) returns public.shipments
language plpgsql security invoker set search_path = '' as $$
declare changed public.shipments;
begin
  if (select public.current_member_role()) not in ('dispatcher', 'admin') then
    raise exception 'Insufficient role';
  end if;
  update public.shipments set
    status = coalesce((p_patch->>'status')::public.shipment_state, status),
    scheduled_at = case when p_patch ? 'scheduled_at' then (p_patch->>'scheduled_at')::timestamptz else scheduled_at end,
    eta_at = case when p_patch ? 'eta_at' then (p_patch->>'eta_at')::timestamptz else eta_at end,
    carrier = case when p_patch ? 'carrier' then p_patch->>'carrier' else carrier end,
    tracking_number = case when p_patch ? 'tracking_number' then p_patch->>'tracking_number' else tracking_number end,
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
    version = version + 1, updated_at = now()
  where id = p_id and organization_id = (select public.current_organization_id())
    and version = p_expected_version and deleted_at is null
  returning * into changed;
  if changed.id is null then raise exception 'Record changed; refresh and retry'; end if;
  insert into public.shipment_events(organization_id, shipment_id, actor_id, event_type, new_values)
  values (changed.organization_id, changed.id, (select auth.uid()), 'dashboard_update', p_patch);
  insert into public.sync_outbox(organization_id, shipment_id, source_id, operation, payload)
  values (changed.organization_id, changed.id, changed.source_id, 'update', p_patch);
  return changed;
end $$;

insert into public.organizations(name, email_domain)
values ('StyleKorean US', 'stylekoreanus.com') on conflict (email_domain) do nothing;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_outbox enable row level security;

create policy organization_member_read on public.organizations for select to authenticated
using (id = (select public.current_organization_id()));
create policy profile_self_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy source_member_read on public.sources for select to authenticated
using (organization_id = (select public.current_organization_id()));
create policy shipment_member_read on public.shipments for select to authenticated
using (organization_id = (select public.current_organization_id()) and deleted_at is null);
create policy event_member_read on public.shipment_events for select to authenticated
using (organization_id = (select public.current_organization_id()));
create policy run_member_read on public.sync_runs for select to authenticated
using (organization_id = (select public.current_organization_id()));

revoke all on public.sync_outbox from anon, authenticated;
revoke insert, update, delete on public.shipments from anon, authenticated;
grant select on public.organizations, public.profiles, public.sources, public.shipments, public.shipment_events, public.sync_runs to authenticated;
grant execute on function public.update_shipment(uuid, bigint, jsonb) to authenticated;

commit;
