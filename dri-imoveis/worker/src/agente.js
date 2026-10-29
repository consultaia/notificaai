// O cérebro da Dri: IA (gratuita, com troca automática) + ferramentas que leem os imóveis e a agenda da conta.
import { perguntar, guardarResposta } from "./ia.js";
import { horariosLivres, descreverHorario, descreverAgora, local } from "./agenda.js";

const COTA_PADRAO = 1500; // mensagens de cliente respondidas pela Claude por mês (≈ 150 conversas)
export const cotaDa = (conta, env) => conta.cota_ia_mensal ?? (Number(env.IA_COTA_MENSAL) || COTA_PADRAO);
export const mesDe = (data) => { const l = local(data); return `${l.ano}-${String(l.mes).padStart(2, "0")}`; };
import { notificarCorretor } from "./notificar.js";
import { generoDa } from "./genero.js";

const MAX_VOLTAS = 8;              // chamadas de ferramenta por mensagem do cliente
const HISTORICO_MAX = 80;          // mensagens da API guardadas por conversa
const HISTORICO_MANTER = 30;       // quantas sobram quando o histórico é encurtado

const brl = (v) => v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// ------------------------------------------------------------------ prompt
// Data e hora vão em cada mensagem do cliente, não aqui.
export function promptSistema(conta) {
  const g = generoDa(conta);
  const quem = conta.tipo === "imobiliaria"
    ? (/^imobili[aá]ria\b/i.test(conta.nome) ? `a ${conta.nome}` : `a imobiliária ${conta.nome}`)
    : (/^corretor(a)?\b/i.test(conta.nome) ? conta.nome : `o corretor ${conta.nome}`);
  return `Você é ${conta.nome_assistente}, assistente virtual que atende pelo WhatsApp para ${quem}${conta.creci ? ` (CRECI ${conta.creci})` : ""}${conta.cidade ? `, em ${conta.cidade}` : ""}.

Seu trabalho: receber bem quem procura imóvel, entender o que a pessoa quer, apresentar opções da carteira e marcar a visita na agenda real.

Seu jeito de falar (isto importa muito):
- Converse como ${g.uma} ${g.x === "o" ? "corretor simpático e atencioso" : "corretora simpática e atenciosa"} conversaria no WhatsApp com alguém que acabou de chegar: calorosa, leve e natural, nunca robótica nem "de formulário". Português do Brasil do dia a dia ("a gente", "tá", "pra" cabem bem), sem gírias forçadas.
- Comece se apresentando com simpatia na primeira mensagem e chame a pessoa pelo nome quando souber (sem repetir o nome em toda mensagem).
- Reaja ao que a pessoa contou antes de seguir: se ela vai casar, está esperando bebê, mudando de cidade ou procurando mais espaço para a família, comente isso com interesse genuíno e use isso para recomendar ("com criança pequena, o playground e a portaria 24h ajudam bastante").
- Se a pessoa não respondeu uma pergunta, não repita a mesma pergunta na mensagem seguinte: siga a conversa e retome só mais tarde, se fizer falta.
- Faça uma pergunta por vez e explique por que pergunta quando ajudar ("pra eu já te mostrar o que cabe no bolso, você pensa em financiar?").
- Apresente imóveis como quem conta uma novidade, destacando o que combina com o que a pessoa disse, e não como uma ficha técnica. Lista com marcadores só quando forem 2 ou 3 opções lado a lado; mesmo assim, uma linha curta por opção e um comentário seu antes ou depois.
- Use emoji com moderação (no máximo um por mensagem, e nem toda mensagem precisa).
- Quando a resposta tiver partes diferentes (por exemplo: um comentário, depois as opções, depois uma pergunta), mande como mensagens separadas, como uma pessoa faz no WhatsApp: escreva uma linha contendo só --- entre uma mensagem e outra. No máximo 3 mensagens por vez; cada uma com 1 a 4 linhas.
- Nunca diga que é uma inteligência artificial sem que perguntem. Se perguntarem, diga com naturalidade que é ${g.a} assistente virtual do ${conta.tipo === "imobiliaria" ? "escritório" : "corretor"} e que ele pode entrar na conversa quando a pessoa quiser.
- Pode usar *negrito* do WhatsApp para nomes de imóveis e valores; não use títulos, tabelas nem markdown.
- Ao falar de você, use o ${g.x === "o" ? "masculino (obrigado, animado, pronto para ajudar)" : "feminino (obrigada, animada, pronta para ajudar)"}.

Como conduzir:
- Se a pessoa já disser o que quer, mostre opções logo. Senão, descubra aos poucos, conversando: compra ou aluguel, tipo de imóvel, bairro ou região, faixa de valor, número de quartos, e se vai financiar (compra).
- Use buscar_imoveis para achar opções. Apresente no máximo 3 por vez, com o essencial: bairro, quartos, área, vagas e valor. Ofereça fotos (enviar_fotos) e detalhes.
- Só fale de imóveis que vieram das ferramentas. Nunca invente imóvel, valor, característica ou condição. Se não houver nada no perfil, diga com franqueza, sugira ajustar a busca e ofereça avisar o corretor (chamar_corretor) para procurar algo fora da carteira.
- Endereço exato só depois que a visita estiver marcada. Antes disso, fale só o bairro.
- Lançamentos e imóveis na planta vêm agrupados por empreendimento: apresente o empreendimento e as plantas disponíveis. Se houver book, ofereça mandar (enviar_book). Se não houver preço cadastrado, diga que o corretor passa a tabela atualizada e as condições, e use chamar_corretor se a pessoa quiser os valores.
- Para marcar visita: consulte horarios_visita, ofereça 2 ou 3 horários, confirme o nome da pessoa e use marcar_visita com o horário exato devolvido pela ferramenta. Depois confirme dia, hora e endereço.
- Para remarcar: primeiro confira se o horário novo está livre (horarios_visita com 'horario' e 'a_partir_de'), marque o novo com marcar_visita e só depois cancele o antigo (visitas_do_cliente e cancelar_visita). Nunca cancele a visita antiga antes de garantir a nova. Para só cancelar, use visitas_do_cliente e cancelar_visita.
- Quando a pessoa pedir um dia e hora específicos, consulte horarios_visita com 'a_partir_de' e 'horario'.
- Guarde o que a pessoa procura com salvar_perfil_cliente assim que souber (ajuda o corretor).
- Novidades: uma vez por conversa, num momento natural (depois de ajudar, ao se despedir ou quando não houver imóvel que sirva agora), pergunte se a pessoa quer receber novidades e lançamentos por aqui. Registre a resposta com registrar_novidades. Não insista se ela disser não, e não pergunte de novo se o cabeçalho disser que ela já respondeu. Se a pessoa pedir para não receber mais mensagens, registre "não" e confirme com gentileza.

Quando a pessoa quer vender ou alugar o imóvel DELA (proprietário):
- Isso é ótimo para o corretor: receba com entusiasmo e explique que você vai anotar algumas informações para o ${conta.tipo === "imobiliaria" ? "corretor" : conta.nome.split(" ")[0]} avaliar e entrar em contato.
- Chame salvar_captacao assim que entender que é um proprietário, e de novo a cada informação nova (só os campos novos).
- Colha aos poucos, conversando, uma ou duas perguntas por vez: vender ou alugar; tipo de imóvel; bairro (endereço completo só se a pessoa quiser passar); quartos, suítes, vagas e área aproximada; valor que ela pensa em pedir (se não souber, diga que o corretor ajuda a definir o valor certo); condomínio e IPTU se souber; se está desocupado, se mora lá ou se está alugado; o que o imóvel tem de especial; e o melhor dia e horário para o corretor ligar ou visitar.
- Peça fotos com naturalidade ("se tiver fotos, pode mandar aqui mesmo que eu já deixo separado pro corretor"). Fotos que chegam ficam guardadas automaticamente; você não consegue vê-las, então só agradeça.
- Não peça documentos, CPF nem dados bancários. Não prometa valor de venda, prazo nem comissão: isso o corretor conversa com a pessoa.
- Quando tiver o essencial (finalidade, tipo, bairro, tamanho e um contato/horário), chame salvar_captacao com finalizar: true, agradeça e diga que o corretor vai entrar em contato. Se a pessoa também procura outro imóvel para ela, siga ajudando normalmente.
- Chame o corretor (chamar_corretor) quando a pessoa pedir para falar com uma pessoa, quiser fazer proposta ou negociar valor, perguntar de documentação, contrato, financiamento em detalhe, avaliação do imóvel dela, ou qualquer coisa que você não saiba responder com certeza. Avise a pessoa que o corretor vai continuar o atendimento.
- Não prometa desconto, não dê opinião jurídica e não peça dados sensíveis (CPF, renda exata, documentos).
- Áudios do cliente chegam transcritos, marcados como "[Áudio do cliente, transcrito]": responda normalmente; se a transcrição parecer sem sentido, peça para repetir. Se vier vídeo, figurinha ou áudio que não deu para transcrever, peça gentilmente para escrever.
${conta.apresentacao ? `\nInformações do ${conta.tipo === "imobiliaria" ? "escritório" : "corretor"} (siga estas orientações):\n${conta.apresentacao}\n` : ""}`;
}

