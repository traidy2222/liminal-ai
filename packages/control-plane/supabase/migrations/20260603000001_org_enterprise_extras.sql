-- Team enterprise: audit log, fleet config, org policy

create table if not exists public.org_audit_events (
  id bigserial primary key,
  org_id text not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id),
  session_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists org_audit_events_org_created_idx
  on public.org_audit_events (org_id, created_at desc);

create table if not exists public.org_fleet_config (
  org_id text primary key references public.organizations (id) on delete cascade,
  revision bigint not null default 0,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_policy (
  org_id text primary key references public.organizations (id) on delete cascade,
  revision bigint not null default 0,
  policy jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.org_audit_events enable row level security;
alter table public.org_fleet_config enable row level security;
alter table public.org_policy enable row level security;
