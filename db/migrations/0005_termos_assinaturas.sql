-- =====================================================================
-- Etapa 5 — Termos, assinatura eletrônica, comprovantes e conclusão
-- =====================================================================

-- ---------------------------------------------------------------------
-- Termos (PDF versionado). O arquivo e o hash não mudam depois do envio.
-- ---------------------------------------------------------------------
create table academy.terms (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(title) between 3 and 200),
  version_label   text not null check (length(version_label) between 1 and 40),
  declaration     text not null check (length(declaration) between 20 and 4000),
  storage_key     text not null unique,
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      integer not null check (size_bytes > 0),
  page_count      integer,
  is_model        boolean not null default false,   -- gerado pelo sistema como modelo
  legal_approved_at timestamptz,                     -- marcado pelo administrador após revisão jurídica
  legal_approved_by uuid references academy.admins (id),
  legal_note      text,
  active          boolean not null default true,
  created_by      uuid references academy.admins (id),
  created_at      timestamptz not null default now(),
  unique (title, version_label)
);

create or replace function academy.term_guard() returns trigger
language plpgsql as $$
begin
  if new.storage_key <> old.storage_key or new.sha256 <> old.sha256 or new.size_bytes <> old.size_bytes
     or new.declaration <> old.declaration or new.title <> old.title or new.version_label <> old.version_label then
    raise exception 'O conteúdo de um termo não pode ser alterado. Envie uma nova versão.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger term_guard before update on academy.terms for each row execute function academy.term_guard();
create trigger term_delete_guard before delete on academy.terms for each row execute function academy.forbid_change();

alter table academy.training_versions add column term_id uuid references academy.terms (id);
create or replace function academy.tv_term_guard() returns trigger
language plpgsql as $$
begin
  if new.term_id is distinct from old.term_id and old.status <> 'draft' then
    raise exception 'O termo de uma versão publicada não pode ser trocado' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger tv_term_guard before update on academy.training_versions
  for each row execute function academy.tv_term_guard();

-- ---------------------------------------------------------------------
-- Assinaturas: registro de evidências, imutável.
-- ---------------------------------------------------------------------
create table academy.signatures (
  id                 uuid primary key default gen_random_uuid(),
  convocation_id     uuid not null unique references academy.convocations (id),
  driver_id          uuid not null references academy.drivers (id),
  term_id            uuid not null references academy.terms (id),
  term_sha256        text not null,
  signed_at          timestamptz not null,
  signer_name        text not null,
  signer_cpf_mask    text not null,
  ip                 text,
  user_agent         text,
  otp_challenge_id   uuid not null references academy.otp_challenges (id),
  otp_channel        text not null,
  otp_destination_mask text not null,
  session_id         uuid,
  drawing_key        text,             -- rubrica desenhada (opcional, complementar)
  drawing_sha256     text,
  evidence           jsonb not null,   -- dados que compõem o hash de evidências
  evidence_sha256    text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  signed_pdf_key     text not null,
  signed_pdf_sha256  text not null check (signed_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  verification_code  text not null unique,
  created_at         timestamptz not null default now()
);
create index signatures_driver_idx on academy.signatures (driver_id);
create trigger signatures_protect before update or delete on academy.signatures
  for each row execute function academy.forbid_change();

-- ---------------------------------------------------------------------
-- Comprovantes de conclusão
-- ---------------------------------------------------------------------
create table academy.certificates (
  id                uuid primary key default gen_random_uuid(),
  convocation_id    uuid not null unique references academy.convocations (id),
  driver_id         uuid not null references academy.drivers (id),
  code              text not null unique,
  issued_at         timestamptz not null,
  data              jsonb not null,
  pdf_key           text not null,
  pdf_sha256        text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  revoked_at        timestamptz,
  revoked_reason    text,
  revoked_by        uuid references academy.admins (id),
  created_at        timestamptz not null default now()
);
create or replace function academy.certificate_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('academy.allow_purge', true), '') = 'on' then return old; end if;
    raise exception 'Comprovantes não podem ser excluídos' using errcode = 'insufficient_privilege';
  end if;
  if old.revoked_at is not null then
    raise exception 'Comprovante já revogado' using errcode = 'insufficient_privilege';
  end if;
  if (new.code, new.issued_at, new.data, new.pdf_key, new.pdf_sha256, new.convocation_id, new.driver_id)
     is distinct from (old.code, old.issued_at, old.data, old.pdf_key, old.pdf_sha256, old.convocation_id, old.driver_id) then
    raise exception 'Somente a revogação do comprovante é permitida' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger certificate_guard before update or delete on academy.certificates
  for each row execute function academy.certificate_guard();

