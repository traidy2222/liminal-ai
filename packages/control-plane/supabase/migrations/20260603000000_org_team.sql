-- Organizations, membership, and cloud memory stores (Pro + Team)

create table if not exists public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id text not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_id_idx on public.org_members (user_id);

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  token text not null unique,
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Pro: per-user notes blob (cross-device sync)
create table if not exists public.user_memory_notes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  revision bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Team: org + workspace partition
create table if not exists public.org_memory_notes (
  org_id text not null references public.organizations (id) on delete cascade,
  workspace_fingerprint text not null,
  note_key text not null,
  revision bigint not null default 0,
  payload jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, workspace_fingerprint, note_key)
);

create index if not exists org_memory_notes_org_ws_idx
  on public.org_memory_notes (org_id, workspace_fingerprint);

-- Team bus envelopes (short TTL via periodic cleanup job)
create table if not exists public.org_memory_bus (
  id bigserial primary key,
  org_id text not null,
  workspace_fingerprint text not null,
  bus_key text not null,
  envelope jsonb not null,
  publisher_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists org_memory_bus_lookup_idx
  on public.org_memory_bus (org_id, workspace_fingerprint, created_at desc);

-- Pro session history chunks
create table if not exists public.user_session_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id text not null,
  chunk_index int not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists user_session_history_user_session_idx
  on public.user_session_history (user_id, session_id);

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;
alter table public.user_memory_notes enable row level security;
alter table public.org_memory_notes enable row level security;
alter table public.org_memory_bus enable row level security;
alter table public.user_session_history enable row level security;
