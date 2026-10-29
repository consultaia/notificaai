import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.js";

// Meta (Graph API) e imagem da campanha de mentira
const chamadas = [];
let modeloStatus = "PENDING";
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === "https://fotos.test/campanha.jpg") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
  const caminho = u.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "");
  const corpo = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  chamadas.push({ metodo: init?.method || "GET", caminho, corpo, headers: init?.headers });
  const ok = (j) => new Response(JSON.stringify(j));
  if (caminho === "app") return ok({ id: "APP1" });
  if (caminho.startsWith("APP1/uploads")) return ok({ id: "upload:SESSAO" });
  if (caminho === "upload:SESSAO") return ok({ h: "HANDLE" });
  if (caminho === "WABA/message_templates") return ok({ id: "TPL1", status: "PENDING", category: "MARKETING" });
  if (caminho.startsWith("TPL1?fields=")) return ok({ status: modeloStatus, rejected_reason: "NONE" });
  if (caminho === "PN/messages") {
    if (corpo.to === "5571900000009") return new Response(JSON.stringify({ error: { message: "número inválido" } }), { status: 400 });
    return ok({ messages: [{ id: `wamid.${corpo.to}` }] });
  }
  if (caminho.startsWith("PN?fields=")) return ok({ quality_rating: "GREEN", messaging_limit_tier: "TIER_250" });
  throw new Error("graph inesperado " + caminho);
};
const { criarCampanha, rodarCampanhas, publicoDa, atualizarStatusEnvios, tratarResposta, pedeParaSair, horarioPermitido, montarModelo } = await import("../src/campanhas.js");

const DIA = 24 * 3600e3;
const agora = new Date("2026-11-10T17:00:00Z"); // 14h em Brasília
const dias = (n) => new Date(agora.getTime() + n * DIA).toISOString();
const conexao = { phone_number_id: "PN", waba_id: "WABA", token: "tok", status: "conectado" };

function montarDb() {
  return fakeDb({
    contas: [{ id: "c1", owner_id: "u1", nome: "Carlos", nome_assistente: "Dri" }],
    assinaturas: [{ conta_id: "c1", status: "ativa" }],
    plataforma_config: [{ id: true, preco_mensal: 197, dias_teste: 5, dias_tolerancia: 2, comissao_adesao: 100 }],
    whatsapp_conexoes: [{ conta_id: "c1", ...conexao }], whatsapp_segredos: [{ conta_id: "c1", access_token: "tok" }],
    conversas: [
      { conta_id: "c1", telefone: "5571911111111", nome: "Ana Souza", novidades: "sim", atualizado_em: dias(-2) },
      { conta_id: "c1", telefone: "5571922222222", nome: "Bruno", novidades: "sim", atualizado_em: dias(-40) },
      { conta_id: "c1", telefone: "5571933333333", nome: "Caio", novidades: "nao", atualizado_em: dias(-1) },
      { conta_id: "c1", telefone: "5571944444444", nome: "Duda", novidades: null, atualizado_em: dias(-1) },
      { conta_id: "c1", telefone: "simulador", nome: "teste", novidades: "sim", atualizado_em: dias(-1) },
      { conta_id: "c1", telefone: "5571900000009", nome: "Erro", novidades: "sim", atualizado_em: dias(-1) },
    ],
    leads: [{ conta_id: "c1", telefone: "5571911111111", perfil: "compra 2 quartos Pituba" }],
    campanhas: [], campanha_envios: [],
  });
}

test("sair da lista, horário permitido e modelo da Meta", () => {
  assert.ok(pedeParaSair("SAIR") && pedeParaSair("Não quero receber") && pedeParaSair("não quero mais receber"));
  assert.ok(!pedeParaSair("parar") && !pedeParaSair("cancelar"), "sozinhos só valem logo depois de uma campanha");
  assert.ok(!pedeParaSair("quero sair do aluguel"));
  assert.equal(horarioPermitido(agora), true);
  assert.equal(horarioPermitido(new Date("2026-11-10T05:00:00Z")), false, "2h da manhã em Brasília");
  const m = montarModelo({ texto: "Lançamento na Pituba!", imagem_url: "x", botao: "Quero ver" }, "dri_x", "H");
  assert.equal(m.category, "MARKETING");
  assert.deepEqual(m.components[0], { type: "HEADER", format: "IMAGE", example: { header_handle: ["H"] } });
  assert.equal(m.components[1].text, "Olá, {{1}}! Lançamento na Pituba!");
  assert.deepEqual(m.components.at(-1).buttons.map((b) => b.text), ["Quero ver", "Não quero receber"]);
});

