# Configurar o Supabase (banco de dados e arquivos)

> Tempo estimado: 20 minutos. Você precisa de uma conta em https://supabase.com.

## 1. Criar o projeto

1. Em **New project**, defina:
   - **Name:** `blink-academy`
   - **Region:** **South America (São Paulo)**, para ficar perto dos motoristas e dentro do Brasil.
   - **Database password:** gere uma senha forte e **guarde-a**.
2. **Plano:**
   - O **Free** pausa o projeto após 7 dias sem uso e limita cada arquivo a **50 MB**.
   - Para uso oficial, recomenda-se o **Pro**. Nele, ajuste o limite em **Storage → Settings → Upload file size limit** (por exemplo, 1 GB).
   - Dica: vídeos de treinamento em 720p e H.264 costumam ficar entre 20 e 80 MB e carregam melhor no 4G.

## 2. Obter as conexões do banco

Em **Project Settings → Database → Connection string** (botão **Connect** no topo do painel), copie duas URLs:

| Para quê | Qual usar | Porta |
|---|---|---|
| Rodar as migrações do seu computador (`DATABASE_URL_MIGRATIONS`) | **Session pooler** | 5432 |
| Aplicação na Vercel (`DATABASE_URL`) | **Transaction pooler** | 6543 |

Troque `[YOUR-PASSWORD]` pela senha do passo 1. O usuário tem a forma `postgres.xxxxxxxx`.

## 3. Criar as tabelas

No seu computador, dentro da pasta do projeto (PowerShell):

```powershell
$env:DATABASE_URL_MIGRATIONS = "postgresql://postgres.xxxxxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
npm run db:migrate
```

Devem aparecer 6 linhas `✔ migração aplicada` e `Banco atualizado.`. O comando pode ser repetido sem problema: ele aplica só o que falta.

> Todas as tabelas ficam no esquema `academy`, que **não é exposto** pela API pública do Supabase. A migração 0006 também remove qualquer permissão das chaves `anon` e `authenticated`. O navegador nunca acessa o banco diretamente.

## 4. Criar o bucket privado de arquivos

No Supabase, abra **SQL Editor → New query**, cole o conteúdo de `db/supabase/storage.sql` e clique em **Run**. A última linha deve mostrar `public = false`.

Não crie políticas de acesso nesse bucket: só o servidor (chave `service_role`) lê e grava, e o navegador recebe links temporários de 5 minutos a 4 horas.

## 5. Copiar as chaves da API

Em **Project Settings → API**, copie:

| Item no Supabase | Variável |
|---|---|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| **service_role** (secret) | `SUPABASE_SERVICE_ROLE_KEY` |

> A chave `service_role` dá acesso total. Ela vai **somente** nas variáveis de ambiente da Vercel. Nunca a coloque no código, no Git, no WhatsApp ou em e-mail. A chave `anon` não é usada.

## 6. Criar o administrador inicial no banco do Supabase

```powershell
$env:DATABASE_URL = "postgresql://postgres.xxxxxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
npm run admin:create
```

Veja [ADMIN-INICIAL.md](ADMIN-INICIAL.md).

## 7. Backups

- O plano **Pro** tem backup diário automático (Database → Backups).
- No Free, faça cópias periódicas com `pg_dump` pela Session pooler.

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| `permission denied to set role` | As migrações foram rodadas com outro usuário. Rode de novo com o usuário `postgres.xxxx`. |
| `prepared statement … does not exist` | O `DATABASE_URL` aponta para outro tipo de pooler. A aplicação já usa `prepare: false`; confira se é o Transaction pooler (6543). |
| Envio de vídeo falha com 413 | O arquivo excede o limite de upload do plano (passo 1). |
| Vídeo não toca na Vercel | Falta `NEXT_PUBLIC_SUPABASE_URL` no momento do *build*. Faça **Redeploy** após configurar. |
