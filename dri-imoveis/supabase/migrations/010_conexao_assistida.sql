-- ============================================================
-- Conexão assistida do WhatsApp: o corretor pede pelo painel e o administrador faz a conexão por ele,
-- entrando no portfólio empresarial da Meta do corretor (que convida o administrador).
-- ============================================================
create table public.pedidos_conexao (
  id                   uuid primary key default gen_random_uuid(),
  conta_id             uuid not null unique references public.contas(id) on delete cascade,
  nome_exibicao        text not null,          -- nome que os clientes vão ver no WhatsApp
  numero               text not null,          -- número a conectar
  numero_situacao      text not null check (numero_situacao in ('livre','apagar','em_uso')),
  documento            text,                   -- CPF ou CNPJ (opcional)
  melhor_horario       text,                   -- para receber o código por SMS ou ligação
  portfolio_convidado  boolean not null default false,
  observacoes          text,
  status               text not null default 'novo' check (status in ('novo','em andamento','concluido','cancelado')),
  nota_admin           text,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
alter table public.pedidos_conexao enable row level security;
create policy pedido_conexao_ler on public.pedidos_conexao
  for select to authenticated using (conta_id = public.minha_conta());
