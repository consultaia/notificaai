// ============================================================
// Dri Imóveis — Cloudflare Worker
//   GET  /                      diagnóstico (quais segredos estão configurados)
//   GET  /webhook/<chave>       verificação do webhook pela Meta (app do corretor)
//   POST /webhook/<chave>       mensagens do WhatsApp -> Durable Object da conversa
//   POST /simular               conversa de teste no painel (login do corretor)
//   POST /simular/reiniciar     apaga a conversa de teste
//   POST /whatsapp/preparar     cria o endereço de webhook e o token de verificação da conta
//   POST /whatsapp/conectar     o corretor cola IDs, token e chave secreta do app dele
//   POST /whatsapp/status       lista de verificação da conexão
//   POST /responder             corretor responde um cliente pelo painel
//   POST /ia/status             quais IAs a conta tem (sem mostrar a chave)
//   POST /ia/salvar             confere e guarda a chave de IA do corretor
//   POST /ia/remover            apaga a chave de IA do corretor
//
// Cada corretor usa o próprio app da Meta (não precisa de Tech Provider): cada conta tem
// um webhook próprio, e a assinatura das mensagens é conferida com a chave secreta do app dela.
//
// Segredos (wrangler secret put …): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e pelo menos uma IA:
//   ANTHROPIC_API_KEY (Claude Haiku, paga, principal) e/ou GEMINI_API_KEY, GROQ_API_KEY,
//   CEREBRAS_API_KEY (gratuitas; viram reserva)
// Opcionais: RESEND_API_KEY + EMAIL_REMETENTE, TEMPLATE_AVISO, PAINEL_URL, PAINEL_ORIGEM,
//   IA_ORDEM, *_MODELO, GRAPH_VERSION, ALERTA_EMAIL (recebe o autoteste diário das IAs)
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { responder, registrarSemResponder } from "./agente.js";
import { transcrever } from "./audio.js";
import { provedoresAtivos, validarChave, PROVEDORES, autotestar, claudePrincipal } from "./ia.js";
import {
  assinaturaValida, extrairMensagens, enviarTexto, enviarImagem, marcarLida,
  lerNumero, assinarWaba, registrarNumero, baixarMidia,
} from "./whatsapp.js";

const ESPERA_MS = 3500;          // junta mensagens picadas ("oi" / "tudo bem?" / "vi o anúncio")
const SIMULADOR = "simulador";

// (__dbTeste: só os testes usam, para trocar o Supabase por um banco em memória)
const banco = (env) => env.__dbTeste || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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

