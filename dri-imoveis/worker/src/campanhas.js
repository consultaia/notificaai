// Campanhas no WhatsApp do corretor: imagem + texto + botão, para quem aceitou receber novidades.
// Fora da janela de 24 h a Meta só entrega modelo aprovado; cada campanha vira um modelo de marketing
// que a Meta aprova (minutos a horas). O cron (a cada 5 min) confere a aprovação e envia em lotes.
//
// Proteções do número do corretor: só quem aceitou, no máximo uma campanha por pessoa a cada 7 dias,
// envio só das 8h às 20h (Brasília), "SAIR" ou o botão "Não quero receber" tiram da lista na hora.
import { graph } from "./whatsapp.js";
import { situacaoDaConta } from "./cobranca.js";
import { local } from "./agenda.js";

const DIA = 24 * 3600e3;
export const INTERVALO_MINIMO_DIAS = 7;
export const BOTAO_SAIR = "Não quero receber";
const RODAPE = "Responda SAIR para não receber mais.";

const primeiroNome = (n) => (String(n || "").trim().split(/\s+/)[0] || "tudo bem").slice(0, 30);
export const pedeParaSair = (texto) => /^\s*(sair|stop|descadastrar|n[aã]o quero (mais )?receber)\s*[.!]*\s*$/i.test(String(texto || ""));
// "parar" ou "cancelar" sozinhos só contam como sair da lista logo depois de uma campanha (senão é "cancela a visita")
const pedeParaSairDaCampanha = (texto) => /^\s*(parar|pare|cancelar)\s*[.!]*\s*$/i.test(String(texto || ""));
export const horarioPermitido = (agora) => { const h = local(agora).hora; return h >= 8 && h < 20; };