// ------------------------------------------------------------------ ferramentas
const FERRAMENTAS = [
  {
    name: "buscar_imoveis",
    description: "Procura imóveis ativos da carteira. Todos os filtros são opcionais; combine os que a pessoa informou. Devolve até 5 imóveis, do mais barato ao mais caro.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        finalidade: { type: "string", enum: ["venda", "aluguel"] },
        tipo: { type: "string", description: "apartamento, casa, studio, cobertura, terreno, sala comercial…" },
        bairro: { type: "string", description: "Bairro ou parte do nome" },
        cidade: { type: "string" },
        preco_min: { type: "number" },
        preco_max: { type: "number" },
        quartos_min: { type: "integer" },
        vagas_min: { type: "integer" },
        palavra_chave: { type: "string", description: "Procura no título, empreendimento, descrição e características (ex.: varanda, piscina, pet, nome do empreendimento)" },
      },
    },
  },
  {
    name: "detalhes_imovel",
    description: "Todos os detalhes de um imóvel (menos o endereço exato).",
    input_schema: { type: "object", additionalProperties: false, required: ["imovel_id"], properties: { imovel_id: { type: "string" } } },
  },
  {
    name: "enviar_fotos",
    description: "Envia fotos do imóvel para a pessoa no WhatsApp, antes da sua próxima mensagem.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["imovel_id"],
      properties: { imovel_id: { type: "string" }, quantidade: { type: "integer", description: "1 a 5, padrão 3" } },
    },
  },
  {
    name: "enviar_book",
    description: "Envia o book (PDF de apresentação) do empreendimento para a pessoa no WhatsApp.",
    input_schema: { type: "object", additionalProperties: false, required: ["imovel_id"], properties: { imovel_id: { type: "string" } } },
  },
  {
    name: "horarios_visita",
    description: "Horários livres para visitar um imóvel, já descontando a agenda do corretor.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["imovel_id"],
      properties: {
        imovel_id: { type: "string" },
        a_partir_de: { type: "string", description: "Data AAAA-MM-DD, se a pessoa pediu um dia específico" },
        horario: { type: "string", description: "HH:MM, se a pessoa pediu um horário específico (use junto com a_partir_de). Diz se está livre e sugere os mais próximos." },
        dias: { type: "integer", description: "Quantos dias olhar, padrão 7" },
      },
    },
  },
  {
    name: "marcar_visita",
    description: "Marca a visita. Use exatamente um 'inicio' devolvido por horarios_visita.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["imovel_id", "inicio", "nome_cliente"],
      properties: {
        imovel_id: { type: "string" },
        inicio: { type: "string", description: "ISO 8601, como veio de horarios_visita" },
        nome_cliente: { type: "string" },
        observacoes: { type: "string", description: "Algo útil para o corretor (ex.: vai com a esposa, quer ver a garagem)" },
      },
    },
  },
  {
    name: "visitas_do_cliente",
    description: "Visitas futuras desta pessoa.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "cancelar_visita",
    description: "Cancela uma visita desta pessoa (use visitas_do_cliente para achar o id).",
    input_schema: { type: "object", additionalProperties: false, required: ["visita_id"], properties: { visita_id: { type: "string" } } },
  },
  {
    name: "salvar_perfil_cliente",
    description: "Guarda o nome e o que a pessoa procura, para o corretor ver no painel.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["perfil"],
      properties: {
        nome: { type: "string" },
        perfil: { type: "string", description: "Resumo curto: finalidade, tipo, região, faixa de valor, quartos, financiamento, prazo" },
      },
    },
  },
  {
    name: "salvar_captacao",
    description: "Guarda os dados de um proprietário que quer vender ou alugar o imóvel dele com o corretor. Chame logo que identificar e a cada informação nova (só os campos novos). Use finalizar: true quando tiver o essencial; o corretor é avisado.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        nome: { type: "string" },
        finalidade: { type: "string", enum: ["venda", "aluguel", "venda ou aluguel"] },
        tipo: { type: "string", description: "apartamento, casa, terreno, sala comercial…" },
        bairro: { type: "string" }, cidade: { type: "string" }, endereco: { type: "string" },
        quartos: { type: "integer" }, suites: { type: "integer" }, banheiros: { type: "integer" }, vagas: { type: "integer" },
        area_m2: { type: "number" },
        valor_pretendido: { type: "number", description: "Valor em reais que a pessoa quer pedir (venda) ou cobrar por mês (aluguel)" },
        condominio: { type: "number" }, iptu: { type: "number" },
        ocupacao: { type: "string", description: "desocupado, mora no imóvel, alugado" },
        caracteristicas: { type: "array", items: { type: "string" } },
        observacoes: { type: "string", description: "Outras informações úteis (reforma, urgência, motivo da venda…)" },
        melhor_horario: { type: "string", description: "Quando o corretor pode ligar ou visitar" },
        finalizar: { type: "boolean", description: "true quando já tiver o essencial; avisa o corretor" },
      },
    },
  },
  {
    name: "registrar_novidades",
    description: "Guarda se a pessoa aceita receber novidades e lançamentos do corretor por WhatsApp (campanhas). Só registre o que a pessoa disse claramente.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["aceita"],
      properties: { aceita: { type: "boolean" } },
    },
  },
  {
    name: "chamar_corretor",
    description: "Passa a conversa para o corretor humano e avisa ele.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["motivo"],
      properties: { motivo: { type: "string", description: "Por que precisa do corretor, em uma frase" } },
    },
  },
];

