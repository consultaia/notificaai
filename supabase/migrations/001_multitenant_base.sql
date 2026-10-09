-- NotificaAI — Fase 1 do multitenant (somente ADITIVA)
--
-- Seguro para rodar com o sistema em uso no HNSA:
--   * nao apaga nem altera nenhum dado existente;
--   * nao liga RLS em nenhuma tabela que o app atual usa;
--   * pode ser executado mais de uma vez (IF NOT EXISTS / ON CONFLICT).
--
-- Antes de rodar: faca backup (Supabase > Database > Backups, ou pg_dump).
-- Como rodar: Supabase > SQL Editor > colar este arquivo > Run.
-- Para desfazer: 001_multitenant_base_rollback.sql

begin;

-- 1. Contratantes -------------------------------------------------------------
-- O app ja le esta tabela (loadHospital) para qualquer contratante que nao seja o HNSA.
create table if not exists public.hospitals (
  id text primary key,                 -- slug do link: notificaai.ia.br/<id>
  name text not null,
  short_name text,
  created_at timestamptz default now()
);
alter table public.hospitals add column if not exists logo text;
alter table public.hospitals add column if not exists logo_url text;
alter table public.hospitals add column if not exists sectors jsonb;
alter table public.hospitals add column if not exists "sectorsInternacao" jsonb;
alter table public.hospitals add column if not exists nsp_label text default 'NSP';
-- null = usa a lista padrao de subnucleos; ou [{"id":"queda","label":"Queda"}, ...]
alter table public.hospitals add column if not exists subnucleos jsonb;
alter table public.hospitals add column if not exists ativo boolean default true;

insert into public.hospitals (id, name, short_name, logo, sectors, "sectorsInternacao", nsp_label)
values ('hnsa', 'Hospital Naval de Salvador', 'HNSA', 'ancora',
        '["UPG","Ala A","Centro Cirúrgico","SEP","Oncologia","Odontologia"]',
        '["UPG","Ala A","Centro Cirúrgico","SEP"]', 'NSP')
on conflict (id) do nothing;

-- Leitura publica (a tela de notificacao anonima precisa do nome/setores do contratante);
-- nenhuma escrita pela chave publica.
alter table public.hospitals enable row level security;
drop policy if exists hospitals_leitura_publica on public.hospitals;
create policy hospitals_leitura_publica on public.hospitals for select using (true);

-- 2. Usuarios (profissionais) passam a pertencer a um contratante ---------------
-- Todos os usuarios existentes sao do HNSA. O app atual ignora esta coluna.
alter table public.nsp_usuarios add column if not exists hospital_id text default 'hnsa';
update public.nsp_usuarios set hospital_id = 'hnsa' where hospital_id is null;
create index if not exists nsp_usuarios_hospital_idx on public.nsp_usuarios (hospital_id);

-- 3. Administradores do contratante (login por e-mail — fase 2) ----------------
-- Liga um usuario do Supabase Auth a um contratante. Ainda nao usado pelo app.
create table if not exists public.hospital_admins (
  user_id uuid not null references auth.users (id) on delete cascade,
  hospital_id text not null references public.hospitals (id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, hospital_id)
);
-- Sem RLS esta tabela ficaria aberta para a chave publica: qualquer um poderia se
-- declarar administrador. Cada administrador so enxerga os proprios vinculos;
-- vinculos novos sao criados apenas pelo painel do Supabase / service role.
alter table public.hospital_admins enable row level security;
drop policy if exists hospital_admins_le_proprio on public.hospital_admins;
create policy hospital_admins_le_proprio on public.hospital_admins
  for select to authenticated using (user_id = auth.uid());

commit;