test("público: só quem aceitou, sem o simulador, com filtros e sem quem recebeu nos últimos 7 dias", async () => {
  const db = montarDb();
  assert.equal((await publicoDa(db, "c1", {}, agora)).contatos.length, 3);
  assert.deepEqual((await publicoDa(db, "c1", { dias: 30 }, agora)).contatos.map((c) => c.nome).sort(), ["Ana Souza", "Erro"]);
  assert.deepEqual((await publicoDa(db, "c1", { palavra: "pituba" }, agora)).contatos.map((c) => c.nome), ["Ana Souza"]);
  db.tabelas.campanha_envios.push({ conta_id: "c1", telefone: "5571911111111", enviado_em: dias(-3) });
  const p = await publicoDa(db, "c1", {}, agora);
  assert.equal(p.contatos.length, 2);
  assert.equal(p.recentes, 1);
});

test("cria o modelo com imagem na Meta, espera a aprovação e envia em lotes no horário", async () => {
  const db = montarDb();
  const r = await criarCampanha({}, db, db.tabelas.contas[0], conexao,
    { nome: "Lançamento Pituba", texto: "Chegou o Residencial Jardins, 2 e 3 quartos.", imagem_url: "https://fotos.test/campanha.jpg" }, agora);
  assert.ok(r.campanha, JSON.stringify(r));
  assert.equal(r.campanha.status, "aguardando aprovação");
  const pedido = chamadas.find((c) => c.caminho === "WABA/message_templates").corpo;
  assert.match(pedido.name, /^dri_lancamento_pituba_[a-f0-9]{6}$/);
  assert.equal(pedido.components[0].example.header_handle[0], "HANDLE");

  // ainda pendente: nada sai
  await rodarCampanhas({}, db, agora);
  assert.equal(db.tabelas.campanha_envios.length, 0);
  modeloStatus = "APPROVED";
  const res = await rodarCampanhas({ CAMPANHA_LOTE: "2" }, db, agora);
  assert.equal(res.aprovadas, 1);
  assert.equal(db.tabelas.campanha_envios.length, 3);
  assert.equal(db.tabelas.campanhas[0].status, "enviando");
  const envio = chamadas.filter((c) => c.caminho === "PN/messages")[0].corpo;
  assert.equal(envio.template.name, db.tabelas.campanhas[0].template_nome);
  assert.equal(envio.template.components[0].parameters[0].image.link, "https://fotos.test/campanha.jpg");
  assert.ok(["Ana", "Bruno", "Erro"].includes(envio.template.components[1].parameters[0].text), "primeiro nome do cliente");

  await rodarCampanhas({ CAMPANHA_LOTE: "2" }, db, agora);
  const c = db.tabelas.campanhas[0];
  assert.equal(c.status, "enviada");
  assert.equal(c.enviadas, 2);
  assert.equal(c.falhas, 1, "número inválido conta como falha e não trava a campanha");

  // fora do horário não envia
  const db2 = montarDb();
  db2.tabelas.campanhas.push({ id: "k", conta_id: "c1", status: "agendada", agendada_para: dias(-1), template_nome: "t", texto: "x", filtro: {}, enviadas: 0, falhas: 0 });
  await rodarCampanhas({}, db2, new Date("2026-11-10T02:00:00Z"));
  assert.equal(db2.tabelas.campanha_envios.length, 0);
});

