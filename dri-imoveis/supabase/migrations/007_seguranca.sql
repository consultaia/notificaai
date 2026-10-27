-- ============================================================
-- Ajustes apontados pelo verificador de segurança do Supabase.
-- (Tabelas com RLS e sem policy — whatsapp_segredos, ia_chaves, wa_mensagens_recebidas —
--  são de propósito: só o Worker, com a service role, lê essas tabelas.)
-- ============================================================

-- Gatilho de atualizado_em com search_path fixo
alter function public.tocar_atualizado_em() set search_path = '';

-- minha_conta(): só quem está logado (as policies usam); visitante anônimo não chama
revoke execute on function public.minha_conta() from anon;

-- Função criada pelo "Ativar RLS automático" do painel do Supabase: roda sozinha quando uma
-- tabela é criada; ninguém precisa chamá-la pela API
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
