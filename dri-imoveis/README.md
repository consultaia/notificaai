# Dri Imóveis

Assistente de WhatsApp para corretores e imobiliárias. O corretor se cadastra sozinho pelo link,
cadastra os imóveis e os horários de visita, testa a assistente e conecta o WhatsApp oficial
num passo a passo. A Dri atende os clientes, apresenta as opções da carteira, manda fotos e
marca a visita na agenda real, sem conflito de horário.

```
web/app.html            painel do corretor (cadastro, passo a passo, imóveis, agenda, conversas)
worker/                 Cloudflare Worker: webhook do WhatsApp, cérebro da Dri (3 IAs gratuitas), simulador
supabase/migrations/    banco (Postgres + login + fotos), com RLS por conta
```

## Como funciona

1. O corretor abre o link e cria a conta (email e senha).
2. Passo a passo: **perfil** → **imóveis** (com fotos e endereço) → **horários de visita** →
   **testar a Dri** num WhatsApp simulado → **conectar o WhatsApp**.
3. O cliente escreve no número. A Meta entrega a mensagem no Worker, que junta mensagens
   picadas (3,5 s), chama a IA com as ferramentas da conta e responde.
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
npx wrangler secret put GEMINI_API_KEY           # aistudio.google.com/apikey
npx wrangler secret put GROQ_API_KEY             # console.groq.com/keys
npx wrangler secret put CEREBRAS_API_KEY         # cloud.cerebras.ai
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
`IA_ORDEM` define a ordem das IAs (padrão `gemini,groq,cerebras`). Os modelos podem ser trocados com
`GEMINI_MODELO` (padrão `gemini-2.5-flash`), `GROQ_MODELO` e `CEREBRAS_MODELO` (padrão `gpt-oss-120b`).

### As 3 IAs gratuitas
A Dri pergunta para a primeira da fila. Se ela der erro, bater o limite do plano gratuito ou
demorar mais de 25 s, a mesma pergunta vai para a próxima, sem o cliente perceber. Uma IA que
bateu o limite fica 1 minuto no fim da fila. Basta configurar uma chave para funcionar; com as
três, uma cobre a outra. `GET /` no Worker mostra quais estão ativas.

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
- **IA:** R$ 0 nos planos gratuitos do Gemini, Groq e Cerebras. Eles têm limite de pedidos por
  minuto e por dia; cada mensagem do cliente usa de 1 a 4 pedidos. Para poucos corretores sobra.
  Com muitos clientes, o primeiro passo é ativar o plano pago de uma delas (barato) e manter as
  outras como reserva.
- **Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado ao Gemini para melhorar
  os produtos dele. Groq e Cerebras não treinam com os dados da API. Se isso importar, ponha
  `IA_ORDEM = "groq,cerebras,gemini"` ou ative o plano pago do Gemini. Cite isso na política de
  privacidade (a Meta pede uma).
- **Supabase e Cloudflare:** os planos gratuitos aguentam o começo.

## Limites conhecidos
- A Dri não ouve áudio nem vê imagem do cliente: pede para escrever.
- Fuso fixo de Brasília (UTC-3), que vale para quase todo o Brasil.
- Aviso por WhatsApp ao corretor fora da janela de 24 h precisa de um modelo aprovado
  (`TEMPLATE_AVISO`, com uma variável `{{1}}`); sem ele, o aviso vai por email e aparece no painel.
- Ainda não há cobrança automática da mensalidade.