test("entregue e lida contam uma vez; SAIR tira da lista; resposta vira contexto para a IA", async () => {
  const db = montarDb();
  db.tabelas.campanhas.push({ id: "k", conta_id: "c1", nome: "Lanç", texto: "Chegou o Residencial Jardins.", entregues: 0, lidas: 0, falhas: 0, respostas: 0 });
  db.tabelas.campanha_envios.push({ id: "e1", campanha_id: "k", conta_id: "c1", telefone: "5571911111111", status: "enviada", wamid: "w1", enviado_em: dias(-1) });
  await atualizarStatusEnvios(db, [{ id: "w1", status: "delivered" }, { id: "w1", status: "read" }, { id: "w1", status: "delivered" }, { id: "outra", status: "read" }]);
  assert.deepEqual([db.tabelas.campanhas[0].entregues, db.tabelas.campanhas[0].lidas], [1, 1]);

  const r = await tratarResposta(db, "c1", "5571911111111", ["Quero saber mais"], agora);
  assert.match(r.contexto, /Residencial Jardins/);
  assert.equal(db.tabelas.campanhas[0].respostas, 1);
  await tratarResposta(db, "c1", "5571911111111", ["e o preço?"], agora);
  assert.equal(db.tabelas.campanhas[0].respostas, 1, "conta uma resposta por pessoa");

  assert.deepEqual(await tratarResposta(db, "c1", "5571911111111", ["Não quero receber"], agora), { sair: true });
  assert.equal(db.tabelas.conversas[0].novidades, "nao");
});

test("não cria campanha sem público, sem WhatsApp ou com chaves no texto", async () => {
  const db = montarDb();
  const conta = db.tabelas.contas[0];
  assert.match((await criarCampanha({}, db, conta, null, { nome: "x", texto: "Texto da campanha aqui" }, agora)).erro, /Conecte o WhatsApp/);
  assert.match((await criarCampanha({}, db, conta, conexao, { nome: "x", texto: "Oi {{1}} tudo bem com você" }, agora)).erro, /chaves/);
  assert.match((await criarCampanha({}, db, conta, conexao, { nome: "x", texto: "Texto da campanha aqui", filtro: { palavra: "cobertura" } }, agora)).erro, /Ninguém/);
});

test("'cancelar' só tira da lista logo depois de uma campanha; sem campanha é conversa normal", async () => {
  const db = montarDb();
  assert.deepEqual(await tratarResposta(db, "c1", "5571922222222", ["cancelar"], agora), {}, "quer cancelar a visita, não sair da lista");
  assert.equal(db.tabelas.conversas[1].novidades, "sim");
  db.tabelas.campanhas.push({ id: "k", conta_id: "c1", nome: "x", texto: "y", respostas: 0 });
  db.tabelas.campanha_envios.push({ id: "e9", campanha_id: "k", conta_id: "c1", telefone: "5571922222222", status: "entregue", enviado_em: dias(-1) });
  assert.deepEqual(await tratarResposta(db, "c1", "5571922222222", ["Parar"], agora), { sair: true });
  assert.equal(db.tabelas.conversas[1].novidades, "nao");
});

test("quem saiu da lista depois de montada não recebe; pendente de outra campanha não entra em duas", async () => {
  const db = montarDb();
  db.tabelas.campanha_envios.push({ campanha_id: "A", conta_id: "c1", telefone: "5571911111111", status: "pendente" });
  const p = await publicoDa(db, "c1", {}, agora);
  assert.ok(!p.contatos.some((c) => c.telefone === "5571911111111"), "já está na fila de outra campanha");
  db.tabelas.campanha_envios.length = 0;
  db.tabelas.campanhas.push({ id: "k", conta_id: "c1", status: "enviando", agendada_para: dias(-1), template_nome: "t", texto: "x", filtro: {}, enviadas: 0, falhas: 0 });
  db.tabelas.campanha_envios.push({ id: "e1", campanha_id: "k", conta_id: "c1", telefone: "5571911111111", nome: "Ana", status: "pendente" });
  db.tabelas.conversas[0].novidades = "nao"; // pediu SAIR depois
  const antes = chamadas.filter((c) => c.caminho === "PN/messages").length;
  await rodarCampanhas({}, db, agora);
  assert.equal(chamadas.filter((c) => c.caminho === "PN/messages").length, antes, "não enviou");
  assert.equal(db.tabelas.campanha_envios[0].erro, "saiu da lista");
});
