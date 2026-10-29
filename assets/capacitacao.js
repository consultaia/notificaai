// NotificaAI — conteudo da Capacitacao online (apostila + questionario por protocolo).
// Carregado sob demanda pela aba "Capacitacao". Base: Protocolos Basicos de Seguranca do
// Paciente (Ministerio da Saude/Anvisa/Fiocruz, 2013 — Portarias MS 1.377/2013 e 2.095/2013),
// RDC Anvisa 36/2013, OMS. Em cada questao, a PRIMEIRA alternativa e a correta (o app embaralha
// a ordem na tela). Ao mudar uma questao, troque o id dela (ex.: ident_1 -> ident_1b) para nao
// misturar resultados antigos e novos.
window.CAPACITACAO_VERSAO = '2026.1';
window.CAPACITACAO_REFS = [
  'Ministério da Saúde/Anvisa/Fiocruz. Protocolos Básicos de Segurança do Paciente (Portarias MS nº 1.377/2013 e nº 2.095/2013).',
  'Anvisa. RDC nº 36/2013 — ações para a segurança do paciente em serviços de saúde.',
  'Ministério da Saúde. Política Nacional de Qualidade e Segurança do Paciente — Portaria GM/MS nº 11.527/2026.',
  'Organização Mundial da Saúde. Metas Internacionais de Segurança do Paciente.'
];
window.CAPACITACAO_MODULOS = [
{
  id: 'identificacao', titulo: 'Identificação correta do paciente', carga: '30 min',
  objetivo: 'Garantir que cada cuidado seja realizado no paciente certo, usando ao menos dois identificadores em todos os momentos de risco.',
  apostila: [
    { t: 'Por que identificar', p: 'Falhas de identificação podem acontecer em qualquer etapa do cuidado e levam a medicamento, exame, cirurgia ou transfusão no paciente errado. A identificação correta é a Meta 1 de segurança do paciente.' },
    { t: 'Os identificadores', itens: ['Use pelo menos dois identificadores: nome completo e data de nascimento (ou nome da mãe / número de registro, conforme o padrão da instituição).', 'Nunca use número do leito, quarto ou setor como identificador.', 'Os dados da pulseira devem estar legíveis e iguais aos do prontuário, das etiquetas e da prescrição.'] },
    { t: 'A pulseira', itens: ['Colocada na admissão, preferencialmente no punho; se não for possível, no tornozelo.', 'Confira os dados com o paciente ou acompanhante ao colocar.', 'Ilegível, solta ou com erro: substitua imediatamente.', 'Sinalizações adicionais (alergia, risco de queda) seguem o padrão institucional.'] },
    { t: 'Quando conferir', itens: ['Antes de administrar medicamentos e hemocomponentes.', 'Antes de coletar material para exames e ao etiquetar amostras.', 'Antes de procedimentos, exames de imagem e cirurgias.', 'Antes de entregar a dieta.', 'Em transporte, transferência e alta.'] },
    { t: 'Como conferir', itens: ['Pergunte de forma aberta: "Qual é o seu nome completo e a sua data de nascimento?".', 'Não pergunte "O senhor é o João?": a pessoa pode concordar sem ouvir direito.', 'Compare a resposta com a pulseira e com a prescrição ou etiqueta.', 'Paciente que não pode responder: confira a pulseira e confirme com o acompanhante, quando houver.'] },
    { t: 'Situações de risco', itens: ['Nomes iguais ou parecidos no mesmo setor: sinalize o alerta e reforce a dupla conferência.', 'Paciente não identificado: use o padrão institucional (ex.: "desconhecido" + número de registro) até a identificação.', 'Recém-nascidos: siga o padrão da instituição para mãe e bebê.'] },
    { t: 'Notifique', p: 'Toda falha de identificação, mesmo sem dano ou percebida a tempo, deve ser notificada ao Núcleo de Segurança do Paciente. É assim que o hospital descobre onde o processo falha.' }
  ],
  questoes: [
    { id: 'ident_1', tema: 'Número mínimo de identificadores', p: 'Quantos identificadores, no mínimo, devem ser usados para confirmar a identidade do paciente?', ops: ['Pelo menos dois, como nome completo e data de nascimento', 'Apenas um: o nome completo', 'O número do leito e o primeiro nome', 'Somente o número do prontuário'], exp: 'O protocolo exige ao menos dois identificadores, como nome completo e data de nascimento.' },
    { id: 'ident_2', tema: 'Leito não é identificador', p: 'O número do leito pode ser usado como identificador do paciente?', ops: ['Não, leito, quarto e setor nunca são identificadores', 'Sim, quando o paciente estiver sedado', 'Sim, se o setor estiver lotado', 'Sim, junto com o número do quarto'], exp: 'Pacientes mudam de leito; por isso leito, quarto e setor nunca identificam o paciente.' },
    { id: 'ident_3', tema: 'Pergunta aberta', p: 'Qual é a forma correta de confirmar a identidade de um paciente consciente?', ops: ['Perguntar: "Qual é o seu nome completo e a sua data de nascimento?"', 'Perguntar: "O senhor é o Sr. José?"', 'Chamar pelo número do leito', 'Conferir apenas a placa da cabeceira'], exp: 'A pergunta aberta evita que o paciente apenas concorde sem ouvir direito.' },
    { id: 'ident_4', tema: 'Momentos de conferência', p: 'Em quais momentos a identificação deve ser conferida?', ops: ['Antes de medicamentos, hemocomponentes, coletas, procedimentos e dieta', 'Somente na admissão', 'Somente antes de cirurgias', 'Uma vez por plantão'], exp: 'A conferência é feita antes de cada cuidado de risco, não só na admissão.' },
    { id: 'ident_5', tema: 'Paciente que não responde', p: 'Como identificar um paciente inconsciente antes de administrar um medicamento?', ops: ['Conferir a pulseira com a prescrição e, se possível, confirmar com o acompanhante', 'Confirmar com o colega do plantão anterior', 'Usar o número do leito', 'Adiar todos os cuidados até ele acordar'], exp: 'Sem resposta do paciente, a pulseira conferida com a prescrição e o acompanhante garantem a identificação.' },
    { id: 'ident_6', tema: 'Pulseira danificada', p: 'A pulseira do paciente está apagada e ilegível. O que fazer?', ops: ['Substituir imediatamente, conferindo os dados com o paciente ou acompanhante', 'Aguardar a alta', 'Escrever os dados à caneta por cima', 'Retirar e não colocar outra'], exp: 'Pulseira ilegível deve ser trocada na hora, com os dados conferidos.' },
    { id: 'ident_7', tema: 'Nomes semelhantes', p: 'Há dois pacientes com nomes muito parecidos no mesmo setor. Qual a conduta?', ops: ['Sinalizar o alerta de nomes semelhantes e reforçar a dupla conferência', 'Nenhuma, se estiverem em quartos diferentes', 'Chamar ambos só pelo primeiro nome', 'Alterar o nome de um deles no sistema'], exp: 'Homônimos aumentam o risco de troca; o alerta visível e a dupla conferência reduzem esse risco.' },
    { id: 'ident_8', tema: 'Notificação de falha', p: 'Uma troca de etiqueta de exame foi percebida antes da coleta, sem dano. Deve ser notificada?', ops: ['Sim, é um incidente (quase erro) e ajuda a prevenir novos casos', 'Não, porque não houve dano', 'Só se o paciente reclamar', 'Só no livro de ocorrências do setor'], exp: 'Quase erros também são notificados: mostram falhas no processo antes que causem dano.' }
  ]
},
{
  id: 'medicamentos', titulo: 'Segurança na prescrição, uso e administração de medicamentos', carga: '40 min',
  objetivo: 'Reduzir erros de medicação em todas as etapas, com atenção especial aos medicamentos de alta vigilância.',
  apostila: [
    { t: 'Onde o erro acontece', p: 'Erros de medicação podem ocorrer na prescrição, na dispensação, no preparo, na administração e no monitoramento. Cada etapa tem barreiras próprias, e todas dependem da equipe.' },
    { t: 'Os certos da administração', itens: ['Paciente certo', 'Medicamento certo', 'Via certa', 'Hora certa', 'Dose certa', 'Registro certo', 'Orientação correta ao paciente', 'Forma farmacêutica certa', 'Resposta certa (monitorar o efeito)'] },
    { t: 'Prescrição segura', itens: ['Legível, com nome do medicamento, dose, via, frequência e diluição.', 'Use zero à esquerda (0,5 mg) e nunca zero à direita (5,0 mg pode ser lido como 50 mg).', 'Evite abreviaturas perigosas, como "U" para unidade: escreva "unidades".', 'Prescrição verbal só em emergência: repita em voz alta, confirme e registre.'] },
    { t: 'Medicamentos de alta vigilância', itens: ['Exemplos: insulinas, heparinas e anticoagulantes, opioides, cloreto de potássio concentrado, sedativos intravenosos, quimioterápicos.', 'Armazenamento separado e identificado.', 'Dupla checagem independente antes de administrar.', 'Cloreto de potássio concentrado não fica disponível nas unidades de internação sem controle.'] },
    { t: 'Nomes e embalagens parecidos', itens: ['Separe fisicamente medicamentos com nomes ou embalagens semelhantes.', 'Destaque a diferença na etiqueta (ex.: letras maiúsculas: hidrOXIzina x hidrALAzina).', 'Na dúvida, confirme com a farmácia antes de administrar.'] },
    { t: 'Paciente informado', itens: ['Pergunte e registre alergias antes do primeiro medicamento.', 'Explique o que está administrando e para quê.', 'Pergunte sobre medicamentos trazidos de casa.', 'Oriente a avisar se sentir algo diferente (coceira, falta de ar, tontura).'] },
    { t: 'Notifique', p: 'Erros de medicação, inclusive os interceptados antes de chegar ao paciente, e reações adversas devem ser notificados ao Núcleo de Segurança do Paciente.' }
  ],
  questoes: [
    { id: 'med_1', tema: 'Os certos da administração', p: 'Qual alternativa NÃO faz parte dos "certos" da administração de medicamentos?', ops: ['Cor certa do comprimido', 'Paciente certo', 'Registro certo', 'Resposta certa'], exp: 'Cor não é um dos certos; a forma farmacêutica sim. Os certos incluem paciente, medicamento, via, hora, dose, registro, orientação, forma e resposta.' },
    { id: 'med_2', tema: 'Zero à esquerda e à direita', p: 'Qual é a forma mais segura de prescrever meio miligrama?', ops: ['0,5 mg', ',5 mg', '0,50 mg', '1/2 mg'], exp: 'Zero à esquerda evita que a vírgula passe despercebida; zero à direita pode multiplicar a dose por dez.' },
    { id: 'med_3', tema: 'Alta vigilância', p: 'Qual destes é um medicamento de alta vigilância?', ops: ['Cloreto de potássio concentrado injetável', 'Dipirona oral', 'Soro fisiológico 0,9% 100 ml', 'Vitamina C oral'], exp: 'O cloreto de potássio concentrado pode causar dano grave em caso de erro e exige controle especial.' },
    { id: 'med_4', tema: 'Dupla checagem', p: 'Antes de administrar insulina ou heparina, recomenda-se:', ops: ['Dupla checagem independente', 'Preparar sem conferência para ganhar tempo', 'Conferir apenas no fim do plantão', 'Deixar a dose pronta na bancada para o próximo plantão'], exp: 'Medicamentos de alta vigilância pedem uma segunda conferência independente antes da administração.' },
    { id: 'med_5', tema: 'Prescrição verbal', p: 'Em uma emergência, o médico dá uma ordem verbal de medicamento. O que fazer?', ops: ['Repetir em voz alta para confirmação e registrar assim que possível', 'Executar sem repetir para não atrasar', 'Recusar sempre', 'Pedir a outro colega para memorizar'], exp: 'A repetição em voz alta (read-back) confirma o que foi entendido; o registro vem logo depois.' },
    { id: 'med_6', tema: 'Nomes semelhantes (LASA)', p: 'Como armazenar medicamentos com nomes semelhantes?', ops: ['Separar e destacar a diferença na identificação', 'Lado a lado, em ordem alfabética, sem destaque', 'Juntos, para facilitar a reposição', 'Apenas pelo nome comercial'], exp: 'Separação física e destaque visual reduzem trocas entre medicamentos parecidos.' },
    { id: 'med_7', tema: 'Alergias', p: 'Antes do primeiro medicamento de um paciente recém-admitido, é essencial:', ops: ['Perguntar e registrar alergias e conferir a sinalização', 'Administrar e observar se haverá reação', 'Perguntar só se o paciente for idoso', 'Consultar apenas a farmácia'], exp: 'A alergia conhecida e registrada evita uma reação previsível.' },
    { id: 'med_8', tema: 'Notificação de quase erro', p: 'Um medicamento errado foi percebido na conferência, antes de chegar ao paciente. É correto:', ops: ['Notificar como quase erro (near miss)', 'Não notificar, porque não houve dano', 'Notificar só com autorização do médico', 'Corrigir e não registrar'], exp: 'O quase erro mostra uma falha real no processo e deve ser notificado.' }
  ]
},
{
  id: 'queda', titulo: 'Prevenção de quedas', carga: '30 min',
  objetivo: 'Identificar o risco de queda de cada paciente e aplicar as medidas de prevenção com a participação do paciente e do acompanhante.',
  apostila: [
    { t: 'Por que prevenir', p: 'Quedas podem causar fraturas, traumatismos e aumento do tempo de internação. Pacientes idosos, confusos ou com mobilidade reduzida têm risco maior.' },
    { t: 'Fatores de risco', itens: ['Idade avançada e história de queda.', 'Mobilidade reduzida, uso de dispositivos (soro, sondas).', 'Confusão, agitação, alteração do sono.', 'Medicamentos: sedativos, hipnóticos, anti-hipertensivos, diuréticos, hipoglicemiantes.', 'Necessidade frequente de ir ao banheiro, diarreia.', 'Déficit visual, hipotensão postural, pós-operatório.'] },
    { t: 'Avaliar e sinalizar', itens: ['Avalie o risco na admissão com a escala adotada pela instituição (ex.: Morse).', 'Reavalie quando a condição mudar, na transferência e após uma queda.', 'Sinalize o risco conforme o padrão institucional (pulseira, placa), para que toda a equipe reconheça.'] },
    { t: 'Medidas no ambiente', itens: ['Cama baixa e travada; grades elevadas quando indicado.', 'Campainha, óculos, água e objetos ao alcance.', 'Iluminação adequada, inclusive à noite; piso seco e sem obstáculos.', 'Calçado fechado e antiderrapante.'] },
    { t: 'Medidas com o paciente', itens: ['Levantar em etapas: sentar na beira da cama, aguardar alguns instantes e então levantar com apoio.', 'Acompanhar ao banheiro quem tem risco; oferecer idas programadas.', 'Revisar com a equipe médica os medicamentos que aumentam o risco.'] },
    { t: 'Paciente e acompanhante', itens: ['Explique o risco e o motivo da sinalização.', 'Oriente a chamar a enfermagem antes de levantar.', 'Acompanhante avisa a enfermagem antes de se ausentar e não deixa o paciente com risco levantar sozinho.'] },
    { t: 'Depois de uma queda', p: 'Avalie o paciente antes de movimentá-lo, chame ajuda e comunique o médico. Registre, notifique ao Núcleo de Segurança do Paciente e reavalie o risco e o plano de cuidados.' }
  ],
  questoes: [
    { id: 'queda_1', tema: 'Avaliação de risco', p: 'Quando o risco de queda deve ser avaliado?', ops: ['Na admissão, reavaliando quando a condição mudar, na transferência e após queda', 'Só depois da primeira queda', 'Só em pacientes acima de 80 anos', 'Uma vez por mês'], exp: 'A avaliação começa na admissão e é refeita sempre que a situação do paciente muda.' },
    { id: 'queda_2', tema: 'Fatores de risco', p: 'Qual destes aumenta o risco de queda?', ops: ['Uso de sedativos e diuréticos', 'Calçado antiderrapante', 'Campainha ao alcance', 'Boa iluminação'], exp: 'Sedativos causam sonolência e diuréticos aumentam as idas ao banheiro: ambos elevam o risco.' },
    { id: 'queda_3', tema: 'Levantar em etapas', p: 'Qual a orientação correta para o paciente levantar da cama?', ops: ['Sentar na beira da cama, aguardar alguns instantes e então levantar com apoio', 'Levantar rápido para não cansar', 'Levantar sozinho à noite para não incomodar', 'Apoiar-se no suporte de soro'], exp: 'Levantar em etapas previne a tontura da hipotensão postural.' },
    { id: 'queda_4', tema: 'Ambiente seguro', p: 'Qual medida de ambiente previne quedas?', ops: ['Cama baixa e travada, com campainha e objetos ao alcance', 'Cama na posição mais alta', 'Luz totalmente apagada à noite', 'Grades sempre abaixadas'], exp: 'Cama baixa e travada e objetos ao alcance evitam que o paciente se estique ou caia de altura.' },
    { id: 'queda_5', tema: 'Sinalização do risco', p: 'Para que serve sinalizar o risco de queda do paciente?', ops: ['Para que toda a equipe reconheça o risco e adote as medidas', 'Para rotular o paciente', 'Para dispensar a avaliação diária', 'Para dispensar o acompanhante'], exp: 'A sinalização comunica o risco a todos que cuidam do paciente.' },
    { id: 'queda_6', tema: 'Papel do acompanhante', p: 'Qual a orientação ao acompanhante de um paciente com alto risco de queda?', ops: ['Avisar a enfermagem antes de se ausentar e não deixar o paciente levantar sozinho', 'Baixar as grades para dar conforto', 'Dar remédio para o paciente dormir', 'Nenhuma, a responsabilidade é só da equipe'], exp: 'O acompanhante é parte da prevenção quando sabe o que fazer.' },
    { id: 'queda_7', tema: 'Conduta após a queda', p: 'O paciente caiu no quarto. Qual o primeiro passo?', ops: ['Avaliar o paciente antes de movimentá-lo, chamar ajuda e comunicar o médico', 'Levantá-lo imediatamente sem avaliar', 'Esperar o fim do plantão para avisar', 'Registrar só se houver fratura'], exp: 'Movimentar sem avaliar pode agravar uma lesão; a avaliação vem primeiro.' },
    { id: 'queda_8', tema: 'Notificação de queda', p: 'Uma queda sem lesão aparente deve ser:', ops: ['Notificada ao NSP, com reavaliação do risco', 'Esquecida, porque não houve dano', 'Notificada só se o familiar reclamar', 'Registrada apenas verbalmente'], exp: 'Toda queda é notificada e o risco é reavaliado, mesmo sem lesão.' }
  ]
},
{
  id: 'lpp', titulo: 'Prevenção de lesão por pressão (LPP)', carga: '40 min',
  objetivo: 'Avaliar o risco, inspecionar a pele e aplicar as medidas que previnem a lesão por pressão.',
  apostila: [
    { t: 'O que é', p: 'Lesão por pressão é um dano localizado na pele e/ou nos tecidos abaixo dela, em geral sobre uma proeminência óssea ou sob um dispositivo médico, causado por pressão ou por pressão combinada com cisalhamento.' },
    { t: 'Onde aparece', itens: ['Região sacral e cóccix, calcâneos (calcanhares), trocânteres (quadril), ísquios.', 'Occipital, cotovelos, orelhas.', 'Sob dispositivos: sondas, máscaras, cateteres, talas.'] },
    { t: 'Avaliar o risco', itens: ['Na admissão, com a escala de Braden (percepção sensorial, umidade, atividade, mobilidade, nutrição, fricção e cisalhamento).', 'Reavalie periodicamente e quando a condição mudar.', 'Quanto menor a pontuação na Braden, maior o risco.'] },
    { t: 'Inspecionar a pele', itens: ['Inspecione diariamente, com atenção às proeminências ósseas e áreas sob dispositivos.', 'Estágio 1: pele íntegra com vermelhidão que não embranquece à pressão.', 'Estágio 2: perda parcial da pele com derme exposta (pode parecer bolha).', 'Estágios 3 e 4, não classificável e tissular profunda indicam dano mais profundo.'] },
    { t: 'Medidas de prevenção', itens: ['Reposicionar a cada 2 horas ou conforme o plano individual.', 'Usar coxins e manter os calcâneos sem apoio direto.', 'Cabeceira até 30° quando possível, para reduzir cisalhamento.', 'Mobilizar com lençol, sem arrastar o paciente.', 'Superfícies de redistribuição de pressão para quem tem risco.', 'Não massagear áreas avermelhadas.'] },
    { t: 'Pele, umidade e nutrição', itens: ['Higienize logo após eliminações; mantenha a pele limpa, seca e hidratada.', 'Use barreira protetora em pacientes com incontinência.', 'Avalie e acompanhe nutrição e hidratação com a equipe.'] },
    { t: 'Notifique', p: 'Lesão por pressão adquirida durante a internação é um evento adverso e deve ser notificada ao Núcleo de Segurança do Paciente.' }
  ],
  questoes: [
    { id: 'lpp_1', tema: 'Escala de Braden', p: 'Qual escala é usada para avaliar o risco de lesão por pressão?', ops: ['Braden', 'Glasgow', 'Apgar', 'Morse'], exp: 'Braden avalia o risco de LPP; Morse é para queda e Glasgow para nível de consciência.' },
    { id: 'lpp_2', tema: 'Reposicionamento', p: 'Com que frequência, em geral, o paciente acamado com risco deve ser reposicionado?', ops: ['A cada 2 horas ou conforme o plano individual', 'Uma vez por plantão', 'Só quando o paciente pedir', 'A cada 8 horas'], exp: 'O reposicionamento frequente alivia a pressão sobre as proeminências ósseas.' },
    { id: 'lpp_3', tema: 'Estágio 1', p: 'O que caracteriza a lesão por pressão estágio 1?', ops: ['Pele íntegra com vermelhidão que não embranquece à pressão', 'Perda parcial da pele com bolha rompida', 'Perda total da pele com exposição de gordura', 'Exposição de osso ou tendão'], exp: 'No estágio 1 a pele ainda está íntegra; reconhecer cedo evita a progressão.' },
    { id: 'lpp_4', tema: 'Locais mais frequentes', p: 'Em paciente acamado em decúbito dorsal, as regiões mais acometidas são:', ops: ['Região sacral e calcâneos', 'Abdômen e tórax', 'Coxa anterior', 'Face anterior das pernas'], exp: 'Em decúbito dorsal, o peso se concentra na região sacral e nos calcanhares.' },
    { id: 'lpp_5', tema: 'Cisalhamento', p: 'Como reduzir o cisalhamento ao mobilizar o paciente?', ops: ['Usar lençol para mobilizar sem arrastar e manter a cabeceira até 30° quando possível', 'Arrastar o paciente no leito', 'Manter a cabeceira a 90° o tempo todo', 'Massagear as áreas avermelhadas com força'], exp: 'Arrastar e cabeceira muito elevada aumentam o cisalhamento; massagem pode piorar o dano.' },
    { id: 'lpp_6', tema: 'Umidade e incontinência', p: 'Paciente com incontinência. Qual o cuidado correto com a pele?', ops: ['Higienizar logo após as eliminações e manter a pele seca e protegida', 'Trocar a fralda só no fim do plantão', 'Usar talco em grande quantidade', 'Nenhum, a umidade não interfere'], exp: 'Umidade enfraquece a pele e aumenta o risco de lesão.' },
    { id: 'lpp_7', tema: 'Lesão por dispositivo', p: 'Sobre lesão por pressão relacionada a dispositivo médico, é correto:', ops: ['Pode ocorrer sob sondas, máscaras e cateteres; inspecione e reposicione', 'Não existe', 'Só ocorre em UTI', 'Só ocorre nos calcanhares'], exp: 'Dispositivos fazem pressão contínua; a pele sob eles precisa ser inspecionada.' },
    { id: 'lpp_8', tema: 'Notificação de LPP', p: 'Lesão por pressão que surgiu durante a internação deve ser:', ops: ['Notificada ao NSP como evento adverso', 'Registrada só na alta', 'Notificada apenas se estágio 4', 'Não precisa ser notificada'], exp: 'Toda LPP adquirida na internação é notificada, independentemente do estágio.' }
  ]
},
{
  id: 'cirurgia', titulo: 'Cirurgia segura', carga: '40 min',
  objetivo: 'Aplicar a lista de verificação de cirurgia segura nos três momentos e envolver o paciente na confirmação.',
  apostila: [
    { t: 'Objetivo', p: 'A lista de verificação de cirurgia segura (OMS) previne cirurgia no paciente, no procedimento ou no local errados e falhas evitáveis como esquecimento de material e falta de profilaxia.' },
    { t: 'Antes da indução anestésica', itens: ['Confirmar com o paciente: identidade, procedimento, local e consentimento.', 'Local demarcado, quando se aplica.', 'Checagem do equipamento de anestesia e oxímetro funcionando.', 'Alergias conhecidas, via aérea difícil ou risco de aspiração, risco de perda sanguínea.'] },
    { t: 'Antes da incisão (pausa cirúrgica)', itens: ['Todos se apresentam por nome e função.', 'Confirmação em voz alta: paciente, procedimento e local.', 'Antibiótico profilático nos últimos 60 minutos, quando indicado.', 'Eventos críticos previstos pela cirurgia, anestesia e enfermagem; exames de imagem disponíveis.'] },
    { t: 'Antes de o paciente sair da sala', itens: ['Procedimento realizado registrado.', 'Contagem de compressas, instrumentais e agulhas conferida.', 'Amostras identificadas com o nome do paciente, lidas em voz alta.', 'Problemas com equipamentos e cuidados para a recuperação.'] },
    { t: 'Demarcação do local', itens: ['Feita pelo cirurgião responsável, com o paciente acordado participando, sempre que houver lateralidade, estruturas múltiplas ou níveis.', 'A marca deve ficar visível após o preparo da pele.'] },
    { t: 'Trabalho em equipe', itens: ['Um profissional conduz a lista e tem autoridade para interromper o processo.', 'Qualquer membro da equipe pode e deve parar o procedimento diante de uma dúvida.', 'Preparo do paciente: jejum, retirada de joias, adornos e próteses móveis, termo de consentimento.'] },
    { t: 'Notifique', p: 'Falhas na aplicação da lista, quase erros e eventos em cirurgia devem ser notificados ao Núcleo de Segurança do Paciente.' }
  ],
  questoes: [
    { id: 'cir_1', tema: 'Três momentos da lista', p: 'Quais são os três momentos da lista de verificação de cirurgia segura?', ops: ['Antes da indução anestésica, antes da incisão e antes de o paciente sair da sala', 'Admissão, alta e retorno ambulatorial', 'Véspera, dia da cirurgia e pós-operatório tardio', 'Apenas antes da incisão'], exp: 'A lista é aplicada antes da anestesia, antes da incisão e antes da saída da sala.' },
    { id: 'cir_2', tema: 'Pausa cirúrgica', p: 'O que acontece na pausa cirúrgica (antes da incisão)?', ops: ['A equipe confirma em voz alta paciente, procedimento e local', 'O anestesista inicia a indução', 'A enfermagem conta as compressas finais', 'O paciente assina o consentimento'], exp: 'A pausa é o último ponto de confirmação antes de começar a cirurgia.' },
    { id: 'cir_3', tema: 'Demarcação', p: 'Quem deve demarcar o local da cirurgia?', ops: ['O cirurgião responsável, com a participação do paciente', 'O próprio paciente, sozinho', 'O acompanhante', 'Ninguém, mesmo em cirurgias com lateralidade'], exp: 'Quem opera demarca, com o paciente confirmando, sempre que houver lateralidade ou níveis.' },
    { id: 'cir_4', tema: 'Contagem de materiais', p: 'Antes de o paciente sair da sala, deve-se:', ops: ['Conferir a contagem de compressas, instrumentais e agulhas', 'Dispensar a contagem se a cirurgia foi curta', 'Contar apenas os instrumentais grandes', 'Deixar a contagem para o dia seguinte'], exp: 'A contagem evita retenção de material no paciente.' },
    { id: 'cir_5', tema: 'Antibiótico profilático', p: 'Quando indicado, o antibiótico profilático deve ter sido administrado:', ops: ['Nos últimos 60 minutos antes da incisão', 'Somente após a cirurgia', 'Na véspera, à noite', 'Apenas se houver febre'], exp: 'A profilaxia dentro de 60 minutos antes da incisão reduz infecção do sítio cirúrgico.' },
    { id: 'cir_6', tema: 'Interromper diante da dúvida', p: 'Um técnico percebe que o lado demarcado diverge do prontuário. O que fazer?', ops: ['Interromper o processo até esclarecer, mesmo sendo o profissional menos experiente', 'Não falar nada para não atrasar', 'Comentar só depois da cirurgia', 'Corrigir a marca sem avisar'], exp: 'Qualquer membro da equipe pode e deve parar o procedimento diante de uma dúvida.' },
    { id: 'cir_7', tema: 'Checagens antes da anestesia', p: 'Antes da indução anestésica, além da identificação, verifica-se:', ops: ['Alergias, via aérea difícil e risco de perda sanguínea', 'Apenas a pressão arterial', 'Somente o jejum', 'O horário da próxima cirurgia'], exp: 'Esses riscos orientam o preparo da anestesia e da equipe.' },
    { id: 'cir_8', tema: 'Identificação de amostras', p: 'Como devem sair da sala as peças e amostras cirúrgicas?', ops: ['Identificadas com o nome do paciente e lidas em voz alta antes de sair', 'Sem identificação, para o laboratório identificar', 'Identificadas só com o número da sala', 'Identificadas no dia seguinte'], exp: 'A identificação conferida em voz alta evita troca ou perda de amostras.' }
  ]
},
{
  id: 'comunicacao', titulo: 'Comunicação efetiva', carga: '30 min',
  objetivo: 'Usar ferramentas de comunicação estruturada entre profissionais e com pacientes para evitar falhas de informação.',
  apostila: [
    { t: 'Por que importa', p: 'Falhas de comunicação estão entre as causas mais frequentes de eventos adversos. A comunicação efetiva é a Meta 2 de segurança do paciente.' },
    { t: 'Passagem de plantão', itens: ['Use uma estrutura padronizada, como SBAR: Situação, Breve histórico, Avaliação e Recomendação.', 'Prefira à beira-leito, quando possível, com o mínimo de interrupções.', 'Inclua pendências, riscos e cuidados programados.'] },
    { t: 'Ordens verbais e por telefone', itens: ['Só quando necessário (emergência, procedimento estéril).', 'Quem recebe escreve, lê de volta em voz alta e confirma (read-back).', 'Registre no prontuário assim que possível.'] },
    { t: 'Resultados críticos', itens: ['Valor crítico de exame é comunicado imediatamente ao profissional responsável.', 'Quem recebe repete o resultado para confirmar.', 'Registre o horário e quem recebeu a informação.'] },
    { t: 'Transferências e registros', itens: ['Na transferência entre setores ou serviços, passe as informações verbalmente e por escrito, de forma estruturada.', 'Registros legíveis, com data, hora e identificação de quem registra.', 'Evite abreviaturas não padronizadas.'] },
    { t: 'Com o paciente e a família', itens: ['Use linguagem simples e confirme o entendimento pedindo que a pessoa repita com as próprias palavras (teach-back).', 'Na alta, revise medicamentos, sinais de alerta e retornos.', 'Comunique eventos adversos ao paciente e à família de forma aberta e transparente (PNQSP 2026).'] },
    { t: 'Fale se perceber risco', p: 'Ao perceber um risco, fale de forma respeitosa e imediata, mesmo diante de um profissional mais experiente. Uma cultura de segurança depende de que todos se sintam à vontade para alertar.' }
  ],
  questoes: [
    { id: 'com_1', tema: 'SBAR', p: 'O que significa a ferramenta SBAR na passagem de plantão?', ops: ['Situação, Breve histórico, Avaliação e Recomendação', 'Sinais, Banho, Alimentação e Repouso', 'Setor, Boletim, Alta e Retorno', 'Sintomas, Bem-estar, Atividade e Rotina'], exp: 'SBAR organiza a informação para que nada essencial se perca.' },
    { id: 'com_2', tema: 'Leitura de volta (read-back)', p: 'Ao receber uma ordem por telefone, o profissional deve:', ops: ['Escrever, ler de volta em voz alta para confirmação e registrar', 'Memorizar e executar', 'Pedir que outro colega anote', 'Executar e confirmar só no dia seguinte'], exp: 'Ler de volta permite corrigir na hora qualquer mal-entendido.' },
    { id: 'com_3', tema: 'Resultado crítico', p: 'O laboratório informa um valor crítico de potássio. A conduta correta é:', ops: ['Comunicar imediatamente o responsável e registrar horário e quem recebeu', 'Aguardar a visita médica do dia seguinte', 'Anotar e deixar para o próximo plantão', 'Avisar apenas o paciente'], exp: 'Resultado crítico exige ação rápida e registro de quem foi comunicado.' },
    { id: 'com_4', tema: 'Passagem de plantão', p: 'Qual é uma boa prática na passagem de plantão?', ops: ['Estruturada, com pendências e riscos, e com o mínimo de interrupções', 'Rápida, no corredor, enquanto se atende o telefone', 'Apenas por escrito, sem conversa', 'Só sobre os pacientes graves'], exp: 'Estrutura e ambiente adequado reduzem perda de informação.' },
    { id: 'com_5', tema: 'Abreviaturas', p: 'Sobre abreviaturas no prontuário, é correto:', ops: ['Evitar abreviaturas não padronizadas pela instituição', 'Usar as que o setor costuma entender', 'Abreviar o nome dos medicamentos para economizar espaço', 'Abreviaturas nunca causam erro'], exp: 'Abreviaturas não padronizadas podem ser lidas de formas diferentes.' },
    { id: 'com_6', tema: 'Teach-back', p: 'Como confirmar que o paciente entendeu a orientação de alta?', ops: ['Pedir que ele repita a orientação com as próprias palavras', 'Perguntar "Entendeu?"', 'Entregar o papel sem explicar', 'Explicar só ao acompanhante'], exp: 'A pergunta "Entendeu?" quase sempre recebe "sim"; repetir mostra o que foi realmente entendido.' },
    { id: 'com_7', tema: 'Falar diante do risco', p: 'Você percebe um risco em um cuidado realizado por um colega mais experiente. O que fazer?', ops: ['Falar imediatamente, de forma respeitosa', 'Ficar em silêncio por hierarquia', 'Comentar só com outros colegas', 'Esperar o fim do plantão'], exp: 'Alertar na hora pode evitar o dano; cultura de segurança valoriza quem fala.' },
    { id: 'com_8', tema: 'Transferência entre setores', p: 'Na transferência do paciente para outro setor, a informação deve ser:', ops: ['Estruturada, passada verbalmente e por escrito à equipe que recebe', 'Passada só pelo prontuário', 'Passada pelo maqueiro', 'Dispensável, a equipe que recebe avalia sozinha'], exp: 'A transição de cuidado é um momento de alto risco de perda de informação.' }
  ]
},
{
  id: 'ccih', titulo: 'Higiene das mãos e prevenção de infecções', carga: '30 min',
  objetivo: 'Realizar a higiene das mãos nos cinco momentos, com a técnica e o tempo corretos.',
  apostila: [
    { t: 'A medida mais simples', p: 'A higiene das mãos é a principal medida para prevenir infecções relacionadas à assistência à saúde. Mãos contaminadas levam microrganismos de um paciente a outro e ao ambiente.' },
    { t: 'Os cinco momentos (OMS)', itens: ['1. Antes de tocar o paciente.', '2. Antes de realizar procedimento limpo ou asséptico.', '3. Após risco de exposição a fluidos corporais.', '4. Após tocar o paciente.', '5. Após tocar superfícies próximas ao paciente.'] },
    { t: 'Preparação alcoólica', itens: ['Indicada quando as mãos não estão visivelmente sujas.', 'Duração: 20 a 30 segundos, friccionando até secar.'] },
    { t: 'Água e sabonete', itens: ['Quando as mãos estão visivelmente sujas ou com fluidos corporais, e após usar o banheiro.', 'Duração: 40 a 60 segundos.', 'Preferir em situações de diarreia por Clostridioides difficile, conforme orientação do SCIH.'] },
    { t: 'Técnica', itens: ['Palma com palma; dorso das mãos; entre os dedos.', 'Polegares; pontas dos dedos e unhas; punhos.', 'Polegares e pontas dos dedos são as áreas mais esquecidas.'] },
    { t: 'Luvas e adornos', itens: ['Luvas não substituem a higiene das mãos: higienize antes de calçar e após retirar.', 'Unhas curtas e naturais; sem anéis, pulseiras e relógio durante a assistência (NR 32).'] },
    { t: 'Todos participam', p: 'Pacientes, acompanhantes e visitantes também higienizam as mãos ao entrar e sair do quarto, e podem pedir ao profissional que higienize as suas. Dúvidas sobre precauções e isolamento: procure o SCIH.' }
  ],
  questoes: [
    { id: 'maos_1', tema: 'Cinco momentos', p: 'Qual alternativa NÃO é um dos cinco momentos da higiene das mãos?', ops: ['Antes de entrar no estacionamento do hospital', 'Antes de tocar o paciente', 'Após tocar superfícies próximas ao paciente', 'Após risco de exposição a fluidos corporais'], exp: 'Os cinco momentos estão ligados ao contato com o paciente e seu entorno.' },
    { id: 'maos_2', tema: 'Tempo com álcool', p: 'Qual é o tempo recomendado para a fricção com preparação alcoólica?', ops: ['20 a 30 segundos', '5 segundos', '2 minutos', '10 minutos'], exp: 'De 20 a 30 segundos, friccionando todas as áreas até secar.' },
    { id: 'maos_3', tema: 'Tempo com água e sabonete', p: 'Qual é o tempo recomendado para lavar as mãos com água e sabonete?', ops: ['40 a 60 segundos', '10 segundos', '5 minutos', 'O tempo de molhar e secar'], exp: 'A lavagem completa leva de 40 a 60 segundos.' },
    { id: 'maos_4', tema: 'Quando usar água e sabonete', p: 'Quando a lavagem com água e sabonete é indicada no lugar do álcool?', ops: ['Quando as mãos estiverem visivelmente sujas ou com fluidos corporais', 'Sempre, o álcool nunca é suficiente', 'Somente no início do plantão', 'Somente antes de comer'], exp: 'Sujeira visível e fluidos corporais pedem água e sabonete.' },
    { id: 'maos_5', tema: 'Luvas', p: 'Sobre luvas e higiene das mãos, é correto:', ops: ['Higienizar antes de calçar e após retirar as luvas', 'Com luvas não é preciso higienizar', 'Basta passar álcool por cima da luva entre pacientes', 'Higienizar só se a luva rasgar'], exp: 'Luvas podem ter microfuros e as mãos se contaminam ao retirá-las.' },
    { id: 'maos_6', tema: 'Adornos', p: 'Durante a assistência, o profissional deve:', ops: ['Retirar anéis, pulseiras e relógio', 'Usar anéis apenas na mão não dominante', 'Manter o relógio para controlar o tempo de fricção', 'Cobrir os adornos com luvas'], exp: 'Adornos acumulam microrganismos e impedem a higiene adequada (NR 32).' },
    { id: 'maos_7', tema: 'Técnica: áreas esquecidas', p: 'Quais áreas das mãos são mais frequentemente esquecidas na higienização?', ops: ['Polegares e pontas dos dedos', 'Palmas', 'Dorso das mãos', 'Punhos'], exp: 'Atenção especial aos polegares e às pontas dos dedos.' },
    { id: 'maos_8', tema: 'Quinto momento', p: 'Você ajustou a bomba de infusão ao lado do leito, sem tocar no paciente. Precisa higienizar as mãos?', ops: ['Sim, é o 5º momento: após tocar superfícies próximas ao paciente', 'Não, porque não tocou no paciente', 'Só se for atender outro paciente com isolamento', 'Só ao fim do plantão'], exp: 'O entorno do paciente também está contaminado; por isso existe o 5º momento.' }
  ]
}
];

