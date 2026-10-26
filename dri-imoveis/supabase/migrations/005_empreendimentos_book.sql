-- ============================================================
-- Lançamentos: o corretor importa o "book" (PDF) do empreendimento.
-- Cada planta (tipologia) vira um imóvel, todos ligados pelo nome do empreendimento,
-- com as fotos das páginas do book e o link do próprio PDF, que a Dri pode mandar ao cliente.
-- ============================================================

alter table public.imoveis
  add column empreendimento    text,
  add column construtora       text,
  add column situacao          text check (situacao in ('pronto','na planta','em obras','lançamento')),
  add column previsao_entrega  text,
  add column programa          text,        -- ex.: Minha Casa, Minha Vida
  add column book_url          text;        -- PDF público (bucket books-imoveis)
create index imoveis_empreendimento on public.imoveis (conta_id, empreendimento);

-- PDFs dos books: leitura pública (a Dri manda o link no WhatsApp), até 50 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books-imoveis', 'books-imoveis', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy books_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books-imoveis' and (storage.foldername(name))[1] = public.minha_conta()::text);
create policy books_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'books-imoveis' and (storage.foldername(name))[1] = public.minha_conta()::text);
