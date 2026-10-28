-- Gênero do nome da assistente, para os textos ("a Dri" / "o Pedro") e o jeito de falar dela ou dele
alter table public.contas
  add column genero_assistente text not null default 'feminino' check (genero_assistente in ('feminino','masculino'));