// ── Apostilas em tom de conversa (professor dialogando com o aluno) ─────────────
// Cada secao: t (titulo), p (paragrafo ou lista de paragrafos), itens (opcional) e
// caixa {tipo: cena | sabia | pratica | pense | atencao, titulo, texto}.
window.CAPACITACAO_APOSTILAS = {
identificacao: {
  abertura: [
    'Olá, colega! Vamos começar por uma pergunta simples: quantas vezes, num único plantão, você confirma quem é o paciente à sua frente? Se a resposta for “várias”, ótimo. Se for “só quando tenho dúvida”, esta conversa é para você.',
    'Identificar o paciente parece óbvio, quase burocrático. Mas é justamente por parecer óbvio que a gente relaxa, e é aí que mora o perigo. Nas próximas páginas vamos entender por que esse gesto pequeno sustenta todos os outros cuidados.'
  ],
  secoes: [
    { t: 'Por que algo tão simples dá errado', p: [
      'Pense na rotina de uma enfermaria cheia: pacientes trocam de leito, chegam transferidos de madrugada, dormem, estão sedados, confusos ou simplesmente cansados de responder. Em meio a isso, a identificação vira automática e o automático é onde o erro se esconde.',
      'Quando a identificação falha, todo o resto falha junto: o medicamento certo vai para a pessoa errada, a amostra de sangue é etiquetada com outro nome, o exame é feito no paciente do leito ao lado. Por isso a identificação correta é a Meta 1 de segurança do paciente: ela vem antes de todas as outras.' ],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Dois pacientes na mesma enfermaria: José Carlos da Silva, leito 3, e José Carlos de Souza, leito 5. O técnico chega com a medicação e chama: “Seu José?”. Os dois olham. O do leito 5, sonolento, responde “sou eu”. Ninguém mentiu, ninguém foi descuidado de propósito, e mesmo assim o remédio quase foi para a pessoa errada. O que teria evitado? Perguntar o nome completo e a data de nascimento, e conferir com a pulseira.' } },
    { t: 'Os dois identificadores', p: [
      'A regra de ouro é usar sempre pelo menos dois identificadores. No nosso protocolo, eles são o nome completo e a data de nascimento. Em algumas situações a instituição pode usar o nome da mãe ou o número de registro, mas a lógica é a mesma: duas informações que juntas só pertencem àquela pessoa.',
      'E o número do leito? Nunca. O leito identifica um lugar, não uma pessoa. O paciente muda de leito, de quarto, de setor; a cama fica e recebe outro.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'Silva, Santos e Oliveira estão entre os sobrenomes mais comuns do Brasil. Num hospital grande, ter dois ou três pacientes com nomes parecidos internados ao mesmo tempo não é raridade, é rotina. É exatamente por isso que só o nome não basta.' } },
    { t: 'A pulseira: o documento que vai junto com o paciente', p: [
      'A pulseira é colocada na admissão, de preferência no punho. Se não for possível, por causa de acesso venoso, curativo ou edema, vai para o tornozelo. Ao colocar, confira os dados em voz alta com o paciente ou o acompanhante: é a primeira chance de pegar um erro de cadastro.',
      'Ela acompanha o paciente até a alta, inclusive no banho, nos exames e no centro cirúrgico. Ficou ilegível, apertada, solta ou com dado errado? Troque na hora. Pulseira que “depois a gente troca” é pulseira que não protege.' ],
      itens: ['Dados legíveis: nome completo e data de nascimento.', 'Iguais aos do prontuário, da prescrição e das etiquetas.', 'Sinalizações extras (alergia, risco de queda) seguem o padrão do hospital.'] },
    { t: 'Quando conferir', p: 'A identificação não é um evento da admissão, é um hábito de todo o plantão. Confira sempre antes de:',
      itens: ['administrar medicamentos e hemocomponentes;', 'coletar sangue ou outro material e etiquetar a amostra;', 'realizar procedimentos, exames de imagem e cirurgias;', 'entregar a dieta;', 'transportar, transferir ou dar alta.'],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Qual desses momentos é o mais “corrido” no seu setor? Normalmente é nele que a conferência é pulada. Que tal combinar com a equipe um cuidado extra justamente ali?' } },
    { t: 'Como perguntar: o segredo da pergunta aberta', p: [
      'Repare na diferença entre “O senhor é o Seu José?” e “Qual é o seu nome completo e a sua data de nascimento?”. A primeira pergunta já entrega a resposta: basta dizer “sim”. E as pessoas dizem sim por muitos motivos: não escutaram direito, estão sedadas, ansiosas, constrangidas ou querem colaborar.',
      'A pergunta aberta obriga o paciente a dizer os dados, e você compara com a pulseira e com a prescrição ou etiqueta. Leva três segundos e fecha a porta para o erro.' ],
      caixa: { tipo: 'pratica', titulo: 'Na prática', texto: 'Paciente que não pode responder (inconsciente, intubado, confuso, bebê): confira a pulseira com a prescrição e, quando houver acompanhante, peça que ele confirme. Paciente sem identificação na chegada: use o padrão do hospital, como “desconhecido” mais o número de registro, até a identificação definitiva.' } },
    { t: 'Erros comuns que vale evitar', itens: [
      'Chamar o paciente pelo número do leito (“o do 12”).',
      'Conferir só o primeiro nome.',
      'Etiquetar tubos de coleta antes de chegar ao paciente, ou deixar para etiquetar depois.',
      'Confiar na placa da cabeceira em vez da pulseira.',
      'Deixar para trocar a pulseira ilegível “no próximo plantão”.' ],
      caixa: { tipo: 'atencao', titulo: 'Atenção aos homônimos', texto: 'Dois pacientes com nomes iguais ou parecidos no mesmo setor? Sinalize o alerta no prontuário e no quadro, avise a equipe na passagem de plantão e reforce a dupla conferência. Se possível, evite colocá-los no mesmo quarto.' } },
    { t: 'E quando algo der errado?', p: [
      'Pegou uma etiqueta trocada antes da coleta? Uma pulseira com a data errada? Notifique, mesmo que nada tenha acontecido. Esses quase erros são ouro para o Núcleo de Segurança do Paciente: mostram onde o processo falha antes que alguém seja prejudicado.',
      'Notificar não é dedurar ninguém. É ajudar o hospital a consertar o sistema, para que o próximo colega cansado, às 4 da manhã, tenha mais barreiras a seu favor.' ] }
  ],
  resumo: ['Sempre dois identificadores: nome completo + data de nascimento.', 'Leito nunca é identificador.', 'Pergunta aberta: “Qual é o seu nome completo e a sua data de nascimento?”.', 'Confira antes de medicação, sangue, coleta, procedimento, dieta e transporte.', 'Pulseira ilegível ou errada: troque na hora.', 'Homônimos: sinalize e redobre a atenção.', 'Quase erro também se notifica.']
},
medicamentos: {
  abertura: [
    'Olá! Se existe um processo no hospital em que muita gente põe a mão, é o do medicamento. O médico prescreve, a farmácia confere e dispensa, a enfermagem prepara e administra, e todo mundo observa a resposta do paciente. Cada passagem de mão é uma chance de acertar, e também de errar.',
    'A boa notícia: a maioria dos erros de medicação é evitável com hábitos simples. Vamos conversar sobre eles.' ],
  secoes: [
    { t: 'Onde o erro aparece', p: [
      'O erro pode nascer em qualquer etapa: uma prescrição ilegível, uma ampola parecida com outra na prateleira, uma diluição calculada às pressas, um horário esquecido na troca de plantão. Quase nunca é falta de conhecimento; é o sistema deixando brechas e a rotina acelerada aproveitando-as.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'A Organização Mundial da Saúde lançou em 2017 o desafio global “Medicação sem Danos”, com a meta de reduzir pela metade os danos graves e evitáveis relacionados a medicamentos. O tema é tão importante que virou prioridade mundial.' } },
    { t: 'Os “certos” da administração', p: 'Você provavelmente já ouviu falar dos certos. Eles funcionam como um checklist mental antes de cada administração:',
      itens: ['Paciente certo: confira os dois identificadores.', 'Medicamento certo: leia o rótulo três vezes (ao pegar, ao preparar, ao administrar).', 'Via certa.', 'Hora certa.', 'Dose certa: atenção redobrada a cálculos e diluições.', 'Registro certo: registre logo após administrar.', 'Orientação correta: explique ao paciente o que é e para que serve.', 'Forma farmacêutica certa.', 'Resposta certa: acompanhe o efeito esperado e os efeitos indesejados.'],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Qual desses certos você confere sem nem perceber? E qual é o primeiro a ser pulado quando o plantão aperta? Saber onde você costuma escorregar já é meio caminho para não escorregar.' } },
    { t: 'Prescrição segura: cada detalhe conta', p: [
      'Algumas convenções existem porque já causaram tragédias. Zero à direita é uma delas: “5,0 mg”, com a vírgula apagada ou mal impressa, vira “50 mg”, dez vezes a dose. Por isso escreva “5 mg”. Já o zero à esquerda é obrigatório: “0,5 mg”, nunca “,5 mg”.',
      'Abreviaturas também enganam. O “U” de unidade, escrito à mão, já foi lido como zero, transformando 10 U de insulina em 100. Escreva “unidades” por extenso.' ],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Plantão noturno, o médico pede por telefone: “Faz quinze de insulina regular”. Você entende cinquenta. O que salva o paciente é a repetição em voz alta: “Confirmando: quinze unidades de insulina regular, subcutânea, agora?”. Prescrição verbal só em emergência, sempre repetida, confirmada e registrada assim que possível.' } },
    { t: 'Medicamentos de alta vigilância', p: [
      'Alguns medicamentos não perdoam: um erro com eles tende a causar dano grave. São chamados de alta vigilância (ou potencialmente perigosos). Exemplos: insulinas, heparinas e outros anticoagulantes, opioides, cloreto de potássio concentrado, sedativos intravenosos e quimioterápicos.',
      'Com eles, três cuidados fazem diferença: armazenamento separado e bem identificado, dupla checagem independente antes de administrar e acesso controlado. Dupla checagem independente quer dizer que o colega confere sozinho, sem você ditar o que ele deve ver.' ],
      caixa: { tipo: 'atencao', titulo: 'Atenção', texto: 'Cloreto de potássio concentrado não deve ficar disponível nas unidades de internação sem controle. Se você encontrar ampolas soltas no posto, avise a farmácia e o NSP.' } },
    { t: 'Nomes e embalagens parecidos', p: [
      'Hidroxizina e hidralazina. Dopamina e dobutamina. Nomes que soam parecidos e embalagens quase iguais são uma armadilha clássica. A estratégia é separar fisicamente na prateleira e destacar a diferença na etiqueta com letras maiúsculas, como em hidrOXIzina e hidrALAzina.',
      'Na dúvida, pare e confirme com a farmácia. Dois minutos de confirmação valem mais do que horas de arrependimento.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'Esse jeito de escrever com letras maiúsculas no meio do nome tem até apelido em inglês: “tall man lettering”. Ele é recomendado no mundo todo justamente para que os olhos percebam a diferença entre nomes parecidos.' } },
    { t: 'O paciente como aliado', p: [
      'O paciente é a última barreira, e muitas vezes a mais atenta. Pergunte sobre alergias antes do primeiro medicamento e registre. Pergunte também sobre os remédios que ele usa em casa, inclusive chás e vitaminas, e oriente que não tome nada trazido de casa sem avisar a equipe.',
      'Ao administrar, diga o que está dando e para quê. Se o paciente estranhar (“esse comprimido não é o que eu tomo”), pare e confira. Muitas vezes ele tem razão.' ] },
    { t: 'Erro ou quase erro? Notifique', p: 'Erros de medicação, reações adversas e também os erros interceptados antes de chegar ao paciente devem ser notificados ao Núcleo de Segurança do Paciente. O quase erro mostra a falha no processo sem que ninguém tenha se machucado: é a melhor aula que o hospital pode ter.' }
  ],
  resumo: ['Use os certos como checklist mental a cada administração.', 'Nunca zero à direita; sempre zero à esquerda.', 'Escreva “unidades” por extenso.', 'Ordem verbal: só em emergência, repetida em voz alta e registrada.', 'Alta vigilância: separar, identificar e fazer dupla checagem independente.', 'Nomes parecidos: separar e destacar a diferença.', 'Pergunte sobre alergias e remédios de casa.', 'Notifique erros e quase erros.']
},
queda: {
  abertura: [
    'Olá! Vamos falar de algo que todo mundo acha que entende: cair. Fora do hospital, uma queda pode ser só um susto. Dentro dele, com o paciente fragilizado, medicado e num ambiente desconhecido, pode significar fratura, cirurgia, internação mais longa e perda de independência.',
    'A boa notícia é que boa parte das quedas pode ser prevenida, e a prevenção é feita de gestos simples, repetidos com consistência.' ],
  secoes: [
    { t: 'Quem cai e por quê', p: [
      'Quedas raramente têm uma causa só. Normalmente é uma soma: um idoso que toma diurético, acorda à noite com vontade de urinar, levanta rápido, sente tontura, o chão está escorregadio e a campainha ficou longe. Tire qualquer um desses elementos e a queda talvez não aconteça.' ],
      itens: ['Idade avançada e história de quedas anteriores.', 'Mobilidade reduzida, uso de soro, sondas e drenos.', 'Confusão, agitação, alteração do sono.', 'Medicamentos: sedativos, hipnóticos, anti-hipertensivos, diuréticos, hipoglicemiantes.', 'Urgência para ir ao banheiro, diarreia.', 'Déficit visual, tontura ao levantar, pós-operatório.'],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Dona Lúcia, 78 anos, segundo dia de pós-operatório. Às 3 da manhã ela precisa ir ao banheiro. Não quer “incomodar a enfermagem”, que parece tão ocupada. Levanta sozinha, de chinelo, com o soro no braço. No caminho, a pressão cai. Quantas oportunidades de prevenção você enxerga nessa história?' } },
    { t: 'Avaliar o risco: o primeiro passo', p: [
      'Cada paciente deve ter o risco de queda avaliado na admissão, com a escala adotada pelo hospital, e reavaliado quando a condição muda, na transferência de setor e depois de qualquer queda.',
      'O resultado precisa ficar visível para toda a equipe, pela sinalização padronizada da instituição (pulseira, placa, alerta no prontuário). Não é rótulo: é um aviso de que aquele paciente precisa de cuidado extra.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'Uma das escalas mais usadas no mundo, a Escala de Morse, foi criada pela enfermeira canadense Janice Morse no fim dos anos 1980. Ela soma pontos para histórico de quedas, diagnósticos, uso de acesso venoso, forma de andar, estado mental e apoio para deambular.' } },
    { t: 'Um ambiente que protege', p: 'Muitas quedas são vencidas antes mesmo de o paciente se mexer, só pelo jeito como o ambiente está arrumado:',
      itens: ['Cama na posição mais baixa e com as rodas travadas.', 'Grades elevadas quando indicado pelo plano de cuidados.', 'Campainha, óculos, água e telefone ao alcance da mão.', 'Luz noturna acesa e caminho até o banheiro livre.', 'Piso seco; se estiver molhado, sinalize na hora.', 'Calçado fechado e antiderrapante (chinelo solto é inimigo).'],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Na próxima vez que entrar num quarto, faça o teste: se você fosse o paciente, conseguiria pegar a água e a campainha sem se esticar? Se a resposta for não, o ambiente ainda não está seguro.' } },
    { t: 'Levantar em etapas', p: [
      'Ao passar de deitado para em pé muito rápido, o sangue “desce” e a pressão cai por alguns segundos: é a hipotensão postural, uma grande causadora de tontura e queda.',
      'Ensine o paciente a levantar em três tempos: sentar na beira da cama, esperar alguns segundos com os pés apoiados no chão e só então ficar em pé, com apoio. Parece detalhe, mas evita muitas quedas.' ],
      caixa: { tipo: 'pratica', titulo: 'Na prática', texto: 'Para pacientes de risco, ofereça idas programadas ao banheiro, principalmente antes de dormir e após diuréticos. Muitas quedas acontecem justamente no trajeto até o banheiro, à noite.' } },
    { t: 'O acompanhante faz parte da equipe', p: [
      'Explique ao paciente e ao acompanhante qual é o risco e por que existe a sinalização. Combine que o paciente deve chamar a enfermagem antes de levantar e que o acompanhante avisa antes de se ausentar do quarto.',
      'Um acompanhante orientado é um par de olhos a mais. Um acompanhante que não sabe do risco pode, sem querer, baixar a grade “para dar conforto”.' ] },
    { t: 'Se a queda acontecer', p: [
      'Primeiro, não levante o paciente imediatamente: avalie se há dor, deformidade, sangramento ou batida na cabeça. Chame ajuda e comunique o médico.',
      'Depois, registre, notifique ao Núcleo de Segurança do Paciente e reavalie o risco e o plano de cuidados. Mesmo a queda sem lesão aparente precisa ser notificada: ela revela uma brecha que pode machucar o próximo paciente.' ],
      caixa: { tipo: 'atencao', titulo: 'Atenção', texto: 'Pacientes em uso de anticoagulante que batem a cabeça precisam de avaliação médica mesmo sem sintomas imediatos, porque um sangramento pode se manifestar horas depois.' } }
  ],
  resumo: ['Avalie o risco na admissão e reavalie quando algo mudar.', 'Sinalize o risco para toda a equipe.', 'Cama baixa e travada, campainha e objetos ao alcance.', 'Calçado antiderrapante, piso seco e luz noturna.', 'Levantar em etapas: sentar, esperar, levantar com apoio.', 'Oriente paciente e acompanhante.', 'Caiu? Avalie antes de mover, comunique, notifique e reavalie.']
},
lpp: {
  abertura: [
    'Olá! Hoje a conversa é sobre uma lesão silenciosa: a lesão por pressão. Ela não faz barulho, não dá alarme no monitor e às vezes começa com uma simples vermelhidão. Mas, quando avança, causa dor, infecção, internação prolongada e muito sofrimento.',
    'O mais importante: na grande maioria das vezes ela pode ser prevenida, e a prevenção está nas nossas mãos, literalmente.' ],
  secoes: [
    { t: 'O que é e como acontece', p: [
      'Lesão por pressão é um dano na pele e nos tecidos de baixo dela, causado por pressão contínua, ou pressão somada ao cisalhamento (aquele “arrastar” da pele sobre o lençol). A pressão aperta os vasos entre o osso e a superfície, o sangue não chega e o tecido sofre.',
      'Por isso ela aparece onde o osso fica mais perto da pele: região sacral e cóccix, calcanhares, quadril, ísquios, cotovelos, nuca e orelhas. E também embaixo de dispositivos: sondas, máscaras, cateteres e talas.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'Até 2016 o nome mais usado era “úlcera por pressão”. O painel americano especializado no tema (NPUAP, hoje NPIAP) passou a recomendar “lesão por pressão”, porque o dano pode existir mesmo com a pele ainda íntegra, sem úlcera aberta.' } },
    { t: 'Quem está em risco', p: [
      'Pacientes acamados, sedados, com mobilidade reduzida, desnutridos, com incontinência ou com pouca sensibilidade (como após um AVC ou em diabéticos) estão no grupo de maior risco.',
      'Para não depender da impressão de cada um, usamos a Escala de Braden na admissão e em reavaliações periódicas. Ela avalia percepção sensorial, umidade, atividade, mobilidade, nutrição e fricção/cisalhamento. Quanto menor a pontuação, maior o risco.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'A Escala de Braden foi criada nos Estados Unidos em 1987 pelas enfermeiras Barbara Braden e Nancy Bergstrom e é uma das ferramentas de enfermagem mais usadas no mundo.' } },
    { t: 'Olhar a pele todos os dias', p: [
      'A inspeção diária da pele é a ferramenta mais barata e eficaz que existe. Aproveite o banho e as mudanças de posição para olhar com atenção as proeminências ósseas e a pele sob os dispositivos.',
      'Um truque simples: pressione levemente uma área avermelhada com o dedo. Se ela clareia e volta a ficar vermelha, a circulação está respondendo. Se continua vermelha, sem clarear, é sinal de lesão por pressão em estágio inicial (estágio 1). É hora de agir.' ],
      itens: ['Estágio 1: pele íntegra com vermelhidão que não clareia à pressão.', 'Estágio 2: perda parcial da pele, pode parecer uma bolha.', 'Estágios 3 e 4: perda total da pele, com exposição de gordura, músculo ou osso.', 'Não classificável e tissular profunda: dano profundo, ainda que a superfície engane.'] },
    { t: 'Mudar de posição: o coração da prevenção', p: [
      'Nenhuma pele aguenta pressão contínua por muito tempo. Por isso o reposicionamento é feito a cada 2 horas, ou conforme o plano individual do paciente. Use travesseiros e coxins para aliviar os pontos de apoio e deixe os calcanhares “flutuando”, sem encostar no colchão.',
      'Na hora de mobilizar, use o lençol para levantar, sem arrastar. E, quando possível, mantenha a cabeceira até 30 graus: cabeceira muito alta faz o paciente escorregar, e o cisalhamento machuca.' ],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Seu Antônio, 82 anos, internado por pneumonia, passa o dia com a cabeceira bem alta “para respirar melhor” e vai escorregando na cama. No terceiro dia, no banho, a técnica nota uma mancha arroxeada na região sacral. O que poderia ter sido feito diferente nos dias anteriores?' } },
    { t: 'Pele limpa, seca e bem nutrida', p: [
      'Umidade enfraquece a pele. Em pacientes com incontinência, higienize logo após as eliminações, seque bem e use creme barreira. Hidrate a pele seca, sem esfregar.',
      'Nutrição e hidratação também são prevenção: pele mal nutrida rompe com facilidade. Envolva a nutrição e a equipe médica quando o paciente come pouco.' ],
      caixa: { tipo: 'atencao', titulo: 'Atenção', texto: 'Não massageie áreas avermelhadas sobre proeminências ósseas. A massagem, que parece carinho, pode aumentar o dano nos tecidos já comprometidos.' } },
    { t: 'Notificar faz parte do cuidado', p: 'Lesão por pressão que surge durante a internação é um evento adverso e deve ser notificada ao Núcleo de Segurança do Paciente, em qualquer estágio. A notificação ajuda a identificar setores, turnos e situações em que a prevenção precisa ser reforçada, como falta de colchões especiais ou de pessoal para os reposicionamentos.' }
  ],
  resumo: ['Avalie o risco com a Escala de Braden e reavalie periodicamente.', 'Inspecione a pele todos os dias, inclusive sob dispositivos.', 'Vermelhidão que não clareia: estágio 1, aja já.', 'Reposicione a cada 2 horas (ou conforme o plano).', 'Calcanhares sem apoio, cabeceira até 30° quando possível, mobilize sem arrastar.', 'Pele limpa, seca e hidratada; nada de massagem na vermelhidão.', 'Notifique toda LPP adquirida na internação.']
},
cirurgia: {
  abertura: [
    'Olá! Já imaginou operar o joelho errado? Ou esquecer uma compressa dentro do paciente? Parece coisa de filme, mas são eventos que aconteceram, e ainda acontecem, em hospitais do mundo todo. Quase sempre com equipes competentes e bem-intencionadas.',
    'A cirurgia segura não depende só da habilidade do cirurgião. Depende de uma equipe que para, confere e conversa nos momentos certos. É disso que vamos falar.' ],
  secoes: [
    { t: 'Uma lista que salva vidas', p: [
      'Em 2008, a Organização Mundial da Saúde lançou a campanha “Cirurgias Seguras Salvam Vidas”, com uma lista de verificação simples, aplicada em três momentos de toda cirurgia.',
      'A ideia veio da aviação: pilotos experientes usam checklists antes de decolar não por falta de conhecimento, mas porque sabem que memória falha sob pressão. No centro cirúrgico é igual.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'Num estudo publicado em 2009 em oito hospitais de diferentes países, a adoção da lista da OMS foi associada à queda da mortalidade cirúrgica de 1,5% para 0,8% e das complicações de 11% para 7%. Poucas intervenções tão simples tiveram impacto tão grande.' } },
    { t: 'Momento 1: antes da anestesia', p: 'Com o paciente ainda acordado, a equipe confirma com ele:',
      itens: ['identidade, procedimento, local da cirurgia e consentimento;', 'demarcação do local, quando se aplica;', 'equipamento de anestesia checado e oxímetro funcionando;', 'alergias conhecidas, via aérea difícil ou risco de aspiração e risco de grande perda de sangue.'],
      caixa: { tipo: 'pratica', titulo: 'Na prática', texto: 'A demarcação do local é feita pelo cirurgião responsável, com o paciente acordado participando, sempre que houver lateralidade (direito/esquerdo), estruturas múltiplas (dedos) ou níveis (coluna). A marca precisa continuar visível depois da antissepsia.' } },
    { t: 'Momento 2: a pausa antes da incisão', p: [
      'Antes do bisturi tocar a pele, todos param. Cada um se apresenta pelo nome e pela função, e a equipe confirma em voz alta: paciente, procedimento e local. Confirma também se o antibiótico profilático foi feito nos últimos 60 minutos (quando indicado) e se os exames de imagem estão disponíveis.',
      'Cirurgião, anestesista e enfermagem comentam os pontos críticos previstos: tempo estimado, perda de sangue esperada, cuidados especiais. São dois minutos que alinham a equipe inteira.' ],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Por que se apresentar pelo nome faz diferença? Estudos de trabalho em equipe mostram que quem foi chamado pelo nome no início se sente mais à vontade para falar quando percebe um problema durante o procedimento.' } },
    { t: 'Momento 3: antes de sair da sala', p: 'Antes de o paciente deixar a sala, a equipe confirma:',
      itens: ['qual procedimento foi realizado e registrado;', 'contagem de compressas, instrumentais e agulhas conferida;', 'amostras e peças identificadas com o nome do paciente, lidas em voz alta;', 'problemas com equipamentos e cuidados para a recuperação.'] },
    { t: 'Todo mundo pode parar a cirurgia', p: [
      'Um dos pontos mais importantes da cirurgia segura é cultural: qualquer membro da equipe, do residente ao técnico de enfermagem, pode e deve interromper o processo diante de uma dúvida.',
      'Interromper não é desrespeito à hierarquia. É exatamente o que a lista espera que aconteça. Um profissional conduz a verificação e tem autoridade para pausar até que tudo esteja esclarecido.' ],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Na pausa antes da incisão, a circulante percebe que a demarcação está no joelho direito, mas o termo de consentimento diz esquerdo. Ela é a pessoa menos experiente da sala. Fala ou fica quieta? Na cirurgia segura, a resposta é sempre: fala. E a equipe agradece.' } },
    { t: 'O paciente também se prepara', p: 'Oriente o paciente a seguir o jejum, retirar joias, piercings e próteses móveis, informar alergias e medicamentos em uso (principalmente anticoagulantes) e a participar das confirmações. Explique que responder várias vezes as mesmas perguntas não é desorganização: é segurança.' },
    { t: 'Notifique', p: 'Falhas na aplicação da lista, quase erros (como uma demarcação divergente percebida a tempo) e eventos no centro cirúrgico devem ser notificados ao Núcleo de Segurança do Paciente. É assim que o processo melhora.' }
  ],
  resumo: ['Três momentos: antes da anestesia, antes da incisão e antes de sair da sala.', 'Confirme paciente, procedimento e local com o paciente acordado.', 'Demarcação pelo cirurgião, com o paciente, quando há lateralidade ou níveis.', 'Antibiótico profilático nos 60 minutos antes da incisão, quando indicado.', 'Contagem de compressas, instrumentais e agulhas antes de sair.', 'Amostras identificadas e lidas em voz alta.', 'Qualquer um pode parar diante de uma dúvida.']
},
comunicacao: {
  abertura: [
    'Olá! Pense numa brincadeira de telefone sem fio: uma frase passa de pessoa em pessoa e chega ao final completamente diferente. No hospital, a informação também passa por muitas mãos: na troca de plantão, na transferência, na ligação do laboratório, na orientação de alta. Só que aqui o “telefone sem fio” pode custar caro.',
    'A comunicação efetiva é a Meta 2 de segurança do paciente. Vamos ver ferramentas simples que tornam a mensagem clara do começo ao fim.' ],
  secoes: [
    { t: 'Por que comunicar bem é segurança', p: [
      'Quando se investigam eventos adversos graves, as falhas de comunicação aparecem entre as causas mais frequentes: uma informação que não foi passada, um resultado que não chegou a quem precisava, uma ordem mal entendida.',
      'O problema raramente é falta de vontade. É pressa, interrupção, ruído, hierarquia e o famoso “eu achei que você sabia”.' ],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Lembre da última passagem de plantão que você recebeu. Saiu dela sabendo exatamente quais pacientes precisavam de atenção primeiro e por quê? Se não, que informação faltou?' } },
    { t: 'SBAR: a passagem de plantão organizada', p: [
      'O SBAR organiza a conversa em quatro partes: Situação (o que está acontecendo agora), Breve histórico (o contexto que importa), Avaliação (o que você acha que está acontecendo) e Recomendação (o que precisa ser feito).',
      'Prefira passar o plantão à beira do leito, quando possível, e num momento com o mínimo de interrupções. Inclua pendências, riscos (queda, LPP, alergias) e cuidados programados.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'O SBAR nasceu na Marinha dos Estados Unidos, nos submarinos nucleares, onde informações precisavam ser passadas de forma rápida e sem ambiguidade. Depois foi adaptado para a saúde e hoje é usado em hospitais do mundo inteiro.' } },
    { t: 'Ordens verbais e por telefone: leia de volta', p: [
      'Ordem verbal ou por telefone só deve acontecer quando não há alternativa, como numa emergência ou durante um procedimento estéril. Quem recebe escreve, lê de volta em voz alta e só executa depois da confirmação. Depois, a ordem é registrada no prontuário.',
      'Essa técnica, chamada de leitura de volta, também vem da aviação: o piloto repete as instruções da torre para garantir que entendeu certo.' ],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: '— Faz furosemida, 40 de 8 em 8. — Confirmando: furosemida 40 mg, endovenosa, de 8 em 8 horas? — Isso, mas é 20 mg, não 40. Sem a leitura de volta, o erro teria passado. Com ela, foi corrigido em três segundos.' } },
    { t: 'Resultados críticos não podem esperar', p: 'Quando o laboratório ou a imagem liga com um resultado crítico, a informação vai imediatamente para o profissional responsável pelo paciente. Quem recebe repete o resultado para confirmar e registra o horário e o nome de quem foi comunicado. Resultado crítico anotado num papel no balcão, esperando a visita do dia seguinte, é uma bomba-relógio.' },
    { t: 'Transferências e registros', p: [
      'Toda transição de cuidado (do pronto-socorro para a enfermaria, da UTI para o quarto, de um hospital para outro) é um momento de alto risco para perder informação. Passe as informações verbalmente e por escrito, de forma estruturada, para a equipe que recebe.',
      'No prontuário, escreva de forma legível, com data, hora e identificação, e evite abreviaturas não padronizadas. O que é óbvio para você pode ser lido de outro jeito pelo colega.' ] },
    { t: 'Com o paciente e a família', p: [
      'Use palavras simples e confirme se a pessoa entendeu. Em vez de perguntar “Entendeu?” (a resposta quase sempre é sim), peça: “Pode me contar como vai tomar esse remédio em casa?”. Essa técnica se chama teach-back, ou ensino de volta.',
      'Quando acontece um evento adverso, a Política Nacional de Qualidade e Segurança do Paciente (2026) reforça a comunicação aberta e transparente com o paciente e a família: o que aconteceu, o que foi feito e o que muda para não se repetir.' ],
      caixa: { tipo: 'pratica', titulo: 'Fale se perceber risco', texto: 'Percebeu algo errado? Fale na hora, com respeito, mesmo diante de alguém mais experiente. Uma frase ajuda: “Estou preocupado com…”. Cultura de segurança é aquela em que todos se sentem à vontade para alertar.' } }
  ],
  resumo: ['Passagem de plantão estruturada (SBAR), com pendências e riscos.', 'Ordem verbal só quando necessário: escreva, leia de volta, confirme e registre.', 'Resultado crítico: comunique na hora e registre quem recebeu e quando.', 'Transferência: informação verbal e escrita, estruturada.', 'Prontuário legível, sem abreviaturas não padronizadas.', 'Teach-back com o paciente; comunicação transparente após eventos adversos.', 'Percebeu risco? Fale.']
},
ccih: {
  abertura: [
    'Olá! Se eu tivesse que escolher uma única medida para proteger os pacientes contra infecções no hospital, seria esta: higienizar as mãos. Simples, barata, rápida e, ainda assim, uma das mais esquecidas.',
    'Nossas mãos tocam pacientes, bombas de infusão, grades da cama, prontuários e celulares. Sem perceber, viram um meio de transporte para microrganismos. Vamos conversar sobre como interromper essa viagem.' ],
  secoes: [
    { t: 'Uma história que mudou a medicina', p: [
      'Em 1847, em Viena, o médico húngaro Ignaz Semmelweis percebeu que as mães atendidas por médicos que vinham direto da sala de autópsia morriam muito mais de febre puerperal do que as atendidas por parteiras. Ele passou a exigir que todos lavassem as mãos com solução clorada antes de examinar as gestantes, e a mortalidade caiu de forma impressionante.',
      'Curiosamente, Semmelweis foi ridicularizado pelos colegas na época. Só anos depois, com as descobertas de Pasteur e Lister sobre os germes, a medicina deu razão a ele.' ],
      caixa: { tipo: 'sabia', titulo: 'Você sabia?', texto: 'O Dia Mundial da Higiene das Mãos é celebrado em 5 de maio. A data foi escolhida pela OMS de propósito: 5 do mês 5, lembrando os cinco dedos de cada mão e os cinco momentos da higiene.' } },
    { t: 'Os cinco momentos', p: 'A OMS resumiu quando higienizar as mãos em cinco momentos, todos ligados ao paciente e ao espaço ao redor dele:',
      itens: ['1. Antes de tocar o paciente.', '2. Antes de realizar procedimento limpo ou asséptico.', '3. Após risco de exposição a fluidos corporais.', '4. Após tocar o paciente.', '5. Após tocar superfícies próximas ao paciente.'],
      caixa: { tipo: 'cena', titulo: 'Imagine a cena', texto: 'Você entra no quarto para ajustar a bomba de infusão. Não toca no paciente, só aperta os botões e arruma o equipo. Precisa higienizar as mãos ao sair? Sim: é o quinto momento. A bomba, a grade e a mesa de cabeceira estão contaminadas com os microrganismos daquele paciente.' } },
    { t: 'Álcool ou água e sabonete?', p: [
      'Na maior parte das vezes, a preparação alcoólica é a melhor escolha: é rápida (20 a 30 segundos), fica ao lado do leito e agride menos a pele. Friccione até secar.',
      'Água e sabonete entram quando as mãos estão visivelmente sujas ou com sangue e outros fluidos, depois de usar o banheiro e em situações específicas orientadas pelo SCIH, como diarreia por Clostridioides difficile, contra a qual o álcool não é eficaz. A lavagem completa leva de 40 a 60 segundos.' ],
      caixa: { tipo: 'pense', titulo: 'Pare e pense', texto: 'Cantar mentalmente “Parabéns pra você” duas vezes leva cerca de 20 segundos. Experimente medir quanto tempo você realmente gasta higienizando as mãos num plantão corrido.' } },
    { t: 'A técnica: onde a gente esquece', p: [
      'Não basta molhar as mãos com álcool: é preciso friccionar todas as áreas. Palma com palma, dorso das mãos, entre os dedos, polegares, pontas dos dedos e unhas, e punhos.',
      'Os polegares e as pontas dos dedos são as áreas mais esquecidas, justamente as que mais tocam o paciente e os objetos.' ],
      caixa: { tipo: 'atencao', titulo: 'Atenção', texto: 'Luvas não substituem a higiene das mãos. Higienize antes de calçar e logo depois de retirar: as luvas podem ter microfuros e as mãos se contaminam no momento da retirada.' } },
    { t: 'Unhas, anéis e relógio', p: 'Durante a assistência, mantenha as unhas curtas e naturais (sem unhas artificiais ou esmalte descascado) e retire anéis, pulseiras e relógio. Adornos acumulam microrganismos e impedem a fricção adequada; a NR 32 proíbe o uso de adornos por profissionais expostos a agentes biológicos.' },
    { t: 'Todos participam', p: [
      'Pacientes, acompanhantes e visitantes também higienizam as mãos ao entrar e sair do quarto, antes das refeições e depois do banheiro. E podem pedir ao profissional que higienize as suas. Quando um paciente faz esse pedido, a resposta certa é “obrigado por lembrar”.',
      'Dúvidas sobre precauções, isolamento e uso de equipamentos de proteção: procure o Serviço de Controle de Infecção Hospitalar (SCIH).' ] }
  ],
  resumo: ['Higiene das mãos é a principal medida contra infecções hospitalares.', 'Cinco momentos: antes do paciente, antes de procedimento limpo, após fluidos, após o paciente, após o entorno.', 'Álcool: 20 a 30 segundos, até secar.', 'Água e sabonete: 40 a 60 segundos, quando houver sujeira visível ou fluidos.', 'Atenção a polegares e pontas dos dedos.', 'Luvas não substituem a higiene.', 'Sem adornos, unhas curtas e naturais.']
}
};
(window.CAPACITACAO_MODULOS || []).forEach(function (m) {
  var a = window.CAPACITACAO_APOSTILAS[m.id];
  if (a) { m.abertura = a.abertura; m.apostila = a.secoes; m.resumo = a.resumo; }
});
