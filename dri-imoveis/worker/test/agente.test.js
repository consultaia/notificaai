import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";
import { utcDe } from "../src/agenda.js";

// Respostas roteirizadas no formato "chat completions"; guarda os pedidos para conferir
const pedidos = [];
let roteiro = [];
let falhar = {};   // { gemini: 429, groq: 500 } -> esses provedores devolvem erro
const nomeDe = (url) => url.includes("generativelanguage") ? "gemini" : url.includes("groq") ? "groq" : url.includes("cerebras") ? "cerebras" : null;
globalThis.fetch = async (url, init) => {
  const prov = nomeDe(String(url));
  if (!prov) throw new Error("fetch inesperado: " + url);
  const corpo = JSON.parse(init.body);
  const chave = init.headers.authorization.slice(7);
  const erro = falhar[prov] ?? falhar[chave];
  if (erro) return new Response(JSON.stringify({ error: { message: "limite" } }), { status: erro });
  pedidos.push({ ...corpo, prov, chave });
  const passo = roteiro.shift();
  const message = typeof passo === "function" ? passo(corpo) : passo;
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message } }] }), { status: 200 });
};
const { responder } = await import("../src/agente.js");
const { _teste } = await import("../src/ia.js");
const ENV = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", CEREBRAS_API_KEY: "c" };
const chamada = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const usar = (...chamadas) => ({ content: null, tool_calls: chamadas });
const falar = (texto) => ({ content: texto });

const ultimoResultado = (corpo) => JSON.parse(corpo.messages.at(-1).content);

test("conversa completa: busca, horários, marca visita, envia fotos", async () => {
  const db = fakeDb({
    contas: [], imoveis: [
      { id: "i1", conta_id: "c1", ativo: true, titulo: "Apto 3/4 Pituba", finalidade: "venda", tipo: "apartamento", bairro: "Pituba", preco: 650000, quartos: 3, vagas: 2, fotos: ["https://x/1.jpg", "https://x/2.jpg"], endereco: "Rua das Hortênsias, 100", caracteristicas: ["varanda"] },
      { id: "i2", conta_id: "c1", ativo: true, titulo: "Casa Itapuã", finalidade: "venda", tipo: "casa", bairro: "Itapuã", preco: 900000, quartos: 4 },
      { id: "i3", conta_id: "OUTRA", ativo: true, titulo: "De outro corretor", finalidade: "venda", tipo: "apartamento", bairro: "Pituba", preco: 1 },
    ],
    disponibilidades: [{ conta_id: "c1", imovel_id: null, dia_semana: 6, hora_inicio: "09:00:00", hora_fim: "12:00:00" }],
    visitas: [], bloqueios: [], conversas: [], leads: [],
  });
  const conta = { id: "c1", nome: "João Corretor", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2, cidade: "Salvador" };
  const fotos = [];
  const ctx = {
    env: ENV, db, conta, telefone: "5571988887777", nome: "Maria", canal: "whatsapp",
    agora: utcDe(2026, 10, 29, "21:00"), conexao: null, enviarFoto: async (u) => fotos.push(u),
  };
  roteiro = [
    usar(chamada("t1", "buscar_imoveis", { finalidade: "venda", bairro: "pituba", palavra_chave: "varanda" })),
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.total_encontrado, 1);
      assert.equal(r.imoveis[0].id, "i1");
      assert.equal(r.imoveis[0].endereco, undefined, "endereço não pode ir antes da visita");
      return usar(chamada("t2", "enviar_fotos", { imovel_id: "i1", quantidade: 5 }), chamada("t3", "horarios_visita", { imovel_id: "i1" }));
    },
    (corpo) => {
      const resultados = corpo.messages.slice(-2);
      assert.deepEqual(resultados.map((m) => [m.role, m.tool_call_id]), [["tool", "t2"], ["tool", "t3"]]);
      const h = JSON.parse(resultados[1].content);
      assert.equal(h.horarios[0].descricao, "sábado 31/10 às 09:00");
      return usar(chamada("t4", "marcar_visita", { imovel_id: "i1", inicio: h.horarios[0].inicio, nome_cliente: "Maria Souza" }));
    },
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.ok, true);
      assert.equal(r.endereco, "Rua das Hortênsias, 100");
      return falar("Prontinho, Maria! Visita marcada para sábado 31/10 às 9h.");
    },
  ];
  const resposta = await responder(ctx, ["Oi, vi o anúncio de apartamento com varanda na Pituba"]);
  assert.equal(resposta, "Prontinho, Maria! Visita marcada para sábado 31/10 às 9h.");
  assert.deepEqual(fotos, ["https://x/1.jpg", "https://x/2.jpg"]);

  const v = db.tabelas.visitas;
  assert.equal(v.length, 1);
  assert.equal(v[0].status, "marcada");
  assert.equal(v[0].inicio, utcDe(2026, 10, 31, "09:00").toISOString());
  assert.equal(db.tabelas.leads[0].nome, "Maria Souza");

  const pedido = pedidos[0];
  assert.equal(pedido.prov, "gemini");
  assert.equal(pedido.model, "gemini-2.5-flash");
  assert.equal(pedido.messages[0].role, "system");
  assert.match(pedido.messages[1].content, /quinta, 29\/10\/2026 21:00, horário de Brasília · nome no WhatsApp: Maria/);
  assert.ok(!JSON.stringify(pedido.tools).includes("additionalProperties"));

  const conversa = db.tabelas.conversas[0];
  assert.equal(conversa.mensagens.at(-1).role, "assistant");
  assert.deepEqual(conversa.transcricao.map((t) => t.de), ["cliente", "dri"]);

  // Segunda mensagem: histórico continua, sem repetir o nome no cabeçalho
  pedidos.length = 0;
  roteiro = [falar("Até sábado!")];
  assert.equal(await responder(ctx, ["obrigada"]), "Até sábado!");
  assert.equal(pedidos[0].messages.length, conversa.mensagens.length); // + system, - resposta nova
  assert.doesNotMatch(pedidos[0].messages.at(-1).content, /nome no WhatsApp/);
});

