-- ============================================================
-- Dri Imóveis — base multi-conta (corretor autônomo ou imobiliária)
-- Cada conta pertence a um usuário do Supabase Auth (owner_id).
-- O painel (anon key + login) só enxerga as linhas da própria conta (RLS).
-- O Worker da Dri usa a service role e ignora a RLS.
-- ============================================================

create extension if not exists btree_gist;

-- ------------------------------------------------------------ contas
create table public.contas (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null unique references auth.users(id) on delete cascade,
  nome                   text not null,                       -- nome do corretor ou da imobiliária
  tipo                   text not null default 'corretor' check (tipo in ('corretor','imobiliaria')),
  creci                  text,
  cidade                 text,
  whatsapp_pessoal       text,                                -- para onde a Dri avisa / passa o cliente
  email_notificacao      text,
  nome_assistente        text not null default 'Dri',
  apresentacao           text,                                -- quem é, regiões, regras (ex.: "não aceito permuta")
  duracao_visita_min     int  not null default 60 check (duracao_visita_min between 15 and 240),
  antecedencia_min_horas int  not null default 2  check (antecedencia_min_horas between 0 and 72),
  onboarding_etapa       int  not null default 1,             -- 1 perfil, 2 imóveis, 3 horários, 4 IA, 5 teste, 6 whatsapp, 7 pronto
  criado_em              timestamptz not null default now()
);

