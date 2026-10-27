import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeDb } from "./fakedb.js";

// API do Mercado Pago de mentira
const mpRespostas = {};
const mpChamadas = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.mercadopago.com")) {
    const caminho = u.slice("https://api.mercadopago.com".length);
    mpChamadas.push({ metodo: init?.method || "GET", caminho, corpo: init?.body ? JSON.parse(init.body) : null });
    const r = mpRespostas[`${init?.method || "GET"} ${caminho}`] ?? mpRespostas[caminho];
    return new Response(JSON.stringify(r ?? { message: "not found" }), { status: r ? 200 : 404 });
  }
  if (u.startsWith("https://graph.facebook.com/")) {
    if (u.includes("?fields=")) return new Response(JSON.stringify({ display_phone_number: "+55 71 98888-0000", verified_name: "Carlos Imóveis" }));
    return new Response(JSON.stringify({ success: true }));
  }
  throw new Error("fetch inesperado " + u);
};
const { situacao, webhookValido, processarAvisoMP, atualizarPausas, criarAssinatura } = await import("../src/cobranca.js");
const worker = (await import("../src/index.js")).default;

const cfg = { preco_mensal: 197, dias_teste: 5, dias_tolerancia: 2, comissao_adesao: 100 };
const DIA = 24 * 3600e3;
const agora = new Date("2026-11-10T12:00:00Z");
const dias = (n) => new Date(agora.getTime() + n * DIA).toISOString();

test("situação: teste, tolerância do pagamento recusado, cortesia", () => {
  assert.deepEqual(situacao({ status: "teste", teste_ate: dias(2) }, cfg, agora).pode_atender, true);
  assert.equal(situacao({ status: "teste", teste_ate: dias(2) }, cfg, agora).dias_restantes, 2);
  assert.deepEqual(situacao({ status: "teste", teste_ate: dias(-0.1) }, cfg, agora), { status: "pausada", motivo: "teste_acabou", pode_atender: false });
  const atrasada = situacao({ status: "atrasada", falhou_em: dias(-1) }, cfg, agora);
  assert.equal(atrasada.pode_atender, true, "ainda dentro dos 2 dias");
  assert.equal(atrasada.pausa_em, dias(1));
  assert.equal(situacao({ status: "atrasada", falhou_em: dias(-2.1) }, cfg, agora).pode_atender, false, "passou dos 2 dias: pausa");
  assert.equal(situacao({ status: "cortesia" }, cfg, agora).pode_atender, true);
  assert.equal(situacao({ status: "cancelada" }, cfg, agora).pode_atender, false);
});

test("confere a assinatura do aviso do Mercado Pago", async () => {
  const ts = "1700000000", req = "req-1", id = "AbC123";
  const v1 = createHmac("sha256", "segredo").update(`id:abc123;request-id:${req};ts:${ts};`).digest("hex");
  const h = (v) => new Headers({ "x-signature": `ts=${ts},v1=${v}`, "x-request-id": req });
  assert.equal(await webhookValido("segredo", h(v1), id), true);
  assert.equal(await webhookValido("segredo", h(v1.replace(/.$/, "0")), id), false);
  assert.equal(await webhookValido("outro", h(v1), id), false);
  assert.equal(await webhookValido("segredo", new Headers(), id), false);
});

function montarDb() {
  return fakeDb({
    plataforma_config: [{ id: true, ...cfg }],
    contas: [
      { id: "c1", owner_id: "u1", nome: "Carlos Andrade", nome_assistente: "Dri", whatsapp_pessoal: "71999990000" },
      { id: "c2", owner_id: "u2", nome: "Ana Lima", nome_assistente: "Dri" },
    ],
    parceiros: [{ id: "p1", codigo: "ana-lima", nome: "Ana Lima", conta_id: "c2", pix: "ana@pix", ativo: true }],
    assinaturas: [{ conta_id: "c1", status: "teste", teste_ate: dias(3), parceiro_id: "p1" }],
    pagamentos: [], comissoes: [], avisos_admin: [],
  });
}

test("assinar no teste: a primeira cobrança fica para o fim do teste", async () => {
  const db = montarDb();
  mpRespostas["POST /preapproval"] = { id: "pre-1", init_point: "https://mp/pagar" };
  const r = await criarAssinatura({ MERCADOPAGO_ACCESS_TOKEN: "t" }, db, { conta: db.tabelas.contas[0], email: "carlos@ex.com", voltarPara: "https://painel", agora });
  assert.equal(r.link, "https://mp/pagar");
  const pedido = mpChamadas.at(-1).corpo;
  assert.equal(pedido.external_reference, "c1");
  assert.equal(pedido.auto_recurring.transaction_amount, 197);
  assert.equal(pedido.auto_recurring.start_date, dias(3));
});

