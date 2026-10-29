-- =====================================================================
-- BLINK ACADEMY — 0001: núcleo, papéis de banco, autenticação e auditoria
-- =====================================================================
-- Modelo de segurança:
--   * Todas as tabelas ficam no esquema "academy", que NÃO é exposto pela
--     API REST do Supabase (só "public" é). Ninguém acessa os dados pelo
--     navegador: todo acesso passa pelo servidor Next.js.
--   * O servidor sempre troca de papel dentro da transação:
--       academy_auth   -> login, códigos, sessões (antes de identificar o usuário)
--       academy_admin  -> painel administrativo
--       academy_driver -> portal do motorista (só enxerga os próprios dados)
--   * Row Level Security está ativa em todas as tabelas.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists academy;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'academy_admin') then
    create role academy_admin nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'academy_driver') then
    create role academy_driver nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'academy_auth') then
    create role academy_auth nologin;
  end if;
end $$;

-- O usuário que conecta (no Supabase: "postgres") precisa poder assumir os papéis.
do $$
begin
  execute format('grant academy_admin, academy_driver, academy_auth to %I', current_user);
exception when others then
  raise notice 'grant de papéis: %', sqlerrm;
end $$;

revoke all on schema academy from public;
grant usage on schema academy to academy_admin, academy_driver, academy_auth;

-- No Supabase, garante que os papéis da API pública não tenham nenhum acesso.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema academy from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema academy from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Contexto da requisição (definido pelo servidor com set_config local)
-- ---------------------------------------------------------------------
create or replace function academy.current_driver_id() returns uuid
language sql stable as $$
  select nullif(current_setting('academy.driver_id', true), '')::uuid
$$;

create or replace function academy.current_admin_id() returns uuid
language sql stable as $$
  select nullif(current_setting('academy.admin_id', true), '')::uuid
$$;

create or replace function academy.admin_can_write() returns boolean
language sql stable as $$
  select coalesce(current_setting('academy.admin_role', true), '') in ('superadmin', 'admin')
$$;

create or replace function academy.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Impede alteração/remoção de registros de trilha (append-only).
-- Só a rotina de retenção pode apagar, ativando academy.allow_purge.
create or replace function academy.forbid_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('academy.allow_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Registro protegido: % não permitido em %', tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------
create table academy.admins (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text not null,
  role            text not null default 'admin' check (role in ('superadmin', 'admin', 'auditor')),
  password_hash   text not null,
  totp_secret_enc text,
  totp_enabled_at timestamptz,
  totp_last_step  bigint,
  active          boolean not null default true,
  failed_logins   integer not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now()
);
create unique index admins_email_uq on academy.admins (lower(email));
create trigger admins_touch before update on academy.admins
  for each row execute function academy.touch_updated_at();

-- ---------------------------------------------------------------------
-- Bases operacionais
-- ---------------------------------------------------------------------
create table academy.bases (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index bases_name_uq on academy.bases (lower(name));

-- ---------------------------------------------------------------------
-- Motoristas
--   cpf_hash : HMAC-SHA256 do CPF (busca e unicidade, sem guardar o CPF em claro)
--   cpf_enc  : CPF criptografado com AES-256-GCM (chave fora do banco)
--   cpf_mask : CPF mascarado para exibição (***.456.789-**)
-- ---------------------------------------------------------------------
create table academy.drivers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  cpf_hash      text not null,
  cpf_enc       text not null,
  cpf_mask      text not null,
  phone         text,
  email         text,
  base_id       uuid references academy.bases (id),
  status        text not null default 'active' check (status in ('active', 'blocked')),
  notes         text,
  anonymized_at timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references academy.admins (id),
  updated_at    timestamptz not null default now(),
  constraint drivers_contact_ck check (phone is not null or email is not null or anonymized_at is not null)
);
create unique index drivers_cpf_hash_uq on academy.drivers (cpf_hash);
create index drivers_name_idx on academy.drivers (lower(full_name));
create index drivers_base_idx on academy.drivers (base_id);
create trigger drivers_touch before update on academy.drivers
  for each row execute function academy.touch_updated_at();

-- ---------------------------------------------------------------------
-- Sessões (o token fica só no cookie; aqui guardamos o hash)
-- ---------------------------------------------------------------------
create table academy.sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  subject_type  text not null check (subject_type in ('admin', 'admin_mfa', 'driver')),
  subject_id    uuid not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  ip            text,
  user_agent    text,
  otp_challenge_id uuid
);
create index sessions_subject_idx on academy.sessions (subject_type, subject_id);

-- ---------------------------------------------------------------------
-- Códigos temporários (OTP) do motorista
-- ---------------------------------------------------------------------
create table academy.otp_challenges (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid references academy.drivers (id),
  purpose          text not null check (purpose in ('login', 'signature')),
  code_hash        text not null,
  channel          text not null check (channel in ('sms', 'email')),
  destination_mask text not null,
  expires_at       timestamptz not null,
  attempts         integer not null default 0,
  max_attempts     integer not null default 5,
  consumed_at      timestamptz,
  session_id       uuid,
  ip               text,
  created_at       timestamptz not null default now()
);
create index otp_driver_idx on academy.otp_challenges (driver_id, created_at desc);

-- Contadores de tentativas (limite de requisições por janela de tempo)
create table academy.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------
-- Logs (somente inclusão)
-- ---------------------------------------------------------------------
create table academy.auth_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  subject_type text,
  subject_id   uuid,
  event        text not null,
  success      boolean not null,
  ip           text,
  user_agent   text,
  details      jsonb not null default '{}'::jsonb
);
create index auth_log_subject_idx on academy.auth_log (subject_id, at desc);
create trigger auth_log_protect before update or delete on academy.auth_log
  for each row execute function academy.forbid_change();

