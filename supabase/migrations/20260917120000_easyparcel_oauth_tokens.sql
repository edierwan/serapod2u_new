create table if not exists public.easyparcel_oauth_tokens (
  id smallint primary key default 1 check (id = 1),
  access_token text not null,
  refresh_token text not null default '',
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.easyparcel_oauth_tokens enable row level security;

grant all on table public.easyparcel_oauth_tokens to service_role;
