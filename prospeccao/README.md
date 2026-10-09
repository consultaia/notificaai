# Prospecção da Dri

Rastreia clínicas no Google, guarda só as que têm avaliação reclamando de demora,
procura o email no site de cada uma, preenche a planilha `Prospeccao-Dri.xlsx` e
envia o email de apresentação pelo Gmail.

## Preparar (uma vez)

1. **Chave do Google Places:** no console.cloud.google.com, crie um projeto, ative a
   "Places API (New)" e gere uma chave de API.
2. **Senha de app do Gmail:** ative a verificação em duas etapas e gere uma senha em
   myaccount.google.com/apppasswords.
3. Copie `config.exemplo.json` para `config.json` e preencha remetente, WhatsApp,
   link da demonstração, cidades e tipos de clínica.
4. Coloque `Prospeccao-Dri.xlsx` nesta pasta. A planilha e o `config.json` ficam fora do git.

## Rodar

```bash
export GOOGLE_PLACES_API_KEY=...
export GMAIL_APP_PASSWORD=...
python3 prospectar.py rastrear         # busca e preenche a planilha
python3 prospectar.py enviar --teste   # mostra os emails sem enviar
python3 prospectar.py enviar           # envia (até "limite_envios_por_execucao")
python3 prospectar.py tudo             # rastrear + enviar
```

Depois de cada envio, a linha fica com Status "Abordado", a data da abordagem e um
follow-up marcado para 3 dias depois. O mesmo email nunca é enviado duas vezes.

## Expandir para o Brasil

Acrescente cidades em `"cidades"`. Com `"bairros"`, a busca é feita bairro a bairro e
pega mais clínicas. Sem bairros, a busca é feita na cidade toda. Quando a lista passa
da linha 205, as fórmulas do Funil e as listas suspensas são ampliadas automaticamente.

## Cuidados

- Mantenha uns 25 a 40 envios por dia em uma conta Gmail comum. Volume maior derruba
  a entrega e pode bloquear a conta. Para escalar, use um domínio próprio
  (ex.: janan@dri.com.br) com aquecimento.
- Quem responder "remover" deve ir para o Status "Perdido" e não ser contatado de novo (LGPD).
- A API do Google devolve até 5 avaliações por clínica. As que não mostram reclamação
  nessas 5 ficam fora da lista.
