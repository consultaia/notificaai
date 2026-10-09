-- Desfaz 001_multitenant_base.sql.
-- ATENCAO: so rode se precisar voltar atras. Remove as tabelas/colunas criadas na fase 1
-- (contratantes cadastrados depois dela e vinculos de administradores sao perdidos).
-- Nenhum dado que existia antes da fase 1 e afetado, EXCETO se a tabela hospitals ja
-- existia antes: nesse caso NAO rode o "drop table hospitals" abaixo.

begin;
drop table if exists public.hospital_admins;
drop table if exists public.platform_admins;
drop index if exists public.nsp_usuarios_hospital_idx;
alter table public.nsp_usuarios drop column if exists hospital_id;
-- drop table if exists public.hospitals;   -- descomente apenas se a tabela foi criada pela fase 1
commit;