create table academy.admin_audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  admin_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  details   jsonb not null default '{}'::jsonb,
  ip        text
);
create index audit_at_idx on academy.admin_audit_log (at desc);
create index audit_entity_idx on academy.admin_audit_log (entity, entity_id);
create trigger audit_protect before update or delete on academy.admin_audit_log
  for each row execute function academy.forbid_change();

-- Configurações gerais (retenção, padrões)
create table academy.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into academy.settings (key, value) values
  ('retention', '{"auth_log_days": 365, "otp_days": 30, "sessions_days": 30, "video_events_days": 365}'::jsonb),
  ('defaults',  '{"video_completion_pct": 95, "pass_pct": 80, "max_attempts": 3, "question_count": 10}'::jsonb)
on conflict (key) do nothing;

-- Caixa de saída usada apenas pelo envio "console" (desenvolvimento e testes)
create table academy.dev_outbox (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  channel     text not null,
  destination text not null,
  body        text not null
);

-- ---------------------------------------------------------------------
-- Permissões e Row Level Security
-- ---------------------------------------------------------------------
alter table academy.admins          enable row level security;
alter table academy.bases           enable row level security;
alter table academy.drivers         enable row level security;
alter table academy.sessions        enable row level security;
alter table academy.otp_challenges  enable row level security;
alter table academy.rate_limits     enable row level security;
alter table academy.auth_log        enable row level security;
alter table academy.admin_audit_log enable row level security;
alter table academy.settings        enable row level security;
alter table academy.dev_outbox      enable row level security;

-- Papel de autenticação: só o necessário para login e sessões
grant select, update on academy.admins to academy_auth;
grant select (id, full_name, cpf_hash, cpf_mask, phone, email, status, anonymized_at) on academy.drivers to academy_auth;
grant select, insert, update on academy.sessions to academy_auth;
grant select, insert, update on academy.otp_challenges to academy_auth;
grant select, insert, update, delete on academy.rate_limits to academy_auth;
grant insert on academy.auth_log to academy_auth;
grant insert on academy.dev_outbox to academy_auth;
grant usage on sequence academy.auth_log_id_seq, academy.dev_outbox_id_seq to academy_auth;

create policy auth_admins on academy.admins for all to academy_auth using (true) with check (true);
create policy auth_drivers on academy.drivers for select to academy_auth using (true);
create policy auth_sessions on academy.sessions for all to academy_auth using (true) with check (true);
create policy auth_otp on academy.otp_challenges for all to academy_auth using (true) with check (true);
create policy auth_rate on academy.rate_limits for all to academy_auth using (true) with check (true);
create policy auth_log_ins on academy.auth_log for insert to academy_auth with check (true);
create policy auth_outbox on academy.dev_outbox for insert to academy_auth with check (true);

-- Papel administrativo
grant select, insert, update, delete on academy.admins, academy.bases, academy.drivers,
  academy.settings to academy_admin;
grant select on academy.sessions, academy.otp_challenges, academy.dev_outbox to academy_admin;
grant update (revoked_at) on academy.sessions to academy_admin;
grant select, insert on academy.auth_log, academy.admin_audit_log to academy_admin;
grant usage on sequence academy.auth_log_id_seq, academy.admin_audit_log_id_seq to academy_admin;

create policy adm_read_admins on academy.admins for select to academy_admin using (true);
-- Só superadmin altera administradores
create policy adm_write_admins on academy.admins for all to academy_admin
  using (current_setting('academy.admin_role', true) = 'superadmin')
  with check (current_setting('academy.admin_role', true) = 'superadmin');
create policy adm_read_bases on academy.bases for select to academy_admin using (true);
create policy adm_write_bases on academy.bases for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_drivers on academy.drivers for select to academy_admin using (true);
create policy adm_write_drivers on academy.drivers for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_settings on academy.settings for select to academy_admin using (true);
create policy adm_write_settings on academy.settings for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_sessions on academy.sessions for select to academy_admin using (true);
create policy adm_revoke_sessions on academy.sessions for update to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_otp on academy.otp_challenges for select to academy_admin using (true);
create policy adm_read_outbox on academy.dev_outbox for select to academy_admin using (true);
create policy adm_read_auth_log on academy.auth_log for select to academy_admin using (true);
create policy adm_ins_auth_log on academy.auth_log for insert to academy_admin with check (true);
create policy adm_read_audit on academy.admin_audit_log for select to academy_admin using (true);
create policy adm_ins_audit on academy.admin_audit_log for insert to academy_admin
  with check (admin_id = academy.current_admin_id());

-- Papel do motorista: só a própria linha, sem colunas sensíveis
grant select (id, full_name, cpf_mask, phone, email, base_id, status) on academy.drivers to academy_driver;
grant select on academy.bases to academy_driver;
grant insert on academy.auth_log to academy_driver;
grant usage on sequence academy.auth_log_id_seq to academy_driver;
create policy drv_self on academy.drivers for select to academy_driver
  using (id = academy.current_driver_id());
create policy drv_bases on academy.bases for select to academy_driver using (true);
create policy drv_auth_log on academy.auth_log for insert to academy_driver
  with check (subject_id = academy.current_driver_id());

-- Substituída na migração 0002 (convocações). Até lá, só o status do motorista vale.
create or replace function academy.driver_has_open_convocation(p_driver uuid) returns boolean
language sql stable as $$ select true $$;
grant execute on function academy.driver_has_open_convocation(uuid) to academy_auth, academy_admin, academy_driver;
