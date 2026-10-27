-- ============================================================
-- Cobrança mensal (Mercado Pago), teste grátis, cortesia e parceiros divulgadores
-- (comissão fixa por PIX a cada nova adesão pelo link do parceiro).
-- A situação da assinatura fica fora de "contas" (que o corretor pode editar):
-- o painel só lê; quem muda é o Worker (service role) e o administrador pelo Worker.
-- ============================================================

-- Valores da plataforma (uma linha só), editáveis na área do administrador
create table public.plataforma_config (
  id               boolean primary key default true check (id),
  preco_mensal     numeric(10,2) not null default 197,
  dias_teste       int not null default 5 check (dias_teste between 0 and 60),
  dias_tolerancia  int not null default 2 check (dias_tolerancia between 0 and 30),  -- pagamento falhou: pausa depois disso
  comissao_adesao  numeric(10,2) not null default 100 check (comissao_adesao >= 0),  -- PIX ao parceiro por adesão
  atualizado_em    timestamptz not null default now()
);
insert into public.plataforma_config default values;
alter table public.plataforma_config enable row level security;   -- só o Worker

-- Parceiros que divulgam com link próprio (…/?p=codigo) e ganham um PIX por adesão.
-- Pode ser um corretor da plataforma (aceita pelo painel) ou alguém de fora (criado pelo administrador).
create table public.parceiros (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique check (codigo ~ '^[a-z0-9-]{2,40}$'),
  nome               text not null,
  conta_id           uuid unique references public.contas(id) on delete set null,
  email              text,
  whatsapp           text,
  pix                text,
  aceitou_termos_em  timestamptz,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);
alter table public.parceiros enable row level security;           -- só o Worker

create table public.assinaturas (
  conta_id          uuid primary key references public.contas(id) on delete cascade,
  status            text not null default 'teste'
                    check (status in ('teste','ativa','atrasada','pausada','cancelada','cortesia')),
  teste_ate         timestamptz not null,
  parceiro_id       uuid references public.parceiros(id) on delete set null,
  mp_preapproval_id text unique,          -- assinatura do Mercado Pago em vigor
  mp_email          text,                 -- email da conta do Mercado Pago de quem paga
  valor_mensal      numeric(10,2),
  assinou_em        timestamptz,
  proxima_cobranca  timestamptz,
  falhou_em         timestamptz,          -- primeira cobrança recusada ainda não resolvida
  aviso_enviado_em  timestamptz,          -- último aviso de cobrança mandado pelo administrador
  pausada_em        timestamptz,
  cortesia_motivo   text,
  atualizado_em     timestamptz not null default now()
);
alter table public.assinaturas enable row level security;
create policy assinatura_ler on public.assinaturas
  for select to authenticated using (conta_id = public.minha_conta());

create table public.pagamentos (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid references public.contas(id) on delete set null,
  mp_id           text not null unique,   -- id do pagamento autorizado no Mercado Pago
  valor           numeric(10,2),
  status          text not null,          -- aprovado | recusado | outro status do Mercado Pago
  detalhe         text,
  pago_em         timestamptz,
  criado_em       timestamptz not null default now()
);
create index pagamentos_mes on public.pagamentos (pago_em);
alter table public.pagamentos enable row level security;
create policy pagamentos_ler on public.pagamentos
  for select to authenticated using (conta_id = public.minha_conta());

-- Uma comissão por conta indicada, gerada no primeiro pagamento aprovado; o administrador paga por PIX e marca
create table public.comissoes (
  id           uuid primary key default gen_random_uuid(),
  parceiro_id  uuid not null references public.parceiros(id) on delete cascade,
  conta_id     uuid not null unique references public.contas(id) on delete cascade,
  valor        numeric(10,2) not null,
  status       text not null default 'a pagar' check (status in ('a pagar','pago','cancelada')),
  pago_em      timestamptz,
  criado_em    timestamptz not null default now()
);
alter table public.comissoes enable row level security;          -- só o Worker

-- Avisos para o administrador (pagamento recusado, pausas, cancelamentos); também vão por email se houver Resend
create table public.avisos_admin (
  id         uuid primary key default gen_random_uuid(),
  assunto    text not null,
  texto      text not null,
  lido       boolean not null default false,
  criado_em  timestamptz not null default now()
);
alter table public.avisos_admin enable row level security;        -- só o Worker

-- Conta nova: começa em teste grátis e fica ligada ao parceiro do link de cadastro
create or replace function public.criar_assinatura()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text;
  v_dias   int;
begin
  select lower(u.raw_user_meta_data->>'parceiro') into v_codigo from auth.users u where u.id = new.owner_id;
  select c.dias_teste into v_dias from public.plataforma_config c where c.id;
  insert into public.assinaturas (conta_id, teste_ate, parceiro_id)
  values (new.id, now() + make_interval(days => coalesce(v_dias, 5)),
          (select p.id from public.parceiros p where p.codigo = v_codigo and p.ativo
             and p.conta_id is distinct from new.id))
  on conflict (conta_id) do nothing;
  return new;
end $$;
revoke execute on function public.criar_assinatura() from public, anon, authenticated;
create trigger contas_assinatura after insert on public.contas
  for each row execute function public.criar_assinatura();

-- Contas que já existiam começam o teste agora
insert into public.assinaturas (conta_id, teste_ate)
select id, now() + interval '5 days' from public.contas
on conflict (conta_id) do nothing;
