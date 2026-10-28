// Parceiros divulgadores: link próprio (…/?p=codigo) e um PIX fixo a cada nova adesão.
// Um corretor da plataforma vira parceiro pelo painel (aceita os termos e informa a chave PIX).

export const normalizarCodigo = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Nomes que confundiriam com a própria plataforma
const RESERVADOS = new Set(["dri", "dri-imoveis", "admin", "app", "painel", "suporte", "oficial", "privacidade", "parceiro", "parceiros", "toc-toc", "toctoc"]);
export const codigoReservado = (c) => RESERVADOS.has(c) || c.startsWith("dri-") || c.startsWith("toc-toc") || c.startsWith("toctoc");

export const linkDoParceiro = (site, codigo) => `${String(site || "").replace(/\/$/, "")}/?p=${codigo}`;

// Primeiro código livre a partir do nome ("Carlos Andrade Imóveis" → carlos-andrade, carlos-andrade-2…)
async function codigoLivre(db, base) {
  let raiz = normalizarCodigo(base).split("-").slice(0, 2).join("-");
  if (!raiz || codigoReservado(raiz)) raiz = "corretor";
  for (let i = 1; i < 200; i++) {
    const c = i === 1 ? raiz : `${raiz}-${i}`;
    const { data } = await db.from("parceiros").select("id").eq("codigo", c).maybeSingle();
    if (!data) return c;
  }
  return `${raiz}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function resumoDoParceiro(db, parceiro) {
  if (!parceiro) return null;
  const [{ data: indicadas }, { data: comissoes }] = await Promise.all([
    db.from("assinaturas").select("conta_id,status").eq("parceiro_id", parceiro.id),
    db.from("comissoes").select("valor,status").eq("parceiro_id", parceiro.id),
  ]);
  const soma = (st) => (comissoes || []).filter((c) => c.status === st).reduce((a, c) => a + Number(c.valor), 0);
  return {
    cadastros: (indicadas || []).length,
    adesoes: (comissoes || []).filter((c) => c.status !== "cancelada").length,
    a_receber: soma("a pagar"), recebido: soma("pago"),
  };
}

// Corretor aceita ser parceiro: guarda PIX, aceite e gera (ou troca) o código do link
export async function aderir(db, conta, { pix, codigo }, agora = new Date()) {
  const chave = String(pix || "").trim();
  if (chave.length < 5) return { erro: "Informe a chave PIX para receber as comissões." };
  const { data: atual } = await db.from("parceiros").select("*").eq("conta_id", conta.id).maybeSingle();
  let novoCodigo = atual?.codigo;
  if (codigo != null && normalizarCodigo(codigo) !== atual?.codigo) {
    novoCodigo = normalizarCodigo(codigo);
    if (novoCodigo.length < 2) return { erro: "O nome do link precisa de pelo menos 2 letras ou números." };
    if (codigoReservado(novoCodigo)) return { erro: "Esse nome de link é reservado. Use o seu nome (ex.: carlos-imoveis)." };
    const { data: dono } = await db.from("parceiros").select("id").eq("codigo", novoCodigo).maybeSingle();
    if (dono && dono.id !== atual?.id) return { erro: "Esse nome de link já está em uso. Tente outro." };
  }
  if (!novoCodigo) novoCodigo = await codigoLivre(db, conta.nome);
  const linha = { codigo: novoCodigo, nome: conta.nome, pix: chave, whatsapp: conta.whatsapp_pessoal || null, email: conta.email_notificacao || null };
  const r = atual
    ? await db.from("parceiros").update(linha).eq("id", atual.id).select().single()
    : await db.from("parceiros").insert({ ...linha, conta_id: conta.id, aceitou_termos_em: agora.toISOString(), ativo: true }).select().single();
  if (r.error) return { erro: r.error.code === "23505" ? "Esse nome de link já está em uso. Tente outro." : r.error.message };
  return { parceiro: r.data };
}
