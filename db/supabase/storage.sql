-- =====================================================================
-- BLINK ACADEMY — armazenamento no Supabase
-- Rode UMA VEZ no SQL Editor do Supabase (Dashboard → SQL Editor → New query).
-- Cria o bucket PRIVADO usado para vídeos, termos, termos assinados e comprovantes.
-- Não crie políticas para "anon" ou "authenticated": o acesso é feito só pelo
-- servidor (chave service_role) e o navegador recebe links temporários assinados.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy-private', 'academy-private', false, null,
        array['video/mp4', 'application/pdf', 'image/png'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

-- Conferência: deve retornar public = false
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'academy-private';
