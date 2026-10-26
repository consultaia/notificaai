import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Simula os provedores: modelos que existem, modelos aposentados, lista de /models
let existentes, listaModelos, pedidos;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith("/models")) return new Response(JSON.stringify({ data: listaModelos.map((id) => ({ id })) }));
  const corpo = JSON.parse(init.body);
  pedidos.push(corpo.model);
  if (!existentes.includes(corpo.model)) {
    // formatos reais de erro de modelo aposentado
    if (u.includes("groq")) return new Response(JSON.stringify({ error: { message: `The model \`${corpo.model}\` has been decommissioned and is no longer supported.`, code: "model_decommissioned" } }), { status: 400 });
    return new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 404 });
  }
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "horarios_visita", arguments: "{\"imovel_id\":\"abc123\"}" } }] } }] }));
};
const ia = await import("../src/ia.js");
const pedido = { sistema: "s", mensagens: [{ role: "user", content: "oi" }], ferramentas: [] };

beforeEach(() => { ia._teste.aposentados.clear(); ia._teste.descobertos.clear(); ia._teste.pausados.clear(); ia.eventosModelo.splice(0); pedidos = []; });

test("modelo aposentado: passa para o próximo da lista do mesmo provedor", async () => {
  existentes = ["openai/gpt-oss-20b"]; listaModelos = [];
  const r = await ia.perguntar({ GROQ_API_KEY: "q" }, pedido);
  assert.equal(r.provedor, "groq"); assert.equal(r.modelo, "openai/gpt-oss-20b");
  assert.deepEqual(pedidos, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  // na próxima, nem tenta o aposentado
  pedidos = [];
  await ia.perguntar({ GROQ_API_KEY: "q" }, pedido);
  assert.deepEqual(pedidos, ["openai/gpt-oss-20b"]);
});

test("toda a lista aposentada: descobre um modelo da mesma família", async () => {
  existentes = ["openai/gpt-oss-200b"]; listaModelos = ["whisper-large-v3", "openai/gpt-oss-200b", "playai-tts"];
  const r = await ia.perguntar({ GROQ_API_KEY: "q" }, pedido);
  assert.equal(r.modelo, "openai/gpt-oss-200b");
  assert.ok(ia.eventosModelo.some((e) => e.tipo === "descoberto" && e.modelo === "openai/gpt-oss-200b"));
});

test("modelo do .env tem prioridade e aceita lista", async () => {
  existentes = ["gemini-3-flash"]; listaModelos = [];
  const r = await ia.perguntar({ GEMINI_API_KEY: "g", GEMINI_MODELO: "gemini-9-flash, gemini-3-flash" }, pedido);
  assert.equal(r.modelo, "gemini-3-flash");
  assert.deepEqual(pedidos, ["gemini-9-flash", "gemini-3-flash"]);
});

test("provedor sem nenhum modelo vivo passa para o próximo provedor", async () => {
  existentes = ["gpt-oss-120b"]; listaModelos = ["whisper"];
  const r = await ia.perguntar({ GROQ_API_KEY: "q", CEREBRAS_API_KEY: "c", IA_ORDEM: "groq,cerebras" }, pedido);
  assert.equal(r.provedor, "cerebras");
});

test("autoteste relata modelo usado e aposentadorias", async () => {
  existentes = ["openai/gpt-oss-20b", "gemini-2.5-flash"]; listaModelos = [];
  const { resultados, eventos } = await ia.autotestar({ GROQ_API_KEY: "q", GEMINI_API_KEY: "g" });
  assert.deepEqual(resultados.map((r) => [r.provedor, r.ok, r.modelo, r.usou_ferramenta]),
    [["gemini", true, "gemini-2.5-flash", true], ["groq", true, "openai/gpt-oss-20b", true]]);
  assert.ok(eventos.some((e) => e.tipo === "aposentado" && e.modelo === "openai/gpt-oss-120b"));
});

test("erro 400 comum (não de modelo) não aposenta o modelo", () => {
  assert.equal(ia.modeloSumiu(400, "Invalid tool schema"), false);
  assert.equal(ia.modeloSumiu(400, "The model `x` has been decommissioned"), true);
  assert.equal(ia.modeloSumiu(404, ""), true);
  assert.equal(ia.modeloSumiu(429, "model rate limit"), false);
});
