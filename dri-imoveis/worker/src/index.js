// ============================================================
// Dri Imóveis — Cloudflare Worker
//   GET  /                      diagnóstico (quais segredos estão configurados)
//   GET  /config                dados públicos para o painel (app da Meta)
//   GET  /webhook               verificação do webhook pela Meta
//   POST /webhook               mensagens do WhatsApp -> Durable Object da conversa
//   POST /simular               conversa de teste no painel (login do corretor)
//   POST /simular/reiniciar     apaga a conversa de teste
//   POST /whatsapp/embedded     conclui o "Conectar WhatsApp" (Embedded Signup)
//   POST /whatsapp/manual       conexão manual com token (plano B)
//   POST /whatsapp/status       confere a conexão
//   POST /responder             corretor responde um cliente pelo painel
//
// Segredos (wrangler secret put …): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN e pelo menos uma IA:
//   GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY (as três = troca automática)
// Opcionais: META_CONFIG_ID (Embedded Signup), RESEND_API_KEY + EMAIL_REMETENTE,
//   TEMPLATE_AVISO, PAINEL_URL, PAINEL_ORIGEM, IA_ORDEM, *_MODELO, GRAPH_VERSION
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { responder, registrarSemResponder } from "./agente.js";
import { provedoresAtivos } from "./ia.js";
import {
  assinaturaValida, extrairMensagens, enviarTexto, enviarImagem, marcarLida,
  concluirEmbeddedSignup, lerNumero, assinarWaba,
} from "./whatsapp.js";

const ESPERA_MS = 3500;          // junta mensagens picadas ("oi" / "tudo bem?" / "vi o anúncio")
const SIMULADOR = "simulador";

