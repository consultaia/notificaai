-- ============================================================
-- Captação: proprietários que querem vender ou alugar o imóvel com o corretor.
-- A Dri colhe os dados pelo WhatsApp (e guarda as fotos que a pessoa manda);
-- o corretor acompanha na aba Captações e transforma em imóvel com um clique.
-- ============================================================

create table public.captacoes (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references public.contas(id) on delete cascade,
  telefone          text not null,
  nome              text,
  finalidade        text check (finalidade in ('venda','aluguel','venda ou aluguel')),
  tipo              text,
  bairro            text,
  cidade            text,
  endereco          text,
  quartos           int,
  suites            int,
  banheiros         int,
  vagas             int,
  area_m2           numeric(10,2),
  valor_pretendido  numeric(14,2),
  condominio        numeric(12,2),
  iptu              numeric(12,2),
  ocupacao          text,              -- desocupado, morando, alugado
  caracteristicas   text[] not null default '{}',
  observacoes       text,              -- o que mais a pessoa contou (reforma, urgência, documentação…)
  melhor_horario    text,              -- quando o corretor pode ligar ou visitar
  fotos             text[] not null default '{}',
  completa          boolean not null default false,   -- a Dri terminou de colher e avisou o corretor
  status            text not null default 'nova'
                    check (status in ('nova','em contato','avaliação marcada','captado','descartada')),
  imovel_id         uuid references public.imoveis(id) on delete set null,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index captacoes_conta on public.captacoes (conta_id, status, criado_em desc);
-- uma captação aberta por telefone (as fotos que chegam vão para ela)
create unique index captacoes_aberta on public.captacoes (conta_id, telefone)
  where status in ('nova','em contato','avaliação marcada');

alter table public.captacoes enable row level security;
create policy captacoes_dono on public.captacoes
  for all to authenticated
  using (conta_id = public.minha_conta()) with check (conta_id = public.minha_conta());

create trigger captacoes_atualizado before update on public.captacoes
  for each row execute function public.tocar_atualizado_em();

-- Fotos que o cliente manda pelo WhatsApp ficam guardadas na conversa
-- (e vão para a captação quando ela existir)
alter table public.conversas add column midias_recebidas text[] not null default '{}';
