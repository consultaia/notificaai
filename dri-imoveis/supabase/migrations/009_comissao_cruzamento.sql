-- ============================================================
-- Comissões: cruzamento indicação → assinatura e trava de duplicidade.
-- Continua valendo uma comissão por conta indicada (conta_id único), mesmo se cancelar e assinar de novo.
-- Suspeita de duplicidade (mesmo pagador, mesmo WhatsApp, o próprio parceiro) fica "em análise".
-- ============================================================
alter table public.comissoes
  add column motivo           text,          -- por que está em análise
  add column pagamento_mp_id  text,          -- pagamento que gerou a comissão
  add column cadastro_em      timestamptz;   -- quando a conta indicada foi criada pelo link

alter table public.comissoes drop constraint comissoes_status_check;
alter table public.comissoes add constraint comissoes_status_check
  check (status in ('em análise','a pagar','pago','cancelada'));
