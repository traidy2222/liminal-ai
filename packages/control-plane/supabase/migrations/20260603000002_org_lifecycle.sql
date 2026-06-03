-- Org lifecycle: explicit setup before Team/Enterprise checkout (pending → active on payment)

alter table public.organizations
  add column if not exists status text not null default 'active';

alter table public.organizations
  add column if not exists created_by uuid references public.profiles (id);

alter table public.organizations
  add column if not exists slug text;

update public.organizations set status = 'active' where status is null or status = '';

alter table public.organizations
  drop constraint if exists organizations_status_check;

alter table public.organizations
  add constraint organizations_status_check
  check (status in ('pending', 'active', 'cancelled'));

create unique index if not exists organizations_slug_unique_idx
  on public.organizations (slug)
  where slug is not null;

create index if not exists organizations_status_created_at_idx
  on public.organizations (status, created_at);

create index if not exists organizations_created_by_idx
  on public.organizations (created_by)
  where created_by is not null;
