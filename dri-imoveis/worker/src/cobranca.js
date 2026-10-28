// Cobrança mensal pelo Mercado Pago (assinatura sem plano: uma por conta), teste grátis,
// cortesia, tolerância quando o cartão é recusado e PIX fixo ao parceiro por adesão.
//
// Situação de cada conta (tabela assinaturas):
//   teste     → atende até teste_ate; se não assinar, pausa
//   ativa     → cartão autorizado no Mercado Pago
//   atrasada  → cobrança recusada: avisa o administrador e atende por mais dias_tolerancia
//   pausada   → não atende (as mensagens ficam guardadas para o corretor); volta quando o pagamento passa
//   cancelada → cancelou no Mercado Pago
//   cortesia  → não paga e nunca pausa (marcada pelo administrador)
//
// Segredos: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET. Variável: ADMIN_EMAILS.
import { enviarTexto } from "./whatsapp.js";
import { generoDa } from "./genero.js";

const MP = "https://api.mercadopago.com";
const DIA = 24 * 3600e3;

export const CONFIG_PADRAO = { preco_mensal: 197, dias_teste: 5, dias_tolerancia: 2, comissao_adesao: 100 };

export async function lerConfig(db) {
  const { data } = await db.from("plataforma_config").select("*").maybeSingle();
  return { ...CONFIG_PADRAO, ...(data || {}) };
}

export const ehAdmin = (env, email) => !!email && String(env.ADMIN_EMAILS || "").toLowerCase().split(",")
  .map((s) => s.trim()).filter(Boolean).includes(String(email).toLowerCase());

// O que vale agora, olhando datas (não depende do cron ter rodado)
export function situacao(a, cfg, agora = new Date()) {
  if (!a) return { status: "teste", pode_atender: true };
  const t = agora.getTime();
  const fim = (iso, dias = 0) => (iso ? new Date(iso).getTime() + dias * DIA : 0);
  if (a.status === "cortesia" || a.status === "ativa") return { status: a.status, pode_atender: true };
  if (a.status === "teste") {
    const ate = fim(a.teste_ate);
    return ate > t
      ? { status: "teste", pode_atender: true, teste_ate: a.teste_ate, dias_restantes: Math.ceil((ate - t) / DIA) }
      : { status: "pausada", motivo: "teste_acabou", pode_atender: false };
  }
  if (a.status === "atrasada") {
    const pausa = fim(a.falhou_em, cfg.dias_tolerancia);
    return pausa > t
      ? { status: "atrasada", pode_atender: true, pausa_em: new Date(pausa).toISOString() }
      : { status: "pausada", motivo: "pagamento", pode_atender: false };
  }
  return { status: a.status, motivo: a.status === "cancelada" ? "cancelada" : "pagamento", pode_atender: false };
}

export async function situacaoDaConta(db, contaId, cfg, agora) {
  const { data } = await db.from("assinaturas").select("*").eq("conta_id", contaId).maybeSingle();
  return { assinatura: data, ...situacao(data, cfg || (await lerConfig(db)), agora) };
}

