# E-mails do login em português

Supabase → projeto `dri-imoveis` → Authentication → Emails (Templates). Colar o assunto e o corpo de cada um.

## Confirm signup

Assunto: `Confirme seu e-mail na Dri Imóveis`

```html
<h2>Falta só confirmar seu e-mail</h2>
<p>Olá! Clique no botão abaixo para confirmar seu e-mail e começar a usar a Dri Imóveis.</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#2a9d8f;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar meu e-mail</a></p>
<p style="color:#666;font-size:13px">Se não foi você que criou a conta, é só ignorar este e-mail.</p>
```

## Reset password

Assunto: `Crie uma senha nova na Dri Imóveis`

```html
<h2>Senha nova</h2>
<p>Recebemos um pedido para trocar a senha da sua conta na Dri Imóveis.</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#2a9d8f;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Criar senha nova</a></p>
<p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
```

## Change email address

Assunto: `Confirme seu novo e-mail na Dri Imóveis`

```html
<h2>Confirme o novo e-mail</h2>
<p>Clique abaixo para passar a usar {{ .NewEmail }} na sua conta da Dri Imóveis.</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#2a9d8f;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar novo e-mail</a></p>
```

## SMTP próprio (Resend): obrigatório antes de divulgar

O envio padrão do Supabase manda pouquíssimos e-mails por hora e sai como "Supabase Auth".

1. **Domínio:** o Resend só envia de um domínio seu (o `pages.dev` não serve). Se ainda não tiver, registre o do
   nome novo da plataforma (Cloudflare → Domain Registration, ou registro.br).
2. **Conta no Resend:** <https://resend.com> → criar conta → **Domains → Add Domain** → digite o domínio.
   Se o domínio estiver na Cloudflare, clique em **Auto configure** (ele cria os registros DNS sozinho);
   senão, copie os registros (MX, TXT/SPF e DKIM) para o painel do seu domínio. Espere ficar **Verified**.
3. **Chave:** Resend → **API Keys → Create API Key** (permissão "Sending access") → copie.
4. **Supabase:** projeto `dri-imoveis` → **Authentication → Emails → SMTP Settings** → ligar **Enable Custom SMTP**:
   - Sender email: `nao-responda@SEUDOMINIO` · Sender name: nome da plataforma
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: a chave do Resend
   - Salvar.
5. **Limite:** Authentication → **Rate Limits** → "Rate limit for sending emails": suba para algo como 100 por hora.
6. **Mesma chave para os avisos da plataforma** (pagamento recusado, nova adesão, autoteste das IAs): grave no ambiente
   da sessão `RESEND_API_KEY` (a chave) e `EMAIL_REMETENTE` (ex.: `Plataforma <nao-responda@SEUDOMINIO>`), sem
   parênteses, e peça ao Claude para gravar no Worker.
7. Teste: crie uma conta nova pelo painel e veja se o e-mail chega em português, com o remetente certo.