const banco = (env) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(env) {
  return {
    "access-control-allow-origin": env.PAINEL_ORIGEM || "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}
const json = (env, dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json", ...cors(env) } });

async function contaDoUsuario(req, env, db) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: conta } = await db.from("contas").select("*").eq("owner_id", data.user.id).maybeSingle();
  return conta;
}

async function conexaoDaConta(db, contaId) {
  const [c, s] = await Promise.all([
    db.from("whatsapp_conexoes").select("*").eq("conta_id", contaId).maybeSingle(),
    db.from("whatsapp_segredos").select("access_token").eq("conta_id", contaId).maybeSingle(),
  ]);
  if (!c.data?.phone_number_id || !s.data?.access_token || c.data.status !== "conectado") return null;
  return { ...c.data, token: s.data.access_token };
}

async function salvarConexao(db, contaId, { phone_number_id, waba_id, token, numero }) {
  const r1 = await db.from("whatsapp_conexoes").upsert({
    conta_id: contaId, phone_number_id, waba_id,
    numero_exibicao: numero?.display_phone_number || null,
    status: "conectado", detalhe: numero?.verified_name || null, conectado_em: new Date().toISOString(),
  });
  if (r1.error) throw new Error(r1.error.code === "23505" ? "Esse número já está ligado a outra conta." : r1.error.message);
  const r2 = await db.from("whatsapp_segredos").upsert({ conta_id: contaId, access_token: token, atualizado_em: new Date().toISOString() });
  if (r2.error) throw new Error(r2.error.message);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const rota = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });

    try {
      if (rota === "GET /") {
        return json(env, {
          servico: "dri-imoveis",
          ia: provedoresAtivos(env), banco: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          meta_app: !!(env.META_APP_ID && env.META_APP_SECRET), webhook: !!env.META_VERIFY_TOKEN,
          embedded_signup: !!env.META_CONFIG_ID, email: !!env.RESEND_API_KEY,
        });
      }
      if (rota === "GET /config") {
        return json(env, {
          meta_app_id: env.META_APP_ID || null, meta_config_id: env.META_CONFIG_ID || null,
          graph_version: env.GRAPH_VERSION || "v23.0", webhook_url: `${url.origin}/webhook`,
        });
      }

      // ---------------------------------------------------------------- Meta
      if (rota === "GET /webhook") {
        const ok = url.searchParams.get("hub.mode") === "subscribe" &&
          env.META_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === env.META_VERIFY_TOKEN;
        return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("forbidden", { status: 403 });
      }
      if (rota === "POST /webhook") {
        const bruto = await req.text();
        if (!(await assinaturaValida(env, bruto, req.headers.get("x-hub-signature-256"))))
          return new Response("assinatura inválida", { status: 401 });
        const msgs = extrairMensagens(JSON.parse(bruto));
        if (msgs.length) ctx.waitUntil(encaminhar(env, msgs));
        return new Response("ok"); // a Meta precisa de 200 rápido
      }

      // ---------------------------------------------------------------- painel
      const db = banco(env);
      const conta = await contaDoUsuario(req, env, db);
      if (!conta) return json(env, { error: "Faça login de novo." }, 401);
      const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};

      if (rota === "POST /simular") {
        const texto = String(corpo.texto || "").trim().slice(0, 2000);
        if (!texto) return json(env, { error: "Mensagem vazia." }, 400);
        const respostas = [];
        const resposta = await responder({
          env, db, conta, telefone: SIMULADOR, nome: corpo.nome || "Cliente de teste", canal: "simulador",
          agora: new Date(), conexao: null,
          enviarFoto: async (u, legenda) => respostas.push({ tipo: "foto", url: u, legenda }),
        }, [texto]);
        if (resposta) respostas.push({ tipo: "texto", texto: resposta });
        return json(env, { respostas });
      }
      if (rota === "POST /simular/reiniciar") {
        await Promise.all([
          db.from("conversas").delete().eq("conta_id", conta.id).eq("telefone", SIMULADOR),
          db.from("leads").delete().eq("conta_id", conta.id).eq("telefone", SIMULADOR),
          db.from("visitas").delete().eq("conta_id", conta.id).eq("status", "teste"),
        ]);
        return json(env, { ok: true });
      }

      if (rota === "POST /whatsapp/embedded") {
        if (!corpo.code || !corpo.phone_number_id || !corpo.waba_id)
          return json(env, { error: "A Meta não devolveu os dados do número. Tente de novo." }, 400);
        const { token, numero } = await concluirEmbeddedSignup(env, corpo);
        await salvarConexao(db, conta.id, { ...corpo, token, numero });
        return json(env, { ok: true, numero: numero?.display_phone_number, nome: numero?.verified_name });
      }
      if (rota === "POST /whatsapp/manual") {
        const { phone_number_id, waba_id, access_token } = corpo;
        if (!phone_number_id || !waba_id || !access_token)
          return json(env, { error: "Preencha o ID do número, o ID da conta (WABA) e o token." }, 400);
        const numero = await lerNumero(env, access_token, phone_number_id);
        await assinarWaba(env, access_token, waba_id);
        await salvarConexao(db, conta.id, { phone_number_id, waba_id, token: access_token, numero });
        return json(env, { ok: true, numero: numero?.display_phone_number, nome: numero?.verified_name });
      }
      if (rota === "POST /whatsapp/status") {
        const conexao = await conexaoDaConta(db, conta.id);
        if (!conexao) return json(env, { conectado: false });
        try {
          const numero = await lerNumero(env, conexao.token, conexao.phone_number_id);
          return json(env, { conectado: true, numero: numero.display_phone_number, nome: numero.verified_name });
        } catch (e) {
          await db.from("whatsapp_conexoes").update({ status: "erro", detalhe: e.message }).eq("conta_id", conta.id);
          return json(env, { conectado: false, erro: e.message });
        }
      }
      if (rota === "POST /responder") {
        const texto = String(corpo.texto || "").trim();
        const telefone = String(corpo.telefone || "").replace(/\D/g, "");
        if (!texto || !telefone) return json(env, { error: "Escreva a mensagem." }, 400);
        const conexao = await conexaoDaConta(db, conta.id);
        if (!conexao) return json(env, { error: "WhatsApp ainda não conectado." }, 400);
        const { data: conversa } = await db.from("conversas").select("id,transcricao,ultima_cliente_em")
          .eq("conta_id", conta.id).eq("telefone", telefone).maybeSingle();
        if (!conversa) return json(env, { error: "Conversa não encontrada." }, 404);
        if (!conversa.ultima_cliente_em || Date.now() - new Date(conversa.ultima_cliente_em) > 24 * 3600e3)
          return json(env, { error: "Já se passaram 24 h da última mensagem do cliente. Pela regra da Meta, só dá para escrever primeiro com um modelo aprovado. Ligue ou mande do seu WhatsApp." }, 400);
        await enviarTexto(env, conexao, telefone, texto);
        await db.from("conversas").update({
          transcricao: [...(conversa.transcricao || []), { de: "corretor", texto, em: new Date().toISOString() }].slice(-200),
          atualizado_em: new Date().toISOString(),
        }).eq("id", conversa.id);
        return json(env, { ok: true });
      }

      return json(env, { error: "Rota não encontrada." }, 404);
    } catch (e) {
      console.error(rota, e);
      return json(env, { error: String(e.message || e) }, 500);
    }
  },
};

