-- =====================================================================
-- BLINK ACADEMY — 0002: treinamentos (versões) e convocações com prazo
-- =====================================================================

create table academy.trainings (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references academy.admins (id),
  updated_at  timestamptz not null default now()
);
create trigger trainings_touch before update on academy.trainings
  for each row execute function academy.touch_updated_at();

-- Cada versão congela o conteúdo (vídeos, prova e termo). Convocações apontam
-- para uma versão: mudar o treinamento depois não altera o que já foi feito.
create table academy.training_versions (
  id           uuid primary key default gen_random_uuid(),
  training_id  uuid not null references academy.trainings (id),
  version      integer not null,
  title        text not null,
  description  text,
  notes        text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references academy.admins (id),
  unique (training_id, version)
);

create table academy.convocations (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references academy.drivers (id),
  training_id         uuid not null references academy.trainings (id),
  training_version_id uuid not null references academy.training_versions (id),
  base_id             uuid references academy.bases (id),
  pnr_reference       text,
  -- prazo
  deadline_mode       text not null check (deadline_mode in ('duration', 'until')),
  duration_hours      integer check (duration_hours is null or duration_hours between 1 and 8760),
  deadline_at         timestamptz,
  start_mode          text not null default 'activation' check (start_mode in ('activation', 'first_access')),
  activated_at        timestamptz not null default now(),
  first_access_at     timestamptz,
  expires_at          timestamptz,
  -- situação
  blocked_at          timestamptz,
  blocked_reason      text,
  cancelled_at        timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references academy.admins (id),
  updated_at          timestamptz not null default now(),
  constraint conv_deadline_ck check (
    (deadline_mode = 'duration' and duration_hours is not null) or
    (deadline_mode = 'until' and deadline_at is not null))
);
create index conv_driver_idx on academy.convocations (driver_id, created_at desc);
create index conv_training_idx on academy.convocations (training_id);
create index conv_expires_idx on academy.convocations (expires_at);
create trigger conv_touch before update on academy.convocations
  for each row execute function academy.touch_updated_at();

-- Histórico de cada convocação (somente inclusão)
create table academy.convocation_events (
  id             bigserial primary key,
  convocation_id uuid not null references academy.convocations (id),
  at             timestamptz not null default now(),
  admin_id       uuid,
  type           text not null,
  details        jsonb not null default '{}'::jsonb
);
create index conv_events_idx on academy.convocation_events (convocation_id, at);
create trigger conv_events_protect before update or delete on academy.convocation_events
  for each row execute function academy.forbid_change();

-- ---------------------------------------------------------------------
-- Regras de prazo no banco
-- ---------------------------------------------------------------------
-- Calcula a data de vencimento sempre que os campos de prazo mudam.
create or replace function academy.conv_compute_expiry() returns trigger
language plpgsql as $$
begin
  if new.deadline_mode = 'until' then
    new.expires_at := new.deadline_at;
  elsif new.start_mode = 'activation' then
    new.expires_at := new.activated_at + make_interval(hours => new.duration_hours);
  elsif new.first_access_at is not null then
    new.expires_at := new.first_access_at + make_interval(hours => new.duration_hours);
  else
    new.expires_at := null; -- só começa a contar no primeiro acesso
  end if;
  return new;
end $$;
create trigger conv_expiry before insert or update of deadline_mode, duration_hours, deadline_at, start_mode, activated_at, first_access_at
  on academy.convocations for each row execute function academy.conv_compute_expiry();

-- Convocação aceita novas ações do motorista? (usado nas políticas de RLS)
create or replace function academy.convocation_is_open(p_conv uuid) returns boolean
language sql stable security definer set search_path = academy, pg_temp as $$
  select exists (
    select 1 from academy.convocations c join academy.drivers d on d.id = c.driver_id
    where c.id = p_conv
      and c.driver_id = academy.current_driver_id()
      and d.status = 'active'
      and c.blocked_at is null and c.cancelled_at is null and c.completed_at is null
      and (c.expires_at is null or c.expires_at > now()))
$$;

-- Motorista pode entrar se tem alguma convocação não bloqueada e não cancelada.
-- (Vencidas e concluídas continuam visíveis para consulta e comprovante.)
create or replace function academy.driver_has_open_convocation(p_driver uuid) returns boolean
language sql stable security definer set search_path = academy, pg_temp as $$
  select exists (select 1 from academy.convocations c
                 where c.driver_id = p_driver and c.blocked_at is null and c.cancelled_at is null)
