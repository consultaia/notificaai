import { chamarClaude, listarModelosClaude, ErroClaude } from "./claude.js";

// Claude Haiku (paga pela plataforma) + três IAs com plano gratuito, em fila: se uma falhar, bater o limite ou demorar, passa para a próxima.
// Todas falam o formato "chat completions" (padrão OpenAI) com ferramentas.
// Primeiro vêm as chaves da própria conta (o limite gratuito é só do corretor); as chaves da
// plataforma ficam de reserva (desligue com IA_RESERVA_PLATAFORMA="nao").
// Ordem configurável: IA_ORDEM="gemini,groq,cerebras" (as gratuitas).
// Claude: ligada quando há ANTHROPIC_API_KEY. IA_CLAUDE="principal" (padrão: vem antes de tudo)
// ou "reserva" (só entra quando todas as gratuitas falharem).
//
// Proteção contra modelo aposentado (o Groq já tirou o Llama do ar de um dia para o outro):
//   1. cada provedor tem uma lista de modelos em ordem de preferência; se um sumir, usa o próximo;
//   2. se todos da lista sumirem, pergunta ao provedor quais modelos existem e escolhe um da mesma família;
//   3. o autoteste diário (cron) avisa por email quando um modelo cai, para atualizar a lista com calma.
// Para trocar modelos sem mexer no código: GEMINI_MODELO, GROQ_MODELO, CEREBRAS_MODELO (aceitam lista separada por vírgula).

export const PROVEDORES = {
  claude: {
    anthropic: true, chave: "ANTHROPIC_API_KEY", modelo: "CLAUDE_MODELO",
    preferidos: ["claude-haiku-5-5"],
    familia: /^claude-haiku/,
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    modelos: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    chave: "GEMINI_API_KEY", modelo: "GEMINI_MODELO",
    preferidos: ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"],
    familia: /gemini-[\d.]+-flash(?!.*(image|tts|audio|live|embed|thinking-exp))/,
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    modelos: "https://api.groq.com/openai/v1/models",
    chave: "GROQ_API_KEY", modelo: "GROQ_MODELO",
    preferidos: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "moonshotai/kimi-k2-instruct-0905", "qwen/qwen3-32b"],
    familia: /gpt-oss|kimi|qwen|llama-?\d.*(70b|maverick|scout)/,
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    modelos: "https://api.cerebras.ai/v1/models",
    chave: "CEREBRAS_API_KEY", modelo: "CEREBRAS_MODELO",
    preferidos: ["gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b"],
    familia: /gpt-oss|qwen|llama/,
  },
};

const aposentados = new Set();      // "groq:llama-3.3-70b-versatile" — modelo que o provedor tirou do ar
const descobertos = new Map();      // "groq" -> modelo achado na lista do provedor
export const eventosModelo = [];    // o autoteste lê e manda por email

// Modelos a tentar, em ordem: os do .env, o descoberto, a lista padrão. Sem os aposentados.
export function modelosDe(env, nome) {
  const p = PROVEDORES[nome];
  const doEnv = (env[p.modelo] || "").split(",").map((m) => m.trim()).filter(Boolean);
  const todos = [...doEnv, ...(descobertos.has(nome) ? [descobertos.get(nome)] : []), ...p.preferidos];
  return [...new Set(todos)].filter((m) => !aposentados.has(`${nome}:${m}`));
}

const MODELO_SUMIU = /model.{0,40}(not found|does not exist|decommission|deprecat|no longer|retired|not supported|unsupported|invalid|unknown)|(not found|does not exist|unknown).{0,20}model|model_not_found|model_decommissioned/i;
export const modeloSumiu = (status, texto) => status === 404 || ((status === 400 || status === 403) && MODELO_SUMIU.test(texto || ""));

