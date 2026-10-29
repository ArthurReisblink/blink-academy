# Segurança, LGPD e limitações

## Identidade

- **Motorista:**
  - O CPF identifica o motorista, mas **nunca é a única prova**. Cada acesso exige um código de 6 dígitos enviado ao telefone ou e-mail cadastrado pela BLINK.
  - O código vale 10 minutos e aceita 5 tentativas.
  - Para CPF inexistente, a resposta é idêntica à de um CPF cadastrado, para não revelar quem está cadastrado.
  - **Não há autocadastro**: só a administração cadastra motoristas.
- **Administrador:**
  - Senha forte (argon2id) + aplicativo autenticador (TOTP), obrigatórios. O mesmo código não pode ser usado duas vezes.
  - Bloqueio após 8 erros.
  - Não existe criação pública de administradores.
- **Sessões:** cookies `httpOnly`, `Secure` (em produção) e `SameSite=Lax`. O token é guardado apenas como hash. Bloquear o motorista ou o administrador encerra as sessões.
- **Limites de tentativas:** em login, envio e conferência de códigos, assinatura e verificação pública.

## Dados

- **CPF:** guardado criptografado (AES-256-GCM), com um hash para busca e uma máscara (`***.123.456-**`) para exibição. Ver o CPF completo no painel é registrado na auditoria.
- **Banco de dados:**
  - Esquema próprio, sem acesso pela API pública do Supabase.
  - Row Level Security em todas as tabelas, com papéis separados para login, painel, motorista e rotinas internas.
  - O motorista só enxerga os próprios registros e não lê o gabarito, as evidências nem os caminhos de arquivos.
- **Registros imutáveis:** quem altera ou apaga é recusado pelo próprio banco, mesmo com acesso direto.
  - tentativas de prova enviadas;
  - assinaturas;
  - histórico das convocações;
  - logs de acesso e auditoria;
  - conteúdo dos termos.
- **Arquivos:** bucket privado. O navegador recebe links temporários e assinados.
- **Cabeçalhos de segurança:** CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy.
- **Segredos:** só no servidor (variáveis de ambiente). Foi conferido que nenhuma chave aparece no código enviado ao navegador.

## Regras garantidas no servidor e no banco

- **Prova:**
  - só abre com todos os vídeos obrigatórios concluídos;
  - respeita o limite de tentativas e o prazo;
  - é corrigida somente no servidor;
  - fica gravada como cópia imutável das perguntas e regras da época.
- **Progresso do vídeo:** conta apenas trechos realmente reproduzidos, limitados ao tempo real decorrido. Pular, acelerar ou repetir não completa o vídeo.
- **Assinatura:**
  - só é liberada após vídeos e aprovação;
  - exige declaração marcada e um novo código de uso único, ligado à sessão;
  - gera um registro de evidências com SHA-256 (data, IP, dispositivo, canal do código, hash do termo, nota, vídeos);
  - inclui o manifesto anexado ao PDF assinado.
- **"Treinamento concluído":** o banco só aceita com vídeos + aprovação + assinatura. Depois de concluído, não volta atrás.
- **Prazo vencido:** bloqueia vídeos, prova e assinatura, e mostra a mensagem "Seu prazo de treinamento terminou. Entre em contato com a administração da BLINK.". Prorrogar mantém todo o progresso.

## LGPD

- **Aviso de privacidade:** disponível em `/privacidade`. Revise o texto com o jurídico e o encarregado (DPO) da BLINK.
- **Retenção automática diária**, configurável em **Configurações**:
  - registros de acesso;
  - códigos;
  - sessões;
  - eventos do player.
- **O que é mantido:** provas, assinaturas e comprovantes, como prova da realização do treinamento.
- **Anonimização:** o superadministrador pode anonimizar um motorista na página dele, o que remove nome, CPF e contatos.
- **Exportações:** contêm só o CPF mascarado e ficam registradas na auditoria.

## Limitações conhecidas

1. **Validade jurídica:**
   - O termo gerado pelo sistema é um **modelo**. O termo oficial e o modelo de assinatura eletrônica devem ser **revisados e aprovados pela área jurídica da BLINK** antes do uso.
   - A rubrica desenhada na tela é apenas complementar e, sozinha, não comprova identidade. A identificação se apoia no CPF + código enviado ao contato cadastrado pela BLINK.
2. **Contato cadastrado:** a segurança do login depende de o telefone ou e-mail cadastrado pertencer de fato ao motorista. Confira esse dado no cadastro.
3. **Itens não testados:** Supabase Storage, envio real de SMS e e-mail e execução na Vercel não puderam ser testados sem as contas da BLINK (veja o checklist em PUBLICACAO.md).
4. **Download de vídeos:** o player desativa download e velocidade, mas nenhum site impede totalmente que alguém grave a tela.
5. **Dependências:** `npm audit --omit=dev` retornou 0 vulnerabilidades em 29/10/2026. Repita periodicamente.