$$;

-- Registra o primeiro acesso do motorista (inicia o prazo quando configurado assim).
create or replace function academy.register_first_access() returns integer
language plpgsql security definer set search_path = academy, pg_temp as $$
declare n integer;
begin
  if academy.current_driver_id() is null then return 0; end if;
  with upd as (
    update academy.convocations c set first_access_at = now()
    where c.driver_id = academy.current_driver_id() and c.first_access_at is null
      and c.blocked_at is null and c.cancelled_at is null
    returning c.id)
  insert into academy.convocation_events (convocation_id, type) select id, 'first_access' from upd;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------
alter table academy.trainings          enable row level security;
alter table academy.training_versions  enable row level security;
alter table academy.convocations       enable row level security;
alter table academy.convocation_events enable row level security;

grant select, insert, update on academy.trainings, academy.training_versions, academy.convocations to academy_admin;
grant select, insert on academy.convocation_events to academy_admin;
grant usage on sequence academy.convocation_events_id_seq to academy_admin;

create policy adm_read_trainings on academy.trainings for select to academy_admin using (true);
create policy adm_write_trainings on academy.trainings for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_tv on academy.training_versions for select to academy_admin using (true);
create policy adm_write_tv on academy.training_versions for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_conv on academy.convocations for select to academy_admin using (true);
create policy adm_write_conv on academy.convocations for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_conv_ev on academy.convocation_events for select to academy_admin using (true);
create policy adm_ins_conv_ev on academy.convocation_events for insert to academy_admin
  with check (academy.admin_can_write() and admin_id = academy.current_admin_id());

-- Motorista: lê só as próprias convocações e o conteúdo dos treinamentos convocados
grant select on academy.convocations, academy.convocation_events to academy_driver;
grant select (id, title, description) on academy.trainings to academy_driver;
grant select (id, training_id, version, title, description) on academy.training_versions to academy_driver;
create policy drv_conv on academy.convocations for select to academy_driver
  using (driver_id = academy.current_driver_id());
create policy drv_conv_ev on academy.convocation_events for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.id = convocation_id and c.driver_id = academy.current_driver_id()));
create policy drv_trainings on academy.trainings for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.training_id = trainings.id and c.driver_id = academy.current_driver_id()));
create policy drv_tv on academy.training_versions for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.training_version_id = training_versions.id and c.driver_id = academy.current_driver_id()));

grant execute on function academy.convocation_is_open(uuid) to academy_driver, academy_admin;
grant execute on function academy.register_first_access() to academy_driver;
revoke execute on function academy.register_first_access() from public;

-- ---------------------------------------------------------------------
-- Visão consolidada de cada convocação (recriada nas próximas migrações
-- conforme vídeos, provas e assinaturas forem sendo adicionados).
-- security_invoker: respeita a RLS de quem consulta.
-- ---------------------------------------------------------------------
create or replace view academy.convocation_overview with (security_invoker = true) as
select
  c.id, c.driver_id, c.training_id, c.training_version_id, c.base_id, c.pnr_reference,
  c.deadline_mode, c.duration_hours, c.deadline_at, c.start_mode, c.activated_at, c.first_access_at,
  c.expires_at, c.blocked_at, c.blocked_reason, c.cancelled_at, c.completed_at, c.created_at,
  d.full_name as driver_name, d.cpf_mask, d.status as driver_status,
  b.name as base_name, t.title as training_title, tv.version as training_version,
  0::int as required_videos, 0::int as completed_required_videos, false as any_video_progress,
  false as has_exam, false as attempt_in_progress, false as passed, 0::int as failed_attempts,
  0::int as attempts_used, 0::int as max_attempts, null::numeric as best_score,
  false as signed, null::timestamptz as signed_at
from academy.convocations c
join academy.drivers d on d.id = c.driver_id
join academy.trainings t on t.id = c.training_id
join academy.training_versions tv on tv.id = c.training_version_id
left join academy.bases b on b.id = coalesce(c.base_id, d.base_id);

grant select on academy.convocation_overview to academy_admin, academy_driver;