// ---------------------------------------------------------------- Mercado Pago
async function mp(env, metodo, caminho, corpo) {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) throw new Error("Pagamento ainda não configurado (MERCADOPAGO_ACCESS_TOKEN).");
  const r = await fetch(MP + caminho, {
    method: metodo,
    headers: {
      authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`, "content-type": "application/json",
      ...(metodo === "POST" ? { "x-idempotency-key": crypto.randomUUID() } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `Mercado Pago respondeu ${r.status}`);
  return j;
}

// Cria a assinatura e devolve o link do Mercado Pago (o cartão é digitado lá)
export async function criarAssinatura(env, db, { conta, email, voltarPara, agora = new Date() }) {
  const cfg = await lerConfig(db);
  const { assinatura } = await situacaoDaConta(db, conta.id, cfg, agora);
  // Ainda no teste: a primeira cobrança fica para o fim do teste
  const fimTeste = assinatura?.status === "teste" && new Date(assinatura.teste_ate) > agora ? new Date(assinatura.teste_ate) : null;
  const r = await mp(env, "POST", "/preapproval", {
    reason: `Toc Toc · assistente de WhatsApp (${conta.nome})`.slice(0, 250),
    external_reference: conta.id,
    payer_email: email,
    back_url: voltarPara,
    status: "pending",
    auto_recurring: {
      frequency: 1, frequency_type: "months", transaction_amount: Number(cfg.preco_mensal), currency_id: "BRL",
      ...(fimTeste ? { start_date: fimTeste.toISOString() } : {}),
    },
  });
  await db.from("assinaturas").update({ mp_email: email, atualizado_em: agora.toISOString() }).eq("conta_id", conta.id);
  return { link: r.init_point, id: r.id };
}

// x-signature: "ts=…,v1=…"; assina-se "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
export async function webhookValido(segredo, headers, dataId) {
  if (!segredo) return false;
  const partes = Object.fromEntries(String(headers.get("x-signature") || "").split(",")
    .map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId || "") ? String(dataId).toLowerCase() : dataId;
  const manifesto = `${id ? `id:${id};` : ""}${headers.get("x-request-id") ? `request-id:${headers.get("x-request-id")};` : ""}ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}

async function assinaturaPor(db, { preapprovalId, contaId }) {
  if (preapprovalId) {
    const { data } = await db.from("assinaturas").select("*").eq("mp_preapproval_id", preapprovalId).maybeSingle();
    if (data) return data;
  }
  if (contaId) {
    const { data } = await db.from("assinaturas").select("*").eq("conta_id", contaId).maybeSingle();
    return data;
  }
  return null;
}

// Aviso do Mercado Pago. Os dados vêm sempre da API (o corpo do aviso só diz o que mudou).
export async function processarAvisoMP(env, db, { tipo, id }, agora = new Date()) {
  const cfg = await lerConfig(db);
  const quando = agora.toISOString();

  if (tipo === "subscription_preapproval" || tipo === "preapproval") {
    const p = await mp(env, "GET", `/preapproval/${id}`);
    const a = await assinaturaPor(db, { preapprovalId: p.id, contaId: p.external_reference });
    if (!a) return { ignorado: "conta não encontrada" };
    if (p.status === "authorized") {
      const anterior = a.mp_preapproval_id && a.mp_preapproval_id !== p.id ? a.mp_preapproval_id : null;
      const volta = ["pausada", "atrasada", "cancelada"].includes(a.status);
      await db.from("assinaturas").update({
        mp_preapproval_id: p.id, mp_email: p.payer_email || a.mp_email, valor_mensal: p.auto_recurring?.transaction_amount ?? null,
        proxima_cobranca: p.next_payment_date || null, assinou_em: a.assinou_em || quando,
        // cortesia continua cortesia; em teste continua testando até a primeira cobrança
        status: a.status === "cortesia" ? "cortesia" : a.status === "teste" && new Date(a.teste_ate) > agora ? "teste" : "ativa",
        ...(volta ? { falhou_em: null, pausada_em: null } : {}),
        atualizado_em: quando,
      }).eq("conta_id", a.conta_id);
      // trocou o cartão criando uma assinatura nova: a velha é cancelada para não cobrar duas vezes
      if (anterior) await mp(env, "PUT", `/preapproval/${anterior}`, { status: "cancelled" }).catch((e) => console.warn("cancelar antiga", e.message));
      return { conta: a.conta_id, status: "autorizada" };
    }
    if (p.status === "cancelled" && a.mp_preapproval_id === p.id && a.status !== "cortesia") {
      await db.from("assinaturas").update({ status: "cancelada", pausada_em: quando, atualizado_em: quando }).eq("conta_id", a.conta_id);
      await avisarAdmin(env, db, "Assinatura cancelada", await linhaConta(db, a.conta_id, "cancelou a assinatura no Mercado Pago."));
      return { conta: a.conta_id, status: "cancelada" };
    }
    return { conta: a.conta_id, status: p.status };
  }

  if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
    const pg = await mp(env, "GET", `/authorized_payments/${id}`);
    const a = await assinaturaPor(db, { preapprovalId: pg.preapproval_id, contaId: pg.external_reference });
    if (!a) return { ignorado: "conta não encontrada" };
    const stPag = pg.payment?.status;
    const aprovado = stPag === "approved";
    const recusado = stPag === "rejected" || stPag === "cancelled" || pg.status === "recycling";
    if (!aprovado && !recusado) return { conta: a.conta_id, status: pg.status };

    const valor = Number(pg.transaction_amount) || null;
    const ins = await db.from("pagamentos").upsert({
      conta_id: a.conta_id, mp_id: String(pg.id), valor, status: aprovado ? "aprovado" : "recusado",
      detalhe: pg.payment?.status_detail || pg.status || null, pago_em: aprovado ? (pg.debit_date || quando) : null,
    }, { onConflict: "mp_id" }).select();
    if (ins.error) throw new Error(ins.error.message);

    if (aprovado) {
      if (a.status !== "cortesia") {
        await db.from("assinaturas").update({ status: "ativa", falhou_em: null, pausada_em: null, atualizado_em: quando }).eq("conta_id", a.conta_id);
        await gerarComissao(env, db, a, cfg, pg.id);
      }
      if (["pausada", "atrasada"].includes(a.status))
        await avisarAdmin(env, db, "Pagamento regularizado", await linhaConta(db, a.conta_id, "pagou e a assistente voltou a atender."));
      return { conta: a.conta_id, status: "pago" };
    }
    if (a.status === "cortesia") return { conta: a.conta_id, status: "recusado (cortesia)" };
    const primeira = !a.falhou_em;
    await db.from("assinaturas").update({
      status: a.status === "pausada" ? "pausada" : "atrasada", falhou_em: a.falhou_em || quando, atualizado_em: quando,
    }).eq("conta_id", a.conta_id);
    if (primeira) {
      const pausa = new Date(agora.getTime() + cfg.dias_tolerancia * DIA);
      await avisarAdmin(env, db, "Pagamento recusado",
        await linhaConta(db, a.conta_id, `teve a cobrança recusada (${pg.payment?.status_detail || pg.status}). A assistente pausa em ${dataBR(pausa)} se não regularizar. Use "Enviar aviso" na área do administrador para avisar o corretor.`));
    }
    return { conta: a.conta_id, status: "recusado" };
  }
  return { ignorado: tipo };
}

// Primeiro pagamento de quem veio pelo link: uma comissão (PIX) para o parceiro, uma vez por conta
async function gerarComissao(env, db, a, cfg, pagamentoId) {
  if (!a.parceiro_id || !(Number(cfg.comissao_adesao) > 0)) return null;
  const { data: p } = await db.from("parceiros").select("id,nome,pix,ativo,conta_id,email,whatsapp").eq("id", a.parceiro_id).maybeSingle();
  if (!p?.ativo || p.conta_id === a.conta_id) return null;
  const { data: ja } = await db.from("comissoes").select("id").eq("conta_id", a.conta_id).maybeSingle();
  if (ja) return null; // uma comissão por conta indicada, para sempre (mesmo se cancelar e assinar de novo)

  const motivos = await suspeitasDeDuplicidade(db, a, p);
  const { data: conta } = await db.from("contas").select("criado_em").eq("id", a.conta_id).maybeSingle();
  const r = await db.from("comissoes").upsert({
    parceiro_id: p.id, conta_id: a.conta_id, valor: Number(cfg.comissao_adesao),
    status: motivos.length ? "em análise" : "a pagar", motivo: motivos.join("; ") || null,
    pagamento_mp_id: pagamentoId ? String(pagamentoId) : null, cadastro_em: conta?.criado_em || null,
  }, { onConflict: "conta_id", ignoreDuplicates: true }).select();
  if (!r.data?.length) return null;
  const valor = `R$ ${Number(cfg.comissao_adesao).toFixed(2).replace(".", ",")}`;
  await avisarAdmin(env, db, motivos.length ? "Comissão em análise" : "Nova adesão com comissão",
    await linhaConta(db, a.conta_id, motivos.length
      ? `fez o primeiro pagamento pelo link de ${p.nome}, mas a comissão de ${valor} ficou em análise: ${motivos.join("; ")}. Aprove ou cancele na aba Comissões.`
      : `fez o primeiro pagamento pelo link de ${p.nome}. Comissão a pagar: ${valor} no PIX ${p.pix || "(sem chave cadastrada)"}.`));
  return r.data[0];
}

// Mesma pessoa com outra conta, ou o próprio parceiro se indicando
async function suspeitasDeDuplicidade(db, a, p) {
  const dig = (t) => String(t || "").replace(/\D/g, "").slice(-11);
  const motivos = [];
  const [{ data: assinaturas }, { data: contas }] = await Promise.all([
    db.from("assinaturas").select("conta_id,mp_email,assinou_em,status"),
    db.from("contas").select("id,whatsapp_pessoal,email_notificacao"),
  ]);
  const esta = (contas || []).find((c) => c.id === a.conta_id) || {};
  const outrasAssinantes = (assinaturas || []).filter((x) => x.conta_id !== a.conta_id && (x.assinou_em || ["ativa", "atrasada", "pausada", "cancelada"].includes(x.status)));
  const email = String(a.mp_email || "").toLowerCase();
  if (email && outrasAssinantes.some((x) => String(x.mp_email || "").toLowerCase() === email))
    motivos.push("o mesmo pagador do Mercado Pago já assina em outra conta");
  const zap = dig(esta.whatsapp_pessoal);
  if (zap.length >= 10 && (contas || []).some((c) => c.id !== a.conta_id && dig(c.whatsapp_pessoal) === zap && outrasAssinantes.some((x) => x.conta_id === c.id)))
    motivos.push("o mesmo WhatsApp já é de outra conta assinante");
  const doParceiro = (contas || []).find((c) => c.id === p.conta_id) || {};
  const emailsParceiro = [p.email, doParceiro.email_notificacao].filter(Boolean).map((e) => e.toLowerCase());
  const zapsParceiro = [p.whatsapp, doParceiro.whatsapp_pessoal].map(dig).filter((z) => z.length >= 10);
  if ((email && emailsParceiro.includes(email)) || (esta.email_notificacao && emailsParceiro.includes(esta.email_notificacao.toLowerCase()))
      || (zap.length >= 10 && zapsParceiro.includes(zap)))
    motivos.push("parece ser o próprio parceiro");
  return motivos;
}

// Cron diário: grava como "pausada" quem passou do prazo (o atendimento já para sozinho pela data)
export async function atualizarPausas(env, db, agora = new Date()) {
  const cfg = await lerConfig(db);
  const { data } = await db.from("assinaturas").select("*").in("status", ["teste", "atrasada"]);
  const pausadas = [];
  for (const a of data || []) {
    const s = situacao(a, cfg, agora);
    if (s.pode_atender) continue;
    await db.from("assinaturas").update({ status: "pausada", pausada_em: agora.toISOString(), atualizado_em: agora.toISOString() }).eq("conta_id", a.conta_id);
    pausadas.push(await linhaConta(db, a.conta_id, s.motivo === "teste_acabou" ? "terminou o teste grátis sem assinar." : "ficou sem pagamento além da tolerância."));
  }
  if (pausadas.length) await avisarAdmin(env, db, `${pausadas.length} conta(s) pausada(s)`, pausadas.join("\n"));
  return pausadas.length;
}

// ---------------------------------------------------------------- avisos
const dataBR = (d) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

async function linhaConta(db, contaId, texto) {
  const { data } = await db.from("contas").select("nome,cidade,whatsapp_pessoal").eq("id", contaId).maybeSingle();
  return `${data?.nome || contaId}${data?.cidade ? ` (${data.cidade})` : ""} ${texto}`;
}

async function email(env, para, assunto, texto) {
  if (!(env.RESEND_API_KEY && env.EMAIL_REMETENTE && para.length)) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_REMETENTE, to: para, subject: assunto, text: texto }),
  }).catch(() => null);
  return !!r?.ok;
}

