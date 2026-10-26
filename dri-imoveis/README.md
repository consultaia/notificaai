# Dri Imóveis

Assistente de WhatsApp para corretores e imobiliárias. O corretor se cadastra sozinho pelo link,
cadastra os imóveis e os horários de visita, testa a assistente e conecta o WhatsApp oficial
sozinho, num passo a passo dentro do painel (com o app da Meta dele; a ConsultaIA não precisa ser
Tech Provider). A Dri atende os clientes, apresenta as opções da carteira, manda fotos e
marca a visita na agenda real, sem conflito de horário.

```
web/app.html            painel do corretor (cadastro, passo a passo, imóveis, agenda, conversas)
web/privacidade.html    política de privacidade que o corretor informa no app da Meta
worker/                 Cloudflare Worker: webhook do WhatsApp, cérebro da Dri (Claude Haiku + 3 IAs gratuitas de reserva), simulador
supabase/migrations/    banco (Postgres + login + fotos), com RLS por conta
```

## Como funciona

1. O corretor abre o link e cria a conta (email e senha).
2. Passo a passo: **perfil** → **imóveis** (com fotos e endereço) → **horários de visita** →
   **IA própria** (chaves gratuitas dele) → **testar a Dri** num WhatsApp simulado → **conectar o WhatsApp**.
3. O cliente escreve no número. A Meta entrega a mensagem no endereço de webhook da conta
   (`/webhook/<chave>`); o Worker confere a assinatura com a chave secreta do app do corretor, que junta mensagens
   picadas (3,5 s), chama a IA com as ferramentas da conta e responde.
4. A Dri busca imóveis, envia fotos, consulta horários livres e marca a visita. O endereço só
   é passado depois da visita marcada. O corretor recebe aviso por email e WhatsApp.
5. Se o cliente quer negociar, fazer proposta ou falar com gente, a Dri chama o corretor e fica
   em silêncio naquela conversa até ele clicar em "Resolvido" no painel. O corretor pode
   responder pelo próprio painel.

## Colocar no ar (uma vez, pela ConsultaIA)

### 1. Supabase
1. Crie um projeto (região São Paulo).
2. SQL Editor → rode, em ordem, os arquivos da pasta `supabase/migrations/` (001 a 006).
3. Authentication → URL Configuration: **Site URL** = endereço do `app.html`; adicione o mesmo
   em Redirect URLs. Deixe a confirmação de email ligada.
4. Anote a URL do projeto, a chave pública (anon) e a service role.