async function meta(env, token, caminho, { metodo = "POST", corpo, headers = {}, bruto } = {}) {
  const r = await fetch(`${graph(env)}/${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(bruto ? {} : { "content-type": "application/json" }), ...headers },
    body: bruto ?? (corpo ? JSON.stringify(corpo) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.error_user_msg || j?.error?.message || `Meta respondeu ${r.status}`);
  return j;
}

// Imagem do cabeçalho do modelo: a Meta pede um exemplo enviado pela API de upload do app
async function exemploDeImagem(env, conexao, url) {
  const img = await fetch(url);
  if (!img.ok) throw new Error("Não consegui ler a imagem da campanha.");
  const dados = await img.arrayBuffer();
  const tipo = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
  const app = await meta(env, conexao.token, "app", { metodo: "GET" });
  const sessao = await meta(env, conexao.token, `${app.id}/uploads?file_length=${dados.byteLength}&file_type=${encodeURIComponent(tipo)}`);
  const up = await meta(env, conexao.token, sessao.id, { headers: { authorization: `OAuth ${conexao.token}`, file_offset: "0" }, bruto: dados });
  return up.h;
}

export function montarModelo(c, nomeModelo, exemploImagem) {
  const componentes = [];
  if (c.imagem_url) componentes.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [exemploImagem] } });
  componentes.push({ type: "BODY", text: `Olá, {{1}}! ${c.texto}`.slice(0, 1024), example: { body_text: [["Carlos"]] } });
  componentes.push({ type: "FOOTER", text: RODAPE });
  componentes.push({ type: "BUTTONS", buttons: [
    { type: "QUICK_REPLY", text: (c.botao || "Quero saber mais").slice(0, 25) },
    { type: "QUICK_REPLY", text: BOTAO_SAIR },
  ] });
  return { name: nomeModelo, language: "pt_BR", category: "MARKETING", components: componentes };
}

// ---------------------------------------------------------------- público
export async function publicoDa(db, contaId, filtro = {}, agora = new Date(), ignorarCampanha = null) {
  const { data: conversas } = await db.from("conversas").select("telefone,nome,novidades,atualizado_em")
    .eq("conta_id", contaId).eq("novidades", "sim");
  let lista = (conversas || []).filter((c) => c.telefone !== "simulador");
  if (Number(filtro.dias) > 0) {
    const desde = new Date(agora.getTime() - Number(filtro.dias) * DIA).toISOString();
    lista = lista.filter((c) => c.atualizado_em >= desde);
  }
  const palavra = String(filtro.palavra || "").trim().toLowerCase();
  if (palavra) {
    const { data: leads } = await db.from("leads").select("telefone,perfil,nome").eq("conta_id", contaId);
    const casa = new Set((leads || []).filter((l) => `${l.perfil || ""} ${l.nome || ""}`.toLowerCase().includes(palavra)).map((l) => l.telefone));
    lista = lista.filter((c) => casa.has(c.telefone));
  }
  // quem recebeu campanha nos últimos 7 dias fica de fora (protege o número contra denúncias)
  const desde = new Date(agora.getTime() - INTERVALO_MINIMO_DIAS * DIA).toISOString();
  const [{ data: recentes }, { data: naFila }] = await Promise.all([
    db.from("campanha_envios").select("telefone").eq("conta_id", contaId).gte("enviado_em", desde),
    db.from("campanha_envios").select("telefone,campanha_id").eq("conta_id", contaId).eq("status", "pendente"),
  ]);
  const ocupados = new Set([...(recentes || []), ...(naFila || []).filter((r) => r.campanha_id !== ignorarCampanha)].map((r) => r.telefone));
  return { contatos: lista.filter((c) => !ocupados.has(c.telefone)), recentes: lista.filter((c) => ocupados.has(c.telefone)).length };
}

// ---------------------------------------------------------------- criar
export async function criarCampanha(env, db, conta, conexao, corpo, agora = new Date()) {
  const nome = String(corpo.nome || "").trim().slice(0, 80);
  const texto = String(corpo.texto || "").trim();
  if (!nome) return { erro: "Dê um nome à campanha (só você vê)." };
  if (texto.length < 10) return { erro: "Escreva a mensagem da campanha." };
  if (texto.length > 900) return { erro: "A mensagem pode ter até 900 caracteres." };
  if (/\{\{/.test(texto)) return { erro: "Tire as chaves {{ }} do texto: o nome do cliente já entra sozinho no começo." };
  if (!conexao) return { erro: "Conecte o WhatsApp antes de criar campanhas." };
  const sit = await situacaoDaConta(db, conta.id);
  if (!sit.pode_atender) return { erro: "A assinatura está pausada. Regularize para usar as campanhas." };
  const agendada = corpo.agendada_para ? new Date(corpo.agendada_para) : agora;
  if (Number.isNaN(agendada.getTime())) return { erro: "Data de envio inválida." };
  const filtro = { dias: Number(corpo.filtro?.dias) || null, palavra: String(corpo.filtro?.palavra || "").trim().slice(0, 60) || null };
  const { contatos } = await publicoDa(db, conta.id, filtro, agora);
  if (!contatos.length) return { erro: "Ninguém nesse público aceitou receber novidades ainda (ou todos já receberam uma campanha nos últimos 7 dias)." };

  const c = { nome, texto, imagem_url: corpo.imagem_url || null, botao: String(corpo.botao || "").trim().slice(0, 25) || "Quero saber mais" };
  const nomeModelo = `dri_${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${crypto.randomUUID().slice(0, 6)}`;
  let modelo;
  try {
    const exemplo = c.imagem_url ? await exemploDeImagem(env, conexao, c.imagem_url) : null;
    modelo = await meta(env, conexao.token, `${conexao.waba_id}/message_templates`, { corpo: montarModelo(c, nomeModelo, exemplo) });
  } catch (e) {
    return { erro: `A Meta não aceitou o modelo da campanha: ${e.message}` };
  }
  const status = modelo.status === "REJECTED" ? "recusada" : modelo.status === "APPROVED" ? "agendada" : "aguardando aprovação";
  const r = await db.from("campanhas").insert({
    conta_id: conta.id, ...c, filtro, agendada_para: agendada.toISOString(), status,
    template_nome: nomeModelo, template_id: modelo.id ? String(modelo.id) : null, total: contatos.length,
  }).select().single();
  if (r.error) throw new Error(r.error.message);
  return { campanha: r.data };
}

// ---------------------------------------------------------------- enviar (cron)
function parametros(c, nome) {
  return [
    ...(c.imagem_url ? [{ type: "header", parameters: [{ type: "image", image: { link: c.imagem_url } }] }] : []),
    { type: "body", parameters: [{ type: "text", text: primeiroNome(nome) }] },
  ];
}

async function conexaoDe(db, contaId) {
  const [{ data: c }, { data: s }] = await Promise.all([
    db.from("whatsapp_conexoes").select("*").eq("conta_id", contaId).maybeSingle(),
    db.from("whatsapp_segredos").select("access_token").eq("conta_id", contaId).maybeSingle(),
  ]);
  return c?.status === "conectado" && s?.access_token ? { ...c, token: s.access_token } : null;
}

// Uma rodada: confere aprovação dos modelos pendentes e envia um lote das campanhas na hora
export async function rodarCampanhas(env, db, agora = new Date()) {
  const lote = Math.max(1, Number(env.CAMPANHA_LOTE) || 20);
  const resumo = { aprovadas: 0, recusadas: 0, enviadas: 0, concluidas: 0 };

  const { data: pendentes } = await db.from("campanhas").select("*").eq("status", "aguardando aprovação");
  for (const c of pendentes || []) {
    const conexao = await conexaoDe(db, c.conta_id);
    if (!conexao || !c.template_id) continue;
    try {
      const t = await meta(env, conexao.token, `${c.template_id}?fields=status,rejected_reason`, { metodo: "GET" });
      if (t.status === "APPROVED") { await db.from("campanhas").update({ status: "agendada", atualizado_em: agora.toISOString() }).eq("id", c.id); resumo.aprovadas++; }
      if (t.status === "REJECTED") {
        await db.from("campanhas").update({ status: "recusada", motivo: t.rejected_reason || "recusada pela Meta", atualizado_em: agora.toISOString() }).eq("id", c.id);
        resumo.recusadas++;
      }
    } catch (e) { console.warn("modelo", c.id, e.message); }
  }

  if (!horarioPermitido(agora)) return resumo;
  const { data: prontas } = await db.from("campanhas").select("*").in("status", ["agendada", "enviando"]).lte("agendada_para", agora.toISOString());
  let restante = lote;
  for (const c of prontas || []) {
    if (restante <= 0) break;
    const conexao = await conexaoDe(db, c.conta_id);
    const sit = await situacaoDaConta(db, c.conta_id);
    if (!conexao || !sit.pode_atender) continue;
    if (c.status === "agendada") {
      // monta a lista na hora de começar (quem aceitou até agora, fora quem recebeu nos últimos 7 dias)
      const { contatos } = await publicoDa(db, c.conta_id, c.filtro || {}, agora, c.id);
      if (contatos.length) await db.from("campanha_envios").upsert(contatos.map((p) => ({ campanha_id: c.id, conta_id: c.conta_id, telefone: p.telefone, nome: p.nome, status: "pendente" })),
        { onConflict: "campanha_id,telefone", ignoreDuplicates: true });
      await db.from("campanhas").update({ status: "enviando", total: contatos.length, atualizado_em: agora.toISOString() }).eq("id", c.id);
    }
    const { data: fila } = await db.from("campanha_envios").select("*").eq("campanha_id", c.id).eq("status", "pendente").limit(restante);
    let enviadas = 0, falhas = 0;
    const { data: aceitam } = (fila || []).length
      ? await db.from("conversas").select("telefone").eq("conta_id", c.conta_id).eq("novidades", "sim").in("telefone", fila.map((e) => e.telefone))
      : { data: [] };
    const ainda = new Set((aceitam || []).map((x) => x.telefone));
    for (const e of fila || []) {
      if (!ainda.has(e.telefone)) { // pediu para sair depois que a lista foi montada
        await db.from("campanha_envios").update({ status: "falhou", erro: "saiu da lista", enviado_em: agora.toISOString() }).eq("id", e.id);
        falhas++; continue;
      }
      try {
        const r = await meta(env, conexao.token, `${conexao.phone_number_id}/messages`, { corpo: {
          messaging_product: "whatsapp", to: e.telefone, type: "template",
          template: { name: c.template_nome, language: { code: "pt_BR" }, components: parametros(c, e.nome) },
        } });
        await db.from("campanha_envios").update({ status: "enviada", wamid: r.messages?.[0]?.id || null, enviado_em: agora.toISOString() }).eq("id", e.id);
        enviadas++;
      } catch (err) {
        await db.from("campanha_envios").update({ status: "falhou", erro: err.message.slice(0, 300), enviado_em: agora.toISOString() }).eq("id", e.id);
        falhas++;
      }
    }
    restante -= (fila || []).length;
    resumo.enviadas += enviadas;
    const terminou = (fila || []).length < lote && !(await db.from("campanha_envios").select("id").eq("campanha_id", c.id).eq("status", "pendente").limit(1)).data?.length;
    await db.from("campanhas").update({
      enviadas: (c.enviadas || 0) + enviadas, falhas: (c.falhas || 0) + falhas, atualizado_em: agora.toISOString(),
      ...(terminou ? { status: "enviada" } : {}),
    }).eq("id", c.id).eq("status", "enviando");
    if (terminou) resumo.concluidas++;
  }
  return resumo;
}

// ---------------------------------------------------------------- avisos da Meta e respostas
const ORDEM = { pendente: 0, enviada: 1, entregue: 2, lida: 3 };
const DO_STATUS = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };

// Avisos de entregue/lida/falhou das mensagens enviadas (só as de campanha interessam)
export async function atualizarStatusEnvios(db, statuses, contaId) {
  for (const s of statuses) {
    const novo = DO_STATUS[s.status];
    if (!novo || !s.id) continue;
    const { data: e } = await db.from("campanha_envios").select("id,campanha_id,status,conta_id").eq("wamid", s.id).maybeSingle();
    if (!e || (contaId && e.conta_id !== contaId)) continue;
    if (novo === e.status) continue; // aviso repetido da Meta
    if (novo !== "falhou" && ORDEM[novo] <= (ORDEM[e.status] ?? 0)) continue;
    if (novo === "falhou" && e.status === "lida") continue;
    await db.from("campanha_envios").update({ status: novo, ...(s.erro ? { erro: s.erro.slice(0, 300) } : {}) }).eq("id", e.id);
    const { data: c } = await db.from("campanhas").select("entregues,lidas,falhas").eq("id", e.campanha_id).maybeSingle();
    if (!c) continue;
    const mais = (campo) => ({ [campo]: (c[campo] || 0) + 1 });
    if (novo === "entregue") await db.from("campanhas").update(mais("entregues")).eq("id", e.campanha_id);
    if (novo === "lida") await db.from("campanhas").update({ ...mais("lidas"), ...(e.status === "enviada" ? mais("entregues") : {}) }).eq("id", e.campanha_id);
    if (novo === "falhou") await db.from("campanhas").update(mais("falhas")).eq("id", e.campanha_id);
  }
}

// Mensagem do cliente: marca resposta à campanha recente e trata o pedido de sair da lista.
// Devolve { sair: true } (não chama a IA) ou { contexto } para a IA saber de qual campanha a pessoa veio.
export async function tratarResposta(db, contaId, telefone, textos, agora = new Date()) {
  const desde = new Date(agora.getTime() - 7 * DIA).toISOString();
  const { data: envios } = await db.from("campanha_envios").select("id,campanha_id,respondeu_em,enviado_em")
    .eq("conta_id", contaId).eq("telefone", telefone).gte("enviado_em", desde);
  const ultimo = (envios || []).sort((a, b) => (a.enviado_em < b.enviado_em ? 1 : -1))[0];
  if (textos.some(pedeParaSair) || (ultimo && textos.some(pedeParaSairDaCampanha))) {
    await db.from("conversas").update({ novidades: "nao", novidades_em: agora.toISOString() }).eq("conta_id", contaId).eq("telefone", telefone);
    return { sair: true };
  }
  if (!ultimo) return {};
  const { data: c } = await db.from("campanhas").select("nome,texto,respostas").eq("id", ultimo.campanha_id).maybeSingle();
  if (!ultimo.respondeu_em) {
    await db.from("campanha_envios").update({ respondeu_em: agora.toISOString() }).eq("id", ultimo.id);
    if (c) await db.from("campanhas").update({ respostas: (c.respostas || 0) + 1 }).eq("id", ultimo.campanha_id);
  }
  return c ? { contexto: `[O cliente está respondendo a uma campanha que o corretor enviou: "${c.texto.slice(0, 400)}"]` } : {};
}

export function extrairStatus(payload) {
  const saida = [];
  for (const entry of payload?.entry || []) for (const change of entry.changes || []) {
    for (const s of change.value?.statuses || []) saida.push({ id: s.id, status: s.status, erro: s.errors?.[0]?.title || s.errors?.[0]?.message || null });
  }
  return saida;
}

// Qualidade e limite do número (aba Campanhas)
export async function saudeDoNumero(env, conexao) {
  try {
    const r = await meta(env, conexao.token, `${conexao.phone_number_id}?fields=quality_rating,messaging_limit_tier`, { metodo: "GET" });
    return { qualidade: r.quality_rating || null, limite: r.messaging_limit_tier || null };
  } catch { return { qualidade: null, limite: null }; }
}