test("cartão autorizado, cobrança paga gera um PIX de comissão por adesão (só uma vez)", async () => {
  const db = montarDb();
  const env = { MERCADOPAGO_ACCESS_TOKEN: "t" };
  mpRespostas["/preapproval/pre-1"] = { id: "pre-1", status: "authorized", external_reference: "c1", payer_email: "carlos@ex.com",
    next_payment_date: dias(3), auto_recurring: { transaction_amount: 197 } };
  await processarAvisoMP(env, db, { tipo: "subscription_preapproval", id: "pre-1" }, agora);
  let a = db.tabelas.assinaturas[0];
  assert.equal(a.mp_preapproval_id, "pre-1");
  assert.equal(a.status, "teste", "continua no teste até a primeira cobrança");

  mpRespostas["/authorized_payments/900"] = { id: 900, preapproval_id: "pre-1", status: "processed", transaction_amount: 197, payment: { id: 1, status: "approved" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "900" }, agora);
  a = db.tabelas.assinaturas[0];
  assert.equal(a.status, "ativa");
  assert.equal(db.tabelas.pagamentos.length, 1);
  assert.deepEqual(db.tabelas.comissoes.map((c) => [c.parceiro_id, c.conta_id, c.valor]), [["p1", "c1", 100]]);
  assert.match(db.tabelas.avisos_admin.at(-1).texto, /PIX ana@pix/);

  mpRespostas["/authorized_payments/901"] = { id: 901, preapproval_id: "pre-1", status: "processed", transaction_amount: 197, payment: { id: 2, status: "approved" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "901" }, agora);
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "900" }, agora); // aviso repetido
  assert.equal(db.tabelas.pagamentos.length, 2);
  assert.equal(db.tabelas.comissoes.length, 1, "mensalidade seguinte não gera outra comissão");
});

test("cobrança recusada: atrasada, avisa o administrador, pausa depois de 2 dias e volta quando paga", async () => {
  const db = montarDb();
  const env = { MERCADOPAGO_ACCESS_TOKEN: "t" };
  Object.assign(db.tabelas.assinaturas[0], { status: "ativa", mp_preapproval_id: "pre-1" });
  mpRespostas["/authorized_payments/950"] = { id: 950, preapproval_id: "pre-1", status: "recycling", transaction_amount: 197, payment: { id: 3, status: "rejected", status_detail: "cc_rejected_insufficient_amount" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "950" }, agora);
  const a = db.tabelas.assinaturas[0];
  assert.equal(a.status, "atrasada");
  assert.equal(a.falhou_em, agora.toISOString());
  assert.match(db.tabelas.avisos_admin[0].assunto, /recusado/);
  assert.equal(db.tabelas.comissoes.length, 0);

  assert.equal(await atualizarPausas(env, db, new Date(agora.getTime() + 1 * DIA)), 0, "1 dia depois ainda atende");
  assert.equal(await atualizarPausas(env, db, new Date(agora.getTime() + 2.1 * DIA)), 1);
  assert.equal(a.status, "pausada");

  mpRespostas["/authorized_payments/951"] = { id: 951, preapproval_id: "pre-1", status: "processed", transaction_amount: 197, payment: { id: 4, status: "approved" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "951" }, new Date(agora.getTime() + 3 * DIA));
  assert.equal(a.status, "ativa");
  assert.equal(a.falhou_em, null);
});

test("cartão novo (reativar) cancela a assinatura antiga no Mercado Pago", async () => {
  const db = montarDb();
  Object.assign(db.tabelas.assinaturas[0], { status: "pausada", mp_preapproval_id: "pre-velha", falhou_em: dias(-5) });
  mpRespostas["/preapproval/pre-nova"] = { id: "pre-nova", status: "authorized", external_reference: "c1", auto_recurring: { transaction_amount: 197 } };
  mpRespostas["PUT /preapproval/pre-velha"] = { id: "pre-velha", status: "cancelled" };
  await processarAvisoMP({ MERCADOPAGO_ACCESS_TOKEN: "t" }, db, { tipo: "subscription_preapproval", id: "pre-nova" }, agora);
  assert.equal(db.tabelas.assinaturas[0].mp_preapproval_id, "pre-nova");
  assert.equal(db.tabelas.assinaturas[0].status, "ativa");
  assert.deepEqual(mpChamadas.at(-1), { metodo: "PUT", caminho: "/preapproval/pre-velha", corpo: { status: "cancelled" } });
});

