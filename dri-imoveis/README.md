# Dri Imóveis

Assistente de WhatsApp para corretores e imobiliárias. O corretor se cadastra sozinho pelo link,
cadastra os imóveis e os horários de visita, testa a assistente e conecta o WhatsApp oficial
num passo a passo. A Dri atende os clientes, apresenta as opções da carteira, manda fotos e
marca a visita na agenda real, sem conflito de horário.

```
web/app.html            painel do corretor (cadastro, passo a passo, imóveis, agenda, conversas)
worker/                 Cloudflare Worker: webhook do WhatsApp, cérebro da Dri (Claude), simulador
supabase/migrations/    banco (Postgres + login + fotos), com RLS por conta
```

## Como funciona

1. O corretor abre o link e cria a conta (email e senha).
2. Passo a passo: **perfil** → **imóveis** (com fotos e endereço) → **horários de visita** →
   **testar a Dri** num WhatsApp simulado → **conectar o WhatsApp**.
3. O cliente escreve no número. A Meta entrega a mensagem no Worker, que junta mensagens
   picadas (3,5 s), chama a Claude com as ferramentas da conta e responde.
4. A Dri busca imóveis, envia fotos, consulta horários livres e marca a visita. O endereço só
   é passado depois da visita marcada. O corretor recebe aviso por email e WhatsApp.
5. Se o cliente quer negociar, fazer proposta ou falar com gente, a Dri chama o corretor e fica
   em silêncio naquela conversa até ele clicar em "Resolvido" no painel. O corretor pode
   responder pelo próprio painel.

## Colocar no ar (uma vez, pela ConsultaIA)

### 1. Supabase
1. Crie um projeto (região São Paulo).
2. SQL Editor → rode `supabase/migrations/001_base.sql`.
3. Authentication → URL Configuration: **Site URL** = endereço do `app.html`; adicione o mesmo
   em Redirect URLs. Deixe a confirmação de email ligada.
4. Anote a URL do projeto, a chave pública (anon) e a service role.

### 2. Worker (Cloudflare)
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN        # invente uma senha longa
npx wrangler secret put META_CONFIG_ID           # do Embedded Signup (passo 3)
npx wrangler secret put RESEND_API_KEY           # opcional: aviso por email
npx wrangler secret put EMAIL_REMETENTE          # ex.: "Dri <avisos@seudominio.com.br>"
npm run deploy
npm test                                         # testes da agenda e da conversa
```
Em `wrangler.toml`, preencha `PAINEL_URL` e `PAINEL_ORIGEM` (endereço do painel).
`MODELO` (padrão `claude-opus-5-5`) e `ESFORCO` (padrão `low`) podem ser trocados ali.

### 3. App da Meta (para o botão "Conectar com o Facebook")
1. Em developers.facebook.com, crie um app do tipo **Empresa** com o produto **WhatsApp**,
   ligado ao portfólio empresarial da ConsultaIA (verificado com o CNPJ).
2. WhatsApp → Configuração → Webhook: URL `https://SEU-WORKER/webhook`, token = `META_VERIFY_TOKEN`.
   Assine o campo **messages**.
3. Para que *outras empresas* conectem os próprios números, o app precisa virar
   **Tech Provider** (Provedor de tecnologia) e passar pela análise da Meta, pedindo
   `whatsapp_business_messaging` e `whatsapp_business_management`. Leva de dias a algumas semanas.
4. Login do Facebook para Empresas → Configurações → crie uma configuração de
   **WhatsApp Embedded Signup**. O ID dela é o `META_CONFIG_ID`.
5. Em Login do Facebook → Configurações, adicione o domínio do painel em "Domínios permitidos
   para o SDK do JavaScript".

Enquanto o app não é aprovado: o primeiro corretor (o seu amigo) pode ser ligado pela
**conexão manual** do painel, com um número adicionado ao próprio app da ConsultaIA.

### 4. Painel
Preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `WORKER_URL` no topo de `web/app.html` e publique a
pasta `web/` (Cloudflare Pages, GitHub Pages ou junto do site). Esse é o link que o corretor recebe.

## Custos (por corretor)
- **Meta:** responder cliente que escreveu é grátis. Mensagem que a empresa inicia (modelo aprovado)
  custa centavos e cai no cartão da conta Meta do corretor.
- **Claude:** cobrado por uso na conta da ConsultaIA; entra na mensalidade. O prompt é cacheado.
- **Supabase e Cloudflare:** os planos gratuitos aguentam o começo.

## Limites conhecidos
- A Dri não ouve áudio nem vê imagem do cliente: pede para escrever.
- Fuso fixo de Brasília (UTC-3), que vale para quase todo o Brasil.
- Aviso por WhatsApp ao corretor fora da janela de 24 h precisa de um modelo aprovado
  (`TEMPLATE_AVISO`, com uma variável `{{1}}`); sem ele, o aviso vai por email e aparece no painel.
- Ainda não há cobrança automática da mensalidade.
