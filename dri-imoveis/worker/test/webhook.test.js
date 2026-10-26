import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeDb } from "./fakedb.js";

const meta = [];   // chamadas à Graph API
let metaFalha = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/models")) {
    const ok = init?.headers?.authorization === "Bearer chave-boa-com-mais-de-vinte-letras";
    return new Response(JSON.stringify(ok ? { data: [] } : { error: { message: "Invalid API Key" } }), { status: ok ? 200 : 401 });
  }
  if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
  meta.push({ url: u, metodo: init?.method || "GET", corpo: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization });
  if (metaFalha && u.includes(metaFalha.trecho)) return new Response(JSON.stringify({ error: { message: metaFalha.msg } }), { status: 400 });
  if (u.includes("?fields=")) return new Response(JSON.stringify({ display_phone_number: "+55 71 98888-0000", verified_name: "Carlos Imóveis" }));
  return new Response(JSON.stringify({ success: true }));
};
const worker = (await import("../src/index.js")).default;

function montar() {
  const db = fakeDb({ contas: [{ id: "c1", owner_id: "u1", nome: "Carlos" }], whatsapp_conexoes: [], whatsapp_segredos: [], wa_mensagens_recebidas: [] });
  db.auth = { getUser: async (t) => (t === "tok-u1" ? { data: { user: { id: "u1" } }, error: null } : { data: null, error: { message: "x" } }) };
  const entregues = [];
  const env = {
    __dbTeste: db,
    CONVERSA: { idFromName: (n) => n, get: (id) => ({ fetch: async (_u, init) => { entregues.push({ ...JSON.parse(init.body), objeto: id }); return new Response("ok"); } }) },
  };
  const esperas = [];
  const ctx = { waitUntil: (p) => esperas.push(p) };
  const chamar = async (metodo, caminho, corpo, extra = {}) => {
    const r = await worker.fetch(new Request("https://dri.test" + caminho, {
      method: metodo, body: corpo == null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
      headers: { authorization: "Bearer tok-u1", ...extra },
    }), env, ctx);
    await Promise.all(esperas.splice(0));
    return r;
  };
  return { db, env, entregues, chamar };
}

const SEGREDO = "0123456789abcdef0123456789abcdef";
const assinar = (corpo, segredo = SEGREDO) => "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");
const payload = (phoneId, id, texto) => JSON.stringify({ entry: [{ changes: [{ value: {
  metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: "5571977776666", profile: { name: "Bia" } }],
  messages: [{ id, from: "5571977776666", type: "text", timestamp: "1761500000", text: { body: texto } }] } }] }] });