function resumoImovel(i) {
  return {
    id: i.id, codigo: i.codigo, titulo: i.titulo, finalidade: i.finalidade, tipo: i.tipo,
    bairro: i.bairro, cidade: i.cidade, valor: brl(i.preco), condominio: brl(i.condominio),
    quartos: i.quartos, suites: i.suites, vagas: i.vagas, area_m2: i.area_m2,
    fotos: (i.fotos || []).length,
    ...(i.empreendimento ? { empreendimento: i.empreendimento, situacao: i.situacao, previsao_entrega: i.previsao_entrega, programa: i.programa, tem_book: !!i.book_url } : {}),
  };
}

async function executar(nome, input, ctx) {
  const { db, conta } = ctx;
  switch (nome) {
    case "buscar_imoveis": {
      let q = db.from("imoveis").select("*").eq("conta_id", conta.id).eq("ativo", true);
      if (input.finalidade) q = q.eq("finalidade", input.finalidade);
      if (input.tipo) q = q.ilike("tipo", `%${input.tipo}%`);
      if (input.bairro) q = q.ilike("bairro", `%${input.bairro}%`);
      if (input.cidade) q = q.ilike("cidade", `%${input.cidade}%`);
      if (input.preco_min != null) q = q.gte("preco", input.preco_min);
      if (input.preco_max != null) q = q.lte("preco", input.preco_max);
      if (input.quartos_min != null) q = q.gte("quartos", input.quartos_min);
      if (input.vagas_min != null) q = q.gte("vagas", input.vagas_min);
      const { data, error } = await q.order("preco", { ascending: true }).limit(60);
      if (error) throw new Error(error.message);
      let lista = data || [];
      if (input.palavra_chave) {
        const p = input.palavra_chave.toLowerCase();
        lista = lista.filter((i) => [i.titulo, i.empreendimento, i.descricao, ...(i.caracteristicas || [])].join(" ").toLowerCase().includes(p));
      }
      return { total_encontrado: lista.length, imoveis: lista.slice(0, 5).map(resumoImovel) };
    }
    case "detalhes_imovel": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      const { endereco, fotos, conta_id, criado_em, atualizado_em, ativo, book_url, ...resto } = i;
      return {
        ...resto, preco: brl(i.preco) || "sob consulta", condominio: brl(i.condominio), iptu: brl(i.iptu),
        quantidade_fotos: (fotos || []).length, tem_book: !!book_url,
      };
    }
    case "enviar_fotos": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      const fotos = (i.fotos || []).slice(0, Math.min(Math.max(input.quantidade || 3, 1), 5));
      if (!fotos.length) return { enviadas: 0, aviso: "Este imóvel ainda não tem fotos cadastradas." };
      for (const [n, url] of fotos.entries()) await ctx.enviarFoto(url, n === 0 ? i.titulo : null);
      return { enviadas: fotos.length, total_disponivel: i.fotos.length };
    }
    case "enviar_book": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      if (!i.book_url) return { enviado: false, aviso: "Este imóvel não tem book cadastrado." };
      const nome = `${(i.empreendimento || i.titulo).replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 60) || "book"}.pdf`;
      await ctx.enviarArquivo(i.book_url, nome, i.empreendimento || i.titulo);
      return { enviado: true };
    }
    case "horarios_visita": {
      await imovelDaConta(ctx, input.imovel_id);
      const agora = ctx.agora;
      const ate = new Date(agora.getTime() + 40 * 864e5).toISOString();
      const [disp, vis, bloq] = await Promise.all([
        db.from("disponibilidades").select("imovel_id,dia_semana,hora_inicio,hora_fim").eq("conta_id", conta.id),
        db.from("visitas").select("inicio,fim").eq("conta_id", conta.id).eq("status", "marcada").gte("fim", agora.toISOString()).lte("inicio", ate),
        db.from("bloqueios").select("inicio,fim").eq("conta_id", conta.id).gte("fim", agora.toISOString()).lte("inicio", ate),
      ]);
      for (const r of [disp, vis, bloq]) if (r.error) throw new Error(r.error.message);
      if (!(disp.data || []).length)
        return { horarios: [], aviso: "O corretor ainda não cadastrou horários de visita. Ofereça chamar o corretor para combinar." };
      const todos = horariosLivres({
        disponibilidades: disp.data, ocupados: [...vis.data, ...bloq.data], imovelId: input.imovel_id,
        agora, dataInicio: input.a_partir_de || null, dias: Math.min(input.dias || 7, 30),
        duracaoMin: conta.duracao_visita_min, antecedenciaHoras: conta.antecedencia_min_horas, limite: 500,
      });
      const item = (d) => ({ inicio: d.toISOString(), descricao: descreverHorario(d) });
      // Pediu um horário: diz se está livre e, se não, os mais próximos naquele dia (ou nos seguintes)
      const hm = /^(\d{1,2})(?::|h)?(\d{2})?$/.exec(String(input.horario || "").trim());
      if (hm) {
        const alvoMin = Number(hm[1]) * 60 + Number(hm[2] || 0);
        const minDoDia = (d) => { const l = local(d); return l.hora * 60 + l.minuto; };
        const diaDe = (d) => { const l = local(d); return `${l.ano}-${l.mes}-${l.dia}`; };
        const primeiroDia = todos.length ? diaDe(todos[0]) : null;
        const doDia = todos.filter((d) => diaDe(d) === primeiroDia);
        const exato = doDia.find((d) => minDoDia(d) === alvoMin);
        const proximos = [...doDia].sort((a, b) => Math.abs(minDoDia(a) - alvoMin) - Math.abs(minDoDia(b) - alvoMin)).slice(0, 3)
          .sort((a, b) => a - b);
        return {
          duracao_minutos: conta.duracao_visita_min,
          pedido_livre: !!exato,
          ...(exato ? { horario_pedido: item(exato) } : {}),
          alternativas: (exato ? [] : proximos).map(item),
          ...(todos.length ? {} : { aviso: "Nenhum horário livre nesse período. Tente outros dias ou chame o corretor." }),
        };
      }
      // Lista resumida: até 5 dias, até 6 horários por dia espalhados entre manhã e tarde
      const porDia = new Map();
      for (const d of todos) { const l = local(d); const k = `${l.ano}-${l.mes}-${l.dia}`; if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(d); }
      const espalhar = (xs, n) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.round(i * (xs.length - 1) / (n - 1))]));
      const resumo = [...porDia.values()].slice(0, 5).flatMap((xs) => espalhar(xs, 6));
      return {
        duracao_minutos: conta.duracao_visita_min,
        horarios: resumo.map(item),
        observacao: "Lista resumida. Se a pessoa pedir um horário que não está aqui, consulte de novo com 'horario' e 'a_partir_de' antes de dizer que não tem.",
        ...(todos.length ? {} : { aviso: "Nenhum horário livre nesse período. Tente outros dias ou chame o corretor." }),
      };
    }
    case "marcar_visita": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      const inicio = new Date(input.inicio);
      if (isNaN(inicio)) return { erro: "Horário inválido. Consulte horarios_visita de novo." };
      const fim = new Date(inicio.getTime() + conta.duracao_visita_min * 60_000);
      // Confere de novo que o horário segue livre (outra pessoa pode ter pego)
      const l = local(inicio);
      const dataLocal = `${l.ano}-${String(l.mes).padStart(2, "0")}-${String(l.dia).padStart(2, "0")}`;
      const { data: disp } = await db.from("disponibilidades").select("imovel_id,dia_semana,hora_inicio,hora_fim").eq("conta_id", conta.id);
      const valido = horariosLivres({
        disponibilidades: disp || [], ocupados: [], imovelId: i.id, agora: ctx.agora,
        dataInicio: dataLocal, dias: 1, duracaoMin: conta.duracao_visita_min,
        antecedenciaHoras: conta.antecedencia_min_horas, passoMin: 30, limite: 200,
      }).some((d) => d.getTime() === inicio.getTime());
      if (!valido) return { erro: "Esse horário não está na agenda de visitas. Consulte horarios_visita de novo." };
      const lead = await salvarLead(ctx, { nome: input.nome_cliente });
      const { data: visita, error } = await db.from("visitas").insert({
        conta_id: conta.id, imovel_id: i.id, lead_id: lead?.id || null,
        cliente_nome: input.nome_cliente, cliente_telefone: ctx.telefone,
        inicio: inicio.toISOString(), fim: fim.toISOString(),
        status: ctx.canal === "simulador" ? "teste" : "marcada",
        origem: ctx.canal === "simulador" ? "simulador" : "dri",
        observacoes: input.observacoes || null,
      }).select().single();
      if (error) {
        if (error.code === "23P01") return { erro: "Esse horário acabou de ser ocupado. Consulte horarios_visita de novo." };
        throw new Error(error.message);
      }
      if (ctx.canal !== "simulador") await notificarCorretor(ctx, "visita", { visita, imovel: i });
      return {
        ok: true, visita_id: visita.id, quando: descreverHorario(inicio), duracao_minutos: conta.duracao_visita_min,
        imovel: i.titulo, endereco: i.endereco || `${i.bairro || ""} (o corretor envia o endereço exato)`,
        corretor: conta.nome,
      };
    }
    case "visitas_do_cliente": {
      const { data, error } = await db.from("visitas").select("id,inicio,status,imovel_id,imoveis(titulo,bairro)")
        .eq("conta_id", conta.id).eq("cliente_telefone", ctx.telefone)
        .in("status", ["marcada", "teste"]).gte("inicio", ctx.agora.toISOString()).order("inicio");
      if (error) throw new Error(error.message);
      return { visitas: (data || []).map((v) => ({ visita_id: v.id, quando: descreverHorario(new Date(v.inicio)), imovel: v.imoveis?.titulo, bairro: v.imoveis?.bairro })) };
    }
    case "cancelar_visita": {
      const { data, error } = await db.from("visitas").update({ status: "cancelada" })
        .eq("id", input.visita_id).eq("conta_id", conta.id).eq("cliente_telefone", ctx.telefone)
        .in("status", ["marcada", "teste"]).select("id,inicio,imoveis(titulo)");
      if (error) throw new Error(error.message);
      if (!data?.length) return { erro: "Não achei essa visita para esta pessoa." };
      if (ctx.canal !== "simulador") await notificarCorretor(ctx, "cancelamento", { visita: data[0] });
      return { ok: true, cancelada: descreverHorario(new Date(data[0].inicio)) };
    }
    case "salvar_perfil_cliente": {
      await salvarLead(ctx, input);
      return { ok: true };
    }
    case "salvar_captacao": {
      const { finalizar, ...campos } = input;
      const dados = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null && v !== undefined && v !== ""));
      const { data: aberta } = await db.from("captacoes").select("*").eq("conta_id", conta.id).eq("telefone", ctx.telefone)
        .in("status", ["nova", "em contato", "avaliação marcada"]).maybeSingle();
      let cap;
      if (aberta) {
        if (dados.caracteristicas) dados.caracteristicas = [...new Set([...(aberta.caracteristicas || []), ...dados.caracteristicas])];
        const r = await db.from("captacoes").update(dados).eq("id", aberta.id).select().single();
        if (r.error) throw new Error(r.error.message);
        cap = r.data;
      } else {
        // fotos que a pessoa mandou antes de a captação existir
        const { data: conv } = await db.from("conversas").select("midias_recebidas").eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();
        const r = await db.from("captacoes").insert({ conta_id: conta.id, telefone: ctx.telefone, nome: dados.nome || ctx.nome || null, ...dados, fotos: conv?.midias_recebidas || [], status: "nova" }).select().single();
        if (r.error) throw new Error(r.error.message);
        cap = r.data;
      }
      if (finalizar && !cap.completa) {
        await db.from("captacoes").update({ completa: true }).eq("id", cap.id);
        if (ctx.canal !== "simulador") await notificarCorretor(ctx, "captacao", { captacao: cap });
      }
      const faltam = [["finalidade", "vender ou alugar"], ["tipo", "tipo do imóvel"], ["bairro", "bairro"], ["quartos", "quartos"],
        ["area_m2", "área"], ["valor_pretendido", "valor pretendido"], ["melhor_horario", "melhor horário para o corretor"]]
        .filter(([k]) => cap[k] == null || cap[k] === "").map(([, rotulo]) => rotulo);
      return { ok: true, fotos_recebidas: (cap.fotos || []).length, ainda_falta: faltam, corretor_avisado: !!(finalizar || cap.completa) };
    }
    case "registrar_novidades": {
      await db.from("conversas").update({ novidades: input.aceita ? "sim" : "nao", novidades_em: new Date().toISOString() })
        .eq("conta_id", conta.id).eq("telefone", ctx.telefone);
      return { ok: true, aviso: input.aceita ? "Anotado. Agradeça e diga que vai avisar quando tiver novidade." : "Anotado: ela não recebe campanhas." };
    }
    case "chamar_corretor": {
      await db.from("conversas").update({ precisa_corretor: true, motivo: input.motivo })
        .eq("conta_id", conta.id).eq("telefone", ctx.telefone);
      if (ctx.canal !== "simulador") await notificarCorretor(ctx, "chamado", { motivo: input.motivo });
      return { ok: true, aviso: "O corretor foi avisado. Diga à pessoa que ele vai continuar o atendimento por aqui." };
    }
    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

