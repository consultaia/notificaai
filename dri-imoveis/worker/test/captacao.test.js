import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";

let roteiro = [], pedidosIA = [];
const enviados = [], emails = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (/\/FOTO\d$/.test(u)) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/" + u.slice(-5), mime_type: "image/jpeg" }));
  if (u.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([9, 9, 9]));
  if (u.startsWith("https://api.resend.com/")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (u.endsWith("/chat/completions")) {
    const c = JSON.parse(init.body); pedidosIA.push(c);
    const passo = roteiro.shift();
    const message = typeof passo === "function" ? passo(c) : passo;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message } }] }));
  }
  if (u.includes("graph.facebook.com")) { if (init.body) enviados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: "ok" }] })); }
  throw new Error("fetch inesperado " + u);
};
const { Conversa } = await import("../src/index.js");
const chamada = (id, name, args) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const falar = (t) => ({ content: t });

test("proprietário: fotos, captação e aviso ao corretor", async () => {
  const db = fakeDb({
    contas: [{ id: "c1", nome: "Carlos Andrade", tipo: "corretor", nome_assistente: "Dri", duracao_visita_min: 60, antecedencia_min_horas: 2, email_notificacao: "carlos@ex.com", whatsapp_pessoal: "5571999990000" }],
    whatsapp_conexoes: [{ conta_id: "c1", phone_number_id: "111", status: "conectado" }],
    whatsapp_segredos: [{ conta_id: "c1", access_token: "EAAtoken" }],
    conversas: [], leads: [], captacoes: [],
  });
  const guardados = [];
  db.storage = { from: () => ({
    upload: async (caminho, dados, o) => { guardados.push([caminho, o.contentType]); return { error: null }; },
    getPublicUrl: (caminho) => ({ data: { publicUrl: "https://sb/" + caminho } }),
  }) };
  const objeto = new Conversa({ storage: {} }, { __dbTeste: db, GROQ_API_KEY: "g", RESEND_API_KEY: "re", EMAIL_REMETENTE: "Dri <a@b.c>" });
  const msg = (id, extra) => ({ contaId: "c1", de: "5571988887777", id, nome: "Seu João", ...extra });

  // 1) manda uma foto antes de dizer o que quer
  roteiro = [(c) => { assert.match(c.messages.at(-1).content, /mandou uma foto.*guardada para o corretor/); return falar("Recebi a foto! Me conta, é sobre um imóvel seu?"); }];
  await objeto.processar([msg("w1", { tipo: "image", imagemId: "FOTO1" })]);
  assert.equal(db.tabelas.conversas[0].midias_recebidas.length, 1);
  assert.match(guardados[0][0], /^c1\/recebidas\/.+\.jpg$/);

  // 2) diz que quer vender: a Dri abre a captação e a foto vai junto
  roteiro = [
    chamada("a", "salvar_captacao", { finalidade: "venda", tipo: "apartamento", bairro: "Pituba", quartos: 3 }),
    (c) => { const r = JSON.parse(c.messages.at(-1).content); assert.equal(r.fotos_recebidas, 1); assert.ok(r.ainda_falta.includes("valor pretendido")); return falar("Que ótimo! Quanto você pensa em pedir?"); },
  ];
  await objeto.processar([msg("w2", { tipo: "text", texto: "quero vender meu apartamento de 3 quartos na Pituba" })]);
  assert.equal(db.tabelas.captacoes.length, 1);
  assert.equal(db.tabelas.captacoes[0].nome, "Seu João");
  assert.equal(db.tabelas.captacoes[0].fotos.length, 1);

  // 3) segunda foto vai direto para a captação
  roteiro = [falar("Foto guardada! 📸")];
  await objeto.processar([msg("w3", { tipo: "image", imagemId: "FOTO2", legenda: "sala" })]);
  assert.equal(db.tabelas.captacoes[0].fotos.length, 2);

  // 4) completa e finaliza: corretor é avisado por email e WhatsApp
  roteiro = [
    chamada("b", "salvar_captacao", { valor_pretendido: 850000, area_m2: 95, melhor_horario: "sábado de manhã", caracteristicas: ["varanda"], finalizar: true }),
    falar("Anotado! O Carlos vai te chamar no sábado de manhã."),
  ];
  enviados.length = 0;
  await objeto.processar([msg("w4", { tipo: "text", texto: "uns 850 mil, 95 m², pode me ligar sábado de manhã" })]);
  const cap = db.tabelas.captacoes[0];
  assert.equal(cap.valor_pretendido, 850000);
  assert.equal(cap.completa, true);
  assert.equal(cap.quartos, 3, "dados anteriores continuam");
  assert.match(emails[0].subject, /Imóvel para captar: apartamento para venda · Pituba/);
  assert.match(emails[0].text, /3 quartos.*95 m².*R\$\s?850\.000/s);
  const avisoWhats = enviados.find((b) => b.to === "5571999990000");
  assert.match(avisoWhats.text.body, /Um proprietário quer vender com você/);
});
