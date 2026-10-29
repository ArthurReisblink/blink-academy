-- =====================================================================
-- Etapa 7 — Endurecimento para o Supabase
-- O esquema "academy" nunca deve ser acessível pelas chaves públicas do
-- Supabase (anon/authenticated) nem pela API REST/GraphQL.
-- =====================================================================
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema academy from %I', r);
      execute format('revoke all on all tables in schema academy from %I', r);
      execute format('revoke all on all sequences in schema academy from %I', r);
      execute format('revoke all on all functions in schema academy from %I', r);
      execute format('alter default privileges in schema academy revoke all on tables from %I', r);
      execute format('alter default privileges in schema academy revoke all on functions from %I', r);
    end if;
  end loop;
end $$;

-- Funções do esquema não ficam executáveis por "public"
revoke all on all functions in schema academy from public;
grant execute on function academy.current_driver_id(), academy.current_admin_id(), academy.admin_can_write()
  to academy_admin, academy_driver, academy_auth, academy_system;
grant execute on function academy.convocation_open_raw(uuid), academy.required_videos_done(uuid) to academy_system, academy_admin, academy_driver;
grant execute on function academy.verify_document(text) to academy_auth;
grant execute on function academy.register_first_access() to academy_driver;
grant execute on function academy.convocation_is_open(uuid) to academy_driver, academy_admin, academy_system;
grant execute on function academy.driver_has_open_convocation(uuid) to academy_auth, academy_admin, academy_driver, academy_system;
