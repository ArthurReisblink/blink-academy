-- =====================================================================
-- BLINK ACADEMY — 0004: banco de questões, provas e tentativas
-- =====================================================================

-- Papel interno usado pelo servidor para gerar e corrigir provas e concluir
-- treinamentos. O motorista nunca lê o gabarito.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'academy_system') then
    create role academy_system nologin;
  end if;
end $$;
do $$
begin
  execute format('grant academy_system to %I', current_user);
exception when others then raise notice '%', sqlerrm;
end $$;
grant usage on schema academy to academy_system;

create table academy.question_topics (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  position integer not null default 0
);
insert into academy.question_topics (name, position) values
  ('Prova de entrega (POD)', 1), ('Identificação do recebedor', 2), ('Qualidade das fotos', 3),
  ('Documentos e informações da entrega', 4), ('O que é PNR', 5), ('Acareação pelo WhatsApp', 6),
  ('Acareação presencial', 7), ('Evidências inválidas', 8), ('Mitos e verdades de POD e PNR', 9)
on conflict (name) do nothing;

create table academy.questions (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references academy.question_topics (id),
  statement   text not null,
  explanation text,
  source      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references academy.admins (id),
  updated_at  timestamptz not null default now()
);
create index questions_topic_idx on academy.questions (topic_id);
create trigger questions_touch before update on academy.questions
  for each row execute function academy.touch_updated_at();

create table academy.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references academy.questions (id) on delete cascade,
  text        text not null,
  is_correct  boolean not null default false,
  position    integer not null
);
create index qopt_question_idx on academy.question_options (question_id);

create table academy.exams (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  description        text,
  question_count     integer not null check (question_count between 1 and 100),
  pass_pct           numeric(5, 2) not null check (pass_pct between 1 and 100),
  max_attempts       integer not null check (max_attempts between 1 and 20),
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes between 1 and 600),
  selection_mode     text not null default 'random' check (selection_mode in ('manual', 'random')),
  topic_ids          uuid[] not null default '{}',
  shuffle_questions  boolean not null default true,
  shuffle_options    boolean not null default true,
  display_mode       text not null default 'one' check (display_mode in ('one', 'all')),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references academy.admins (id),
  updated_at         timestamptz not null default now()
);
create trigger exams_touch before update on academy.exams
  for each row execute function academy.touch_updated_at();

create table academy.exam_questions (
  exam_id     uuid not null references academy.exams (id) on delete cascade,
  question_id uuid not null references academy.questions (id),
  position    integer not null,
  primary key (exam_id, question_id)
);

-- Prova vinculada à versão do treinamento (só muda enquanto a versão é rascunho)
alter table academy.training_versions add column exam_id uuid references academy.exams (id);
create or replace function academy.tv_exam_guard() returns trigger
language plpgsql as $$
begin
  if new.exam_id is distinct from old.exam_id and old.status <> 'draft' then
    raise exception 'A prova de uma versão publicada não pode ser trocada' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger tv_exam_guard before update on academy.training_versions
  for each row execute function academy.tv_exam_guard();

-- ---------------------------------------------------------------------
-- Tentativas: registro imutável de perguntas, alternativas, regras,
-- respostas e nota. O gabarito fica em coluna que o motorista não lê.
-- ---------------------------------------------------------------------
create table academy.exam_attempts (
  id             uuid primary key default gen_random_uuid(),
  convocation_id uuid not null references academy.convocations (id),
  exam_id        uuid not null references academy.exams (id),
  attempt_number integer not null,
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz,
  submitted_at   timestamptz,
  submit_reason  text check (submit_reason in ('driver', 'time_limit')),
  questions      jsonb not null,
  answer_key     jsonb not null,
  rules          jsonb not null,
  answers        jsonb not null default '{}'::jsonb,
  correct_count  integer,
  score_pct      numeric(5, 2),
  passed         boolean,
  unique (convocation_id, attempt_number)
);
create index attempts_conv_idx on academy.exam_attempts (convocation_id);

