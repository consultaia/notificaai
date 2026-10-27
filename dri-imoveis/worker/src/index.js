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
//   POST /importar/analisar     lê o texto das páginas de um book (PDF) e devolve os dados para revisão
//   POST /ia/status             quais IAs a conta tem (sem mostrar a chave)
//   POST /ia/salvar             confere e guarda a chave de IA do corretor
//   POST /ia/remover            apaga a chave de IA do corretor
//   GET  /plano                 preço e dias de teste (página de vendas)
//   POST /mercadopago/webhook   avisos do Mercado Pago (assinatura autorizada, cobrança paga ou recusada)
//   POST /eu                    quem está logado (é administrador?)
//   POST /assinatura/status     situação da assinatura da conta (faixa do painel)
//   POST /assinatura/assinar    cria a assinatura no Mercado Pago e devolve o link de pagamento
//   POST /parceiro/status       link e comissões do corretor que é parceiro
//   POST /parceiro/aderir       corretor aceita ser parceiro (chave PIX) e recebe o link
//   POST /campanhas/listar      campanhas da conta, público que aceitou novidades e saúde do número
//   POST /campanhas/publico     quantas pessoas recebem com o filtro escolhido
//   POST /campanhas/criar       cria a campanha (modelo de marketing na Meta) para enviar agora ou depois
//   POST /campanhas/cancelar    cancela uma campanha que ainda não terminou
//   POST /admin/…               área do administrador (ADMIN_EMAILS): ver admin.js
//
// Cada corretor usa o próprio app da Meta (não precisa de Tech Provider): cada conta tem
// um webhook próprio, e a assinatura das mensagens é conferida com a chave secreta do app dela.
//
// Segredos (wrangler secret put …): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e pelo menos uma IA:
//   ANTHROPIC_API_KEY (Claude Haiku, paga, principal) e/ou GEMINI_API_KEY, GROQ_API_KEY,
//   CEREBRAS_API_KEY (gratuitas; viram reserva)
// Opcionais: RESEND_API_KEY + EMAIL_REMETENTE, TEMPLATE_AVISO, PAINEL_URL, PAINEL_ORIGEM,
//   IA_ORDEM, *_MODELO, GRAPH_VERSION, ALERTA_EMAIL (recebe o autoteste diário das IAs),
//   MERCADOPAGO_ACCESS_TOKEN + MERCADOPAGO_WEBHOOK_SECRET (cobrança), ADMIN_EMAILS, SITE_URL
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { responder, registrarSemResponder, cotaDa, mesDe, dividirMensagens } from "./agente.js";
import { transcrever } from "./audio.js";
import { lerBook } from "./catalogo.js";
import { provedoresAtivos, validarChave, PROVEDORES, autotestar, claudePrincipal } from "./ia.js";
import {
  lerConfig, situacaoDaConta, ehAdmin, criarAssinatura, webhookValido, processarAvisoMP, atualizarPausas, avisarAdmin,
} from "./cobranca.js";
import { rotaAdmin } from "./admin.js";
import { prepararConexao, conectarWhatsApp } from "./conexao.js";
import {
  criarCampanha, rodarCampanhas, atualizarStatusEnvios, tratarResposta, extrairStatus, publicoDa, saudeDoNumero,
} from "./campanhas.js";
import { aderir, resumoDoParceiro, linkDoParceiro } from "./parceiros.js";
import {
  assinaturaValida, extrairMensagens, enviarTexto, enviarImagem, enviarDocumento, marcarLida,
  lerNumero, baixarMidia,
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

async function usuarioDe(req, db) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

async function contaDe(db, usuario) {
  if (!usuario) return null;
  const { data: conta } = await db.from("contas").select("*").eq("owner_id", usuario.id).maybeSingle();
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

export default {
  // Autoteste diário das IAs (cron em wrangler.toml): avisa por email se alguma caiu ou trocou de modelo
  // A cada 5 min: aprovação e envio das campanhas. Uma vez por dia: autoteste das IAs e pausas da cobrança.
  async scheduled(evento, env, ctx) {
    if (evento.cron === "*/5 * * * *") {
      ctx.waitUntil(rodarCampanhas(env, banco(env)).then((r) => console.log("campanhas", JSON.stringify(r)), (e) => console.error("campanhas", e)));
      return;
    }
    ctx.waitUntil(avisarAutoteste(env));
    ctx.waitUntil(atualizarPausas(env, banco(env)).catch((e) => console.error("pausas", e)));
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
          const payload = JSON.parse(bruto);
          const msgs = extrairMensagens(payload)
            .filter((m) => !conexao.phone_number_id || m.phoneNumberId === conexao.phone_number_id);
          const statuses = extrairStatus(payload);
          if (statuses.length) ctx.waitUntil(atualizarStatusEnvios(db, statuses).catch((e) => console.error("status", e)));
          if (msgs.length) {
            ctx.waitUntil(Promise.all([
              db.from("whatsapp_conexoes").update({ ultima_mensagem_em: new Date().toISOString() }).eq("conta_id", conexao.conta_id),
              conexao.status === "conectado" ? encaminhar(env, conexao.conta_id, msgs) : null,
            ]));
          }
          return new Response("ok"); // a Meta precisa de 200 rápido
        }
      }

      // ---------------------------------------------------------------- página de vendas e Mercado Pago
      if (rota === "GET /plano") {
        const cfg = await lerConfig(banco(env));
        return json(env, { preco_mensal: Number(cfg.preco_mensal), dias_teste: cfg.dias_teste, comissao_adesao: Number(cfg.comissao_adesao) });
      }
      if (rota === "POST /mercadopago/webhook") {
        const bruto = await req.text();
        const aviso = (() => { try { return JSON.parse(bruto || "{}"); } catch { return {}; } })();
        const id = url.searchParams.get("data.id") || url.searchParams.get("id") || aviso.data?.id;
        const tipo = aviso.type || url.searchParams.get("type") || url.searchParams.get("topic");
        if (env.MERCADOPAGO_WEBHOOK_SECRET && !(await webhookValido(env.MERCADOPAGO_WEBHOOK_SECRET, req.headers, id)))
          return new Response("assinatura inválida", { status: 401 });
        if (!id || !tipo) return new Response("ok");
        // os dados são lidos da API do Mercado Pago; erro devolve 500 para ele tentar de novo
        const r = await processarAvisoMP(env, banco(env), { tipo, id: String(id) });
        console.log("mercadopago", tipo, id, JSON.stringify(r));
        return new Response("ok");
      }

      // ---------------------------------------------------------------- administrador
      const db = banco(env);
      const usuario = await usuarioDe(req, db);
      if (!usuario) return json(env, { error: "Faça login de novo." }, 401);
      const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const admin = ehAdmin(env, usuario.email) && !!usuario.email_confirmed_at;
      if (rota === "POST /eu") return json(env, { admin, email: usuario.email });
      if (rota.startsWith("POST /admin/")) {
        if (!admin) return json(env, { error: "Acesso só para o administrador." }, 403);
        const r = await rotaAdmin(rota, corpo, { env, db, url: url.origin });
        if (!r) return json(env, { error: "Rota não encontrada." }, 404);
        return r.erro ? json(env, { error: r.erro }, r.status || 400) : json(env, r);
      }

      // ---------------------------------------------------------------- painel
      const conta = await contaDe(db, usuario);
      if (!conta) return json(env, { error: "Faça login de novo." }, 401);
      const site = env.SITE_URL || env.PAINEL_ORIGEM || url.origin;

      if (rota === "POST /assinatura/status") {
        const cfg = await lerConfig(db);
        const s = await situacaoDaConta(db, conta.id, cfg);
        return json(env, {
          status: s.status, pode_atender: s.pode_atender, motivo: s.motivo || null, dias_restantes: s.dias_restantes ?? null,
          teste_ate: s.assinatura?.teste_ate || null, pausa_em: s.pausa_em || null, tem_cartao: !!s.assinatura?.mp_preapproval_id,
          proxima_cobranca: s.assinatura?.proxima_cobranca || null, aviso_enviado_em: s.assinatura?.aviso_enviado_em || null,
          preco_mensal: Number(s.assinatura?.valor_mensal ?? cfg.preco_mensal), pagamento_configurado: !!env.MERCADOPAGO_ACCESS_TOKEN,
          email: usuario.email, admin,
        });
      }
      if (rota === "POST /assinatura/assinar") {
        const email = String(corpo.email || usuario.email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(env, { error: "Informe o email da sua conta do Mercado Pago." }, 400);
        try {
          return json(env, await criarAssinatura(env, db, { conta, email, voltarPara: env.PAINEL_URL || `${site}/app` }));
        } catch (e) {
          return json(env, { error: `Não consegui abrir o pagamento: ${e.message}` }, 400);
        }
      }
      if (rota === "POST /parceiro/status" || rota === "POST /parceiro/aderir") {
        let { data: parceiro } = await db.from("parceiros").select("*").eq("conta_id", conta.id).maybeSingle();
        if (rota === "POST /parceiro/aderir") {
          if (corpo.aceito !== true) return json(env, { error: "Para ser parceiro, aceite os termos." }, 400);
          const r = await aderir(db, conta, { pix: corpo.pix, codigo: corpo.codigo });
          if (r.erro) return json(env, { error: r.erro }, 400);
          parceiro = r.parceiro;
        }
        const cfg = await lerConfig(db);
        return json(env, {
          parceiro: parceiro ? { codigo: parceiro.codigo, pix: parceiro.pix, ativo: parceiro.ativo, link: linkDoParceiro(site, parceiro.codigo) } : null,
          resumo: await resumoDoParceiro(db, parceiro), comissao_adesao: Number(cfg.comissao_adesao),
        });
      }

      if (rota === "POST /simular") {
        const sit = await situacaoDaConta(db, conta.id);
        if (!sit.pode_atender) return json(env, { error: "A assistente está pausada. Assine ou atualize o pagamento no topo do painel para ela voltar a responder." }, 402);
        const texto = String(corpo.texto || "").trim().slice(0, 2000);
        if (!texto) return json(env, { error: "Mensagem vazia." }, 400);
        const respostas = [];
        const resposta = await responder({
          env, db, conta, telefone: SIMULADOR, nome: corpo.nome || "Cliente de teste", canal: "simulador",
          agora: new Date(), conexao: null,
          enviarFoto: async (u, legenda) => respostas.push({ tipo: "foto", url: u, legenda }),
          enviarArquivo: async (u, nomeArquivo) => respostas.push({ tipo: "arquivo", url: u, nome: nomeArquivo }),
        }, [texto]);
        for (const parte of dividirMensagens(resposta)) respostas.push({ tipo: "texto", texto: parte });
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
      if (rota.startsWith("POST /campanhas/")) {
        const conexao = await conexaoDaConta(db, conta.id);
        if (rota === "POST /campanhas/listar") {
          const [{ data: campanhas }, publico, saude] = await Promise.all([
            db.from("campanhas").select("*").eq("conta_id", conta.id).order("criado_em", { ascending: false }).limit(50),
            publicoDa(db, conta.id, {}),
            conexao ? saudeDoNumero(env, conexao) : null,
          ]);
          return json(env, { campanhas: campanhas || [], aceitaram: publico.contatos.length + publico.recentes, disponiveis: publico.contatos.length, conectado: !!conexao, saude });
        }
        if (rota === "POST /campanhas/publico") {
          const p = await publicoDa(db, conta.id, corpo.filtro || {});
          return json(env, { disponiveis: p.contatos.length, recentes: p.recentes });
        }
        if (rota === "POST /campanhas/criar") {
          const r = await criarCampanha(env, db, conta, conexao, corpo);
          return r.erro ? json(env, { error: r.erro }, 400) : json(env, r);
        }
        if (rota === "POST /campanhas/cancelar") {
          const r = await db.from("campanhas").update({ status: "cancelada", atualizado_em: new Date().toISOString() })
            .eq("id", String(corpo.id || "")).eq("conta_id", conta.id).in("status", ["aguardando aprovação", "agendada", "enviando"]).select();
          return r.data?.length ? json(env, { ok: true }) : json(env, { error: "Essa campanha não pode mais ser cancelada." }, 400);
        }
      }
      if (rota === "POST /whatsapp/pedido") {
        const { data } = await db.from("pedidos_conexao").select("*").eq("conta_id", conta.id).maybeSingle();
        return json(env, { pedido: data || null });
      }
      if (rota === "POST /whatsapp/pedir") {
        const txt = (v, n = 200) => String(v || "").trim().slice(0, n) || null;
        const numero = String(corpo.numero || "").replace(/\D/g, "");
        if (!txt(corpo.nome_exibicao)) return json(env, { error: "Diga o nome que os clientes vão ver no WhatsApp." }, 400);
        if (numero.length < 10) return json(env, { error: "Informe o número com DDD." }, 400);
        if (!["livre", "apagar", "em_uso"].includes(corpo.numero_situacao)) return json(env, { error: "Diga se o número está no WhatsApp hoje." }, 400);
        const linha = {
          conta_id: conta.id, nome_exibicao: txt(corpo.nome_exibicao, 120), numero, numero_situacao: corpo.numero_situacao,
          documento: txt(corpo.documento, 30), melhor_horario: txt(corpo.melhor_horario), portfolio_convidado: corpo.portfolio_convidado === true,
          observacoes: txt(corpo.observacoes, 1000), status: "novo", atualizado_em: new Date().toISOString(),
        };
        const r = await db.from("pedidos_conexao").upsert(linha, { onConflict: "conta_id" }).select().single();
        if (r.error) throw new Error(r.error.message);
        await avisarAdmin(env, db, "Pedido de conexão do WhatsApp",
          `${conta.nome} pediu ajuda para conectar o WhatsApp ${numero}${linha.portfolio_convidado ? " (já convidou você no portfólio da Meta)" : " (ainda não convidou você no portfólio da Meta)"}. Melhor horário: ${linha.melhor_horario || "não informado"}. Veja a aba Conexões do admin.`);
        return json(env, { pedido: r.data });
      }
      if (rota === "POST /whatsapp/conectar") {
        const r = await conectarWhatsApp(env, db, conta.id, corpo);
        return r.erro ? json(env, { error: r.erro }, 400) : json(env, r);
      }
      if (rota === "POST /importar/analisar") {
        const paginas = Array.isArray(corpo.paginas) ? corpo.paginas.slice(0, 300) : [];
        const imagens = Array.isArray(corpo.imagens) ? corpo.imagens.slice(0, 12) : [];
        if (!paginas.length && !imagens.length) return json(env, { error: "Não recebi as páginas do PDF." }, 400);
        try {
          return json(env, { dados: await lerBook(env, { paginas, imagens, totalPaginas: Number(corpo.total_paginas) || paginas.length }) });
        } catch (e) {
          return json(env, { error: e.message }, 422);
        }
      }
      if (rota === "POST /ia/status") {
        const { data } = await db.from("ia_chaves").select("provedor,chave,validada_em,ultimo_erro,ultimo_erro_em").eq("conta_id", conta.id);
        const mes = mesDe(new Date());
        const { data: uso } = await db.from("ia_uso").select("mensagens").eq("conta_id", conta.id).eq("mes", mes).maybeSingle();
        return json(env, {
          ia_inclusa: claudePrincipal(env),
          capacidade: claudePrincipal(env) ? { mes, usadas: uso?.mensagens || 0, cota: cotaDa(conta, env) } : null,
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

async function guardarMidia(db, contaId, telefone, nome, url) {
  const { data: conv } = await db.from("conversas").select("id,midias_recebidas").eq("conta_id", contaId).eq("telefone", telefone).maybeSingle();
  if (conv) await db.from("conversas").update({ midias_recebidas: [...(conv.midias_recebidas || []), url] }).eq("id", conv.id);
  else await db.from("conversas").insert({ conta_id: contaId, telefone, nome, midias_recebidas: [url] });
  const { data: cap } = await db.from("captacoes").select("id,fotos").eq("conta_id", contaId).eq("telefone", telefone)
    .in("status", ["nova", "em contato", "avaliação marcada"]).maybeSingle();
  if (cap) await db.from("captacoes").update({ fotos: [...(cap.fotos || []), url] }).eq("id", cap.id);
}

// Assistente pausada: a mensagem fica na aba Conversas, marcada para o corretor responder
async function guardarComAssistentePausada(db, contaId, telefone, nome, fila) {
  const em = new Date().toISOString();
  const novas = fila.map((m) => ({ de: "cliente", texto: m.texto || (m.tipo ? `[${m.tipo}]` : "[mensagem]"), em }));
  const { data: conversa } = await db.from("conversas").select("id,transcricao").eq("conta_id", contaId).eq("telefone", telefone).maybeSingle();
  const campos = { precisa_corretor: true, motivo: "Assistente pausada (assinatura)", ultima_cliente_em: em, atualizado_em: em };
  if (conversa) await db.from("conversas").update({ ...campos, transcricao: [...(conversa.transcricao || []), ...novas].slice(-200) }).eq("id", conversa.id);
  else await db.from("conversas").insert({ conta_id: contaId, telefone, nome, transcricao: novas, ...campos });
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
    // Conta pausada (teste acabou ou pagamento atrasado além da tolerância): guarda para o corretor e não responde
    const sit = await situacaoDaConta(db, contaId);
    if (!sit.pode_atender) return guardarComAssistentePausada(db, contaId, telefone, nome, fila);

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
    // Fotos do cliente: guarda no storage e na conversa; se for um proprietário com captação aberta, vai para ela
    for (const m of fila.filter((m) => m.imagemId)) {
      try {
        const { dados, tipo } = await baixarMidia(env, conexao, m.imagemId);
        const caminho = `${contaId}/recebidas/${crypto.randomUUID()}.${tipo.includes("png") ? "png" : "jpg"}`;
        const up = await db.storage.from("fotos-imoveis").upload(caminho, dados, { contentType: tipo.split(";")[0] });
        if (up.error) throw new Error(up.error.message);
        const url = db.storage.from("fotos-imoveis").getPublicUrl(caminho).data.publicUrl;
        await guardarMidia(db, contaId, telefone, nome, url);
        m.texto = `[O cliente mandou uma foto${m.legenda ? ` com a legenda "${m.legenda}"` : ""}. Ela foi guardada para o corretor; você não consegue vê-la.]`;
      } catch (e) {
        console.warn("foto recebida", e.message);
        m.texto = `[O cliente mandou uma foto${m.legenda ? ` com a legenda "${m.legenda}"` : ""} que não deu para guardar.]`;
      }
    }
    const textos = fila.map((m) => m.texto ?? TIPO_SEM_TEXTO[m.tipo] ?? (m.tipo in TIPO_SEM_TEXTO ? null : `[Mensagem do tipo ${m.tipo}]`))
      .filter(Boolean);
    if (!textos.length) return;

    const ctx = {
      env, db, conta, conexao, telefone, nome, canal: "whatsapp", agora: new Date(),
      enviarFoto: (u, legenda) => enviarImagem(env, conexao, telefone, u, legenda),
      enviarArquivo: (u, nomeArquivo, legenda) => enviarDocumento(env, conexao, telefone, u, nomeArquivo, legenda),
    };
    // Resposta a campanha: "SAIR" tira da lista (sem IA); senão a IA sabe de qual campanha a pessoa veio
    const campanha = await tratarResposta(db, contaId, telefone, textos).catch(() => ({}));
    if (campanha.sair) {
      await marcarLida(env, conexao, fila[fila.length - 1].id, false);
      await enviarTexto(env, conexao, telefone, "Pronto, você não vai mais receber novidades por aqui. Se precisar de alguma coisa, é só chamar! 🙂").catch(() => {});
      return registrarSemResponder(ctx, textos);
    }
    ctx.contexto = campanha.contexto || null;
    const { data: conversa } = await db.from("conversas").select("precisa_corretor")
      .eq("conta_id", contaId).eq("telefone", telefone).maybeSingle();
    // com o corretor no comando, só marca como lida (sem "digitando…")
    await marcarLida(env, conexao, fila[fila.length - 1].id, !conversa?.precisa_corretor);
    if (conversa?.precisa_corretor) return registrarSemResponder(ctx, textos);

    try {
      const resposta = await responder(ctx, textos);
      const partes = dividirMensagens(resposta);
      for (const [i, parte] of partes.entries()) {
        if (i > 0) { // pausa curta entre mensagens, como alguém digitando
          await marcarLida(env, conexao, fila[fila.length - 1].id);
          await new Promise((r) => setTimeout(r, Math.min(2500, 600 + parte.length * 15)));
        }
        await enviarTexto(env, conexao, telefone, parte);
      }
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
