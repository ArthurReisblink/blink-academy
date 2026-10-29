-- =====================================================================
-- BLINK ACADEMY — 0003: biblioteca de vídeos, vídeos por versão e progresso
-- =====================================================================

create table academy.videos (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  storage_key      text not null unique,
  mime             text not null default 'video/mp4',
  size_bytes       bigint not null default 0,
  duration_seconds numeric(10, 2) not null check (duration_seconds > 0),
  status           text not null default 'pending_upload' check (status in ('pending_upload', 'ready')),
  created_at       timestamptz not null default now(),
  created_by       uuid references academy.admins (id),
  updated_at       timestamptz not null default now()
);
create trigger videos_touch before update on academy.videos
  for each row execute function academy.touch_updated_at();

-- Vídeos de cada versão (ordem, obrigatoriedade e % mínimo de reprodução)
create table academy.version_videos (
  version_id     uuid not null references academy.training_versions (id),
  video_id       uuid not null references academy.videos (id),
  position       integer not null,
  required       boolean not null default true,
  completion_pct numeric(5, 2) not null default 95 check (completion_pct between 50 and 100),
  primary key (version_id, video_id)
);

-- Só versões em rascunho podem ter os vídeos alterados (as publicadas ficam congeladas)
create or replace function academy.version_videos_guard() returns trigger
language plpgsql as $$
declare st text;
begin
  select status into st from academy.training_versions where id = coalesce(new.version_id, old.version_id);
  if st <> 'draft' then
    raise exception 'A versão % não está em rascunho: crie uma nova versão para alterar os vídeos', coalesce(new.version_id, old.version_id)
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger version_videos_guard before insert or update or delete on academy.version_videos
  for each row execute function academy.version_videos_guard();

-- Progresso por convocação e vídeo. "intervals" guarda os trechos efetivamente
-- reproduzidos (já unificados): rever o mesmo trecho não soma duas vezes.
create table academy.video_progress (
  convocation_id    uuid not null references academy.convocations (id),
  video_id          uuid not null references academy.videos (id),
  intervals         jsonb not null default '[]'::jsonb,
  covered_seconds   numeric(10, 2) not null default 0,
  duration_seconds  numeric(10, 2) not null,
  completion_pct    numeric(5, 2) not null,
  last_position     numeric(10, 2) not null default 0,
  last_heartbeat_at timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (convocation_id, video_id)
);
create trigger video_progress_touch before update on academy.video_progress
  for each row execute function academy.touch_updated_at();

-- Uma vez concluído, o vídeo não volta a "não concluído"
create or replace function academy.video_progress_guard() returns trigger
language plpgsql as $$
begin
  if old.completed_at is not null and new.completed_at is null then
    new.completed_at := old.completed_at;
  end if;
  if new.covered_seconds < old.covered_seconds then
    raise exception 'O progresso não pode diminuir' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger video_progress_guard before update on academy.video_progress
  for each row execute function academy.video_progress_guard();

create table academy.video_events (
  id             bigserial primary key,
  convocation_id uuid not null references academy.convocations (id),
  video_id       uuid not null references academy.videos (id),
  at             timestamptz not null default now(),
  type           text not null check (type in ('play', 'pause', 'seeked', 'ended', 'heartbeat', 'error', 'completed')),
  position       numeric(10, 2),
  details        jsonb not null default '{}'::jsonb
);
create index video_events_idx on academy.video_events (convocation_id, video_id, at);
create trigger video_events_protect before update or delete on academy.video_events
  for each row execute function academy.forbid_change();

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------
alter table academy.videos         enable row level security;
alter table academy.version_videos enable row level security;
alter table academy.video_progress enable row level security;
alter table academy.video_events   enable row level security;

grant select, insert, update, delete on academy.videos, academy.version_videos to academy_admin;
grant select on academy.video_progress, academy.video_events to academy_admin;
create policy adm_read_videos on academy.videos for select to academy_admin using (true);
create policy adm_write_videos on academy.videos for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_vv on academy.version_videos for select to academy_admin using (true);
create policy adm_write_vv on academy.version_videos for all to academy_admin
  using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_vp on academy.video_progress for select to academy_admin using (true);
