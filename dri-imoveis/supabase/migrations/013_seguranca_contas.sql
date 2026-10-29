-- ============================================================
-- Endurecimento apontado na revisão:
-- 1. O corretor só altera os campos do perfil da própria conta (não mexe em cota_ia_mensal) e não apaga a conta
--    (apagar e recriar dava teste grátis infinito e permitia se autoindicar como parceiro).
-- 2. Comissão (já paga ou não) não some se uma conta for apagada pelo administrador.
-- 3. Bucket de fotos só aceita imagem de até 10 MB.
-- ============================================================
revoke insert, update, delete on public.contas from authenticated;
grant insert (owner_id, nome, tipo, creci, cidade, whatsapp_pessoal, email_notificacao, nome_assistente, genero_assistente,
              apresentacao, duracao_visita_min, antecedencia_min_horas, avisar_capacidade, onboarding_etapa)
  on public.contas to authenticated;
grant update (nome, tipo, creci, cidade, whatsapp_pessoal, email_notificacao, nome_assistente, genero_assistente,
              apresentacao, duracao_visita_min, antecedencia_min_horas, avisar_capacidade, onboarding_etapa)
  on public.contas to authenticated;

alter table public.comissoes alter column conta_id drop not null;
alter table public.comissoes drop constraint comissoes_conta_id_fkey;
alter table public.comissoes add constraint comissoes_conta_id_fkey
  foreign key (conta_id) references public.contas(id) on delete set null;

update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'fotos-imoveis';

-- Referências só para registros da própria conta (a chave estrangeira sozinha não passa pela RLS)
create policy visitas_refs_proprias on public.visitas as restrictive for insert to authenticated
  with check ((imovel_id is null or exists (select 1 from public.imoveis i where i.id = imovel_id and i.conta_id = public.minha_conta()))
          and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id and l.conta_id = public.minha_conta())));
create policy visitas_refs_proprias_upd on public.visitas as restrictive for update to authenticated using (true)
  with check ((imovel_id is null or exists (select 1 from public.imoveis i where i.id = imovel_id and i.conta_id = public.minha_conta()))
          and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id and l.conta_id = public.minha_conta())));
create policy disp_refs_proprias on public.disponibilidades as restrictive for insert to authenticated
  with check (imovel_id is null or exists (select 1 from public.imoveis i where i.id = imovel_id and i.conta_id = public.minha_conta()));
create policy disp_refs_proprias_upd on public.disponibilidades as restrictive for update to authenticated using (true)
  with check (imovel_id is null or exists (select 1 from public.imoveis i where i.id = imovel_id and i.conta_id = public.minha_conta()));
create policy captacoes_refs_proprias_upd on public.captacoes as restrictive for update to authenticated using (true)
  with check (imovel_id is null or exists (select 1 from public.imoveis i where i.id = imovel_id and i.conta_id = public.minha_conta()));
