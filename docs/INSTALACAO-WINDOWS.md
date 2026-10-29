# Instalar e rodar no Windows

Este guia monta o sistema no seu computador. Use-o para testar, treinar a equipe ou desenvolver. Para colocar no ar, veja [PUBLICACAO.md](PUBLICACAO.md).

## 1. Programas necessários

1. **Node.js 22 LTS.** Baixe em https://nodejs.org (botão "LTS") e instale com as opções padrão.
2. **PostgreSQL 16 ou 17.** Baixe em https://www.postgresql.org/download/windows/ (instalador da EDB).
   - Anote a senha do usuário `postgres` e mantenha a porta `5432`.
   - O pgAdmin, instalado junto, ajuda a ver o banco.
3. **Opcional: Git**, de https://git-scm.com, para enviar o código ao GitHub na publicação.

Abra o **PowerShell** e confira:

```powershell
node -v      # v22.x
npm -v
```

## 2. Preparar o projeto

Descompacte o arquivo `blink-academy.zip` (por exemplo em `C:\blink-academy`) e, no PowerShell:

```powershell
cd C:\blink-academy
npm install
npm run secrets
```

O comando `npm run secrets` mostra 4 chaves. **Guarde-as num cofre de senhas.** Se `DATA_ENCRYPTION_KEY` ou `HASH_PEPPER` forem perdidas, os CPFs cadastrados não poderão mais ser lidos nem localizados.

## 3. Criar os bancos locais

No pgAdmin (ou no "SQL Shell (psql)"), crie dois bancos:

```sql
create database blink_dev;
create database blink_test;
```

- `blink_dev` é usado para testar o sistema.
- `blink_test` é usado pelos testes automáticos, que **apagam e recriam** tudo nele a cada execução.

## 4. Configurar o `.env.local`

Copie o modelo:

```powershell
copy .env.example .env.local
notepad .env.local
```

Preencha:

```
APP_URL=http://localhost:3000
DATABASE_URL=postgres://postgres:SUA_SENHA@localhost:5432/blink_dev
DATA_ENCRYPTION_KEY=(do npm run secrets)
HASH_PEPPER=(do npm run secrets)
MEDIA_SIGNING_SECRET=(do npm run secrets)
CRON_SECRET=(do npm run secrets)
STORAGE_DRIVER=local
MESSAGING_DRIVER=console
```

- `STORAGE_DRIVER=local` guarda os vídeos e PDFs na pasta `storage-local`.
- `MESSAGING_DRIVER=console` não envia SMS. O código aparece **na janela do PowerShell** onde o sistema está rodando, na linha `[código sms → +55…]`.

## 5. Criar as tabelas e o administrador

```powershell
npm run db:migrate
npm run admin:create
```

O segundo comando pede e-mail, nome e senha e cria um superadministrador. A senha precisa de 12 ou mais caracteres, com maiúscula, minúscula, número e símbolo. Detalhes em [ADMIN-INICIAL.md](ADMIN-INICIAL.md).

## 6. Rodar

```powershell
npm run dev
```

Acesse:

- **Painel:** http://localhost:3000/admin
  - No primeiro login aparece um QR Code. Leia-o com o Google Authenticator, Microsoft Authenticator ou Authy e digite o código de 6 dígitos.
- **Motorista:** http://localhost:3000/m. Use um CPF cadastrado no painel; o código aparece no PowerShell.

### Roteiro para preparar o primeiro treinamento

1. **Biblioteca de vídeos:** envie os vídeos MP4.
2. **Banco de questões:** clique em **Carregar banco inicial** (38 perguntas tiradas do documento "Na rota do treinamento").
3. **Provas:** crie a prova (por exemplo, 10 questões, nota mínima de 80%, 3 tentativas).
4. **Termos e documentos:** envie o PDF do termo aprovado pelo jurídico, ou gere o termo-modelo para revisão.
5. **Treinamentos:** crie o treinamento e configure a versão 1:
   1. adicione os vídeos;
   2. vincule a prova e o termo;
   3. clique em **Publicar versão 1**.
6. **Motoristas:** cadastre o motorista com o prazo (1, 2, 3, 7 ou 15 dias, personalizado ou data específica), ou importe uma planilha CSV pelo modelo disponível na tela.

## 7. Testes automáticos

Os testes usam o banco `blink_test`. Se o seu PostgreSQL tem senha, crie o arquivo `.env.test.local`:

```
DATABASE_URL=postgres://postgres:SUA_SENHA@localhost:5432/blink_test
```

Depois rode:

```powershell
npm test
```

O resultado esperado é `Tests 121 passed`. Por segurança, os testes só rodam num banco local cujo nome contenha "test".

### Testes no navegador (opcional)

Com o sistema rodando (`npm run dev`) e `MESSAGING_DRIVER=console`, rode:

```powershell
npx playwright install chromium
npm run test:e2e
```

Esses testes criam dados de exemplo no banco **de desenvolvimento**. Nunca os rode contra produção.

## Problemas comuns

| Mensagem | Solução |
|---|---|
| `Variável de ambiente ausente: …` | Falta preencher a variável no `.env.local`. |
| `password authentication failed` | A senha do PostgreSQL no `DATABASE_URL` está errada. |
| `permission denied to set role "academy_auth"` | Rode `npm run db:migrate` com o mesmo usuário do `DATABASE_URL`, que deve ser `postgres`. |
| O código do motorista não chega | Em desenvolvimento ele aparece no PowerShell; em produção configure SMS ou e-mail (veja PUBLICACAO.md). |
| "Muitas tentativas" | É a proteção contra força bruta. Aguarde 15 minutos. |
