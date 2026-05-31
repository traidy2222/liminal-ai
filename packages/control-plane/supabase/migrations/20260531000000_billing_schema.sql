-- Vireon control plane: billing + license entitlements
-- Apply with: supabase db push (or paste into Supabase SQL editor)

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_stripe_customer_id_idx on public.profiles (stripe_customer_id);

-- Stripe subscription mirror
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  tier text not null check (tier in ('pro', 'team', 'enterprise')),
  status text not null,
  current_period_end timestamptz,
  seats int not null default 1,
  org_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- Issued license tokens (harness verifies offline; server is source of truth for re-issue)
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_sub text not null unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('pro', 'team', 'enterprise')),
  token text not null,
  expires_at timestamptz not null,
  seats int not null default 1,
  org_id text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists licenses_user_id_idx on public.licenses (user_id);
create index if not exists licenses_active_idx on public.licenses (user_id) where revoked_at is null;

-- Webhook idempotency
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: users read own license row; all writes via service role from control plane
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.licenses enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

create policy licenses_select_own on public.licenses
  for select using (auth.uid() = user_id and revoked_at is null);

-- Service role bypasses RLS; no insert/update policies for clients
