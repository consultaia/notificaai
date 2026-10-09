-- OPCIONAL. Validade de protocolos passou de 3 para 2 anos.
-- O app ja calcula 2 anos para registros novos e o vencimento pode ser editado na tela.
-- Este script ajusta os protocolos JA gravados cujo vencimento era o calculo automatico de 3 anos
-- (aprovacao + 3 anos). Vencimentos digitados a mao (qualquer outra data) NAO sao alterados.
--
-- 1) Veja antes o que vai mudar:
select nome, aprovado_em, proxima_revisao as vencimento_atual,
       (aprovado_em + interval '2 years')::date as vencimento_novo
from public.protocolos
where aprovado_em is not null
  and proxima_revisao = (aprovado_em + interval '3 years')::date
order by nome;

-- 2) Se estiver de acordo, rode:
-- update public.protocolos
--    set proxima_revisao = (aprovado_em + interval '2 years')::date
--  where aprovado_em is not null
--    and proxima_revisao = (aprovado_em + interval '3 years')::date;