-- Convocação aberta (sem considerar quem está consultando)
create or replace function academy.convocation_open_raw(p_conv uuid) returns boolean
language sql stable security definer set search_path = academy, pg_temp as $$
  select exists (
    select 1 from academy.convocations c join academy.drivers d on d.id = c.driver_id
    where c.id = p_conv and d.status = 'active'
      and c.blocked_at is null and c.cancelled_at is null and c.completed_at is null
      and (c.expires_at is null or c.expires_at > now()))
$$;

create or replace function academy.required_videos_done(p_conv uuid) returns boolean
language sql stable security definer set search_path = academy, pg_temp as $$
  select exists (select 1 from academy.convocations c join academy.version_videos vv on vv.version_id = c.training_version_id
                 where c.id = p_conv and vv.required)
     and not exists (
       select 1 from academy.convocations c
       join academy.version_videos vv on vv.version_id = c.training_version_id and vv.required
       left join academy.video_progress p on p.convocation_id = c.id and p.video_id = vv.video_id
       where c.id = p_conv and p.completed_at is null)
$$;

-- Regras verificadas pelo próprio banco ao abrir uma tentativa
create or replace function academy.attempt_insert_guard() returns trigger
language plpgsql security definer set search_path = academy, pg_temp as $$
declare
  v_exam uuid; v_max integer; v_prev integer;
begin
  if not academy.convocation_open_raw(new.convocation_id) then
    raise exception 'Convocação fora do prazo, bloqueada ou encerrada' using errcode = 'check_violation';
  end if;
  if not academy.required_videos_done(new.convocation_id) then
    raise exception 'A avaliação só é liberada após concluir todos os vídeos obrigatórios' using errcode = 'check_violation';
  end if;
  select tv.exam_id into v_exam from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id where c.id = new.convocation_id;
  if v_exam is null or v_exam <> new.exam_id then
    raise exception 'Prova não corresponde ao treinamento' using errcode = 'check_violation';
  end if;
  if exists (select 1 from academy.exam_attempts a where a.convocation_id = new.convocation_id and (a.submitted_at is null or a.passed)) then
    raise exception 'Já existe avaliação em andamento ou aprovada' using errcode = 'check_violation';
  end if;
  select max_attempts into v_max from academy.exams where id = new.exam_id;
  select count(*) into v_prev from academy.exam_attempts where convocation_id = new.convocation_id;
  if v_prev >= v_max then
    raise exception 'Limite de tentativas atingido' using errcode = 'check_violation';
  end if;
  new.attempt_number := v_prev + 1;
  new.submitted_at := null; new.correct_count := null; new.score_pct := null; new.passed := null;
  return new;
end $$;
create trigger attempt_insert_guard before insert on academy.exam_attempts
  for each row execute function academy.attempt_insert_guard();

create or replace function academy.attempt_update_guard() returns trigger
language plpgsql as $$
begin
  if old.submitted_at is not null then
    raise exception 'Tentativa já enviada não pode ser alterada' using errcode = 'insufficient_privilege';
  end if;
  if new.questions is distinct from old.questions or new.answer_key is distinct from old.answer_key
     or new.rules is distinct from old.rules or new.convocation_id <> old.convocation_id
     or new.attempt_number <> old.attempt_number or new.started_at <> old.started_at
     or new.exam_id <> old.exam_id or new.deadline_at is distinct from old.deadline_at then
    raise exception 'Perguntas e regras da tentativa são imutáveis' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger attempt_update_guard before update on academy.exam_attempts
  for each row execute function academy.attempt_update_guard();
create trigger attempt_delete_guard before delete on academy.exam_attempts
  for each row execute function academy.forbid_change();

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------
alter table academy.question_topics  enable row level security;
alter table academy.questions        enable row level security;
alter table academy.question_options enable row level security;
alter table academy.exams            enable row level security;
alter table academy.exam_questions   enable row level security;
alter table academy.exam_attempts    enable row level security;

grant select, insert, update, delete on academy.questions, academy.question_options, academy.exams, academy.exam_questions to academy_admin;
grant select on academy.question_topics, academy.exam_attempts to academy_admin;
create policy adm_topics on academy.question_topics for select to academy_admin using (true);
create policy adm_read_q on academy.questions for select to academy_admin using (true);
create policy adm_write_q on academy.questions for all to academy_admin using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_qo on academy.question_options for select to academy_admin using (true);
create policy adm_write_qo on academy.question_options for all to academy_admin using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_ex on academy.exams for select to academy_admin using (true);
create policy adm_write_ex on academy.exams for all to academy_admin using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_eq on academy.exam_questions for select to academy_admin using (true);
create policy adm_write_eq on academy.exam_questions for all to academy_admin using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_read_att on academy.exam_attempts for select to academy_admin using (true);