-- ---------------------------------------------------------------------
-- Conclusão: o próprio banco confere vídeos + aprovação + assinatura.
-- Depois de concluída, a convocação não volta atrás.
-- ---------------------------------------------------------------------
create or replace function academy.conv_completion_guard() returns trigger
language plpgsql security definer set search_path = academy, pg_temp as $$
begin
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'Treinamento concluído não pode ser reaberto' using errcode = 'insufficient_privilege';
  end if;
  if old.completed_at is null and new.completed_at is not null then
    if not academy.required_videos_done(new.id) then
      raise exception 'Conclusão recusada: vídeos obrigatórios pendentes' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from academy.exam_attempts a where a.convocation_id = new.id and a.passed) then
      raise exception 'Conclusão recusada: prova sem aprovação' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from academy.signatures s where s.convocation_id = new.id) then
      raise exception 'Conclusão recusada: termo não assinado' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger conv_completion_guard before update of completed_at on academy.convocations
  for each row execute function academy.conv_completion_guard();

-- Assinatura só com vídeos concluídos, prova aprovada e prazo aberto
create or replace function academy.signature_insert_guard() returns trigger
language plpgsql security definer set search_path = academy, pg_temp as $$
declare v_term uuid; v_driver uuid;
begin
  select tv.term_id, c.driver_id into v_term, v_driver
    from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id where c.id = new.convocation_id;
  if not academy.convocation_open_raw(new.convocation_id) then
    raise exception 'Assinatura recusada: convocação fora do prazo, bloqueada ou encerrada' using errcode = 'check_violation';
  end if;
  if v_driver <> new.driver_id then
    raise exception 'Assinatura recusada: motorista não corresponde' using errcode = 'check_violation';
  end if;
  if v_term is null or v_term <> new.term_id then
    raise exception 'Assinatura recusada: termo não corresponde ao treinamento' using errcode = 'check_violation';
  end if;
  if not academy.required_videos_done(new.convocation_id) then
    raise exception 'Assinatura recusada: vídeos obrigatórios pendentes' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from academy.exam_attempts a where a.convocation_id = new.convocation_id and a.passed) then
    raise exception 'Assinatura recusada: prova sem aprovação' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from academy.otp_challenges o where o.id = new.otp_challenge_id and o.purpose = 'signature'
                 and o.driver_id = new.driver_id and o.consumed_at is not null) then
    raise exception 'Assinatura recusada: código de confirmação inválido' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger signature_insert_guard before insert on academy.signatures
  for each row execute function academy.signature_insert_guard();

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------
alter table academy.terms        enable row level security;
alter table academy.signatures   enable row level security;
alter table academy.certificates enable row level security;

-- administração
grant select, insert, update on academy.terms to academy_admin;
grant select on academy.signatures to academy_admin;
grant select, update (revoked_at, revoked_reason, revoked_by) on academy.certificates to academy_admin;
create policy adm_terms_r on academy.terms for select to academy_admin using (true);
create policy adm_terms_w on academy.terms for insert to academy_admin with check (academy.admin_can_write());
create policy adm_terms_u on academy.terms for update to academy_admin using (academy.admin_can_write()) with check (academy.admin_can_write());
create policy adm_sig_r on academy.signatures for select to academy_admin using (true);
create policy adm_cert_r on academy.certificates for select to academy_admin using (true);
create policy adm_cert_u on academy.certificates for update to academy_admin
  using (coalesce(current_setting('academy.admin_role', true), '') = 'superadmin')
  with check (coalesce(current_setting('academy.admin_role', true), '') = 'superadmin');