// ------------------------------------------------------------ rotas
function montarWorker() {
  const db = montarDb();
  const usuarios = { "tok-admin": { id: "u9", email: "janan.almeida@gmail.com", email_confirmed_at: "x" }, "tok-u1": { id: "u1", email: "carlos@ex.com", email_confirmed_at: "x" } };
  db.auth = {
    getUser: async (t) => (usuarios[t] ? { data: { user: usuarios[t] }, error: null } : { data: null, error: { message: "x" } }),
    admin: {
      listUsers: async () => ({ data: { users: [{ id: "u1", email: "carlos@ex.com" }, { id: "u2", email: "ana@ex.com" }] }, error: null }),
      getUserById: async (id) => ({ data: { user: { id, email: "carlos@ex.com" } } }),
    },
  };
  const env = { __dbTeste: db, ADMIN_EMAILS: "janan.almeida@gmail.com", SITE_URL: "https://dri.site" };
  const chamar = async (token, caminho, corpo = {}) => {
    const r = await worker.fetch(new Request("https://dri.test" + caminho, { method: "POST", body: JSON.stringify(corpo), headers: { authorization: `Bearer ${token}` } }), env, { waitUntil() {} });
    return { status: r.status, j: await r.json() };
  };
  return { db, chamar };
}

test("só o administrador entra na área de admin e pode dar cortesia", async () => {
  const { db, chamar } = montarWorker();
  assert.equal((await chamar("tok-u1", "/admin/resumo")).status, 403);
  assert.equal((await chamar("tok-u1", "/eu")).j.admin, false);
  assert.equal((await chamar("tok-admin", "/eu")).j.admin, true);

  const r = await chamar("tok-admin", "/admin/resumo");
  assert.equal(r.status, 200);
  assert.equal(r.j.numeros.contas, 2);
  assert.equal(r.j.contas.find((c) => c.id === "c1").email, "carlos@ex.com");
  assert.equal(r.j.contas.find((c) => c.id === "c1").parceiro, "ana-lima");
  assert.equal(r.j.parceiros[0].link, "https://dri.site/?p=ana-lima");

  await chamar("tok-admin", "/admin/conta", { conta_id: "c1", acao: "cortesia", motivo: "amigo" });
  assert.equal(db.tabelas.assinaturas[0].status, "cortesia");
  assert.equal((await chamar("tok-u1", "/assinatura/status")).j.status, "cortesia");
});

test("conta pausada não usa o simulador; corretor vira parceiro e recebe o link", async () => {
  const { db, chamar } = montarWorker();
  db.tabelas.assinaturas[0].teste_ate = new Date(Date.now() - DIA).toISOString();
  const s = await chamar("tok-u1", "/simular", { texto: "oi" });
  assert.equal(s.status, 402);

  assert.equal((await chamar("tok-u1", "/parceiro/aderir", { pix: "carlos@pix" })).status, 400, "precisa aceitar os termos");
  const p = await chamar("tok-u1", "/parceiro/aderir", { pix: "carlos@pix", aceito: true });
  assert.equal(p.status, 200);
  assert.equal(p.j.parceiro.link, "https://dri.site/?p=carlos-andrade");
  assert.equal(p.j.comissao_adesao, 100);
  const dup = await chamar("tok-u1", "/parceiro/aderir", { pix: "carlos@pix", aceito: true, codigo: "Ana Lima" });
  assert.equal(dup.status, 400, "link já usado por outro parceiro");
  assert.equal((await chamar("tok-u1", "/parceiro/aderir", { pix: "carlos@pix", aceito: true, codigo: "Dri Imóveis" })).status, 400, "nome reservado");
});