### 2. Worker (Cloudflare)
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY        # platform.claude.com: a Claude Haiku é a IA principal
npx wrangler secret put GEMINI_API_KEY           # aistudio.google.com/apikey
npx wrangler secret put GROQ_API_KEY             # console.groq.com/keys (reserva e transcrição de áudio)
npx wrangler secret put CEREBRAS_API_KEY         # cloud.cerebras.ai
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY           # opcional: aviso por email
npx wrangler secret put EMAIL_REMETENTE          # ex.: "Dri <avisos@seudominio.com.br>"
npx wrangler secret put ALERTA_EMAIL             # opcional: recebe o autoteste diário das IAs
npm run deploy
npm test                                         # testes da agenda e da conversa
```
Em `wrangler.toml`, preencha `PAINEL_URL` e `PAINEL_ORIGEM` (endereço do painel).
`IA_ORDEM` define a ordem das IAs (padrão `gemini,groq,cerebras`). Os modelos podem ser trocados com
`GEMINI_MODELO` (padrão `gemini-2.5-flash`), `GROQ_MODELO` e `CEREBRAS_MODELO` (padrão `gpt-oss-120b`).

### A IA da Dri
**Principal: Claude Haiku 5.5** (`claude-haiku-5-5`, a Claude mais barata), paga pela plataforma e
incluída na mensalidade. Fica ligada quando há `ANTHROPIC_API_KEY`. Para o corretor, a etapa IA vira
opcional. Custo estimado: uns R$ 0,10 por conversa. `IA_CLAUDE = "reserva"` inverte a ordem (gratuitas
primeiro, Claude só se todas falharem); `CLAUDE_MODELO` troca o modelo; `CLAUDE_ESFORCO` (padrão `low`).

**Capacidade incluída:** cada conta tem uma cota mensal de mensagens respondidas pela Claude
(`IA_COTA_MENSAL`, padrão 1.500 ≈ 150 conversas ≈ R$ 15; por conta: coluna `contas.cota_ia_mensal`).
Renova todo dia 1º (horário de Brasília). Em 80% e em 100% o corretor recebe aviso por email e
WhatsApp (desligável no perfil) e vê uma barra no painel. Passou da cota, a Dri continua com as
chaves gratuitas dele; sem elas, com a reserva compartilhada da plataforma. O uso (mensagens e
tokens) fica na tabela `ia_uso`, para você acompanhar o custo por corretor.

**Cadastro de imóveis:** três caminhos na aba Imóveis:
- **Empreendimento** (à mão): dados comuns (nome, construtora, situação, entrega, endereço, apresentação),
  lazer e diferenciais em botões de tocar (piscina, playground, churrasqueira, salões…) mais campo livre,
  fotos comuns, o book em PDF e uma **tabela de plantas**, cada uma com quartos, suítes, banheiros, vagas,
  área, preço e imagem da planta. Cada planta vira uma opção que a Dri oferece. Dá para editar depois
  (mudar preço, pausar, duplicar, remover ou acrescentar planta).
- **Imóvel avulso**: um apartamento ou casa, com as mesmas características em botões.
- **Importar book (PDF)**: a IA preenche o formulário de empreendimento; o corretor confere e completa.

**Importar book (PDF):** na aba Imóveis, o corretor manda o book de divulgação do empreendimento.
O PDF é lido no próprio navegador (pdf.js), página por página: texto e imagem de cada página. O texto
vai para a IA (Claude Haiku com saída estruturada; sem ela, uma gratuita em modo JSON), que devolve
empreendimento, endereço, situação, lazer, as plantas (com a página de cada uma) e as melhores páginas
para foto. Se o PDF for só imagem, a Claude lê as imagens das primeiras 12 páginas. O corretor revisa no
mesmo formulário de empreendimento e completa o que o book não traz (preços, vagas): cada planta vira um
imóvel, com a imagem da planta como primeira foto e as páginas escolhidas depois. Até 50 MB o próprio PDF fica guardado (bucket `books-imoveis`) e a Dri manda o book ao cliente
(ferramenta `enviar_book`). Testado com books reais de 3 MB/48 páginas e 30 MB/32 páginas.

**Captação (proprietários):** quando quem escreve quer vender ou alugar o imóvel dele, a Dri colhe os
dados aos poucos (finalidade, tipo, bairro, quartos, vagas, área, valor pretendido, ocupação, melhor
horário) com a ferramenta `salvar_captacao`, guarda as fotos que a pessoa manda pelo WhatsApp (bucket
`fotos-imoveis`, pasta `recebidas/`) e avisa o corretor por email e WhatsApp. No painel, a aba Captações
lista tudo com a situação (nova, em contato, avaliação marcada, captado, descartada) e o botão
"Cadastrar como imóvel", que já preenche o formulário (o imóvel começa pausado).

**Áudio:** a Dri baixa o áudio do WhatsApp e transcreve com o Whisper do Groq (gratuito), usando a
chave do Groq do corretor ou a da plataforma. Se não der para transcrever, ela pede para o cliente escrever.

### As 3 IAs gratuitas (reserva)
Cada corretor cadastra as **próprias chaves** (Groq, Gemini e Cerebras, grátis e sem cartão) na
etapa IA do painel. O painel confere a chave antes de salvar e nunca mostra a chave inteira de
volta. Assim o limite gratuito é de cada corretor, e o movimento de um não atrapalha os outros.
As chaves que você põe no Worker (`GEMINI_API_KEY` etc.) viram **reserva compartilhada**: só são
usadas se as do corretor falharem ou se ele ainda não cadastrou nenhuma. Para desligar a reserva,
ponha `IA_RESERVA_PLATAFORMA = "nao"` em `wrangler.toml`. Quando uma chave do corretor falha, o
painel mostra o erro para ele gerar outra.

**Se um provedor aposentar o modelo** (o Groq tirou o Llama do ar de um dia para o outro em 2026):
1. cada IA tem uma lista de modelos em ordem de preferência (`worker/src/ia.js`); se um sumir, a Dri
   usa o próximo da mesma IA na hora, sem o cliente perceber;
2. se a lista inteira sumir, a Dri pergunta ao provedor quais modelos existem e escolhe um da mesma família;
3. se ainda assim falhar, passa para a próxima IA;
4. todo dia às 8h um autoteste roda em cada IA e manda email para `ALERTA_EMAIL` se algo caiu ou
   mudou de modelo, para você atualizar a lista com calma. Para trocar o modelo sem mexer no código:
   `GROQ_MODELO`, `GEMINI_MODELO`, `CEREBRAS_MODELO` (aceitam lista separada por vírgula).

A Dri pergunta para a primeira da fila. Se ela der erro, bater o limite do plano gratuito ou
demorar mais de 25 s, a mesma pergunta vai para a próxima, sem o cliente perceber. Uma IA que
bateu o limite fica 1 minuto no fim da fila (só a chave daquele corretor). Basta configurar uma chave para funcionar; com as
três, uma cobre a outra. `GET /` no Worker mostra quais estão ativas.

### 3. WhatsApp: o corretor conecta sozinho
Não há nada a configurar na Meta pela ConsultaIA. Na aba **WhatsApp** do painel, o corretor segue
um passo a passo de 22 itens, que leva uns 30 minutos:

| Etapa | O que ele faz |
|---|---|
| A | Cria a conta de desenvolvedor e um app em developers.facebook.com (caso de uso WhatsApp) |
| B | Adiciona o número dele e copia o ID do número e o ID da conta do WhatsApp Business |
| C | Cria um usuário do sistema e gera um **token permanente** |
| D | Copia a **chave secreta do app**, informa a política de privacidade e cola tudo no painel, com um PIN de 6 dígitos |
| E | Cola no app o **endereço de webhook** e o **token de verificação** que o painel mostra (com botão Copiar) e ativa `messages` |
| F | Publica o app (modo Ao vivo) e manda um "oi" de outro celular |

O painel confere os dados com a Meta na hora (erros viram instruções do que corrigir) e mostra uma
lista de verificação que se atualiza sozinha: dados conectados → webhook confirmado → primeira
mensagem recebida.

Limites desse caminho: o número não pode estar em uso em nenhum app do WhatsApp (o corretor usa
um chip novo ou apaga a conta do WhatsApp daquele número). Manter o app WhatsApp Business no
celular junto com a Dri só é possível pelo cadastro incorporado da Meta, que exige Tech Provider.

### 4. Painel
Preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `WORKER_URL` no topo de `web/app.html`, troque
`CONTATO` em `web/privacidade.html` por um email de contato, e publique a pasta `web/` (Cloudflare Pages, GitHub Pages ou junto do site). Esse é o link que o corretor recebe.

## Custos (por corretor)
- **Meta:** responder cliente que escreveu é grátis. Mensagem que a empresa inicia (modelo aprovado)
  custa centavos e cai no cartão da conta Meta do corretor. Cada corretor tem o próprio app e a própria conta.
- **IA:** Claude Haiku, cobrada por uso na conta da plataforma: uns R$ 0,10 por conversa
  (US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída), ou uns R$ 30 por mês para um
  corretor com 10 conversas por dia. As gratuitas (do corretor e da plataforma) só entram se a Claude falhar.
- **Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado ao Gemini para melhorar
  os produtos dele. Groq e Cerebras não treinam com os dados da API. Se isso importar, ponha
  `IA_ORDEM = "groq,cerebras,gemini"` ou ative o plano pago do Gemini. Cite isso na política de
  privacidade (a Meta pede uma).
- **Supabase e Cloudflare:** os planos gratuitos aguentam o começo.

## Limites conhecidos
- A Dri entende áudio (transcrição), mas não vê imagem nem vídeo do cliente: pede para escrever.
- Fuso fixo de Brasília (UTC-3), que vale para quase todo o Brasil.
- Aviso por WhatsApp ao corretor fora da janela de 24 h precisa de um modelo aprovado
  (`TEMPLATE_AVISO`, com uma variável `{{1}}`); sem ele, o aviso vai por email e aparece no painel.
- Ainda não há cobrança automática da mensalidade.
