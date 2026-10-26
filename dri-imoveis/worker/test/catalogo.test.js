import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";

let pedidoClaude = null, pedidoGroq = null, claudeFalha = false, respostaIA = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.anthropic.com/v1/messages")) {
    pedidoClaude = JSON.parse(init.body);
    if (claudeFalha) return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }), { status: 529, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(respostaIA) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json", "request-id": "r" } });
  }
  if (u.includes("groq")) {
    pedidoGroq = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(respostaIA) } }] }));
  }
  throw new Error("fetch inesperado " + u);
};
const { lerBook } = await import("../src/catalogo.js");
const { responder } = await import("../src/agente.js");

// Book de exemplo (texto sintético no formato dos books de lançamento)
const paginas = [
  { n: 1, texto: "Residencial Jardim Exemplo. Seu novo lar no Imbuí. Imagem meramente ilustrativa." },
  { n: 5, texto: "2 e 3 quartos. Suíte e varanda. 60 m² e 70 m². Piscina com borda infinita, academia, salão de festas, espaço pet, portaria 24h." },
  { n: 25, texto: "3/4 Suíte e varanda 70 m² privativos Planta Tipo A" },
  { n: 26, texto: "2/4 Suíte e varanda 60 m² privativos Planta Tipo B" },
  { n: 30, texto: "Rua das Flores, nº 100 - Imbuí, Salvador/BA. Realização: Construtora Exemplo. Financiamento até 90% com FGTS." },
];
const respostaBoa = {
  empreendimento: "Residencial Jardim Exemplo", construtora: "Construtora Exemplo", finalidade: "venda", tipo: "apartamento",
  bairro: "Imbuí", cidade: "Salvador, BA", endereco: "Rua das Flores, 100 - Imbuí", situacao: "lançamento", previsao_entrega: "",
  programa: "", preco_a_partir: 0, descricao: "Apartamentos de 2 e 3 quartos com suíte e varanda no Imbuí.",
  caracteristicas: ["piscina com borda infinita", "academia", "  ", "portaria 24h"], vagas: 0,
  plantas: [
    { nome: "3/4 com suíte e varanda (Tipo A)", quartos: 3, suites: 1, area_m2: 70, varanda: true, pagina: 25 },
    { nome: "2/4 com suíte e varanda (Tipo B)", quartos: 2, suites: 1, area_m2: 60, varanda: true, pagina: 99 },
  ],
  paginas_fotos: [1, 5, 1, 0, 40],
};

test("lê o book com a Claude em saída estruturada e limpa o resultado", async () => {
  respostaIA = respostaBoa; claudeFalha = false;
  const d = await lerBook({ ANTHROPIC_API_KEY: "k" }, { paginas, totalPaginas: 32 });
  assert.equal(pedidoClaude.model, "claude-haiku-5-5");
  assert.equal(pedidoClaude.output_config.format.type, "json_schema");
  assert.match(pedidoClaude.messages[0].content.at(-1).text, /--- Página 25 ---\n3\/4 Suíte/);
  assert.equal(d.empreendimento, "Residencial Jardim Exemplo");
  assert.equal(d.preco_a_partir, null, "sem preço no book: fica vazio, não zero");
  assert.equal(d.previsao_entrega, null);
  assert.deepEqual(d.caracteristicas, ["piscina com borda infinita", "academia", "portaria 24h"]);
  assert.equal(d.plantas[1].pagina, null, "página que não existe no PDF é descartada");
  assert.deepEqual(d.paginas_fotos, [1, 5], "páginas repetidas e fora do PDF somem");
});

test("Claude fora do ar: uma IA gratuita lê em modo JSON", async () => {
  respostaIA = respostaBoa; claudeFalha = true; pedidoGroq = null;
  const d = await lerBook({ ANTHROPIC_API_KEY: "k", GROQ_API_KEY: "g" }, { paginas, totalPaginas: 32 });
  assert.equal(pedidoGroq.response_format.type, "json_object");
  assert.equal(d.plantas.length, 2);
  claudeFalha = false;
});

test("PDF só de imagem: manda as imagens das páginas para a Claude", async () => {
  respostaIA = respostaBoa;
  await lerBook({ ANTHROPIC_API_KEY: "k" }, { paginas: [{ n: 1, texto: "" }], imagens: [{ n: 1, base64: "AAAA" }, { n: 2, base64: "BBBB" }], totalPaginas: 2 });
  const blocos = pedidoClaude.messages[0].content;
  assert.deepEqual(blocos.filter((b) => b.type === "image").map((b) => b.source.data), ["AAAA", "BBBB"]);
});

test("a Dri manda o book do empreendimento no WhatsApp", async () => {
  const db = fakeDb({ conversas: [], leads: [], imoveis: [{ id: "i1", conta_id: "c1", ativo: true, titulo: "Jardim Exemplo · 3/4 Tipo A", empreendimento: "Jardim Exemplo", finalidade: "venda", book_url: "https://x/book.pdf" }] });
  const arquivos = [];
  let volta = 0;
  globalThis.fetch = async (url, init) => {
    const c = JSON.parse(init.body);
    volta++;
    const msg = volta === 1
      ? { content: null, tool_calls: [{ id: "a", type: "function", function: { name: "enviar_book", arguments: "{\"imovel_id\":\"i1\"}" } }] }
      : { content: "Te mandei o book!" };
    if (volta === 2) assert.deepEqual(JSON.parse(c.messages.at(-1).content), { enviado: true });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...msg } }] }));
  };
  const r = await responder({ env: { GROQ_API_KEY: "g" }, db, conta: { id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 },
    telefone: "5571", canal: "whatsapp", agora: new Date(), enviarFoto: async () => {}, enviarArquivo: async (u, nome) => arquivos.push([u, nome]) }, ["tem o book?"]);
  assert.equal(r, "Te mandei o book!");
  assert.deepEqual(arquivos, [["https://x/book.pdf", "Jardim Exemplo.pdf"]]);
});
