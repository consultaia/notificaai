# Ligar a cobrança mensal no Mercado Pago

Uns 15 minutos. Ao final, o corretor clica em **Assinar** no painel, digita o cartão na página do Mercado Pago
e a cobrança de R$ 197 se renova todo mês sozinha. O Worker recebe os avisos do Mercado Pago e atualiza a
situação da conta (pagando, pagamento recusado, pausada).

## 1. Conta do Mercado Pago
Use a conta que vai **receber** o dinheiro (pessoa física ou CNPJ), com cadastro e identidade verificados.

## 2. Criar a aplicação
1. Entre em <https://www.mercadopago.com.br/developers> com essa conta → **Suas integrações** → **Criar aplicação**.
2. Nome: `Toc Toc`.
3. Tipo de solução: **Pagamentos online**. Plataforma de e-commerce: **não**.
4. Produto: **Assinaturas** (se pedir um modelo, escolha "assinatura sem plano associado").
5. Confirme e crie.

## 3. Credenciais de produção
1. Na aplicação → **Credenciais de produção** → ativar (pede ramo do negócio e site: use `https://dri-imoveis.pages.dev`).
2. Copie o **Access Token** de produção (começa com `APP_USR-`).

## 4. Webhook (avisos de pagamento)
1. Na aplicação → **Webhooks** → **Configurar notificações** → aba **Modo produção**.
2. URL: `https://dri-imoveis.janan-almeida.workers.dev/mercadopago/webhook`
3. Eventos: marque **Planos e assinaturas** (assinaturas e pagamentos recorrentes / "subscription_preapproval" e
   "subscription_authorized_payment").
4. Salve. Aparece a **assinatura secreta** do webhook: copie.

## 5. Guardar as chaves (nunca no chat)
No ambiente da sessão do Claude (menu do ambiente → Edit), **sem parênteses ou aspas em volta**:
- `MERCADOPAGO_ACCESS_TOKEN` = Access Token de produção
- `MERCADOPAGO_WEBHOOK_SECRET` = assinatura secreta do webhook

Na sessão seguinte o Claude grava as duas no Worker:
`printf %s "$MERCADOPAGO_ACCESS_TOKEN" | npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN` (idem para o segredo).
Ou cole você mesmo no Cloudflare: Workers → `dri-imoveis` → Settings → Variables and Secrets → Add (tipo Secret).

## 6. Teste real antes de divulgar
1. Na área do administrador → **Valores**, baixe a mensalidade para um valor pequeno (ex.: R$ 5).
2. Com uma conta de teste de corretor, clique em **Assinar** e pague com um cartão seu.
3. Confira: a faixa do painel some (ou mostra "assinatura registrada" durante o teste grátis), a conta aparece como
   **pagando** no admin e o pagamento entra em "Recebido este mês" quando o Mercado Pago cobrar.
4. Cancele essa assinatura no Mercado Pago (Assinaturas → cancelar), volte a mensalidade para R$ 197 em **Valores**.

## Como funciona depois
- **Teste grátis (5 dias):** quem assina durante o teste só é cobrado quando o teste termina.
- **Cartão recusado:** a conta vira "pagamento recusado", você recebe o aviso (na aba Avisos do admin e por email se
  houver Resend) e pode clicar em **Enviar aviso** para o corretor. A assistente pausa 2 dias depois.
- **Reativar:** o corretor clica em **Atualizar pagamento** no painel e cadastra o cartão de novo; quando o Mercado Pago
  aprova, a assistente volta sozinha e a assinatura antiga é cancelada para não cobrar duas vezes.
- **Cortesia:** no admin, "Dar cortesia": não cobra e nunca pausa.
- **Parceiros:** R$ 100 por PIX quando o indicado faz o primeiro pagamento; uma vez por conta. Suspeita de mesma
  pessoa ou do próprio parceiro fica "em análise". Você paga o PIX e clica em "Marcar como paga".
