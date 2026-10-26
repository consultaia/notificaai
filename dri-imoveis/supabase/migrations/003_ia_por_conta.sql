-- ============================================================
-- Chaves de IA de cada conta: o limite gratuito de cada corretor é só dele.
-- Só o Worker (service role) lê as chaves; o painel vê o resumo pelo Worker.
-- ============================================================

create table public.ia_chaves (
  conta_id      uuid not null references public.contas(id) on delete cascade,
  provedor      text not null check (provedor in ('gemini','groq','cerebras')),
  chave         text not null,
  validada_em   timestamptz,
  ultimo_erro   text,
  ultimo_erro_em timestamptz,
  primary key (conta_id, provedor)
);
alter table public.ia_chaves enable row level security;
-- sem policy: o painel não lê a chave
