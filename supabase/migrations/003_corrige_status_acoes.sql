-- OPCIONAL, mas recomendado. A tela "Ações pendentes" gravava status 'concluida' (com a),
-- enquanto o resto do sistema espera 'concluido'. Essas ações apareciam como pendentes no plano,
-- nao deixavam fechar o plano e contavam como atrasadas no painel. O app ja grava certo.
--
-- 1) Veja quantas sao:
select count(*) as acoes_com_status_errado from public.plano_acoes where status = 'concluida';

-- 2) Corrija:
-- update public.plano_acoes set status = 'concluido' where status = 'concluida';
