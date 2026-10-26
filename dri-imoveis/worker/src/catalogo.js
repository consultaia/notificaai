// Lê o texto (e, se preciso, imagens) das páginas de um book de empreendimento e devolve
// os dados organizados: empreendimento, endereço, lazer, plantas e páginas boas para foto.
// Usa a Claude Haiku com saída estruturada; sem ela, uma IA gratuita em modo JSON.
import Anthropic from "@anthropic-ai/sdk";
import { PROVEDORES, provedoresAtivos } from "./ia.js";

const LIMITE_TEXTO = 60_000;   // caracteres de texto do PDF enviados para a IA
const LIMITE_IMAGENS = 12;

// Campos sempre presentes (vazio = "" ou 0), para a saída estruturada ficar simples
const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["empreendimento", "construtora", "finalidade", "tipo", "bairro", "cidade", "endereco", "situacao",
    "previsao_entrega", "programa", "preco_a_partir", "descricao", "caracteristicas", "vagas", "plantas", "paginas_fotos"],
  properties: {
    empreendimento: { type: "string", description: "Nome do empreendimento" },
    construtora: { type: "string", description: "Construtora ou incorporadora; vazio se não houver" },
    finalidade: { type: "string", enum: ["venda", "aluguel"] },
    tipo: { type: "string", description: "apartamento, casa, studio, sala comercial…" },
    bairro: { type: "string" },
    cidade: { type: "string", description: "Cidade/UF, ex.: Salvador, BA" },
    endereco: { type: "string", description: "Endereço completo se aparecer; vazio se não" },
    situacao: { type: "string", enum: ["lançamento", "na planta", "em obras", "pronto", ""] },
    previsao_entrega: { type: "string", description: "Ex.: dezembro de 2027; vazio se não houver" },
    programa: { type: "string", description: "Ex.: Minha Casa, Minha Vida; vazio se não houver" },
    preco_a_partir: { type: "number", description: "Menor valor em reais citado no book; 0 se não houver preço" },
    descricao: { type: "string", description: "Resumo de 3 a 5 frases para apresentar o empreendimento a um cliente, sem exageros de marketing" },
    caracteristicas: { type: "array", items: { type: "string" }, description: "Itens de lazer e diferenciais, curtos (ex.: piscina com borda infinita, portaria 24h)" },
    vagas: { type: "integer", description: "Vagas por unidade, se o book disser; 0 se não" },
    plantas: {
      type: "array", description: "Uma por tipologia/planta diferente",
      items: {
        type: "object", additionalProperties: false,
        required: ["nome", "quartos", "suites", "area_m2", "varanda", "pagina"],
        properties: {
          nome: { type: "string", description: "Ex.: 3/4 com suíte e varanda (Tipo A)" },
          quartos: { type: "integer" }, suites: { type: "integer" },
          area_m2: { type: "number", description: "Área privativa; se houver várias muito próximas, a menor" },
          varanda: { type: "boolean" },
          pagina: { type: "integer", description: "Página da planta no PDF; 0 se não souber" },
        },
      },
    },
    paginas_fotos: { type: "array", items: { type: "integer" }, description: "Até 8 páginas com as melhores imagens para mostrar a um cliente (fachada, lazer, áreas comuns, decorado), em ordem de importância. Não inclua páginas só de texto." },
  },
};

const INSTRUCOES = `Você recebe o conteúdo de um book (PDF de divulgação) de empreendimento imobiliário, página por página.
Extraia os dados para cadastro. Regras:
- Use só o que está no book. Não invente preço, área, endereço ou data. Campo sem informação: "" ou 0.
- "Imagem meramente ilustrativa" e textos legais não são características.
- Cada planta/tipologia diferente vira um item em "plantas", com a página onde a planta aparece.
- Responda em português do Brasil.`;

