-- Spike schema for ADR 0005, applied to the throwaway Neon branch `spike`.
-- IDs default to uuidv7(); Better Auth runs with generateId: false.
create schema if not exists platform;

create table platform.users (
  id uuid primary key default uuidv7(),
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table platform.sessions (
  id uuid primary key default uuidv7(),
  user_id uuid not null references platform.users (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  active_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_user_idx on platform.sessions (user_id);
create table platform.accounts (
  id uuid primary key default uuidv7(),
  user_id uuid not null references platform.users (id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_idx on platform.accounts (user_id);
create table platform.verifications (
  id uuid primary key default uuidv7(),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verifications_identifier_idx on platform.verifications (identifier);
create table platform.organizations (
  id uuid primary key default uuidv7(),
  name text not null,
  slug text not null unique,
  logo text,
  metadata text,
  created_at timestamptz not null default now()
);
create table platform.members (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  user_id uuid not null references platform.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table platform.invitations (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  email text not null,
  role text,
  status text not null,
  expires_at timestamptz not null,
  inviter_id uuid not null references platform.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Shoppers: one identity per store. Email is unique per store, not globally.
create table store.shopper_users (
  tenant_id uuid not null default app.current_tenant_id_guarded(),
  id uuid primary key default uuidv7(),
  name text not null,
  email text not null,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);
create table store.shopper_sessions (
  tenant_id uuid not null default app.current_tenant_id_guarded(),
  id uuid primary key default uuidv7(),
  user_id uuid not null references store.shopper_users (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopper_sessions_tenant_user_idx on store.shopper_sessions (tenant_id, user_id);
create table store.shopper_accounts (
  tenant_id uuid not null default app.current_tenant_id_guarded(),
  id uuid primary key default uuidv7(),
  user_id uuid not null references store.shopper_users (id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopper_accounts_tenant_user_idx on store.shopper_accounts (tenant_id, user_id);
create table store.shopper_verifications (
  tenant_id uuid not null default app.current_tenant_id_guarded(),
  id uuid primary key default uuidv7(),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopper_verifications_tenant_identifier_idx on store.shopper_verifications (tenant_id, identifier);

alter table store.shopper_users enable row level security;
alter table store.shopper_users force row level security;
create policy tenant_isolation on store.shopper_users to app_rw using (tenant_id = (select app.current_tenant_id_guarded())) with check (tenant_id = (select app.current_tenant_id_guarded()));
alter table store.shopper_sessions enable row level security;
alter table store.shopper_sessions force row level security;
create policy tenant_isolation on store.shopper_sessions to app_rw using (tenant_id = (select app.current_tenant_id_guarded())) with check (tenant_id = (select app.current_tenant_id_guarded()));
alter table store.shopper_accounts enable row level security;
alter table store.shopper_accounts force row level security;
create policy tenant_isolation on store.shopper_accounts to app_rw using (tenant_id = (select app.current_tenant_id_guarded())) with check (tenant_id = (select app.current_tenant_id_guarded()));
alter table store.shopper_verifications enable row level security;
alter table store.shopper_verifications force row level security;
create policy tenant_isolation on store.shopper_verifications to app_rw using (tenant_id = (select app.current_tenant_id_guarded())) with check (tenant_id = (select app.current_tenant_id_guarded()));

grant usage on schema platform to app_rw;
grant select, insert, update, delete on all tables in schema platform to app_rw;
grant select, insert, update, delete on store.shopper_users, store.shopper_sessions, store.shopper_accounts, store.shopper_verifications to app_rw;
select 'ok' as applied