-- Papel interno (gera/corrige provas): lê banco e convocações, grava tentativas
grant select on academy.question_topics, academy.questions, academy.question_options, academy.exams, academy.exam_questions,
  academy.convocations, academy.training_versions, academy.trainings, academy.version_videos, academy.video_progress, academy.drivers,
  academy.videos, academy.bases to academy_system;
grant select, insert, update on academy.exam_attempts to academy_system;
grant insert on academy.convocation_events to academy_system;
grant usage on sequence academy.convocation_events_id_seq to academy_system;
create policy sys_topics on academy.question_topics for select to academy_system using (true);
create policy sys_q on academy.questions for select to academy_system using (true);
create policy sys_qo on academy.question_options for select to academy_system using (true);
create policy sys_ex on academy.exams for select to academy_system using (true);
create policy sys_eq on academy.exam_questions for select to academy_system using (true);
create policy sys_conv on academy.convocations for select to academy_system using (true);
create policy sys_tv on academy.training_versions for select to academy_system using (true);
create policy sys_tr on academy.trainings for select to academy_system using (true);
create policy sys_vv on academy.version_videos for select to academy_system using (true);
create policy sys_vp on academy.video_progress for select to academy_system using (true);
create policy sys_drv on academy.drivers for select to academy_system using (true);
create policy sys_videos on academy.videos for select to academy_system using (true);
create policy sys_bases on academy.bases for select to academy_system using (true);
create policy sys_att on academy.exam_attempts for all to academy_system using (true) with check (true);
create policy sys_conv_ev on academy.convocation_events for insert to academy_system with check (admin_id is null);

-- Motorista: vê as próprias tentativas, sem a coluna do gabarito
grant select (id, convocation_id, exam_id, attempt_number, started_at, deadline_at, submitted_at, submit_reason, questions, rules,
  answers, correct_count, score_pct, passed) on academy.exam_attempts to academy_driver;
create policy drv_att on academy.exam_attempts for select to academy_driver
  using (exists (select 1 from academy.convocations c where c.id = convocation_id and c.driver_id = academy.current_driver_id()));
grant select (id, title, description, question_count, pass_pct, max_attempts, time_limit_minutes, display_mode) on academy.exams to academy_driver;
create policy drv_exams on academy.exams for select to academy_driver
  using (exists (select 1 from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id
                 where tv.exam_id = exams.id and c.driver_id = academy.current_driver_id()));
grant select (id, training_id, version, title, description, exam_id) on academy.training_versions to academy_driver;

grant execute on function academy.convocation_open_raw(uuid), academy.required_videos_done(uuid) to academy_system, academy_admin, academy_driver;

-- ---------------------------------------------------------------------
-- Visão consolidada: agora com prova e tentativas
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
  (tv.exam_id is not null) as has_exam,
  exists (select 1 from academy.exam_attempts a where a.convocation_id = c.id and a.submitted_at is null
          and (a.deadline_at is null or a.deadline_at > now())) as attempt_in_progress,
  exists (select 1 from academy.exam_attempts a where a.convocation_id = c.id and a.passed) as passed,
  (select count(*)::int from academy.exam_attempts a where a.convocation_id = c.id and a.submitted_at is not null and not a.passed) as failed_attempts,
  (select count(*)::int from academy.exam_attempts a where a.convocation_id = c.id) as attempts_used,
  coalesce((select e.max_attempts from academy.exams e where e.id = tv.exam_id), 0) as max_attempts,
  (select max(a.score_pct) from academy.exam_attempts a where a.convocation_id = c.id) as best_score,
  false as signed, null::timestamptz as signed_at
from academy.convocations c
join academy.drivers d on d.id = c.driver_id
join academy.trainings t on t.id = c.training_id
join academy.training_versions tv on tv.id = c.training_version_id
left join academy.bases b on b.id = coalesce(c.base_id, d.base_id);
