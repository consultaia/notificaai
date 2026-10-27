-- ============================================================
-- Campanhas no WhatsApp do corretor (modelo de marketing aprovado pela Meta), só para quem aceitou.
-- A assistente pergunta no atendimento se a pessoa quer receber novidades; "SAIR" tira da lista.
-- O corretor só lê; quem cria, envia e atualiza é o Worker (service role).
-- ============================================================

-- Consentimento por conversa (o corretor não altera: o grant de update em conversas continua só em precisa_corretor e motivo)
alter table public.conversas
  add column novidades     text check (novidades in ('sim','nao')),
  add column novidades_em  timestamptz;

create table public.campanhas (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references public.contas(id) on delete cascade,
  nome             text not null,
  texto            text not null,
  imagem_url       text,
  botao            text,                        -- resposta rápida (ex.: "Quero saber mais")
  filtro           jsonb not null default '{}', -- { dias, palavra }
  agendada_para    timestamptz not null,
  status           text not null default 'aguardando aprovação'
                   check (status in ('aguardando aprovação','agendada','enviando','enviada','recusada','cancelada','erro')),
  template_nome    text,
  template_id      text,
  motivo           text,                        -- recusa da Meta ou erro
  total            int not null default 0,
  enviadas         int not null default 0,
  entregues        int not null default 0,
  lidas            int not null default 0,
  respostas        int not null default 0,
  falhas           int not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index campanhas_fila on public.campanhas (status, agendada_para);
alter table public.campanhas enable row level security;
create policy campanhas_ler on public.campanhas
  for select to authenticated using (conta_id = public.minha_conta());

create table public.campanha_envios (
  id            uuid primary key default gen_random_uuid(),
  campanha_id   uuid not null references public.campanhas(id) on delete cascade,
  conta_id      uuid not null references public.contas(id) on delete cascade,
  telefone      text not null,
  nome          text,
  status        text not null default 'pendente' check (status in ('pendente','enviada','entregue','lida','falhou')),
  wamid         text unique,                 -- id da mensagem na Meta (os avisos de entregue/lida vêm por ele)
  erro          text,
  enviado_em    timestamptz,
  respondeu_em  timestamptz,
  unique (campanha_id, telefone)
);
create index campanha_envios_pendentes on public.campanha_envios (campanha_id, status);
create index campanha_envios_telefone on public.campanha_envios (conta_id, telefone, enviado_em);
alter table public.campanha_envios enable row level security;
create policy campanha_envios_ler on public.campanha_envios
  for select to authenticated using (conta_id = public.minha_conta());
