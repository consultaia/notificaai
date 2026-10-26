-- NotificaAI — Política Nacional de Qualidade e Segurança do Paciente (PNQSP,
-- Portaria GM/MS nº 11.527/2026): comunicação ao paciente e experiência do paciente.
--
-- Somente ADITIVO, seguro com o sistema em uso:
--   * nao apaga nem altera nenhum dado existente;
--   * so acrescenta 4 colunas em notifications e cria as tabelas experiencia_paciente
--     e videos_educacao;
--   * pode ser executado mais de uma vez.
--
-- Como rodar: Supabase > SQL Editor > New query > colar este arquivo > Run.
-- Resultado esperado: "Success. No rows returned".

begin;

-- 1. Comunicacao do evento ao paciente/familia (disclosure) ---------------------
-- comunicado_paciente: comunicado | pendente | sem_contato | recusou | nao_aplicavel
alter table public.notifications add column if not exists comunicado_paciente text;
alter table public.notifications add column if not exists comunicado_em date;
alter table public.notifications add column if not exists comunicado_por text;
alter table public.notifications add column if not exists comunicado_obs text;

-- 2. Pesquisa de experiencia do paciente ----------------------------------------
-- Respondida por pacientes e acompanhantes pelo link/QR code, sem identificacao.
-- Perguntas: 2 = sim, 1 = em parte, 0 = nao, vazio = nao sei / nao se aplica.
create table if not exists public.experiencia_paciente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  hospital_id text not null default 'hnsa',
  perfil text,                 -- paciente | acompanhante
  setor text,
  q_identificacao smallint,    -- confirmaram nome/pulseira antes de medicamentos e exames
  q_maos smallint,             -- viu a higiene das maos antes de tocar no paciente
  q_informacao smallint,       -- recebeu explicacoes claras sobre tratamento e medicamentos
  q_escuta smallint,           -- se sentiu a vontade para perguntar e foi ouvido
  q_seguranca smallint,        -- se sentiu seguro durante o atendimento
  nota smallint check (nota between 0 and 10), -- recomendaria a um amigo/familiar
  comentario text
);
create index if not exists experiencia_paciente_hosp_idx on public.experiencia_paciente (hospital_id, created_at);

-- Qualquer pessoa pode responder; ninguem altera ou apaga pela chave publica.
alter table public.experiencia_paciente enable row level security;
drop policy if exists experiencia_insere on public.experiencia_paciente;
create policy experiencia_insere on public.experiencia_paciente for insert with check (true);
drop policy if exists experiencia_le on public.experiencia_paciente;
create policy experiencia_le on public.experiencia_paciente for select using (true);

-- 3. Videos de educacao em saude do proprio hospital (links do YouTube) ---------
-- Aparecem na Central de Conhecimento, por subnucleo. Cadastrados pelo gestor e
-- pelos subnucleos dentro da plataforma.
create table if not exists public.videos_educacao (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  hospital_id text not null default 'hnsa',
  subnucleo text,              -- id do subnucleo (queda, lpp...) ou 'geral'
  titulo text not null,
  url text not null,           -- link do YouTube
  descricao text,
  publico text default 'todos', -- todos | pacientes | equipe
  ordem integer default 0,
  ativo boolean not null default true,
  criado_por text
);
create index if not exists videos_educacao_hosp_idx on public.videos_educacao (hospital_id, subnucleo);
-- Mesmo acesso das demais tabelas do app (a protecao por login vem na fase 2).
alter table public.videos_educacao enable row level security;
drop policy if exists videos_educacao_tudo on public.videos_educacao;
create policy videos_educacao_tudo on public.videos_educacao for all using (true) with check (true);

commit;
