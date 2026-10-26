-- ============================================================
-- Capacidade de IA incluída (Claude Haiku) por conta e por mês.
-- Passou da cota, a Dri usa as chaves gratuitas do corretor (ou a reserva da plataforma).
-- Em 80% e 100% o corretor é avisado (se avisar_capacidade).
-- ============================================================

alter table public.contas
  add column cota_ia_mensal     int,                          -- nulo = padrão da plataforma (IA_COTA_MENSAL)
  add column avisar_capacidade  boolean not null default true;

create table public.ia_uso (
  conta_id        uuid not null references public.contas(id) on delete cascade,
  mes             text not null,              -- 'AAAA-MM' (horário de Brasília)
  mensagens       int  not null default 0,    -- mensagens de cliente respondidas pela Claude
  tokens_entrada  bigint not null default 0,
  tokens_saida    bigint not null default 0,
  aviso_80_em     timestamptz,
  aviso_100_em    timestamptz,
  primary key (conta_id, mes)
);
alter table public.ia_uso enable row level security;
create policy ia_uso_ler on public.ia_uso
  for select to authenticated using (conta_id = public.minha_conta());

-- Soma o uso de forma atômica (várias conversas ao mesmo tempo). Só o Worker chama.
create or replace function public.registrar_uso_ia(p_conta uuid, p_mes text, p_mensagens int, p_entrada bigint, p_saida bigint)
returns public.ia_uso
language sql security definer set search_path = public as $$
  insert into public.ia_uso as u (conta_id, mes, mensagens, tokens_entrada, tokens_saida)
  values (p_conta, p_mes, p_mensagens, p_entrada, p_saida)
  on conflict (conta_id, mes) do update
    set mensagens = u.mensagens + excluded.mensagens,
        tokens_entrada = u.tokens_entrada + excluded.tokens_entrada,
        tokens_saida = u.tokens_saida + excluded.tokens_saida
  returning *;
$$;
revoke all on function public.registrar_uso_ia(uuid, text, int, bigint, bigint) from public, anon, authenticated;
