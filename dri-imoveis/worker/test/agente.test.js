import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";
import { utcDe } from "../src/agenda.js";

// Respostas roteirizadas da API da Claude; guarda os pedidos para conferir
const pedidos = [];
let roteiro = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.anthropic.com")) {
    const corpo = JSON.parse(init.body);
    pedidos.push(corpo);
    const passo = roteiro.shift();
    const content = typeof passo === "function" ? passo(corpo) : passo;
    const usaFerramenta = content.some((b) => b.type === "tool_use");
    return new Response(JSON.stringify({
      id: "msg_" + pedidos.length, type: "message", role: "assistant", model: corpo.model, content,
      stop_reason: usaFerramenta ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  }
  throw new Error("fetch inesperado: " + url);
};
const { responder } = await import("../src/agente.js");

const ultimoResultado = (corpo) => JSON.parse(corpo.messages.at(-1).content.find((b) => b.type === "tool_result").content);

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
    env: { ANTHROPIC_API_KEY: "test" }, db, conta, telefone: "5571988887777", nome: "Maria", canal: "whatsapp",
    agora: utcDe(2026, 10, 29, "21:00"), conexao: null, enviarFoto: async (u) => fotos.push(u),
  };
  roteiro = [
    [{ type: "tool_use", id: "t1", name: "buscar_imoveis", input: { finalidade: "venda", bairro: "pituba", palavra_chave: "varanda" } }],
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.total_encontrado, 1);
      assert.equal(r.imoveis[0].id, "i1");
      assert.equal(r.imoveis[0].endereco, undefined, "endereço não pode ir antes da visita");
      return [{ type: "tool_use", id: "t2", name: "enviar_fotos", input: { imovel_id: "i1", quantidade: 5 } },
              { type: "tool_use", id: "t3", name: "horarios_visita", input: { imovel_id: "i1" } }];
    },
    (corpo) => {
      const resultados = corpo.messages.at(-1).content;
      assert.equal(resultados.length, 2, "os dois tool_result voltam numa mensagem só");
      const h = JSON.parse(resultados[1].content);
      assert.equal(h.horarios[0].descricao, "sábado 31/10 às 09:00");
      return [{ type: "tool_use", id: "t4", name: "marcar_visita", input: { imovel_id: "i1", inicio: h.horarios[0].inicio, nome_cliente: "Maria Souza" } }];
    },
    (corpo) => {
      const r = ultimoResultado(corpo);
      assert.equal(r.ok, true);
      assert.equal(r.endereco, "Rua das Hortênsias, 100");
      return [{ type: "text", text: "Prontinho, Maria! Visita marcada para sábado 31/10 às 9h." }];
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
  assert.equal(pedido.model, "claude-opus-5-5");
  assert.equal(pedido.fallbacks, "default");
  assert.match(pedido.messages[0].content, /quinta, 29\/10\/2026 21:00, horário de Brasília · nome no WhatsApp: Maria/);
  assert.ok(!("temperature" in pedido));

  const conversa = db.tabelas.conversas[0];
  assert.equal(conversa.mensagens.at(-1).role, "assistant");
  assert.deepEqual(conversa.transcricao.map((t) => t.de), ["cliente", "dri"]);

  // Segunda mensagem: histórico continua, sem repetir o nome no cabeçalho
  pedidos.length = 0;
  roteiro = [[{ type: "text", text: "Até sábado!" }]];
  assert.equal(await responder(ctx, ["obrigada"]), "Até sábado!");
  assert.equal(pedidos[0].messages.length, conversa.mensagens.length - 1);
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
  const ctx = { env: { ANTHROPIC_API_KEY: "t" }, db, conta, telefone: "557100", canal: "whatsapp", agora: utcDe(2026, 10, 29, "10:00"), conexao: null, enviarFoto: async () => {} };
  roteiro = [
    [{ type: "tool_use", id: "a", name: "marcar_visita", input: { imovel_id: "i1", inicio: utcDe(2026, 10, 31, "09:00").toISOString(), nome_cliente: "Zé" } }],
    (c) => { assert.match(ultimoResultado(c).erro, /ocupado/); return [{ type: "tool_use", id: "b", name: "marcar_visita", input: { imovel_id: "i1", inicio: utcDe(2026, 10, 31, "15:00").toISOString(), nome_cliente: "Zé" } }]; },
    (c) => { assert.match(ultimoResultado(c).erro, /não está na agenda/); return [{ type: "tool_use", id: "d", name: "detalhes_imovel", input: { imovel_id: "de-outra-conta" } }]; },
    (c) => { const r = c.messages.at(-1).content[0]; assert.equal(r.is_error, true); return [{ type: "text", text: "ok" }]; },
  ];
  assert.equal(await responder(ctx, ["quero sábado 9h"]), "ok");
  assert.equal(db.tabelas.visitas.length, 1);
});

test("chamar_corretor marca a conversa", async () => {
  const db = fakeDb({ conversas: [], leads: [], imoveis: [] });
  const conta = { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
  const ctx = { env: { ANTHROPIC_API_KEY: "t" }, db, conta, telefone: "5571", canal: "simulador", agora: new Date(), conexao: null, enviarFoto: async () => {} };
  roteiro = [[{ type: "tool_use", id: "x", name: "chamar_corretor", input: { motivo: "Quer fazer proposta" } }], [{ type: "text", text: "Vou chamar o corretor." }]];
  await responder(ctx, ["quero fazer uma proposta de 500 mil"]);
  assert.equal(db.tabelas.conversas[0].precisa_corretor, true);
  assert.equal(db.tabelas.conversas[0].motivo, "Quer fazer proposta");
});