// Webhook: descarta repetidas e entrega cada mensagem ao objeto da conversa
async function encaminhar(env, msgs) {
  const db = banco(env);
  for (const m of msgs) {
    const { data: nova } = await db.from("wa_mensagens_recebidas")
      .upsert({ message_id: m.id }, { onConflict: "message_id", ignoreDuplicates: true }).select();
    if (!nova?.length) continue; // a Meta reenviou
    const { data: conexao } = await db.from("whatsapp_conexoes").select("conta_id")
      .eq("phone_number_id", m.phoneNumberId).eq("status", "conectado").maybeSingle();
    if (!conexao) continue;
    const stub = env.CONVERSA.get(env.CONVERSA.idFromName(`${conexao.conta_id}:${m.de}`));
    await stub.fetch("https://conversa/mensagem", {
      method: "POST", body: JSON.stringify({ ...m, contaId: conexao.conta_id }),
    });
  }
}

const TIPO_SEM_TEXTO = {
  audio: "[O cliente mandou um áudio, que você não consegue ouvir.]",
  video: "[O cliente mandou um vídeo, que você não consegue ver.]",
  sticker: "[O cliente mandou uma figurinha.]",
  image: "[O cliente mandou uma imagem sem legenda, que você não consegue ver.]",
  document: "[O cliente mandou um documento, que você não consegue abrir.]",
  contacts: "[O cliente compartilhou um contato.]",
  reaction: null, // reação a mensagem: ignora
};

// Um objeto por conversa (conta + telefone): processa as mensagens em fila, uma rodada por vez.
export class Conversa {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.rodando = false;
  }

  async fetch(req) {
    const m = await req.json();
    const fila = (await this.state.storage.get("fila")) || [];
    if (!fila.length) await this.state.storage.put("primeiraEm", Date.now());
    fila.push(m);
    await this.state.storage.put("fila", fila);
    // espera um pouco por mais mensagens, mas não mais que 15 s desde a primeira da fila
    const primeira = (await this.state.storage.get("primeiraEm")) || Date.now();
    await this.state.storage.setAlarm(Math.min(Date.now() + ESPERA_MS, primeira + 15000));
    return new Response("ok");
  }

  async alarm() {
    if (this.rodando) return; // a rodada atual pega o que chegou
    this.rodando = true;
    try {
      for (;;) {
        const fila = (await this.state.storage.get("fila")) || [];
        if (!fila.length) break;
        await this.state.storage.delete("fila");
        await this.processar(fila).catch((e) => console.error("conversa", e));
      }
    } finally {
      this.rodando = false;
    }
  }

  async processar(fila) {
    const env = this.env;
    const db = banco(env);
    const { contaId, de: telefone } = fila[0];
    const nome = fila.map((m) => m.nome).filter(Boolean).pop() || null;
    const textos = fila.map((m) => m.texto ?? TIPO_SEM_TEXTO[m.tipo] ?? (m.tipo in TIPO_SEM_TEXTO ? null : `[Mensagem do tipo ${m.tipo}]`))
      .filter(Boolean);
    if (!textos.length) return;

    const [{ data: conta }, conexao] = await Promise.all([
      db.from("contas").select("*").eq("id", contaId).maybeSingle(),
      conexaoDaConta(db, contaId),
    ]);
    if (!conta || !conexao) return;
    await marcarLida(env, conexao, fila[fila.length - 1].id);

    const ctx = {
      env, db, conta, conexao, telefone, nome, canal: "whatsapp", agora: new Date(),
      enviarFoto: (u, legenda) => enviarImagem(env, conexao, telefone, u, legenda),
    };
    const { data: conversa } = await db.from("conversas").select("precisa_corretor")
      .eq("conta_id", contaId).eq("telefone", telefone).maybeSingle();
    if (conversa?.precisa_corretor) return registrarSemResponder(ctx, textos);

    try {
      const resposta = await responder(ctx, textos);
      if (resposta) await enviarTexto(env, conexao, telefone, resposta);
    } catch (e) {
      console.error("responder", e);
      await enviarTexto(env, conexao, telefone,
        "Desculpe, tive um probleminha aqui. O corretor já foi avisado e te responde em seguida.").catch(() => {});
      await db.from("conversas").upsert({
        conta_id: contaId, telefone, nome, precisa_corretor: true, motivo: `Erro técnico: ${String(e.message || e).slice(0, 200)}`,
      }, { onConflict: "conta_id,telefone" });
    }
  }
}
