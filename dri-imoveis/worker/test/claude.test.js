import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";

// Claude e Groq falsos. A Claude recebe o pedido pelo SDK oficial (fetch por baixo).
let roteiroClaude, statusClaude, pedidosClaude, pedidosGroq;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.anthropic.com/v1/messages")) {
    const corpo = JSON.parse(init.body);
    pedidosClaude.push(corpo);
    if (statusClaude) return new Response(JSON.stringify({ type: "error", error: { type: statusClaude === 429 ? "rate_limit_error" : "api_error", message: "falha" } }), { status: statusClaude, headers: { "content-type": "application/json" } });
    const content = roteiroClaude.shift()(corpo);
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: corpo.model, content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json", "request-id": "r" } });
  }
  if (u.includes("groq")) {
    pedidosGroq.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "resposta do Groq" } }] }));
  }
  throw new Error("fetch inesperado " + u);
};
const { responder } = await import("../src/agente.js");
const ia = await import("../src/ia.js");
const { paraClaude } = await import("../src/claude.js");

const conta = { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 };
const ctx = (db, env) => ({ env, db, conta, telefone: "5571", canal: "whatsapp", agora: new Date(), conexao: null, enviarFoto: async () => {} });
beforeEach(() => { roteiroClaude = []; statusClaude = null; pedidosClaude = []; pedidosGroq = []; ia._teste.pausados.clear(); });

test("Haiku é a principal: pedido no formato da Claude, com ferramenta e raciocínio preservado", async () => {
  const db = fakeDb({ conversas: [], leads: [], imoveis: [], ia_chaves: [{ conta_id: "c1", provedor: "groq", chave: "gsk_do_corretor" }] });
  const env = { ANTHROPIC_API_KEY: "sk-ant", GROQ_API_KEY: "gsk_plataforma" };
  roteiroClaude = [
    () => [{ type: "thinking", thinking: "", signature: "assin1" }, { type: "tool_use", id: "toolu_1", name: "buscar_imoveis", input: { finalidade: "venda" } }],
    (c) => {
      // segunda volta: o raciocínio da primeira volta precisa voltar igual, e o resultado da ferramenta junto
      assert.deepEqual(c.messages[1].content[0], { type: "thinking", thinking: "", signature: "assin1" });
      assert.equal(c.messages[2].content[0].type, "tool_result");
      assert.equal(c.messages[2].content[0].tool_use_id, "toolu_1");
      return [{ type: "text", text: "Tenho opções!" }];
    },
  ];
  assert.equal(await responder(ctx(db, env), ["quero comprar"]), "Tenho opções!");
  const p = pedidosClaude[0];
  assert.equal(p.model, "claude-haiku-5-5");
  assert.equal(p.output_config.effort, "low");
  assert.deepEqual(p.cache_control, { type: "ephemeral" });
  assert.equal(typeof p.system, "string");
  assert.ok(p.tools.find((t) => t.name === "marcar_visita").input_schema.required.includes("inicio"));
  assert.ok(!("temperature" in p) && !("thinking" in p));
  assert.equal(pedidosGroq.length, 0, "com a Claude no ar, o Groq do corretor nem é usado");
  // o histórico guardado mantém os blocos da Claude
  assert.equal(db.tabelas.conversas[0].mensagens[1]._claude[0].signature, "assin1");
});

test("Claude fora do ar: a chave gratuita do corretor responde", async () => {
  const db = fakeDb({ conversas: [], leads: [], ia_chaves: [{ conta_id: "c1", provedor: "groq", chave: "gsk_do_corretor" }] });
  statusClaude = 529;
  const r = await responder(ctx(db, { ANTHROPIC_API_KEY: "sk-ant" }), ["oi"]);
  assert.equal(r, "resposta do Groq");
  assert.ok(pedidosClaude.length >= 1);
  // o Groq não recebe o campo interno da Claude
  assert.ok(!JSON.stringify(pedidosGroq[0]).includes("_claude"));
});

test("IA_CLAUDE=reserva: gratuitas primeiro, Claude só no fim", async () => {
  const db = fakeDb({ conversas: [], leads: [] });
  await responder(ctx(db, { ANTHROPIC_API_KEY: "sk-ant", GROQ_API_KEY: "g", IA_CLAUDE: "reserva" }), ["oi"]);
  assert.equal(pedidosClaude.length, 0);
  assert.equal(pedidosGroq.length, 1);
});

test("conversão: resultados de ferramenta juntos, ids válidos, histórico vindo de outra IA", () => {
  const msgs = paraClaude([
    { role: "user", content: "oi" },
    { role: "assistant", content: null, tool_calls: [
      { id: "call:1/a", type: "function", function: { name: "a", arguments: "{\"x\":1}" } },
      { id: "call:2", type: "function", function: { name: "b", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call:1/a", content: "{}" },
    { role: "tool", tool_call_id: "call:2", content: "{}" },
    { role: "assistant", content: "pronto" },
  ]);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(msgs[1].content[0].id, "call_1_a");
  assert.deepEqual(msgs[1].content[0].input, { x: 1 });
  assert.deepEqual(msgs[2].content.map((b) => b.tool_use_id), ["call_1_a", "call_2"]);
});
