# Administrador inicial

Não existe cadastro público de administradores. O primeiro **superadministrador** é criado por linha de comando, com acesso direto ao banco. Os demais são criados por ele dentro do painel, em **Administradores**.

## Criar

No PowerShell, na pasta do projeto, com `DATABASE_URL` apontando para o banco desejado (`.env.local` ou `$env:DATABASE_URL`):

```powershell
npm run admin:create
```

Responda às perguntas:

- **E-mail:** é o login.
- **Nome completo**
- **Senha:** mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo. A senha não aparece na tela enquanto é digitada.

O perfil criado é `superadmin`. Para outro perfil, defina `ADMIN_ROLE` antes de rodar o comando.

Para automatizar, sem perguntas:

```powershell
$env:ADMIN_NAME="Arthur"; $env:ADMIN_EMAIL="arthur@blink.com.br"; $env:ADMIN_ROLE="superadmin"
$env:ADMIN_PASSWORD="(senha forte)"; npm run admin:create
Remove-Item Env:ADMIN_PASSWORD
```

## Primeiro login (verificação em duas etapas)

1. Abra `/admin` e entre com e-mail e senha.
2. Aparecem um **QR Code** e uma chave de texto. Leia o QR Code com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy).
3. Digite o código de 6 dígitos. A partir daí, todo login pede senha e código.

## Perfis

| Perfil | Pode |
|---|---|
| **Superadministrador** | Tudo, inclusive criar e desativar administradores, revogar comprovantes, anonimizar motoristas (LGPD) e mudar a retenção. |
| **Administrador** | Operação diária: motoristas, prazos, treinamentos, vídeos, questões, provas, termos e relatórios. |
| **Auditor** | Somente leitura de tudo, inclusive da auditoria. |

## Celular perdido ou senha esquecida

Outro superadministrador abre **Administradores → Gerenciar**. Ali ele define uma nova senha provisória e/ou marca **redefinir autenticador**, e as sessões da pessoa são encerradas.

Se o único superadministrador perdeu o acesso, rode `npm run admin:create` para criar outro superadministrador e, com ele, redefina o acesso do anterior.

Após 8 tentativas de senha erradas, a conta fica bloqueada por 15 minutos.