// Fica registrado para a área do administrador e vai por email se houver Resend
export async function avisarAdmin(env, db, assunto, texto) {
  await db.from("avisos_admin").insert({ assunto, texto }).then(() => {}, () => {});
  const para = String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return email(env, para, `Toc Toc: ${assunto}`, `${texto}\n\nÁrea do administrador: ${env.PAINEL_URL || ""}#admin`);
}

export function textoAvisoCobranca(conta, sit) {
  const g = generoDa(conta);
  const painel = "o painel do Toc Toc";
  if (sit.status === "atrasada")
    return `Olá, ${conta.nome.split(" ")[0]}! Aqui é do Toc Toc. A cobrança da sua assinatura não foi aprovada pelo cartão. Para ${g.a} ${conta.nome_assistente} continuar atendendo seus clientes, atualize o pagamento em ${painel} até ${dataBR(sit.pausa_em)}. Qualquer dúvida, é só responder.`;
  if (sit.status === "pausada" || sit.status === "cancelada")
    return `Olá, ${conta.nome.split(" ")[0]}! Aqui é do Toc Toc. ${g.A} ${conta.nome_assistente} está pausad${g.x} por falta de pagamento. As mensagens dos seus clientes continuam chegando no painel. Para reativar, atualize o pagamento em ${painel}: ${g.ela} volta a atender assim que o Mercado Pago aprovar.`;
  if (sit.status === "teste")
    return `Olá, ${conta.nome.split(" ")[0]}! Aqui é do Toc Toc. Seu teste grátis termina em ${sit.dias_restantes} dia(s). Para ${g.a} ${conta.nome_assistente} continuar atendendo, assine em ${painel}.`;
  return `Olá, ${conta.nome.split(" ")[0]}! Aqui é do Toc Toc. Passando para lembrar de conferir sua assinatura em ${painel}.`;
}

