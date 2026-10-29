-- NotificaAI — Política Nacional de Qualidade e Segurança do Paciente (PNQSP,
-- Portaria GM/MS nº 11.527/2026): comunicação ao paciente e experiência do paciente.
--
-- Somente ADITIVO, seguro com o sistema em uso:
--   * nao apaga nem altera nenhum dado existente;
--   * so acrescenta colunas (4 em notifications) e cria as tabelas experiencia_paciente,
--     videos_educacao, capacitacao_respostas, capacitacao_participantes e capacitacao_config;
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

-- 4. Capacitacao online: resultado do questionario autoavaliativo por protocolo --
create table if not exists public.capacitacao_respostas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  hospital_id text not null default 'hnsa',
  modulo text not null,        -- id do protocolo/subnucleo (identificacao, queda...)
  nome text not null,
  setor text,
  profissao text,
  acertos smallint,
  total smallint,
  percentual smallint,
  respostas jsonb,             -- {id_da_questao: {"e": alternativa, "c": acertou}}
  duracao_seg integer,
  versao text,
  participante_id uuid
);
alter table public.capacitacao_respostas add column if not exists participante_id uuid;
-- tipo: 'pre' = diagnostico inicial (antes da trilha) | 'pos' = desafio final
alter table public.capacitacao_respostas add column if not exists tipo text default 'pos';
alter table public.capacitacao_respostas add column if not exists pre_percentual smallint;
create index if not exists capacitacao_hosp_idx on public.capacitacao_respostas (hospital_id, modulo, created_at);
-- Qualquer profissional envia pelo link; ninguem altera ou apaga pela chave publica.
alter table public.capacitacao_respostas enable row level security;
drop policy if exists capacitacao_insere on public.capacitacao_respostas;
create policy capacitacao_insere on public.capacitacao_respostas for insert with check (true);
drop policy if exists capacitacao_le on public.capacitacao_respostas;
create policy capacitacao_le on public.capacitacao_respostas for select using (true);

-- 5. Cadastro de quem faz a capacitacao + progresso (continuar de onde parou) ----
create table if not exists public.capacitacao_participantes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  hospital_id text not null default 'hnsa',
  codigo text not null,        -- 6 caracteres; continua em outro aparelho
  nome text not null,
  setor text,
  profissao text,
  progresso jsonb              -- {modulo: {etapa, resp, pct, cert...}}
);
create unique index if not exists capacitacao_part_codigo_idx on public.capacitacao_participantes (hospital_id, codigo);
-- retorno pelo nome + PIN de 4 numeros (guardado so como hash; nao entra no backup)
alter table public.capacitacao_participantes add column if not exists nome_chave text;
alter table public.capacitacao_participantes add column if not exists senha_hash text;
create index if not exists capacitacao_part_nome_idx on public.capacitacao_participantes (hospital_id, nome_chave);
alter table public.capacitacao_participantes enable row level security;
drop policy if exists capacitacao_part_tudo on public.capacitacao_participantes;
create policy capacitacao_part_tudo on public.capacitacao_participantes for all using (true) with check (true);

-- 6. Assinaturas do certificado (imagem PNG + nome + cargo), uma linha por instituicao
create table if not exists public.capacitacao_config (
  hospital_id text primary key,
  assinatura text,             -- imagem em data URL (PNG transparente, ~30 KB)
  assinante_nome text,
  assinante_cargo text,
  assinatura2 text,
  assinante2_nome text,
  assinante2_cargo text,
  updated_at timestamptz default now()
);
alter table public.capacitacao_config enable row level security;
drop policy if exists capacitacao_config_tudo on public.capacitacao_config;
create policy capacitacao_config_tudo on public.capacitacao_config for all using (true) with check (true);

commit;