async function imovelDaConta({ db, conta }, id) {
  const { data, error } = await db.from("imoveis").select("*").eq("id", id).eq("conta_id", conta.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Imóvel não encontrado. Use buscar_imoveis para pegar o id certo.");
  return data;
}

async function salvarLead({ db, conta, telefone }, { nome, perfil }) {
  const linha = { conta_id: conta.id, telefone };
  if (nome) linha.nome = nome;
  if (perfil) linha.perfil = perfil;
  const { data } = await db.from("leads").upsert(linha, { onConflict: "conta_id,telefone" }).select().single();
  return data;
}

// ------------------------------------------------------------------ histórico
// Formato das ferramentas no padrão "chat completions". O Gemini recusa additionalProperties.
const semExtras = (o) => {
  if (Array.isArray(o)) return o.map(semExtras);
  if (o && typeof o === "object")
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== "additionalProperties").map(([k, v]) => [k, semExtras(v)]));
  return o;
};
const FERRAMENTAS_IA = FERRAMENTAS.map((f) => ({
  type: "function", function: { name: f.name, description: f.description, parameters: semExtras(f.input_schema) },
}));

// Encurta conversas longas mantendo o final, sempre começando numa mensagem do cliente
export function encurtarHistorico(msgs, perfil) {
  if (msgs.length <= HISTORICO_MAX) return msgs;
  let corte = msgs.length - HISTORICO_MANTER;
  while (corte < msgs.length && !(msgs[corte].role === "user" && typeof msgs[corte].content === "string")) corte++;
  if (corte >= msgs.length) return msgs;
  // as mensagens mantidas perdem o raciocínio guardado da Claude (ele vale só com o histórico completo)
  const resto = msgs.slice(corte).map(({ _claude, ...m }) => m);
  resto[0] = { role: "user", content: `[Conversa anterior encurtada.${perfil ? ` O que já se sabe da pessoa: ${perfil}` : ""}]\n\n${resto[0].content}` };
  return resto;
}

