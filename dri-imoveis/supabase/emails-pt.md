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

## Remetente (importante antes de abrir para corretores)

O envio padrão do Supabase manda poucos e-mails por hora e sai como "Supabase Auth". Para produção:
Authentication → Emails → SMTP Settings → ligar "Custom SMTP" com uma conta do Resend
(host `smtp.resend.com`, porta `465`, usuário `resend`, senha = chave do Resend),
remetente `Dri Imóveis <nao-responda@SEU-DOMINIO>`.