const aleatorio = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Endereço de webhook e token de verificação da conta (criados uma vez)
async function prepararConexao(db, contaId) {
  const { data } = await db.from("whatsapp_conexoes").select("*").eq("conta_id", contaId).maybeSingle();
  if (data?.webhook_chave && data?.verify_token) return data;
  const novo = { conta_id: contaId, webhook_chave: aleatorio(16), verify_token: aleatorio(12) };
  const r = await db.from("whatsapp_conexoes").upsert(novo, { onConflict: "conta_id" }).select().single();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const soNumeros = (v) => String(v || "").replace(/\D/g, "");

export default {
  // Autoteste diário das IAs (cron em wrangler.toml): avisa por email se alguma caiu ou trocou de modelo
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(avisarAutoteste(env));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const rota = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });

    try {
      if (rota === "GET /") {
        return json(env, {
          servico: "dri-imoveis",
          ia: provedoresAtivos(env), banco: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          email: !!env.RESEND_API_KEY,
        });
      }

      // ---------------------------------------------------------------- Meta (app de cada corretor)
      const webhook = url.pathname.match(/^\/webhook\/([a-f0-9]{32})\/?$/);
      if (webhook) {
        const db = banco(env);
        const { data: conexao } = await db.from("whatsapp_conexoes").select("*").eq("webhook_chave", webhook[1]).maybeSingle();
        if (!conexao) return new Response("not found", { status: 404 });

        if (req.method === "GET") {
          const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === conexao.verify_token;
          if (!ok) return new Response("forbidden", { status: 403 });
          await db.from("whatsapp_conexoes").update({ webhook_verificado_em: new Date().toISOString() }).eq("conta_id", conexao.conta_id);
          return new Response(url.searchParams.get("hub.challenge"));
        }
        if (req.method === "POST") {
          const bruto = await req.text();
          const { data: segredo } = await db.from("whatsapp_segredos").select("app_secret").eq("conta_id", conexao.conta_id).maybeSingle();
          if (!(await assinaturaValida(segredo?.app_secret, bruto, req.headers.get("x-hub-signature-256"))))
            return new Response("assinatura inválida", { status: 401 });
          const msgs = extrairMensagens(JSON.parse(bruto))
            .filter((m) => !conexao.phone_number_id || m.phoneNumberId === conexao.phone_number_id);
          if (msgs.length) {
            ctx.waitUntil(Promise.all([
              db.from("whatsapp_conexoes").update({ ultima_mensagem_em: new Date().toISOString() }).eq("conta_id", conexao.conta_id),
              conexao.status === "conectado" ? encaminhar(env, conexao.conta_id, msgs) : null,
            ]));
          }
          return new Response("ok"); // a Meta precisa de 200 rápido
        }
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

      if (rota === "POST /whatsapp/preparar" || rota === "POST /whatsapp/status") {
        const c = await prepararConexao(db, conta.id);
        const base = {
          webhook_url: `${url.origin}/webhook/${c.webhook_chave}`, verify_token: c.verify_token,
          conectado: c.status === "conectado", numero: c.numero_exibicao, nome: c.detalhe,
          webhook_verificado_em: c.webhook_verificado_em, ultima_mensagem_em: c.ultima_mensagem_em,
        };
        if (rota === "POST /whatsapp/preparar" || c.status !== "conectado") return json(env, { ...base, erro: c.status === "erro" ? c.detalhe : null });
        // confere se o token ainda vale
        const conexao = await conexaoDaConta(db, conta.id);
        try {
          const numero = await lerNumero(env, conexao.token, conexao.phone_number_id);
          return json(env, { ...base, numero: numero.display_phone_number, nome: numero.verified_name });
        } catch (e) {
          await db.from("whatsapp_conexoes").update({ status: "erro", detalhe: e.message }).eq("conta_id", conta.id);
          return json(env, { ...base, conectado: false, erro: `O token parou de funcionar: ${e.message}` });
        }
      }
      if (rota === "POST /whatsapp/conectar") {
        const phone_number_id = soNumeros(corpo.phone_number_id), waba_id = soNumeros(corpo.waba_id);
        const access_token = String(corpo.access_token || "").trim(), app_secret = String(corpo.app_secret || "").trim().toLowerCase();
        const pin = soNumeros(corpo.pin);
        if (!phone_number_id || !waba_id || !access_token || !app_secret)
          return json(env, { error: "Preencha os quatro campos: ID do número, ID da conta do WhatsApp Business, token e chave secreta do app." }, 400);
        if (!/^[a-f0-9]{32}$/.test(app_secret))
          return json(env, { error: "A chave secreta do app tem 32 letras e números (de 0 a 9 e de a a f). Confira em Configurações do app → Básico." }, 400);
        if (corpo.pin && pin.length !== 6) return json(env, { error: "O PIN precisa ter 6 números." }, 400);
        await prepararConexao(db, conta.id);

        let numero;
        try { numero = await lerNumero(env, access_token, phone_number_id); }
        catch (e) { return json(env, { error: `A Meta não aceitou o token ou o ID do número: ${e.message}. Confira se copiou o ID do número (não o número de telefone) e se o token tem as permissões whatsapp_business_messaging e whatsapp_business_management.` }, 400); }
        try { await assinarWaba(env, access_token, waba_id); }
        catch (e) { return json(env, { error: `Não consegui ligar a conta do WhatsApp Business ao seu app: ${e.message}. Confira o ID da conta (WABA) e se o usuário do sistema tem acesso a ela.` }, 400); }
        if (pin) {
          try { await registrarNumero(env, access_token, phone_number_id, pin); }
          catch (e) { return json(env, { error: `Não consegui ativar o número na API: ${e.message}. Se o número já tinha verificação em duas etapas, use o mesmo PIN.` }, 400); }
        }
        const r1 = await db.from("whatsapp_conexoes").update({
          phone_number_id, waba_id, numero_exibicao: numero.display_phone_number || null, detalhe: numero.verified_name || null,
          status: "conectado", conectado_em: new Date().toISOString(),
        }).eq("conta_id", conta.id);
        if (r1.error) return json(env, { error: r1.error.code === "23505" ? "Esse número já está ligado a outra conta da Dri." : r1.error.message }, 400);
        const r2 = await db.from("whatsapp_segredos").upsert({ conta_id: conta.id, access_token, app_secret, atualizado_em: new Date().toISOString() });
        if (r2.error) throw new Error(r2.error.message);
        return json(env, { ok: true, numero: numero.display_phone_number, nome: numero.verified_name });
      }
      if (rota === "POST /ia/status") {
        const { data } = await db.from("ia_chaves").select("provedor,chave,validada_em,ultimo_erro,ultimo_erro_em").eq("conta_id", conta.id);
        return json(env, {
          ia_inclusa: claudePrincipal(env),
          reserva_da_plataforma: env.IA_RESERVA_PLATAFORMA !== "nao" && provedoresAtivos(env).length > 0,
          chaves: (data || []).map((c) => ({
            provedor: c.provedor, final: `…${c.chave.slice(-4)}`, validada_em: c.validada_em,
            ultimo_erro: c.ultimo_erro, ultimo_erro_em: c.ultimo_erro_em,
          })),
        });
      }
      if (rota === "POST /ia/salvar") {
        const provedor = String(corpo.provedor || ""), chave = String(corpo.chave || "").trim();
        if (!PROVEDORES[provedor] || PROVEDORES[provedor].anthropic) return json(env, { error: "Escolha Gemini, Groq ou Cerebras." }, 400);
        if (chave.length < 20) return json(env, { error: "Essa chave parece incompleta. Copie de novo." }, 400);
        try { await validarChave(provedor, chave); }
        catch (e) { return json(env, { error: `A ${provedor} não aceitou a chave: ${e.message}` }, 400); }
        const r = await db.from("ia_chaves").upsert({
          conta_id: conta.id, provedor, chave, validada_em: new Date().toISOString(), ultimo_erro: null, ultimo_erro_em: null,
        }, { onConflict: "conta_id,provedor" });
        if (r.error) throw new Error(r.error.message);
        return json(env, { ok: true });
      }
      if (rota === "POST /ia/remover") {
        await db.from("ia_chaves").delete().eq("conta_id", conta.id).eq("provedor", String(corpo.provedor || ""));
        return json(env, { ok: true });
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

export async function avisarAutoteste(env) {
  const { resultados, eventos } = await autotestar(env);
  const problemas = resultados.filter((r) => !r.ok || !r.usou_ferramenta);
  console.log("autoteste IA", JSON.stringify({ resultados, eventos }));
  if (!problemas.length && !eventos.length) return { resultados, eventos, avisado: false };
  if (!(env.RESEND_API_KEY && env.EMAIL_REMETENTE && env.ALERTA_EMAIL)) return { resultados, eventos, avisado: false };
  const linhas = [
    ...resultados.map((r) => r.ok
      ? `${r.ok && r.usou_ferramenta ? "OK" : "ATENÇÃO"} ${r.provedor}: modelo ${r.modelo}${r.usou_ferramenta ? "" : " respondeu sem usar a ferramenta"}`
      : `FALHOU ${r.provedor}: ${r.erro}`),
    ...eventos.map((e) => e.tipo === "aposentado"
      ? `Modelo aposentado: ${e.provedor} ${e.modelo} (${e.erro})`
      : `Modelo novo em uso: ${e.provedor} ${e.modelo} (achado automaticamente)`),
    "", "A Dri continua atendendo com as outras opções. Para fixar o modelo novo, atualize GROQ_MODELO / GEMINI_MODELO / CEREBRAS_MODELO ou a lista em worker/src/ia.js.",
  ];
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_REMETENTE, to: [env.ALERTA_EMAIL], subject: "Dri: atenção com as IAs", text: linhas.join("\n") }),
  }).catch((e) => console.error("email autoteste", e));
  return { resultados, eventos, avisado: true };
}