// ------------------------------------------------------------------ uma rodada
/**
 * Processa as mensagens novas do cliente e devolve o que a Dri respondeu.
 * ctx: { env, db, conta, telefone, nome, canal: 'whatsapp'|'simulador', agora, enviarFoto(url, legenda) }
 */
export async function responder(ctx, textosDoCliente) {
  const { env, db, conta } = ctx;

  let { data: conversa } = await db.from("conversas").select("*")
    .eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();
  if (!conversa) {
    const r = await db.from("conversas").insert({ conta_id: conta.id, telefone: ctx.telefone, nome: ctx.nome }).select().single();
    if (r.error) throw new Error(r.error.message);
    conversa = r.data;
  }
  const { data: lead } = await db.from("leads").select("perfil").eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();

  const cabecalho = `[${descreverAgora(ctx.agora)}, horário de Brasília${ctx.nome && !conversa.mensagens.length ? ` · nome no WhatsApp: ${ctx.nome}` : ""}${conversa.novidades ? ` · já respondeu se quer novidades (${conversa.novidades})` : ""}]${ctx.contexto ? `\n${ctx.contexto}` : ""}`;
  const mensagens = encurtarHistorico(conversa.mensagens, lead?.perfil);
  mensagens.push({ role: "user", content: `${cabecalho}\n${textosDoCliente.join("\n")}` });
  const sistema = promptSistema(conta);
  const { data: linhasChaves } = await db.from("ia_chaves").select("provedor,chave").eq("conta_id", conta.id);
  const mes = mesDe(ctx.agora);
  const cota = cotaDa(conta, env);
  const { data: usoMes } = await db.from("ia_uso").select("mensagens").eq("conta_id", conta.id).eq("mes", mes).maybeSingle();
  const iaConta = {
    contaId: conta.id, chaves: Object.fromEntries((linhasChaves || []).map((l) => [l.provedor, l.chave])),
    semClaude: (usoMes?.mensagens || 0) >= cota,
  };
  const usoClaude = { usou: false, entrada: 0, saida: 0 };
  const anotarFalhas = (falhas) => Promise.all(falhas.filter((f) => f.origem === "conta").map((f) =>
    db.from("ia_chaves").update({ ultimo_erro: f.erro.slice(0, 300), ultimo_erro_em: new Date().toISOString() })
      .eq("conta_id", conta.id).eq("provedor", f.nome)));

  let respostaFinal = "";
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    let msg;
    try {
      const r = await perguntar(env, { sistema, mensagens, ferramentas: FERRAMENTAS_IA }, iaConta);
      msg = r.msg;
      if (r.provedor === "claude") {
        usoClaude.usou = true;
        const u = msg._uso || {};
        usoClaude.entrada += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        usoClaude.saida += u.output_tokens || 0;
      }
      if (r.falhas.length) await anotarFalhas(r.falhas);
    } catch (e) {
      await anotarFalhas((e.falhas || []));
      throw e;
    }
    const resposta = guardarResposta(msg);
    mensagens.push(resposta);
    const texto = (resposta.content || "").trim();
    if (!resposta.tool_calls) { respostaFinal = texto; break; }

    for (const chamada of resposta.tool_calls) {
      let conteudo;
      try {
        const r = await executar(chamada.function.name, JSON.parse(chamada.function.arguments || "{}"), ctx);
        conteudo = JSON.stringify(r);
      } catch (e) {
        conteudo = JSON.stringify({ erro: String(e.message || e) });
      }
      mensagens.push({ role: "tool", tool_call_id: chamada.id, content: conteudo });
    }
    if (volta === MAX_VOLTAS - 1) respostaFinal = texto || "Só um instante, vou confirmar isso com o corretor.";
  }
  // O histórico precisa terminar com a resposta da Dri; se parou no meio, fecha a rodada
  if (mensagens[mensagens.length - 1].role !== "assistant" || mensagens[mensagens.length - 1].tool_calls)
    mensagens.push({ role: "assistant", content: respostaFinal || "…" });

  if (usoClaude.usou) await contarCapacidade(ctx, mes, cota, usoClaude);

  const agoraIso = ctx.agora.toISOString();
  const transcricao = [...(conversa.transcricao || []),
    ...textosDoCliente.map((t) => ({ de: "cliente", texto: t, em: agoraIso })),
    ...dividirMensagens(respostaFinal).map((texto) => ({ de: "dri", texto, em: new Date().toISOString() })),
  ].slice(-200);
  const { error } = await db.from("conversas").update({
    mensagens, transcricao, nome: conversa.nome || ctx.nome,
    ultima_cliente_em: agoraIso, atualizado_em: new Date().toISOString(),
  }).eq("id", conversa.id);
  if (error) throw new Error(error.message);
  return respostaFinal;
}