-- sistema (assina e conclui depois de validar a sessão e o código)
grant select on academy.terms, academy.otp_challenges, academy.exam_attempts to academy_system;
grant select, insert on academy.signatures, academy.certificates to academy_system;
grant update (completed_at) on academy.convocations to academy_system;
create policy sys_terms on academy.terms for select to academy_system using (true);
create policy sys_otp on academy.otp_challenges for select to academy_system using (true);
create policy sys_sig on academy.signatures for all to academy_system using (true) with check (true);
create policy sys_cert on academy.certificates for all to academy_system using (true) with check (true);
create policy sys_conv_complete on academy.convocations for update to academy_system using (true) with check (true);

-- motorista: vê o termo da própria convocação, a própria assinatura e o próprio comprovante
grant select (id, title, version_label, declaration, sha256, size_bytes, page_count) on academy.terms to academy_driver;
create policy drv_terms on academy.terms for select to academy_driver
  using (exists (select 1 from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id
                 where tv.term_id = terms.id and c.driver_id = academy.current_driver_id()));
grant select (id, convocation_id, term_id, term_sha256, signed_at, signer_name, signer_cpf_mask, otp_channel, otp_destination_mask,
  evidence_sha256, signed_pdf_sha256, verification_code) on academy.signatures to academy_driver;
create policy drv_sig on academy.signatures for select to academy_driver using (driver_id = academy.current_driver_id());
grant select (id, convocation_id, code, issued_at, data, pdf_sha256, revoked_at) on academy.certificates to academy_driver;
create policy drv_cert on academy.certificates for select to academy_driver using (driver_id = academy.current_driver_id());
grant select (id, training_id, version, title, description, exam_id, term_id) on academy.training_versions to academy_driver;

-- ---------------------------------------------------------------------
-- Verificação pública: só por código, devolve dados mínimos (sem CPF)
-- ---------------------------------------------------------------------
create or replace function academy.verify_document(p_code text)
returns table (kind text, code text, issued_at timestamptz, training_title text, training_version integer,
               holder text, pdf_sha256 text, revoked boolean, extra_sha256 text)
language sql stable security definer set search_path = academy, pg_temp as $$
  select 'certificate', ce.code, ce.issued_at, ce.data->>'training_title', (ce.data->>'training_version')::int,
         ce.data->>'holder_masked', ce.pdf_sha256, ce.revoked_at is not null, s.signed_pdf_sha256
  from academy.certificates ce left join academy.signatures s on s.convocation_id = ce.convocation_id
  where ce.code = upper(p_code)
  union all
  select 'signature', s.verification_code, s.signed_at, s.evidence->>'training_title', (s.evidence->>'training_version')::int,
         s.evidence->>'holder_masked', s.signed_pdf_sha256, false, s.evidence_sha256
  from academy.signatures s where s.verification_code = upper(p_code)
$$;
revoke all on function academy.verify_document(text) from public;
grant execute on function academy.verify_document(text) to academy_auth;

-- ---------------------------------------------------------------------
-- Visão consolidada: assinatura e comprovante
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
  exists (select 1 from academy.signatures s where s.convocation_id = c.id) as signed,
  (select s.signed_at from academy.signatures s where s.convocation_id = c.id) as signed_at,
  (select ce.code from academy.certificates ce where ce.convocation_id = c.id) as certificate_code
from academy.convocations c
join academy.drivers d on d.id = c.driver_id
join academy.trainings t on t.id = c.training_id
join academy.training_versions tv on tv.id = c.training_version_id
left join academy.bases b on b.id = coalesce(c.base_id, d.base_id);