// Botão "Enviar aviso" do administrador: email e WhatsApp pessoal do corretor (pelo número dele, se conectado).
// O painel do corretor também mostra a faixa de cobrança sempre.
export async function enviarAvisoCobranca(env, db, conta, sit, { conexao, emailLogin, texto }) {
  const msg = texto || textoAvisoCobranca(conta, sit);
  const canais = [];
  const para = [conta.email_notificacao || emailLogin].filter(Boolean);
  if (await email(env, para, "Toc Toc: sua assinatura", `${msg}\n\nPainel: ${env.PAINEL_URL || ""}`)) canais.push("email");
  const pessoal = String(conta.whatsapp_pessoal || "").replace(/\D/g, "");
  if (conexao && pessoal) {
    const numero = pessoal.length <= 11 ? `55${pessoal}` : pessoal;
    try {
      if (env.TEMPLATE_AVISO) {
        const r = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || "v23.0"}/${conexao.phone_number_id}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${conexao.token}`, "content-type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "template",
            template: { name: env.TEMPLATE_AVISO, language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: msg.slice(0, 1000) }] }] } }),
        });
        if (r.ok) canais.push("whatsapp");
      } else {
        await enviarTexto(env, conexao, numero, msg);
        canais.push("whatsapp");
      }
    } catch (e) { console.warn("aviso whatsapp", e.message); }
  }
  await db.from("assinaturas").update({ aviso_enviado_em: new Date().toISOString() }).eq("conta_id", conta.id);
  return { canais, texto: msg };
}