// Webhook: descarta repetidas e entrega cada mensagem ao objeto da conversa
async function encaminhar(env, contaId, msgs) {
  const db = banco(env);
  for (const m of msgs) {
    const { data: nova } = await db.from("wa_mensagens_recebidas")
      .upsert({ message_id: m.id }, { onConflict: "message_id", ignoreDuplicates: true }).select();
    if (!nova?.length) continue; // a Meta reenviou
    const stub = env.CONVERSA.get(env.CONVERSA.idFromName(`${contaId}:${m.de}`));
    await stub.fetch("https://conversa/mensagem", {
      method: "POST", body: JSON.stringify({ ...m, contaId }),
    });
  }
}

const TIPO_SEM_TEXTO = {
  audio: "[O cliente mandou um áudio que não deu para transcrever.]",
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

    const [{ data: conta }, conexao] = await Promise.all([
      db.from("contas").select("*").eq("id", contaId).maybeSingle(),
      conexaoDaConta(db, contaId),
    ]);
    if (!conta || !conexao) return;

    // Áudio vira texto (Whisper do Groq); se não der, a Dri pede para escrever
    if (fila.some((m) => m.midiaId)) {
      const { data: chaveConta } = await db.from("ia_chaves").select("chave").eq("conta_id", contaId).eq("provedor", "groq").maybeSingle();
      const chaves = [chaveConta?.chave, env.GROQ_API_KEY].filter(Boolean);
      for (const m of fila.filter((m) => m.midiaId)) {
        try {
          const texto = await transcrever(chaves, await baixarMidia(env, conexao, m.midiaId), env);
          if (texto) m.texto = `[Áudio do cliente, transcrito] ${texto}`;
        } catch (e) { console.warn("transcrição", e.message); }
      }
    }
    const textos = fila.map((m) => m.texto ?? TIPO_SEM_TEXTO[m.tipo] ?? (m.tipo in TIPO_SEM_TEXTO ? null : `[Mensagem do tipo ${m.tipo}]`))
      .filter(Boolean);
    if (!textos.length) return;
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