test("passo a passo completo: preparar, verificar webhook, conectar, receber mensagem", async () => {
  const { db, entregues, chamar } = montar();

  // 1. painel pede o endereço do webhook e o token de verificação
  const prep = await (await chamar("POST", "/whatsapp/preparar", {})).json();
  assert.match(prep.webhook_url, /^https:\/\/dri\.test\/webhook\/[a-f0-9]{32}$/);
  assert.match(prep.verify_token, /^[a-f0-9]{24}$/);
  const caminho = new URL(prep.webhook_url).pathname;
  // chamar de novo devolve o mesmo endereço
  assert.equal((await (await chamar("POST", "/whatsapp/preparar", {})).json()).webhook_url, prep.webhook_url);

  // 2. a Meta verifica o webhook com o token
  const ruim = await chamar("GET", `${caminho}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123`);
  assert.equal(ruim.status, 403);
  const bom = await chamar("GET", `${caminho}?hub.mode=subscribe&hub.verify_token=${prep.verify_token}&hub.challenge=987`);
  assert.equal(await bom.text(), "987");
  assert.ok(db.tabelas.whatsapp_conexoes[0].webhook_verificado_em);

  // 3. corretor cola os dados
  const erro = await (await chamar("POST", "/whatsapp/conectar", { phone_number_id: "111", waba_id: "222", access_token: "EAAx", app_secret: "curta" })).json();
  assert.match(erro.error, /32 letras/);
  const ok = await (await chamar("POST", "/whatsapp/conectar", { phone_number_id: " 111 ", waba_id: "222", access_token: "EAAx", app_secret: SEGREDO.toUpperCase(), pin: "123456" })).json();
  assert.equal(ok.numero, "+55 71 98888-0000");
  assert.deepEqual(meta.map((m) => m.url.split("/").slice(4).join("/")), ["111?fields=display_phone_number,verified_name", "222/subscribed_apps", "111/register"]);
  assert.equal(meta[2].corpo.pin, "123456");
  assert.equal(meta[0].auth, "Bearer EAAx");
  assert.equal(db.tabelas.whatsapp_conexoes[0].status, "conectado");
  assert.equal(db.tabelas.whatsapp_segredos[0].app_secret, SEGREDO);

  // 4. mensagem com assinatura errada é recusada
  const corpo = payload("111", "wamid.1", "Oi, vi o anúncio");
  assert.equal((await chamar("POST", caminho, corpo, { "x-hub-signature-256": assinar(corpo, "f".repeat(32)) })).status, 401);
  assert.equal(entregues.length, 0);

  // 5. mensagem certa chega na conversa; repetida (a Meta reenvia) é ignorada
  assert.equal((await chamar("POST", caminho, corpo, { "x-hub-signature-256": assinar(corpo) })).status, 200);
  await chamar("POST", caminho, corpo, { "x-hub-signature-256": assinar(corpo) });
  assert.equal(entregues.length, 1);
  assert.equal(entregues[0].objeto, "c1:5571977776666");
  assert.equal(entregues[0].texto, "Oi, vi o anúncio");
  assert.ok(db.tabelas.whatsapp_conexoes[0].ultima_mensagem_em);

  // 6. mensagem de outro número do mesmo app não entra nesta conta
  const outro = payload("999", "wamid.2", "oi");
  await chamar("POST", caminho, outro, { "x-hub-signature-256": assinar(outro) });
  assert.equal(entregues.length, 1);

  // 7. status: lista de verificação
  const st = await (await chamar("POST", "/whatsapp/status", {})).json();
  assert.equal(st.conectado, true);
  assert.ok(st.webhook_verificado_em && st.ultima_mensagem_em);
});

test("erros da Meta viram mensagens que o corretor entende", async () => {
  const { chamar } = montar();
  await chamar("POST", "/whatsapp/preparar", {});
  metaFalha = { trecho: "fields=", msg: "Invalid OAuth access token" };
  const r = await (await chamar("POST", "/whatsapp/conectar", { phone_number_id: "1", waba_id: "2", access_token: "x", app_secret: SEGREDO })).json();
  assert.match(r.error, /não aceitou o token.*Invalid OAuth/);
  metaFalha = { trecho: "subscribed_apps", msg: "Unsupported post request" };
  const r2 = await (await chamar("POST", "/whatsapp/conectar", { phone_number_id: "1", waba_id: "2", access_token: "x", app_secret: SEGREDO })).json();
  assert.match(r2.error, /ID da conta \(WABA\)/);
  metaFalha = null;
});

test("webhook de chave desconhecida e painel sem login", async () => {
  const { chamar } = montar();
  assert.equal((await chamar("GET", "/webhook/" + "a".repeat(32) + "?hub.mode=subscribe")).status, 404);
  const r = await worker.fetch(new Request("https://dri.test/whatsapp/preparar", { method: "POST" }), { __dbTeste: montar().db }, { waitUntil() {} });
  assert.equal(r.status, 401);
});

test("corretor cadastra a própria chave de IA (conferida antes de salvar)", async () => {
  const { db, chamar } = montar();
  const ruim = await (await chamar("POST", "/ia/salvar", { provedor: "groq", chave: "chave-ruim-com-mais-de-vinte-letras" })).json();
  assert.match(ruim.error, /não aceitou a chave.*Invalid API Key/);
  assert.equal((db.tabelas.ia_chaves || []).length, 0);
  const ok = await (await chamar("POST", "/ia/salvar", { provedor: "groq", chave: "chave-boa-com-mais-de-vinte-letras" })).json();
  assert.equal(ok.ok, true);
  const st = await (await chamar("POST", "/ia/status", {})).json();
  assert.deepEqual(st.chaves.map((c) => [c.provedor, c.final]), [["groq", "…tras"]]);
  assert.ok(!JSON.stringify(st).includes("chave-boa"), "a chave inteira nunca volta para o painel");
  await chamar("POST", "/ia/remover", { provedor: "groq" });
  assert.equal(db.tabelas.ia_chaves.length, 0);
});