// Último recurso: pergunta ao provedor quais modelos existem hoje e pega um da mesma família
async function descobrirModelo(nome, chave) {
  const p = PROVEDORES[nome];
  try {
    if (p.anthropic) {
      const ids = await listarModelosClaude(chave);
      return ids.filter((id) => p.familia.test(id) && !aposentados.has(`${nome}:${id}`)).sort().reverse()[0] || null;
    }
    const r = await fetch(p.modelos, { headers: { authorization: `Bearer ${chave}` } });
    if (!r.ok) return null;
    const j = await r.json();
    const ids = (j.data || j.models || []).map((m) => String(m.id || m.name || "").replace(/^models\//, ""));
    return ids.filter((id) => p.familia.test(id) && !aposentados.has(`${nome}:${id}`)).sort().reverse()[0] || null;
  } catch { return null; }
}

const TEMPO_LIMITE_MS = 25_000;
const PAUSA_APOS_LIMITE_MS = 60_000;   // provedor que deu 429 fica de lado por 1 min
const pausados = new Map();             // "conta:<id>:gemini" ou "plataforma:gemini" -> até quando

// IAs gratuitas, na ordem configurada
const ordem = (env) => (env.IA_ORDEM || "gemini,groq,cerebras").split(",").map((s) => s.trim())
  .filter((n) => PROVEDORES[n] && !PROVEDORES[n].anthropic);
const claudeAtiva = (env) => !!env.ANTHROPIC_API_KEY;
export const claudePrincipal = (env) => claudeAtiva(env) && (env.IA_CLAUDE || "principal") !== "reserva";

// Chaves da plataforma configuradas no Worker (Claude primeiro, se ativa)
export function provedoresAtivos(env) {
  return [...(claudeAtiva(env) ? ["claude"] : []), ...ordem(env).filter((n) => env[PROVEDORES[n].chave])];
}

// Confere uma chave antes de salvar (lista os modelos do provedor)
export async function validarChave(nome, chave) {
  const p = PROVEDORES[nome];
  if (!p) throw new Error("IA desconhecida.");
  const r = await fetch(p.modelos, { headers: { authorization: `Bearer ${chave}` } });
  if (r.ok) return true;
  const j = await r.json().catch(() => null);
  const m = j?.error?.message || j?.[0]?.error?.message || `erro ${r.status}`;
  throw new Error(r.status === 401 || r.status === 403 || r.status === 400 ? `Chave recusada: ${m}` : m);
}

// Cada provedor aceita só os campos do padrão; o Gemini ainda precisa receber de volta
// a "assinatura de raciocínio" (extra_content) que ele mesmo mandou.
function limparMensagem(m, provedor) {
  const base = { role: m.role, content: m.content ?? (m.tool_calls ? null : "") };
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  if (m.tool_calls?.length) {
    base.tool_calls = m.tool_calls.map((c) => ({
      id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments || "{}" },
      ...(provedor === "gemini" && c.extra_content ? { extra_content: c.extra_content } : {}),
    }));
  }
  return base;
}

// Guarda a resposta só com o que interessa (sem campos de raciocínio de cada provedor)
export function guardarResposta(msg) {
  const m = { role: "assistant", content: msg.content || null };
  if (msg._claude) m._claude = msg._claude;
  if (msg.tool_calls?.length) {
    m.tool_calls = msg.tool_calls.map((c, i) => ({
      id: c.id || `chamada_${Date.now()}_${i}`, type: "function",
      function: { name: c.function?.name, arguments: c.function?.arguments || "{}" },
      ...(c.extra_content ? { extra_content: c.extra_content } : {}),
    }));
  }
  return m;
}

class FalhaProvedor extends Error {}

// Tenta os modelos do provedor em ordem; modelo aposentado não derruba a Dri
async function chamarUm(env, alvo, pedido) {
  const { nome, chave, id } = alvo;
  let modelos = modelosDe(env, nome);
  let descobriu = false;
  for (let i = 0; i < modelos.length || !descobriu; i++) {
    if (i >= modelos.length) {
      descobriu = true;
      const novo = await descobrirModelo(nome, chave);
      if (!novo) break;
      descobertos.set(nome, novo);
      eventosModelo.push({ em: new Date().toISOString(), provedor: nome, tipo: "descoberto", modelo: novo });
      modelos = [...modelos, novo];
    }
    const modelo = modelos[i];
    try {
      return { msg: await chamarModelo(env, alvo, modelo, pedido), modelo };
    } catch (e) {
      if (!(e instanceof ModeloSumiu)) throw e;
      aposentados.add(`${nome}:${modelo}`);
      if (descobertos.get(nome) === modelo) descobertos.delete(nome);
      eventosModelo.push({ em: new Date().toISOString(), provedor: nome, tipo: "aposentado", modelo, erro: e.message });
      console.warn(`Modelo ${nome}:${modelo} indisponível, tentando o próximo:`, e.message);
    }
  }
  throw new FalhaProvedor(`${id}: nenhum modelo disponível`);
}

class ModeloSumiu extends Error {}

async function chamarModelo(env, { nome, chave, id }, modelo, { sistema, mensagens, ferramentas }) {
  const p = PROVEDORES[nome];
  if (p.anthropic) {
    try {
      return await chamarClaude({ chave, modelo, esforco: env.CLAUDE_ESFORCO || "low", sistema, mensagens, ferramentas, timeoutMs: TEMPO_LIMITE_MS });
    } catch (e) {
      if (!(e instanceof ErroClaude)) throw e;
      if (e.modeloSumiu) throw new ModeloSumiu(e.message);
      if (e.limite) pausados.set(id, Date.now() + PAUSA_APOS_LIMITE_MS);
      throw new FalhaProvedor(`${id}: ${e.message}`);
    }
  }
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(p.url, {
      method: "POST", signal: ctrl.signal,
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: "system", content: sistema }, ...mensagens.map((m) => limparMensagem(m, nome))],
        tools: ferramentas, tool_choice: "auto", max_tokens: 4000,
      }),
    });
  } catch (e) {
    throw new FalhaProvedor(`${id}: ${e.name === "AbortError" ? "demorou demais" : e.message}`);
  } finally {
    clearTimeout(relogio);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const texto = j?.error?.message || j?.[0]?.error?.message || JSON.stringify(j || "");
    if (modeloSumiu(r.status, texto + " " + (j?.error?.code || ""))) throw new ModeloSumiu(`${modelo}: ${r.status} ${texto}`);
    if (r.status === 429) pausados.set(id, Date.now() + PAUSA_APOS_LIMITE_MS);
    throw new FalhaProvedor(`${id}: ${r.status} ${j?.error?.message || j?.[0]?.error?.message || ""}`.trim());
  }
  const msg = j?.choices?.[0]?.message;
  if (!msg || (!msg.content && !msg.tool_calls?.length)) throw new FalhaProvedor(`${id}: resposta vazia`);
  for (const c of msg.tool_calls || []) {
    try { JSON.parse(c.function?.arguments || "{}"); }
    catch { throw new FalhaProvedor(`${id}: chamada de ferramenta com JSON inválido`); }
  }
  return msg;
}

