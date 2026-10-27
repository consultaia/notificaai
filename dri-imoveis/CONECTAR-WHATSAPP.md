# Conectar o WhatsApp de um corretor (conexão assistida)

Para quando o corretor escolhe **"Façam para mim"** no painel. O pedido aparece na área do administrador →
aba **Conexões** (e nos Avisos). Tempo: uns 20 minutos por corretor, com ele disponível no telefone para o código.

## O que o corretor já fez (pelo formulário)
1. Criou o **portfólio empresarial** dele em business.facebook.com.
2. **Convidou você** (janan.almeida@gmail.com) como administrador do portfólio.
3. Mandou: nome que os clientes vão ver, número, situação do número e melhor horário.

Se o pedido diz "ainda não convidou você", mande uma mensagem pedindo o convite antes de marcar o horário.

## Antes de começar
- O número **não pode estar em nenhum WhatsApp** (nem comum, nem Business). Se estiver, o corretor apaga a conta do
  WhatsApp desse número no celular (Configurações → Conta → Apagar conta) ou usa um chip novo.
- Combine o horário: o código de verificação chega no número dele por SMS ou ligação.

## Passo a passo (você, no computador)
1. **Aceite o convite**: chega no seu email ("convite para o portfólio …"). Abra e aceite com o seu Facebook.
2. Em **developers.facebook.com** (a primeira vez, clique em Começar para virar desenvolvedor) →
   **Meus apps → Criar app** → caso de uso **Conectar-se com clientes pelo WhatsApp** (ou Outro → Empresa) →
   nome `Dri <nome do corretor>` → **portfólio empresarial: o do corretor** (não o seu). Conclua.
3. No app: **WhatsApp → Configuração da API → Adicionar número de telefone**:
   nome de exibição (o do pedido), categoria **Imóveis**, número. Ligue para o corretor e peça o código.
   Depois, no campo **De**, escolha o número novo e copie **ID do número de telefone** e
   **ID da conta do WhatsApp Business**.
4. **Token permanente**: business.facebook.com → (portfólio do corretor) **Configurações → Usuários do sistema →
   Adicionar** (nome Dri, função Administrador) → **Atribuir ativos**: o app (controle total) e a conta do WhatsApp
   (controle total) → **Gerar token**: app do corretor, validade **Nunca**, permissões
   `whatsapp_business_messaging` e `whatsapp_business_management`. Copie (só aparece uma vez).
5. No app: **Configurações do app → Básico**: copie a **Chave secreta do aplicativo** e, em
   **URL da Política de Privacidade**, cole o link que aparece no admin. Salve.
6. Na área do administrador → **Conexões** → **Fazer a conexão** no pedido: cole ID do número, ID da conta,
   chave secreta, token e um **PIN de 6 números** (anote e passe para o corretor: é a verificação em duas etapas
   do número). Clique em **Conectar**. Se der erro, a mensagem diz qual dado conferir.
7. No app: **WhatsApp → Configuração → Webhook → Editar**: cole a **URL de callback** e o **Token de verificação**
   que aparecem no admin → **Verificar e salvar** → em **Campos do webhook**, **Gerenciar** → ative **messages**.
8. No topo do app, mude de **Desenvolvimento** para **Ao vivo** (Publicar).
9. Peça ao corretor para mandar um "oi" de outro celular para o número. A assistente responde em segundos e a
   situação no admin fica toda ✅. Marque o pedido como **Concluído**.
10. Opcional: no Gerenciador do WhatsApp do portfólio do corretor, em **Pagamentos**, ele cadastra um cartão
    (necessário só para campanhas/mensagens que a empresa inicia; responder clientes é grátis).

## Depois
- Você pode sair do portfólio do corretor quando quiser (ele remove você em Pessoas). A conexão continua: o token
  é do usuário do sistema do portfólio dele, não seu.
- O corretor é dono de tudo (portfólio, app, número). Se ele cancelar a plataforma, os dados da Meta continuam dele.
