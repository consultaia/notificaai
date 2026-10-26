import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";

const chamadas = [];
let whisperFalha = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  chamadas.push({ u, metodo: init.method || "GET", auth: init.headers?.authorization, corpo: init.body });
  if (u.endsWith("/MIDIA123")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/audio", mime_type: "audio/ogg; codecs=opus" }));
  if (u.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([1, 2, 3]));
  if (u.endsWith("/audio/transcriptions")) {
    if (whisperFalha) return new Response(JSON.stringify({ error: { message: "limite" } }), { status: 429 });
    assert.equal(init.body.get("language"), "pt");
    assert.equal(init.body.get("model"), "whisper-large-v3-turbo");
    return new Response(JSON.stringify({ text: " Oi, quero um apartamento de três quartos na Pituba " }));
  }
  if (u.endsWith("/chat/completions")) {
    const c = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recebi: " + c.messages.at(-1).content.split("\n").slice(1).join(" ") } }] }));
  }
  if (u.includes("graph.facebook.com")) return new Response(JSON.stringify({ messages: [{ id: "ok" }] }));
  throw new Error("fetch inesperado " + u);
};
const { Conversa } = await import("../src/index.js");

function montar() {
  const db = fakeDb({
    contas: [{ id: "c1", nome: "Ana", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2 }],
    whatsapp_conexoes: [{ conta_id: "c1", phone_number_id: "111", status: "conectado" }],
    whatsapp_segredos: [{ conta_id: "c1", access_token: "EAAtoken" }],
    ia_chaves: [{ conta_id: "c1", provedor: "groq", chave: "gsk_corretor" }],
    conversas: [], leads: [],
  });
  return { db, objeto: new Conversa({ storage: {} }, { __dbTeste: db, GROQ_API_KEY: "gsk_plataforma" }) };
}
const audio = { contaId: "c1", de: "5571999", id: "wamid.A", tipo: "audio", texto: null, midiaId: "MIDIA123", nome: "Bia" };

test("áudio do cliente é transcrito e a Dri responde ao conteúdo", async () => {
  const { db, objeto } = montar();
  chamadas.length = 0;
  await objeto.processar([{ ...audio }]);
  const whisper = chamadas.find((c) => c.u.endsWith("/audio/transcriptions"));
  assert.equal(whisper.auth, "Bearer gsk_corretor", "usa a chave do Groq do corretor primeiro");
  const midia = chamadas.find((c) => c.u.startsWith("https://lookaside"));
  assert.equal(midia.auth, "Bearer EAAtoken");
  const enviada = chamadas.filter((c) => c.u.endsWith("/111/messages") && c.metodo === "POST").map((c) => JSON.parse(c.corpo)).find((b) => b.type === "text");
  assert.match(enviada.text.body, /\[Áudio do cliente, transcrito\] Oi, quero um apartamento de três quartos na Pituba/);
  assert.equal(db.tabelas.conversas[0].transcricao[0].texto, "[Áudio do cliente, transcrito] Oi, quero um apartamento de três quartos na Pituba");
});

test("se a transcrição falhar, a Dri recebe o aviso para pedir texto", async () => {
  const { objeto } = montar();
  whisperFalha = true; chamadas.length = 0;
  await objeto.processar([{ ...audio, id: "wamid.B" }]);
  whisperFalha = false;
  // tentou as duas chaves (corretor e plataforma)
  assert.deepEqual(chamadas.filter((c) => c.u.endsWith("/audio/transcriptions")).map((c) => c.auth), ["Bearer gsk_corretor", "Bearer gsk_plataforma"]);
  const enviada = chamadas.filter((c) => c.u.endsWith("/111/messages")).map((c) => JSON.parse(c.corpo)).find((b) => b.type === "text");
  assert.match(enviada.text.body, /não deu para transcrever/);
});
