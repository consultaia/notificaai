// Três IAs com plano gratuito, em fila: se uma falhar, bater o limite ou demorar, passa para a próxima.
// Todas falam o formato "chat completions" (padrão OpenAI) com ferramentas.
// Ordem e modelos configuráveis: IA_ORDEM="gemini,groq,cerebras", GEMINI_MODELO, GROQ_MODELO, CEREBRAS_MODELO.

export const PROVEDORES = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    chave: "GEMINI_API_KEY", modelo: "GEMINI_MODELO", padrao: "gemini-2.5-flash",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    chave: "GROQ_API_KEY", modelo: "GROQ_MODELO", padrao: "openai/gpt-oss-120b",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    chave: "CEREBRAS_API_KEY", modelo: "CEREBRAS_MODELO", padrao: "gpt-oss-120b",
  },
};

const TEMPO_LIMITE_MS = 25_000;
const PAUSA_APOS_LIMITE_MS = 60_000;   // provedor que deu 429 fica de lado por 1 min
const pausados = new Map();             // nome -> até quando (vale enquanto o Worker estiver vivo)

export function provedoresAtivos(env) {
  return (env.IA_ORDEM || "gemini,groq,cerebras").split(",").map((s) => s.trim())
    .filter((n) => PROVEDORES[n] && env[PROVEDORES[n].chave]);
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

async function chamarUm(env, nome, { sistema, mensagens, ferramentas }) {
  const p = PROVEDORES[nome];
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(p.url, {
      method: "POST", signal: ctrl.signal,
      headers: { authorization: `Bearer ${env[p.chave]}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env[p.modelo] || p.padrao,
        messages: [{ role: "system", content: sistema }, ...mensagens.map((m) => limparMensagem(m, nome))],
        tools: ferramentas, tool_choice: "auto", max_tokens: 4000,
      }),
    });
  } catch (e) {
    throw new FalhaProvedor(`${nome}: ${e.name === "AbortError" ? "demorou demais" : e.message}`);
  } finally {
    clearTimeout(relogio);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 429) pausados.set(nome, Date.now() + PAUSA_APOS_LIMITE_MS);
    throw new FalhaProvedor(`${nome}: ${r.status} ${j?.error?.message || j?.[0]?.error?.message || ""}`.trim());
  }
  const msg = j?.choices?.[0]?.message;
  if (!msg || (!msg.content && !msg.tool_calls?.length)) throw new FalhaProvedor(`${nome}: resposta vazia`);
  for (const c of msg.tool_calls || []) {
    try { JSON.parse(c.function?.arguments || "{}"); }
    catch { throw new FalhaProvedor(`${nome}: chamada de ferramenta com JSON inválido`); }
  }
  return msg;
}

/**
 * Pergunta para a primeira IA disponível; em erro passa para a próxima.
 * Devolve { msg, provedor, falhas }.
 */
export async function perguntar(env, pedido) {
  const ordem = provedoresAtivos(env);
  if (!ordem.length) throw new Error("Nenhuma IA configurada (GEMINI_API_KEY, GROQ_API_KEY ou CEREBRAS_API_KEY).");
  // quem está pausado por limite vai para o fim da fila, mas ainda é tentado se os outros falharem
  const agora = Date.now();
  const fila = [...ordem.filter((n) => !(pausados.get(n) > agora)), ...ordem.filter((n) => pausados.get(n) > agora)];
  const falhas = [];
  for (const nome of fila) {
    try {
      const msg = await chamarUm(env, nome, pedido);
      return { msg, provedor: nome, falhas };
    } catch (e) {
      if (!(e instanceof FalhaProvedor)) throw e;
      falhas.push(e.message);
      console.warn("IA falhou, tentando a próxima:", e.message);
    }
  }
  throw new Error(`Todas as IAs falharam: ${falhas.join(" | ")}`);
}

export const _teste = { pausados };
