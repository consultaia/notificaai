// Claude (Anthropic) como uma das IAs da fila. A conversa fica guardada no formato comum
// ("chat completions"); aqui ela é convertida para o formato da Claude e de volta.
// Os blocos originais da Claude (com o raciocínio) ficam guardados em `_claude` na mensagem
// e voltam iguais nas próximas chamadas, como a API pede.
import Anthropic from "@anthropic-ai/sdk";

const idValido = (id) => String(id || "x").replace(/[^a-zA-Z0-9_-]/g, "_");
const semRaciocinio = (blocos) => blocos.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");

// Ferramentas do formato comum -> formato da Claude
export const ferramentasClaude = (ferramentas) => ferramentas.map((f) => ({
  name: f.function.name, description: f.function.description, input_schema: f.function.parameters,
}));

// Histórico comum -> mensagens da Claude (papéis alternados, resultados de ferramenta juntos)
export function paraClaude(mensagens, { comRaciocinio = true } = {}) {
  const saida = [];
  const juntar = (role, blocos) => {
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === role) ultima.content.push(...blocos);
    else saida.push({ role, content: [...blocos] });
  };
  for (const m of mensagens) {
    if (m.role === "user") juntar("user", [{ type: "text", text: String(m.content || "…") }]);
    else if (m.role === "tool") juntar("user", [{ type: "tool_result", tool_use_id: idValido(m.tool_call_id), content: String(m.content || "") }]);
    else if (m.role === "assistant") {
      let blocos;
      if (Array.isArray(m._claude)) blocos = comRaciocinio ? m._claude : semRaciocinio(m._claude);
      else {
        blocos = [];
        if (m.content) blocos.push({ type: "text", text: m.content });
        for (const c of m.tool_calls || []) {
          let input = {};
          try { input = JSON.parse(c.function.arguments || "{}"); } catch { /* fica vazio */ }
          blocos.push({ type: "tool_use", id: idValido(c.id), name: c.function.name, input });
        }
      }
      if (!blocos.length) blocos = [{ type: "text", text: "…" }];
      juntar("assistant", blocos);
    }
  }
  return saida;
}

// Resposta da Claude -> mensagem no formato comum (com os blocos originais em _claude)
export function deClaude(resposta) {
  const texto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const usos = resposta.content.filter((b) => b.type === "tool_use");
  return {
    role: "assistant",
    content: texto || null,
    ...(usos.length ? { tool_calls: usos.map((u) => ({ id: u.id, type: "function", function: { name: u.name, arguments: JSON.stringify(u.input || {}) } })) } : {}),
    _claude: resposta.content,
    _uso: resposta.usage,   // só para contar a capacidade; não vai para o histórico
  };
}

export class ErroClaude extends Error {
  constructor(msg, { limite = false, modeloSumiu = false } = {}) { super(msg); this.limite = limite; this.modeloSumiu = modeloSumiu; }
}

export async function chamarClaude({ chave, modelo, esforco, sistema, mensagens, ferramentas, timeoutMs }) {
  const client = new Anthropic({ apiKey: chave, timeout: timeoutMs, maxRetries: 1 });
  const pedido = (msgs) => client.messages.create({
    model: modelo,
    max_tokens: 16000,
    output_config: { effort: esforco || "low" },
    cache_control: { type: "ephemeral" },
    system: sistema,
    tools: ferramentasClaude(ferramentas),
    messages: msgs,
  });
  let resposta;
  try {
    try {
      resposta = await pedido(paraClaude(mensagens));
    } catch (e) {
      // O histórico mudou desde que o raciocínio foi gerado (ex.: o corretor editou as orientações):
      // a recuperação documentada é tirar os blocos de raciocínio e tentar uma vez.
      if (e instanceof Anthropic.BadRequestError && mensagens.some((m) => m._claude)) resposta = await pedido(paraClaude(mensagens, { comRaciocinio: false }));
      else throw e;
    }
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) throw new ErroClaude(`${modelo}: ${e.message}`, { modeloSumiu: true });
    if (e instanceof Anthropic.RateLimitError) throw new ErroClaude(`429 ${e.message}`, { limite: true });
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) throw new ErroClaude(`${e.status || ""} ${e.message}`.trim());
    throw e;
  }
  if (resposta.stop_reason === "refusal") throw new ErroClaude("recusou responder");
  if (resposta.stop_reason === "max_tokens") throw new ErroClaude("resposta cortada (max_tokens)");
  return deClaude(resposta);
}

export async function listarModelosClaude(chave) {
  const client = new Anthropic({ apiKey: chave, maxRetries: 0 });
  const ids = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids;
}
