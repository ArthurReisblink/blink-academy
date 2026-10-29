# BLINK ACADEMY — Controle de treinamentos POD e PNR

Plataforma web para a BLINK convocar motoristas parceiros após uma ocorrência de PNR. O motorista assiste aos vídeos, faz a avaliação e assina o termo eletronicamente. Ao final, recebe um comprovante verificável.

> **Situação:** o sistema foi desenvolvido e testado em ambiente local nas 7 etapas, com testes automatizados e de navegador. **Ainda não está publicado.** A publicação depende das contas da BLINK no Supabase e na Vercel e de um provedor de SMS ou e-mail. Siga [docs/PUBLICACAO.md](docs/PUBLICACAO.md). O endereço público só existirá depois desse passo.

## O que tem

| Portal | Telas |
|---|---|
| **Administração** (`/admin`) | Login com senha + aplicativo autenticador · Dashboard · Motoristas (cadastro, importação CSV, prazos, prorrogação, bloqueio, reconvocação) · Treinamentos e versões · Biblioteca de vídeos · Banco de questões · Provas · Termos e documentos · Assinaturas · Relatórios (CSV/Excel/PDF) · Auditoria · Configurações · Administradores |
| **Motorista** (`/m`) | Entrada com CPF + código enviado por SMS ou e-mail · Minha convocação · Vídeos com progresso · Avaliação · Resultado · Leitura e assinatura do termo · Comprovante |
| **Público** (`/verificar`) | Conferência de comprovante ou termo assinado pelo código. A consulta não exibe CPF nem contato. |

## Tecnologia

- **Aplicação:** Next.js 15 (App Router) + TypeScript + Tailwind CSS 4.
- **Banco e arquivos:** PostgreSQL (Supabase) e Supabase Storage em bucket privado.
- **Hospedagem:** Vercel, com rotina diária de retenção.
- **PDF e planilhas:** pdf-lib (termo assinado, comprovante, relatório) e ExcelJS.
- **Testes:** Vitest (unidade e integração com banco real) e Playwright (navegador).

## Estrutura

```
db/migrations/        scripts SQL do banco (aplicados em ordem por npm run db:migrate)
db/supabase/          SQL do bucket de arquivos no Supabase
docs/                 guias de instalação, Supabase, Vercel, administrador e segurança
e2e/                  testes de navegador (Playwright)
scripts/              migração, criação do administrador, geração de segredos
src/app/              telas e rotas (admin, motorista, verificação, APIs)
src/server/           regras de negócio, autenticação, PDFs, armazenamento
src/lib/              banco, criptografia, CPF, datas
tests/                testes Vitest (unidade e integração)
```

## Começando

- [Instalar e rodar no Windows](docs/INSTALACAO-WINDOWS.md)
- [Configurar o Supabase](docs/SUPABASE.md)
- [Publicar na Vercel e obter o link](docs/PUBLICACAO.md)
- [Administrador inicial](docs/ADMIN-INICIAL.md)
- [Segurança, LGPD e limitações](docs/SEGURANCA.md)

## Comandos

| Comando | Para quê |
|---|---|
| `npm install` | instala as dependências |
| `npm run secrets` | gera as chaves secretas (`DATA_ENCRYPTION_KEY`, `HASH_PEPPER`, …) |
| `npm run db:migrate` | cria ou atualiza as tabelas no banco do `DATABASE_URL` |
| `npm run admin:create` | cria o primeiro superadministrador |
| `npm run dev` | roda em `http://localhost:3000` |
| `npm run build` e `npm start` | versão de produção local |
| `npm test` | 121 testes (unidade e integração); precisa de um PostgreSQL de teste, veja o guia do Windows |
| `npm run test:e2e` | 11 testes de navegador contra o servidor em execução (só em desenvolvimento) |

## Resultado dos testes (última execução)

- **Vitest:** 12 arquivos e **121 testes aprovados**, incluindo os **14 obrigatórios** em `tests/integration/obrigatorios.test.ts`.
- **Playwright:** **11 testes aprovados**. A jornada completa vai do administrador preparando o treinamento até o motorista assistir, reprovar, ser aprovado, assinar com código e o comprovante ser verificado. Os testes de segurança cobrem acesso sem login, cookie forjado, CPF inexistente, cabeçalhos HTTP e ausência de cadastro público.
- **`npm audit --omit=dev`:** 0 vulnerabilidades.

O termo gerado pelo sistema é um **modelo**. Ele deve ser revisado e aprovado pela área jurídica da BLINK antes do uso oficial.
