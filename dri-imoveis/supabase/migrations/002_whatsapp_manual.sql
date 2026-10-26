-- ============================================================
-- Conexão manual do WhatsApp: cada conta usa o próprio app da Meta.
-- Cada conta ganha um endereço de webhook próprio (/webhook/<webhook_chave>) e um
-- token de verificação; a chave secreta do app dela confere a assinatura das mensagens.
-- ============================================================

alter table public.whatsapp_conexoes
  add column webhook_chave          text unique,
  add column verify_token           text,
  add column webhook_verificado_em  timestamptz,
  add column ultima_mensagem_em     timestamptz;

alter table public.whatsapp_segredos
  add column app_secret text;
-- O token da Meta só é preenchido depois que o corretor cola os dados
alter table public.whatsapp_segredos alter column access_token drop not null;