test("duplicidade: mesmo pagador em outra conta ou o próprio parceiro ficam em análise; paga não se repete", async () => {
  const db = montarDb();
  const env = { MERCADOPAGO_ACCESS_TOKEN: "t" };
  // c1 já assina (sem parceiro); c3 é outra conta da mesma pessoa, criada pelo link da Ana
  Object.assign(db.tabelas.assinaturas[0], { status: "ativa", parceiro_id: null, mp_preapproval_id: "pre-1", mp_email: "carlos@ex.com", assinou_em: dias(-30) });
  db.tabelas.contas.push({ id: "c3", owner_id: "u3", nome: "Carlos A.", nome_assistente: "Dri", criado_em: dias(-1) });
  db.tabelas.assinaturas.push({ conta_id: "c3", status: "teste", teste_ate: dias(-0.1), parceiro_id: "p1", mp_preapproval_id: "pre-3", mp_email: "Carlos@ex.com" });
  mpRespostas["/authorized_payments/970"] = { id: 970, preapproval_id: "pre-3", status: "processed", transaction_amount: 197, payment: { id: 7, status: "approved" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "970" }, agora);
  const c = db.tabelas.comissoes[0];
  assert.equal(c.status, "em análise");
  assert.match(c.motivo, /mesmo pagador/);
  assert.equal(c.pagamento_mp_id, "970");
  assert.equal(c.cadastro_em, dias(-1), "cruzamento: data do cadastro pelo link");
  assert.match(db.tabelas.avisos_admin.at(-1).assunto, /em análise/);

  // depois de paga, novo ciclo (cancelou e assinou de novo) não gera outra
  c.status = "pago";
  db.tabelas.assinaturas[1].mp_preapproval_id = "pre-4";
  mpRespostas["/authorized_payments/971"] = { id: 971, preapproval_id: "pre-4", status: "processed", transaction_amount: 197, payment: { id: 8, status: "approved" } };
  await processarAvisoMP(env, db, { tipo: "subscription_authorized_payment", id: "971" }, agora);
  assert.equal(db.tabelas.comissoes.length, 1);
});

test("o próprio parceiro se indicando com outra conta fica em análise", async () => {
  const db = montarDb();
  db.tabelas.contas[1].whatsapp_pessoal = "(71) 98888-7777";            // Ana, a parceira
  db.tabelas.contas[0].whatsapp_pessoal = "5571988887777";              // conta nova com o mesmo WhatsApp
  Object.assign(db.tabelas.assinaturas[0], { mp_preapproval_id: "pre-1" });
  mpRespostas["/authorized_payments/980"] = { id: 980, preapproval_id: "pre-1", status: "processed", transaction_amount: 197, payment: { id: 9, status: "approved" } };
  await processarAvisoMP({ MERCADOPAGO_ACCESS_TOKEN: "t" }, db, { tipo: "subscription_authorized_payment", id: "980" }, agora);
  assert.equal(db.tabelas.comissoes[0].status, "em análise");
  assert.match(db.tabelas.comissoes[0].motivo, /próprio parceiro/);
});

test("conexão assistida: corretor pede, administrador vê o pedido e conecta pelo corretor", async () => {
  const { db, chamar } = montarWorker();
  Object.assign(db.tabelas, { pedidos_conexao: [], whatsapp_conexoes: [], whatsapp_segredos: [] });
  assert.equal((await chamar("tok-u1", "/whatsapp/pedir", { nome_exibicao: "Carlos Imóveis", numero: "71 9888" })).status, 400);
  const p = await chamar("tok-u1", "/whatsapp/pedir", { nome_exibicao: "Carlos Imóveis", numero: "(71) 98888-0000", numero_situacao: "livre", portfolio_convidado: true, melhor_horario: "manhã" });
  assert.equal(p.status, 200);
  assert.match(db.tabelas.avisos_admin.at(-1).texto, /já convidou você/);
  assert.equal((await chamar("tok-u1", "/admin/whatsapp/conectar", { conta_id: "c1" })).status, 403, "só o administrador");

  const r = await chamar("tok-admin", "/admin/resumo");
  assert.equal(r.j.pedidos[0].conta, "Carlos Andrade");
  assert.equal(r.j.numeros.pedidos_conexao, 1);
  const d = await chamar("tok-admin", "/admin/whatsapp/dados", { conta_id: "c1" });
  assert.match(d.j.webhook_url, /^https:\/\/dri\.test\/webhook\/[a-f0-9]{32}$/);
  const c = await chamar("tok-admin", "/admin/whatsapp/conectar", { conta_id: "c1", phone_number_id: "111", waba_id: "222", access_token: "tok", app_secret: "a".repeat(32) });
  assert.equal(c.status, 200, JSON.stringify(c.j));
  assert.equal(db.tabelas.whatsapp_conexoes[0].status, "conectado");
  assert.equal(db.tabelas.pedidos_conexao[0].status, "em andamento");
  assert.equal((await chamar("tok-u1", "/whatsapp/pedido")).j.pedido.status, "em andamento");
});
