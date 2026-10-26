// O cérebro da Dri: Claude + ferramentas que leem os imóveis e a agenda da conta.
import Anthropic from "@anthropic-ai/sdk";
import { horariosLivres, descreverHorario, descreverAgora, local } from "./agenda.js";
import { notificarCorretor } from "./notificar.js";

const MAX_VOLTAS = 8;              // chamadas de ferramenta por mensagem do cliente
const HISTORICO_MAX = 80;          // mensagens da API guardadas por conversa
const HISTORICO_MANTER = 30;       // quantas sobram quando o histórico é encurtado

const brl = (v) => v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// ------------------------------------------------------------------ prompt
// Fica igual em toda a conversa (o cache da API depende disso). Data e hora vão em cada mensagem.
export function promptSistema(conta) {
  const quem = conta.tipo === "imobiliaria" ? `a imobiliária ${conta.nome}` : `o corretor ${conta.nome}`;
  return `Você é ${conta.nome_assistente}, assistente virtual que atende pelo WhatsApp para ${quem}${conta.creci ? ` (CRECI ${conta.creci})` : ""}${conta.cidade ? `, em ${conta.cidade}` : ""}.

Seu trabalho: responder rápido quem procura imóvel, entender o que a pessoa quer, apresentar opções da carteira e marcar a visita na agenda real.

Como conduzir a conversa:
- Escreva em português do Brasil, em tom cordial e direto, como uma pessoa no WhatsApp. Mensagens curtas, no máximo uns 3 parágrafos curtos. Pode usar *negrito* do WhatsApp; não use títulos, tabelas nem markdown.
- Se a pessoa já disser o que quer, vá direto às opções. Senão, descubra aos poucos (uma ou duas perguntas por vez): compra ou aluguel, tipo de imóvel, bairro ou região, faixa de valor, número de quartos, e se vai financiar (compra).
- Use buscar_imoveis para achar opções. Apresente no máximo 3 por vez, com o essencial: bairro, quartos, área, vagas e valor. Ofereça fotos (enviar_fotos) e detalhes.
- Só fale de imóveis que vieram das ferramentas. Nunca invente imóvel, valor, característica ou condição. Se não houver nada no perfil, diga com franqueza, sugira ajustar a busca e ofereça avisar o corretor (chamar_corretor) para procurar algo fora da carteira.
- Endereço exato só depois que a visita estiver marcada. Antes disso, fale só o bairro.
- Para marcar visita: consulte horarios_visita, ofereça 2 ou 3 horários, confirme o nome da pessoa e use marcar_visita com o horário exato devolvido pela ferramenta. Depois confirme dia, hora e endereço.
- Para remarcar ou cancelar, use visitas_do_cliente e cancelar_visita, depois marque o novo horário.
- Guarde o que a pessoa procura com salvar_perfil_cliente assim que souber (ajuda o corretor).
- Chame o corretor (chamar_corretor) quando a pessoa pedir para falar com uma pessoa, quiser fazer proposta ou negociar valor, perguntar de documentação, contrato, financiamento em detalhe, avaliação do imóvel dela, ou qualquer coisa que você não saiba responder com certeza. Avise a pessoa que o corretor vai continuar o atendimento.
- Não prometa desconto, não dê opinião jurídica e não peça dados sensíveis (CPF, renda exata, documentos).
- Se a mensagem trouxer áudio, vídeo ou figurinha que você não consegue ver, peça gentilmente para escrever.
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
        palavra_chave: { type: "string", description: "Procura no título, descrição e características (ex.: varanda, piscina, pet)" },
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
    name: "horarios_visita",
    description: "Horários livres para visitar um imóvel, já descontando a agenda do corretor.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["imovel_id"],
      properties: {
        imovel_id: { type: "string" },
        a_partir_de: { type: "string", description: "Data AAAA-MM-DD, se a pessoa pediu um dia específico" },
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
        lista = lista.filter((i) => [i.titulo, i.descricao, ...(i.caracteristicas || [])].join(" ").toLowerCase().includes(p));
      }
      return { total_encontrado: lista.length, imoveis: lista.slice(0, 5).map(resumoImovel) };
    }
    case "detalhes_imovel": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      const { endereco, fotos, conta_id, criado_em, atualizado_em, ativo, ...resto } = i;
      return {
        ...resto, preco: brl(i.preco), condominio: brl(i.condominio), iptu: brl(i.iptu),
        quantidade_fotos: (fotos || []).length,
      };
    }
    case "enviar_fotos": {
      const i = await imovelDaConta(ctx, input.imovel_id);
      const fotos = (i.fotos || []).slice(0, Math.min(Math.max(input.quantidade || 3, 1), 5));
      if (!fotos.length) return { enviadas: 0, aviso: "Este imóvel ainda não tem fotos cadastradas." };
      for (const [n, url] of fotos.entries()) await ctx.enviarFoto(url, n === 0 ? i.titulo : null);
      return { enviadas: fotos.length, total_disponivel: i.fotos.length };
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
      const livres = horariosLivres({
        disponibilidades: disp.data, ocupados: [...vis.data, ...bloq.data], imovelId: input.imovel_id,
        agora, dataInicio: input.a_partir_de || null, dias: Math.min(input.dias || 7, 30),
        duracaoMin: conta.duracao_visita_min, antecedenciaHoras: conta.antecedencia_min_horas, limite: 12,
      });
      return {
        duracao_minutos: conta.duracao_visita_min,
        horarios: livres.map((d) => ({ inicio: d.toISOString(), descricao: descreverHorario(d) })),
        ...(livres.length ? {} : { aviso: "Nenhum horário livre nesse período. Tente outros dias ou chame o corretor." }),
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
const temThinking = (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "thinking" || b.type === "redacted_thinking");
const semThinking = (m) => Array.isArray(m.content)
  ? { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }
  : m;
const ehTextoDoCliente = (m) => m.role === "user" &&
  (typeof m.content === "string" || (Array.isArray(m.content) && m.content.every((b) => b.type === "text")));

// Encurta conversas longas mantendo o final. As mensagens mantidas perdem os blocos
// de raciocínio (thinking), porque eles valem só com o histórico completo.
export function encurtarHistorico(msgs, perfil) {
  if (msgs.length <= HISTORICO_MAX) return msgs;
  let corte = msgs.length - HISTORICO_MANTER;
  while (corte < msgs.length && !ehTextoDoCliente(msgs[corte])) corte++;
  if (corte >= msgs.length) return msgs;
  const resto = msgs.slice(corte).map(semThinking);
  const primeira = resto[0];
  const texto = typeof primeira.content === "string" ? primeira.content : primeira.content.map((b) => b.text).join("\n");
  resto[0] = { role: "user", content: `[Conversa anterior encurtada.${perfil ? ` O que já se sabe da pessoa: ${perfil}` : ""}]\n\n${texto}` };
  return resto;
}

// ------------------------------------------------------------------ uma rodada
/**
 * Processa as mensagens novas do cliente e devolve o que a Dri respondeu.
 * ctx: { env, db, conta, telefone, nome, canal: 'whatsapp'|'simulador', agora, enviarFoto(url, legenda) }
 */
export async function responder(ctx, textosDoCliente) {
  const { env, db, conta } = ctx;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let { data: conversa } = await db.from("conversas").select("*")
    .eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();
  if (!conversa) {
    const r = await db.from("conversas").insert({ conta_id: conta.id, telefone: ctx.telefone, nome: ctx.nome }).select().single();
    if (r.error) throw new Error(r.error.message);
    conversa = r.data;
  }
  const { data: lead } = await db.from("leads").select("perfil").eq("conta_id", conta.id).eq("telefone", ctx.telefone).maybeSingle();

  const cabecalho = `[${descreverAgora(ctx.agora)}, horário de Brasília${ctx.nome && !conversa.mensagens.length ? ` · nome no WhatsApp: ${ctx.nome}` : ""}]`;
  let mensagens = encurtarHistorico(conversa.mensagens, lead?.perfil);
  mensagens.push({ role: "user", content: `${cabecalho}\n${textosDoCliente.join("\n")}` });

  const pedido = (msgs) => client.beta.messages.create({
    model: env.MODELO || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: env.ESFORCO || "low" },
    cache_control: { type: "ephemeral" },
    system: promptSistema(conta),
    tools: FERRAMENTAS,
    messages: msgs,
  });

  let respostaFinal = "";
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    let resposta;
    try {
      resposta = await pedido(mensagens);
    } catch (e) {
      // Se o prompt mudou (ex.: o corretor editou a apresentação), os blocos de raciocínio
      // antigos deixam de valer. Recuperação: tira esses blocos e tenta uma vez.
      if (e instanceof Anthropic.BadRequestError && mensagens.some(temThinking)) {
        mensagens = mensagens.map(semThinking);
        resposta = await pedido(mensagens);
      } else throw e;
    }
    mensagens.push({ role: "assistant", content: resposta.content });

    if (resposta.stop_reason === "refusal") {
      respostaFinal = "Desculpe, não consigo ajudar com isso por aqui. Vou pedir para o corretor falar com você.";
      await executar("chamar_corretor", { motivo: "A assistente não pôde responder a última mensagem." }, ctx);
      break;
    }
    if (resposta.stop_reason === "pause_turn") continue;

    const usos = resposta.content.filter((b) => b.type === "tool_use");
    const texto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!usos.length) { respostaFinal = texto; break; }

    const resultados = [];
    for (const uso of usos) {
      try {
        const r = await executar(uso.name, uso.input || {}, ctx);
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(r) });
      } catch (e) {
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: String(e.message || e), is_error: true });
      }
    }
    mensagens.push({ role: "user", content: resultados });
    if (volta === MAX_VOLTAS - 1) respostaFinal = texto || "Só um instante, vou confirmar isso com o corretor.";
  }
  // O histórico precisa terminar com a resposta da Dri; se parou no meio, fecha a rodada
  if (mensagens[mensagens.length - 1].role !== "assistant")
    mensagens.push({ role: "assistant", content: [{ type: "text", text: respostaFinal || "…" }] });

  const agoraIso = ctx.agora.toISOString();
  const transcricao = [...(conversa.transcricao || []),
    ...textosDoCliente.map((t) => ({ de: "cliente", texto: t, em: agoraIso })),
    ...(respostaFinal ? [{ de: "dri", texto: respostaFinal, em: new Date().toISOString() }] : []),
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
