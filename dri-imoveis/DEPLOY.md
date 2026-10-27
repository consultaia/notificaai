# Colocar a Dri Imóveis no ar (roteiro para a próxima sessão)

Código: pasta `dri-imoveis/` do repositório `consultaia/notificaai`, branch `claude/tender-dirac-tfvz9r`.
Dono: Janan (janan.almeida@gmail.com). Decisões já tomadas, não perguntar de novo:
- Supabase: organização **"Dri imoveis"** (plano Pro, slug `gwinofiomyeplnrhicyf`), projeto
  **`dri-imoveis`**, ID **`xmqmnmyejkfpmniljkbt`**, região `sa-east-1`,
  URL `https://xmqmnmyejkfpmniljkbt.supabase.co`. **Banco já pronto**: migrações 001 a 007 aplicadas,
  bucket de books em 200 MB, verificador de segurança revisado. URL e chave pública já estão em `web/app.html`.
  Avisos que ficam de propósito: tabelas com RLS sem policy (`ia_chaves`, `whatsapp_segredos`,
  `wa_mensagens_recebidas`: só o Worker lê) e `minha_conta()` executável por usuário logado (as policies usam).
- Hospedagem: Cloudflare (Worker `dri-imoveis` + painel no Cloudflare Pages).
- IA principal: Claude Haiku 5.5 paga pela plataforma, com capacidade mensal por conta (padrão 1.500
  mensagens). Gratuitas (Groq, Gemini, Cerebras) como reserva; Groq também transcreve áudio.
- WhatsApp: cada corretor conecta o próprio app da Meta pelo passo a passo do painel (sem Tech Provider).
- Contato na política de privacidade: janan.almeida@gmail.com (já está em `web/privacidade.html`).

## Pré-requisitos (o Janan faz)
Variáveis/segredos no ambiente da sessão: `CLOUDFLARE_API_TOKEN` (Workers + Pages: Edit),
`CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`; opcionais `RESEND_API_KEY`,
`GEMINI_API_KEY`, `CEREBRAS_API_KEY`. Rede: `api.cloudflare.com` liberado.
Nunca pedir chave ou token no chat.

## Passos
1. **Supabase**: já feito (ver acima). Só conferir com `list_migrations` no projeto `xmqmnmyejkfpmniljkbt`
   que 001 a 007 estão lá. Migração nova futura: arquivo em `supabase/migrations/` + `apply_migration`.
   - Service role key: pedir ao Janan para criar o segredo `SUPABASE_SERVICE_ROLE_KEY` no ambiente,
     ou para colar direto no Cloudflare (Worker → Settings → Variables and Secrets). Não pelo chat.
     Fica em Supabase → Project Settings → API Keys (chave `service_role` / secret).
2. **Worker**: em `worker/`, `npm ci`, `npm test` (precisa passar tudo), depois
   `npx wrangler deploy`. Segredos com `npx wrangler secret put` (lendo das variáveis de ambiente,
   ex.: `printf %s "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY` e os opcionais.
   `ALERTA_EMAIL = janan.almeida@gmail.com` em `wrangler.toml` (se houver Resend + `EMAIL_REMETENTE`).
   Conferir `GET /` do Worker: `ia` deve listar `claude` e `groq`.
3. **Painel**: preencher `WORKER_URL` no topo de `web/app.html` (Supabase já preenchido); publicar a pasta `web/` com `npx wrangler pages deploy web --project-name dri-imoveis`.
   Pôr `PAINEL_URL` e `PAINEL_ORIGEM` no `wrangler.toml` com o endereço do Pages e publicar o Worker de novo.
4. **Login do Supabase**: Authentication → URL Configuration: Site URL e Redirect URL = endereço do
   `app.html` (se o MCP não fizer, pedir ao Janan, com o caminho exato).
5. **Teste real antes de entregar**:
   - criar uma conta de teste pelo painel, cadastrar um empreendimento e horários;
   - no simulador do painel, conversar como cliente: saudação, bairro sem imóvel, "quero" depois de
     uma oferta, fotos, book, marcar visita, pedir para falar com o corretor; conferir tom (mensagens
     separadas, calor humano) e que nada é inventado;
   - mandar como proprietário "quero vender meu apartamento" (conferir a aba Captações e o aviso), importar os dois books de exemplo do Janan (Encanto Piatã e Imbuí Class; pedir os PDFs de novo se
     não estiverem na sessão) e conferir o que a IA extraiu;
   - ajustar o prompt em `worker/src/agente.js` se preciso, rodar `npm test`, publicar.
6. Entregar ao Janan o link do painel e o link da política de privacidade (o corretor usa na Meta).
   Fazer commit e push do que mudou (sem chaves no repositório).