function montarTexto(paginas) {
  let total = 0;
  const partes = [];
  for (const p of paginas) {
    const t = String(p.texto || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const pedaco = `--- Página ${p.n} ---\n${t}`;
    if (total + pedaco.length > LIMITE_TEXTO) break;
    partes.push(pedaco); total += pedaco.length;
  }
  return partes.join("\n");
}

function normalizar(d, totalPaginas) {
  const pag = (n) => (Number.isInteger(n) && n >= 1 && n <= totalPaginas ? n : null);
  const txt = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v) => (typeof v === "number" && v > 0 ? v : null);
  return {
    empreendimento: txt(d.empreendimento), construtora: txt(d.construtora),
    finalidade: d.finalidade === "aluguel" ? "aluguel" : "venda", tipo: txt(d.tipo) || "apartamento",
    bairro: txt(d.bairro), cidade: txt(d.cidade), endereco: txt(d.endereco),
    situacao: ["lançamento", "na planta", "em obras", "pronto"].includes(d.situacao) ? d.situacao : null,
    previsao_entrega: txt(d.previsao_entrega), programa: txt(d.programa),
    preco_a_partir: num(d.preco_a_partir), descricao: txt(d.descricao),
    caracteristicas: (d.caracteristicas || []).map(txt).filter(Boolean).slice(0, 30),
    vagas: Number.isInteger(d.vagas) && d.vagas > 0 ? d.vagas : null,
    plantas: (d.plantas || []).slice(0, 20).map((p) => ({
      nome: txt(p.nome) || "Planta", quartos: Number.isInteger(p.quartos) && p.quartos > 0 ? p.quartos : null,
      suites: Number.isInteger(p.suites) && p.suites > 0 ? p.suites : null, area_m2: num(p.area_m2),
      varanda: !!p.varanda, pagina: pag(p.pagina),
    })),
    paginas_fotos: [...new Set((d.paginas_fotos || []).map(pag).filter(Boolean))].slice(0, 8),
  };
}

async function comClaude(env, texto, imagens, totalPaginas) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  const conteudo = [];
  for (const img of imagens.slice(0, LIMITE_IMAGENS)) {
    conteudo.push({ type: "text", text: `Página ${img.n}:` });
    conteudo.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.base64 } });
  }
  conteudo.push({ type: "text", text: `O PDF tem ${totalPaginas} páginas.\n\n${texto || "(o PDF não tem texto selecionável; use as imagens)"}` });
  const r = await client.messages.create({
    model: env.CLAUDE_MODELO?.split(",")[0]?.trim() || "claude-haiku-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: INSTRUCOES,
    messages: [{ role: "user", content: conteudo }],
  });
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") throw new Error(`Claude não terminou (${r.stop_reason})`);
  const bloco = r.content.find((b) => b.type === "text");
  return JSON.parse(bloco.text);
}

async function comGratuita(env, texto, totalPaginas) {
  const erros = [];
  for (const nome of provedoresAtivos(env).filter((n) => !PROVEDORES[n].anthropic)) {
    const p = PROVEDORES[nome];
    const r = await fetch(p.url, {
      method: "POST",
      headers: { authorization: `Bearer ${env[p.chave]}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: (env[p.modelo] || "").split(",")[0].trim() || p.preferidos[0],
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${INSTRUCOES}\nResponda só com um JSON neste esquema:\n${JSON.stringify(ESQUEMA)}` },
          { role: "user", content: `O PDF tem ${totalPaginas} páginas.\n\n${texto}` },
        ],
      }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const j = await r.json().catch(() => null);
    if (r.ok) {
      try { return JSON.parse(j.choices[0].message.content); } catch { erros.push(`${nome}: JSON inválido`); continue; }
    }
    erros.push(`${nome}: ${j?.error?.message || r.status}`);
  }
  throw new Error(`Nenhuma IA conseguiu ler o book: ${erros.join(" | ") || "nenhuma configurada"}`);
}

/**
 * paginas: [{ n, texto }], imagens: [{ n, base64 }] (opcional, para PDF só de imagem)
 */
export async function lerBook(env, { paginas, imagens = [], totalPaginas }) {
  const texto = montarTexto(paginas || []);
  const total = totalPaginas || (paginas || []).length;
  if (texto.length < 300 && !imagens.length) throw new Error("O PDF quase não tem texto. Envie as imagens das páginas.");
  let dados;
  if (env.ANTHROPIC_API_KEY) {
    try { dados = await comClaude(env, texto, texto.length < 300 ? imagens : [], total); }
    catch (e) { console.warn("book com Claude falhou, tentando gratuita:", e.message); }
  }
  if (!dados) {
    if (!texto) throw new Error("Este PDF é só imagem e a leitura por imagem precisa da IA incluída.");
    dados = await comGratuita(env, texto, total);
  }
  return normalizar(dados, total);
}

export const _teste = { montarTexto, normalizar, ESQUEMA };
