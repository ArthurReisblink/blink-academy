# Publicar na Vercel e obter o link para o WhatsApp

> Pré-requisitos:
> - Supabase configurado, conforme [SUPABASE.md](SUPABASE.md).
> - Conta na Vercel (https://vercel.com).
> - Conta no GitHub (https://github.com).
> - Um provedor de SMS (Twilio) ou e-mail (Resend) para os códigos dos motoristas.

## 1. Enviar o código para um repositório **privado** no GitHub

1. No GitHub, crie um repositório: **New → Private → `blink-academy`**.
2. No PowerShell, dentro da pasta do projeto:

```powershell
git init
git add .
git commit -m "BLINK Academy"
git branch -M main
git remote add origin https://github.com/SUA-CONTA/blink-academy.git
git push -u origin main
```

O `.gitignore` já impede o envio de `.env.local`, `storage-local` e outros arquivos locais. Antes do push, confira com `git status` que nenhum arquivo `.env` aparece.

## 2. Escolher como os códigos serão enviados

Sem isso, os motoristas **não conseguem entrar**: em produção, o modo `console` é bloqueado de propósito.

| Opção | Variáveis | Observação |
|---|---|---|
| **SMS (Twilio)** | `MESSAGING_DRIVER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (número Twilio em formato +1…/+55…) | Cobrança por SMS. Teste o envio para números brasileiros antes. |
| **E-mail (Resend)** | `MESSAGING_DRIVER=resend`, `RESEND_API_KEY`, `RESEND_FROM="BLINK Academy <nao-responda@seu-dominio>"`, `OTP_PREFERRED_CHANNEL=email` | Exige um domínio verificado no Resend. |

Com qualquer valor diferente de `console`, o sistema usa:

- **SMS** para quem tem só celular;
- **e-mail** para quem tem só e-mail;
- o canal de `OTP_PREFERRED_CHANNEL` para quem tem os dois.

Configure as credenciais dos dois provedores se quiser atender os dois casos.

## 3. Importar na Vercel

1. Na Vercel, faça **Add New → Project** e importe o repositório `blink-academy`. A Vercel detecta Next.js sozinha.
2. Em **Environment Variables** (ambiente *Production*), cadastre:

| Variável | Valor |
|---|---|
| `APP_URL` | por enquanto `https://blink-academy.vercel.app` (ajuste no passo 5) |
| `DATABASE_URL` | Transaction pooler do Supabase (porta **6543**) |
| `DATA_ENCRYPTION_KEY`, `HASH_PEPPER`, `MEDIA_SIGNING_SECRET`, `CRON_SECRET` | os valores do `npm run secrets`, **os mesmos** usados ao criar o administrador |
| `STORAGE_DRIVER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role do Supabase |
| `SUPABASE_BUCKET` | `academy-private` |
| `MESSAGING_DRIVER` e credenciais | conforme o passo 2 |
| `OTP_PREFERRED_CHANNEL` | `sms` ou `email` |
| `DB_POOL_MAX` | `3` |

3. Clique em **Deploy**.

O arquivo `vercel.json` já define:

- a região **São Paulo** (`gru1`);
- a rotina diária de retenção de dados, às 06:17 UTC. A Vercel envia o `CRON_SECRET` automaticamente.

## 4. Primeiro acesso

1. Quando o deploy terminar, a Vercel mostra o **domínio** do projeto, por exemplo `https://blink-academy-xxxx.vercel.app`. **Esse é o endereço real.** Use exatamente o que aparecer no seu painel.
2. Abra `<domínio>/admin`, entre com o administrador criado e cadastre o autenticador.

## 5. Ajustar o `APP_URL` e publicar de novo

Em **Settings → Environment Variables**, coloque em `APP_URL` o domínio exato do passo 4, ou o domínio próprio, se configurar um (por exemplo `academy.blink.com.br`, em **Settings → Domains**). Depois clique em **Deployments → ⋯ → Redeploy**.

O `APP_URL` aparece nos PDFs, no link de verificação dos comprovantes.

## 6. Checklist de verificação antes de divulgar

Faça com um motorista de teste, de preferência num celular Android com 4G:

- [ ] Painel: login com senha + autenticador funciona.
- [ ] Biblioteca: envio de um vídeo real chega a "Disponível". Isso testa o Supabase Storage.
- [ ] Treinamento publicado com vídeos, prova e termo, este último **aprovado pelo jurídico**.
- [ ] Motorista de teste cadastrado com o seu próprio celular ou e-mail.
- [ ] `<domínio>/m`: o código chega por SMS ou e-mail e o login funciona.
- [ ] O vídeo toca no celular e o percentual sobe; avançar o vídeo não conta.
- [ ] A prova libera só depois dos vídeos. Reprovação e aprovação aparecem corretamente.
- [ ] A assinatura com código funciona e o comprovante baixa.
- [ ] `<domínio>/verificar` reconhece o código do comprovante.
- [ ] Relatório exporta em CSV, Excel e PDF.
- [ ] Em Configurações → Retenção, "Última execução" é preenchida no dia seguinte (rotina agendada).

## 7. Link para enviar aos motoristas pelo WhatsApp

Somente depois de concluir o checklist acima, envie:

```
Olá! Você foi convocado para o treinamento BLINK sobre POD e PNR.
Acesse: <domínio>/m
Entre com seu CPF. Você vai receber um código no celular (ou e-mail) cadastrado.
Prazo: conforme informado pela BLINK.
```

Troque `<domínio>` pelo endereço verificado no passo 4 ou 5.

> **Nota sobre o que foi testado:** o fluxo inteiro foi testado localmente, com armazenamento local e códigos em modo de teste. Três itens não puderam ser testados sem as contas da BLINK:
> - o armazenamento no Supabase Storage;
> - o envio real de SMS e e-mail;
> - a execução na Vercel.
>
> Por isso o checklist acima é obrigatório antes da divulgação.