// Corretor assumiu a conversa: a Dri não responde, só registra para o painel
export async function registrarSemResponder(ctx, textosDoCliente) {
  const { db, conta } = ctx;
  const { data: conversa } = await db.from("conversas").select("id,transcricao")
    .eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();
  if (!conversa) return;
  const em = ctx.agora.toISOString();
  await db.from("conversas").update({
    transcricao: [...(conversa.transcricao || []), ...textosDoCliente.map((t) => ({ de: "cliente", texto: t, em }))].slice(-200),
    ultima_cliente_em: em, atualizado_em: em,
  }).eq("id", conversa.id);
}

// Soma a mensagem na capacidade do mês e avisa o corretor em 80% e 100% (uma vez cada)
async function contarCapacidade(ctx, mes, cota, { entrada, saida }) {
  const { db, conta } = ctx;
  const { data: uso, error } = await db.rpc("registrar_uso_ia", {
    p_conta: conta.id, p_mes: mes, p_mensagens: 1, p_entrada: entrada, p_saida: saida,
  });
  if (error || !uso) { console.warn("uso IA", error?.message); return; }
  const nivel = uso.mensagens >= cota ? 100 : uso.mensagens >= cota * 0.8 ? 80 : 0;
  if (!nivel) return;
  const campo = nivel === 100 ? "aviso_100_em" : "aviso_80_em";
  if (uso[campo]) return;
  await db.from("ia_uso").update({ [campo]: new Date().toISOString() }).eq("conta_id", conta.id).eq("mes", mes);
  if (conta.avisar_capacidade === false) return;
  const { data: chaves } = await db.from("ia_chaves").select("provedor").eq("conta_id", conta.id);
  await notificarCorretor(ctx, "capacidade", { nivel, usadas: uso.mensagens, cota, temChavesProprias: (chaves || []).length > 0 });
}

// A Dri pode mandar a resposta em até 3 mensagens, separadas por uma linha só com ---
export function dividirMensagens(texto) {
  return String(texto || "").split(/\n[ \t]*-{3,}[ \t]*\n/).map((t) => t.trim()).filter(Boolean)
    .reduce((acc, t) => (acc.length < 3 ? [...acc, t] : [...acc.slice(0, 2), `${acc[2]}\n\n${t}`]), []);
}