create policy adm_read_ve on academy.video_events for select to academy_admin using (true);

-- Motorista: vê os vídeos das versões em que foi convocado
grant select (id, title, description, storage_key, mime, duration_seconds, status) on academy.videos to academy_driver;
grant select on academy.version_videos to academy_driver;
create policy drv_vv on academy.version_videos for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.training_version_id = version_videos.version_id and c.driver_id = academy.current_driver_id()));
create policy drv_videos on academy.videos for select to academy_driver
  using (exists (select 1 from academy.version_videos vv join academy.convocations c on c.training_version_id = vv.version_id
                 where vv.video_id = videos.id and c.driver_id = academy.current_driver_id()));

-- Progresso: lê o próprio; grava apenas enquanto a convocação estiver aberta (no prazo, sem bloqueio)
grant select, insert, update on academy.video_progress to academy_driver;
grant select, insert on academy.video_events to academy_driver;
grant usage on sequence academy.video_events_id_seq to academy_driver;
create policy drv_vp_read on academy.video_progress for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.id = convocation_id and c.driver_id = academy.current_driver_id()));
create policy drv_vp_ins on academy.video_progress for insert to academy_driver
  with check (academy.convocation_is_open(convocation_id));
create policy drv_vp_upd on academy.video_progress for update to academy_driver
  using (academy.convocation_is_open(convocation_id)) with check (academy.convocation_is_open(convocation_id));
create policy drv_ve_read on academy.video_events for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.id = convocation_id and c.driver_id = academy.current_driver_id()));
create policy drv_ve_ins on academy.video_events for insert to academy_driver
  with check (academy.convocation_is_open(convocation_id));

-- O motorista registra conclusão de vídeo no histórico da convocação
grant insert on academy.convocation_events to academy_driver;
grant usage on sequence academy.convocation_events_id_seq to academy_driver;
create policy drv_conv_ev_ins on academy.convocation_events for insert to academy_driver
  with check (admin_id is null and type in ('video_completed', 'exam_started', 'exam_submitted', 'signed', 'completed')
              and exists (select 1 from academy.convocations c where c.id = convocation_id and c.driver_id = academy.current_driver_id()));

-- ---------------------------------------------------------------------
-- Visão consolidada: agora com vídeos obrigatórios e progresso
-- ---------------------------------------------------------------------
create or replace view academy.convocation_overview with (security_invoker = true) as
select
  c.id, c.driver_id, c.training_id, c.training_version_id, c.base_id, c.pnr_reference,
  c.deadline_mode, c.duration_hours, c.deadline_at, c.start_mode, c.activated_at, c.first_access_at,
  c.expires_at, c.blocked_at, c.blocked_reason, c.cancelled_at, c.completed_at, c.created_at,
  d.full_name as driver_name, d.cpf_mask, d.status as driver_status,
  b.name as base_name, t.title as training_title, tv.version as training_version,
  (select count(*)::int from academy.version_videos vv where vv.version_id = c.training_version_id and vv.required) as required_videos,
  (select count(*)::int from academy.version_videos vv join academy.video_progress p on p.video_id = vv.video_id and p.convocation_id = c.id
     where vv.version_id = c.training_version_id and vv.required and p.completed_at is not null) as completed_required_videos,
  exists (select 1 from academy.video_progress p where p.convocation_id = c.id and p.covered_seconds > 0) as any_video_progress,
  false as has_exam, false as attempt_in_progress, false as passed, 0::int as failed_attempts,
  0::int as attempts_used, 0::int as max_attempts, null::numeric as best_score,
  false as signed, null::timestamptz as signed_at
from academy.convocations c
join academy.drivers d on d.id = c.driver_id
join academy.trainings t on t.id = c.training_id
join academy.training_versions tv on tv.id = c.training_version_id
left join academy.bases b on b.id = coalesce(c.base_id, d.base_id);