test("horário ocupado e horário fora da agenda são recusados", async () => {
  const db = fakeDb({
    imoveis: [{ id: "i1", conta_id: "c1", ativo: true, titulo: "Apto", finalidade: "aluguel", endereco: "Rua X" }],
    disponibilidades: [{ conta_id: "c1", imovel_id: null, dia_semana: 6, hora_inicio: "09:00", hora_fim: "12:00" }],
    visitas: [{ id: "v0", conta_id: "c1", imovel_id: "i1", status: "marcada", inicio: utcDe(2026, 10, 31, "09:00").toISOString(), fim: utcDe(2026, 10, 31, "10:00").toISOString() }],
    conversas: [], leads: [], bloqueios: [],
  });
  const conta = { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
  const ctx = { env: ENV, db, conta, telefone: "557100", canal: "whatsapp", agora: utcDe(2026, 10, 29, "10:00"), conexao: null, enviarFoto: async () => {} };
  roteiro = [
    usar(chamada("a", "marcar_visita", { imovel_id: "i1", inicio: utcDe(2026, 10, 31, "09:00").toISOString(), nome_cliente: "Zé" })),
    (c) => { assert.match(ultimoResultado(c).erro, /ocupado/); return usar(chamada("b", "marcar_visita", { imovel_id: "i1", inicio: utcDe(2026, 10, 31, "15:00").toISOString(), nome_cliente: "Zé" })); },
    (c) => { assert.match(ultimoResultado(c).erro, /não está na agenda/); return usar(chamada("d", "detalhes_imovel", { imovel_id: "de-outra-conta" })); },
    (c) => { assert.match(ultimoResultado(c).erro, /não encontrado/); return falar("ok"); },
  ];
  assert.equal(await responder(ctx, ["quero sábado 9h"]), "ok");
  assert.equal(db.tabelas.visitas.length, 1);
});

test("chamar_corretor marca a conversa", async () => {
  const db = fakeDb({ conversas: [], leads: [], imoveis: [] });
  const conta = { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
  const ctx = { env: ENV, db, conta, telefone: "5571", canal: "simulador", agora: new Date(), conexao: null, enviarFoto: async () => {} };
  roteiro = [usar(chamada("x", "chamar_corretor", { motivo: "Quer fazer proposta" })), falar("Vou chamar o corretor.")];
  await responder(ctx, ["quero fazer uma proposta de 500 mil"]);
  assert.equal(db.tabelas.conversas[0].precisa_corretor, true);
  assert.equal(db.tabelas.conversas[0].motivo, "Quer fazer proposta");
});

const contaBase = { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
const ctxBase = (db, env = ENV) => ({ env, db, conta: contaBase, telefone: "5571", canal: "whatsapp", agora: new Date(), conexao: null, enviarFoto: async () => {} });

test("se o Gemini bate o limite, passa para o Groq e depois deixa o Gemini de lado", async () => {
  _teste.pausados.clear(); pedidos.length = 0;
  falhar = { gemini: 429 };
  roteiro = [falar("Oi! Sou a Dri.")];
  const db = fakeDb({ conversas: [], leads: [] });
  assert.equal(await responder(ctxBase(db), ["oi"]), "Oi! Sou a Dri.");
  assert.deepEqual(pedidos.map((p) => p.prov), ["groq"]);
  assert.equal(pedidos[0].model, "openai/gpt-oss-120b");
  // Na mensagem seguinte o Gemini (pausado) vai para o fim da fila: Groq é tentado primeiro
  falhar = {}; pedidos.length = 0; roteiro = [falar("Claro!")];
  await responder(ctxBase(db), ["pode me ajudar?"]);
  assert.deepEqual(pedidos.map((p) => p.prov), ["groq"]);
});

test("troca de IA no meio das ferramentas mantém o histórico e chega na terceira", async () => {
  _teste.pausados.clear(); pedidos.length = 0; falhar = {};
  const db = fakeDb({ conversas: [], leads: [], imoveis: [] });
  roteiro = [
    () => { // depois desta resposta do Gemini, Gemini e Groq passam a falhar
      falhar = { gemini: 503, groq: 500 };
      return usar({ ...chamada("g1", "buscar_imoveis", { finalidade: "aluguel" }), extra_content: { google: { thought_signature: "sig" } } });
    },
    (c) => {
      assert.equal(c.messages.at(-2).tool_calls[0].extra_content, undefined, "Cerebras não recebe campo do Gemini");
      assert.equal(ultimoResultado(c).total_encontrado, 0);
      return falar("No momento não tenho imóvel para aluguel.");
    },
  ];
  assert.equal(await responder(ctxBase(db), ["tem algo pra alugar?"]), "No momento não tenho imóvel para aluguel.");
  falhar = {};
  assert.deepEqual(pedidos.map((p) => p.prov), ["gemini", "cerebras"]);
  // o histórico guardado mantém a assinatura do Gemini para quando ele voltar
  assert.equal(db.tabelas.conversas[0].mensagens[1].tool_calls[0].extra_content.google.thought_signature, "sig");
});

test("todas as IAs fora do ar: erro claro", async () => {
  _teste.pausados.clear(); falhar = { gemini: 500, groq: 500, cerebras: 500 };
  const db = fakeDb({ conversas: [], leads: [] });
  await assert.rejects(responder(ctxBase(db), ["oi"]), /Todas as IAs falharam/);
  falhar = {};
});

test("só uma IA configurada também funciona", async () => {
  _teste.pausados.clear(); pedidos.length = 0; falhar = {};
  roteiro = [falar("ok")];
  const db = fakeDb({ conversas: [], leads: [] });
  await responder(ctxBase(db, { GROQ_API_KEY: "q" }), ["oi"]);
  assert.deepEqual(pedidos.map((p) => p.prov), ["groq"]);
});

test("usa primeiro as chaves do próprio corretor; plataforma é reserva", async () => {
  _teste.pausados.clear(); pedidos.length = 0; falhar = {};
  const db = fakeDb({ conversas: [], leads: [], ia_chaves: [{ conta_id: "c1", provedor: "groq", chave: "groq-do-corretor" }] });
  roteiro = [falar("oi")];
  await responder(ctxBase(db), ["oi"]);
  assert.deepEqual(pedidos.map((p) => [p.prov, p.chave]), [["groq", "groq-do-corretor"]]);

  // chave do corretor com problema: vai para a reserva (Gemini da plataforma) e o erro fica anotado
  pedidos.length = 0; falhar = { "groq-do-corretor": 401 }; roteiro = [falar("oi de novo")];
  assert.equal(await responder(ctxBase(db), ["oi"]), "oi de novo");
  assert.deepEqual(pedidos.map((p) => [p.prov, p.chave]), [["gemini", "g"]]);
  assert.match(db.tabelas.ia_chaves[0].ultimo_erro, /conta:c1:groq: 401/);

  // sem reserva da plataforma: o erro é do corretor
  falhar = { "groq-do-corretor": 401 };
  await assert.rejects(responder(ctxBase(db, { ...ENV, IA_RESERVA_PLATAFORMA: "nao" }), ["oi"]), /Todas as IAs falharam/);
  falhar = {};
});

test("limite de um corretor não atrapalha outro", async () => {
  _teste.pausados.clear(); pedidos.length = 0;
  const db = fakeDb({ conversas: [], leads: [], ia_chaves: [
    { conta_id: "c1", provedor: "gemini", chave: "gemini-A" },
    { conta_id: "c2", provedor: "gemini", chave: "gemini-B" },
  ] });
  falhar = { "gemini-A": 429 };
  roteiro = [falar("A respondido pela reserva")];
  await responder(ctxBase(db), ["oi"]);                      // corretor A bate o limite
  falhar = {};
  roteiro = [falar("B normal")];
  const ctxB = { ...ctxBase(db), conta: { ...contaBase, id: "c2" } };
  pedidos.length = 0;
  await responder(ctxB, ["oi"]);                             // corretor B segue com a chave dele
  assert.deepEqual(pedidos.map((p) => p.chave), ["gemini-B"]);
  assert.ok(_teste.pausados.has("conta:c1:gemini") && !_teste.pausados.has("conta:c2:gemini"));
});

test("assistente com nome masculino: o prompt usa o masculino", async () => {
  const { promptSistema } = await import("../src/agente.js");
  const p = promptSistema({ nome: "Carlos Imóveis", nome_assistente: "Pedro", genero_assistente: "masculino", tipo: "corretor" });
  assert.match(p, /como um corretor simpático e atencioso/);
  assert.match(p, /é o assistente virtual do corretor/);
  assert.match(p, /masculino \(obrigado/);
  const f = promptSistema({ nome: "Carlos Imóveis", nome_assistente: "Dri", tipo: "corretor" });
  assert.match(f, /como uma corretora simpática/);
  assert.match(f, /é a assistente virtual/);
});

test("horário pedido no fim da tarde aparece (antes a lista cortava nos 12 primeiros)", async () => {
  const db = fakeDb({
    contas: [], imoveis: [{ id: "i1", conta_id: "c1", ativo: true, titulo: "Apto", finalidade: "aluguel", tipo: "apartamento", bairro: "Imbuí", preco: 3500 }],
    disponibilidades: [{ conta_id: "c1", imovel_id: null, dia_semana: 5, hora_inicio: "09:00:00", hora_fim: "18:00:00" }],
    visitas: [{ conta_id: "c1", status: "marcada", inicio: utcDe(2026, 10, 30, "16:00").toISOString(), fim: utcDe(2026, 10, 30, "17:00").toISOString() }],
    bloqueios: [], conversas: [], leads: [],
  });
  const conta = { id: "c1", nome: "João", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
  const ctx = { env: ENV, db, conta, telefone: "5571988887777", nome: "Marcos", canal: "simulador", agora: utcDe(2026, 10, 28, "20:00"), conexao: null };
  roteiro = [
    usar(chamada("t1", "horarios_visita", { imovel_id: "i1", a_partir_de: "2026-10-30", horario: "15:00" })),
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.pedido_livre, true);
      assert.equal(r.horario_pedido.descricao, "sexta 30/10 às 15:00");
      return usar(chamada("t2", "horarios_visita", { imovel_id: "i1", a_partir_de: "2026-10-30", horario: "16:00" }));
    },
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.pedido_livre, false, "16h já tem visita");
      assert.deepEqual(r.alternativas.map((a) => a.descricao), ["sexta 30/10 às 14:30", "sexta 30/10 às 15:00", "sexta 30/10 às 17:00"]);
      return usar(chamada("t3", "horarios_visita", { imovel_id: "i1", a_partir_de: "2026-10-30", dias: 1 }));
    },
    (corpo) => {
      const r = ultimoResultado(corpo);
      const hs = r.horarios.map((h) => h.descricao.slice(-5));
      assert.equal(hs.length, 6);
      assert.equal(hs[0], "09:00"); assert.equal(hs.at(-1), "17:00", "a lista resumida cobre a tarde");
      return falar("ok");
    },
  ];
  assert.equal(await responder(ctx, ["sexta às 15h dá?"]), "ok");
});
