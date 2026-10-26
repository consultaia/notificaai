// Três IAs com plano gratuito, em fila: se uma falhar, bater o limite ou demorar, passa para a próxima.
// Todas falam o formato "chat completions" (padrão OpenAI) com ferramentas.
// Primeiro vêm as chaves da própria conta (o limite gratuito é só do corretor); as chaves da
// plataforma ficam de reserva (desligue com IA_RESERVA_PLATAFORMA="nao").
// Ordem e modelos configuráveis: IA_ORDEM="gemini,groq,cerebras", GEMINI_MODELO, GROQ_MODELO, CEREBRAS_MODELO.

export const PROVEDORES = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    modelos: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    chave: "GEMINI_API_KEY", modelo: "GEMINI_MODELO", padrao: "gemini-2.5-flash",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    modelos: "https://api.groq.com/openai/v1/models",
    chave: "GROQ_API_KEY", modelo: "GROQ_MODELO", padrao: "openai/gpt-oss-120b",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    modelos: "https://api.cerebras.ai/v1/models",
    chave: "CEREBRAS_API_KEY", modelo: "CEREBRAS_MODELO", padrao: "gpt-oss-120b",
  },
};

const TEMPO_LIMITE_MS = 25_000;
const PAUSA_APOS_LIMITE_MS = 60_000;   // provedor que deu 429 fica de lado por 1 min
const pausados = new Map();             // "conta:<id>:gemini" ou "plataforma:gemini" -> até quando

const ordem = (env) => (env.IA_ORDEM || "gemini,groq,cerebras").split(",").map((s) => s.trim()).filter((n) => PROVEDORES[n]);

// Chaves da plataforma configuradas no Worker
export function provedoresAtivos(env) {
  return ordem(env).filter((n) => env[PROVEDORES[n].chave]);
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

async function chamarUm(env, { nome, chave, id }, { sistema, mensagens, ferramentas }) {
  const p = PROVEDORES[nome];
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(p.url, {
      method: "POST", signal: ctrl.signal,
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env[p.modelo] || p.padrao,
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
  const reserva = env.IA_RESERVA_PLATAFORMA === "nao" ? [] : provedoresAtivos(env)
    .map((nome) => ({ nome, chave: env[PROVEDORES[nome].chave], origem: "plataforma", id: `plataforma:${nome}` }));
  const tentativas = [...proprias, ...reserva];
  if (!tentativas.length) throw new Error("Nenhuma IA configurada: cadastre uma chave na aba IA do painel.");
  // quem está pausado por limite vai para o fim da fila, mas ainda é tentado se os outros falharem
  const agora = Date.now();
  const fila = [...tentativas.filter((t) => !(pausados.get(t.id) > agora)), ...tentativas.filter((t) => pausados.get(t.id) > agora)];
  const falhas = [];
  for (const t of fila) {
    try {
      const msg = await chamarUm(env, t, pedido);
      return { msg, provedor: t.nome, origem: t.origem, falhas };
    } catch (e) {
      if (!(e instanceof FalhaProvedor)) throw e;
      falhas.push({ ...t, chave: undefined, erro: e.message });
      console.warn("IA falhou, tentando a próxima:", e.message);
    }
  }
  throw Object.assign(new Error(`Todas as IAs falharam: ${falhas.map((f) => f.erro).join(" | ")}`), { falhas });
}

export const _teste = { pausados };