/**
 * Pergunta para a primeira IA disponível; em erro passa para a próxima.
 * conta: { contaId, chaves: { gemini?: "...", groq?: "...", cerebras?: "..." } }
 * Devolve { msg, provedor, origem: "conta"|"plataforma", falhas }.
 */
export async function perguntar(env, pedido, conta = {}) {
  const proprias = ordem(env).filter((n) => conta.chaves?.[n])
    .map((nome) => ({ nome, chave: conta.chaves[nome], origem: "conta", id: `conta:${conta.contaId}:${nome}` }));
  const daPlataforma = (nome) => ({ nome, chave: env[PROVEDORES[nome].chave], origem: "plataforma", id: `plataforma:${nome}` });
  const reserva = env.IA_RESERVA_PLATAFORMA === "nao" ? [] : ordem(env).filter((n) => env[PROVEDORES[n].chave]).map(daPlataforma);
  const claude = claudeAtiva(env) ? [daPlataforma("claude")] : [];
  const tentativas = claudePrincipal(env) ? [...claude, ...proprias, ...reserva] : [...proprias, ...reserva, ...claude];
  if (!tentativas.length) throw new Error("Nenhuma IA configurada: cadastre uma chave na aba IA do painel.");
  // quem está pausado por limite vai para o fim da fila, mas ainda é tentado se os outros falharem
  const agora = Date.now();
  const fila = [...tentativas.filter((t) => !(pausados.get(t.id) > agora)), ...tentativas.filter((t) => pausados.get(t.id) > agora)];
  const falhas = [];
  for (const t of fila) {
    try {
      const { msg, modelo } = await chamarUm(env, t, pedido);
      return { msg, provedor: t.nome, modelo, origem: t.origem, falhas };
    } catch (e) {
      if (!(e instanceof FalhaProvedor)) throw e;
      falhas.push({ ...t, chave: undefined, erro: e.message });
      console.warn("IA falhou, tentando a próxima:", e.message);
    }
  }
  throw Object.assign(new Error(`Todas as IAs falharam: ${falhas.map((f) => f.erro).join(" | ")}`), { falhas });
}

// Autoteste: uma pergunta curta com ferramenta, para cada IA da plataforma
export async function autotestar(env) {
  const ferramenta = [{ type: "function", function: { name: "horarios_visita", description: "Horários livres", parameters: { type: "object", properties: { imovel_id: { type: "string" } }, required: ["imovel_id"] } } }];
  const resultados = [];
  for (const nome of provedoresAtivos(env)) {
    const alvo = { nome, chave: env[PROVEDORES[nome].chave], origem: "plataforma", id: `autoteste:${nome}` };
    try {
      const { msg, modelo } = await chamarUm(env, alvo, {
        sistema: "Você testa ferramentas. Use a ferramenta pedida.",
        mensagens: [{ role: "user", content: "Quais horários livres para o imóvel abc123? Use a ferramenta." }],
        ferramentas: ferramenta,
      });
      resultados.push({ provedor: nome, ok: true, modelo, usou_ferramenta: !!msg.tool_calls?.length });
    } catch (e) {
      resultados.push({ provedor: nome, ok: false, erro: e.message });
    }
  }
  return { resultados, eventos: eventosModelo.splice(0) };
}

export const _teste = { pausados, aposentados, descobertos };