-- ------------------------------------------------------------ WhatsApp
-- Dados visíveis no painel
create table public.whatsapp_conexoes (
  conta_id         uuid primary key references public.contas(id) on delete cascade,
  phone_number_id  text unique,
  waba_id          text,
  numero_exibicao  text,
  status           text not null default 'pendente' check (status in ('pendente','conectado','erro')),
  detalhe          text,
  conectado_em     timestamptz
);
-- Token da Meta: só o Worker (service role) lê. RLS ligada e nenhuma policy.
create table public.whatsapp_segredos (
  conta_id      uuid primary key references public.contas(id) on delete cascade,
  access_token  text not null,
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------ imóveis
create table public.imoveis (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references public.contas(id) on delete cascade,
  codigo                text,
  titulo                text not null,
  finalidade            text not null check (finalidade in ('venda','aluguel')),
  tipo                  text not null default 'apartamento',
  bairro                text,
  cidade                text,
  endereco              text,               -- só é passado ao cliente depois da visita marcada
  preco                 numeric(14,2),
  condominio            numeric(12,2),
  iptu                  numeric(12,2),
  quartos               int,
  suites                int,
  banheiros             int,
  vagas                 int,
  area_m2               numeric(10,2),
  aceita_financiamento  boolean,
  aceita_pet            boolean,
  mobiliado             boolean,
  descricao             text,
  caracteristicas       text[] not null default '{}',
  fotos                 text[] not null default '{}',   -- URLs públicas (bucket fotos-imoveis)
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index imoveis_busca on public.imoveis (conta_id, ativo, finalidade, tipo);

-- ------------------------------------------------------------ agenda
-- Janela semanal de visitas. imovel_id nulo = vale para todos os imóveis.
create table public.disponibilidades (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references public.contas(id) on delete cascade,
  imovel_id   uuid references public.imoveis(id) on delete cascade,
  dia_semana  int  not null check (dia_semana between 0 and 6),   -- 0 = domingo
  hora_inicio time not null,
  hora_fim    time not null,
  check (hora_fim > hora_inicio)
);
create index disponibilidades_conta on public.disponibilidades (conta_id);

-- Folgas, viagens, compromissos
create table public.bloqueios (
  id        uuid primary key default gen_random_uuid(),
  conta_id  uuid not null references public.contas(id) on delete cascade,
  inicio    timestamptz not null,
  fim       timestamptz not null,
  motivo    text,
  check (fim > inicio)
);

create table public.leads (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references public.contas(id) on delete cascade,
  telefone   text not null,
  nome       text,
  perfil     text,            -- o que a pessoa procura, resumido pela Dri
  criado_em  timestamptz not null default now(),
  unique (conta_id, telefone)
);

create table public.visitas (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references public.contas(id) on delete cascade,
  imovel_id         uuid not null references public.imoveis(id) on delete cascade,
  lead_id           uuid references public.leads(id) on delete set null,
  cliente_nome      text,
  cliente_telefone  text,
  inicio            timestamptz not null,
  fim               timestamptz not null,
  status            text not null default 'marcada' check (status in ('marcada','cancelada','realizada','teste')),
  origem            text not null default 'dri' check (origem in ('dri','manual','simulador')),
  observacoes       text,
  criado_em         timestamptz not null default now(),
  check (fim > inicio),
  -- o corretor não pode estar em duas visitas ao mesmo tempo
  exclude using gist (conta_id with =, tstzrange(inicio, fim) with &&) where (status = 'marcada')
);
create index visitas_agenda on public.visitas (conta_id, inicio);

-- ------------------------------------------------------------ conversas
create table public.conversas (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references public.contas(id) on delete cascade,
  telefone          text not null,
  nome              text,
  mensagens         jsonb not null default '[]',   -- histórico no formato da API (só o Worker usa)
  transcricao       jsonb not null default '[]',   -- [{de:'cliente'|'dri', texto, em}] para o painel
  precisa_corretor  boolean not null default false,
  motivo            text,
  ultima_cliente_em timestamptz,                   -- janela de 24 h da Meta
  atualizado_em     timestamptz not null default now(),
  unique (conta_id, telefone)
);

-- Meta reenvia o mesmo webhook se demorarmos: guarda o id para não responder duas vezes
create table public.wa_mensagens_recebidas (
  message_id   text primary key,
  recebido_em  timestamptz not null default now()
);

-- ------------------------------------------------------------ RLS
alter table public.contas                 enable row level security;
alter table public.whatsapp_conexoes      enable row level security;
alter table public.whatsapp_segredos      enable row level security;
alter table public.imoveis                enable row level security;
alter table public.disponibilidades       enable row level security;
alter table public.bloqueios              enable row level security;
alter table public.leads                  enable row level security;
alter table public.visitas                enable row level security;
alter table public.conversas              enable row level security;
alter table public.wa_mensagens_recebidas enable row level security;

create or replace function public.minha_conta() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.contas where owner_id = auth.uid()
$$;
revoke all on function public.minha_conta() from public;
grant execute on function public.minha_conta() to authenticated;

create policy contas_dono on public.contas
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy conexao_ler on public.whatsapp_conexoes
  for select to authenticated using (conta_id = public.minha_conta());

do $$
declare t text;
begin
  foreach t in array array['imoveis','disponibilidades','bloqueios','leads','visitas'] loop
    execute format(
      'create policy %1$s_dono on public.%1$s for all to authenticated
         using (conta_id = public.minha_conta()) with check (conta_id = public.minha_conta())', t);
  end loop;
end $$;

-- Conversas: o corretor lê e pode marcar como resolvida, mas não reescreve o histórico
create policy conversas_ler on public.conversas
  for select to authenticated using (conta_id = public.minha_conta());
create policy conversas_resolver on public.conversas
  for update to authenticated using (conta_id = public.minha_conta()) with check (conta_id = public.minha_conta());
revoke update on public.conversas from authenticated;
grant update (precisa_corretor, motivo) on public.conversas to authenticated;

-- whatsapp_segredos e wa_mensagens_recebidas: sem policy = só service role.

-- ------------------------------------------------------------ atualizado_em
create or replace function public.tocar_atualizado_em() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
create trigger imoveis_atualizado before update on public.imoveis
  for each row execute function public.tocar_atualizado_em();

-- ------------------------------------------------------------ fotos
insert into storage.buckets (id, name, public)
values ('fotos-imoveis', 'fotos-imoveis', true)
on conflict (id) do nothing;

-- Caminho das fotos: <conta_id>/<arquivo>. Leitura pública (a Dri manda o link no WhatsApp).
create policy fotos_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-imoveis' and (storage.foldername(name))[1] = public.minha_conta()::text);
create policy fotos_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-imoveis' and (storage.foldername(name))[1] = public.minha_conta()::text);
