// Banco em memória que imita o pedaço do supabase-js usado pela Dri (só para testes).
import { randomUUID } from "node:crypto";

export function fakeDb(tabelas) {
  const t = (n) => (tabelas[n] ||= []);
  const relacoes = { imoveis: ["imoveis", "imovel_id"] };
  class Q {
    constructor(nome) { this.nome = nome; this.filtros = []; this.op = "select"; this.campos = "*"; }
    select(c = "*") { if (this.op === "select") this.campos = c; this.retornar = true; return this; }
    eq(c, v) { this.filtros.push((r) => r[c] === v); return this; }
    in(c, vs) { this.filtros.push((r) => vs.includes(r[c])); return this; }
    gte(c, v) { this.filtros.push((r) => r[c] != null && r[c] >= v); return this; }
    lte(c, v) { this.filtros.push((r) => r[c] != null && r[c] <= v); return this; }
    ilike(c, v) { const p = v.replaceAll("%", "").toLowerCase(); this.filtros.push((r) => String(r[c] ?? "").toLowerCase().includes(p)); return this; }
    order(c, o = {}) { this.ordem = [c, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    insert(v) { this.op = "insert"; this.valores = [].concat(v); return this; }
    update(v) { this.op = "update"; this.valores = v; return this; }
    upsert(v, o = {}) { this.op = "upsert"; this.valores = [].concat(v); this.conflito = (o.onConflict || "id").split(","); this.ignorar = o.ignoreDuplicates; return this; }
    delete() { this.op = "delete"; return this; }
    maybeSingle() { this.um = "talvez"; return this; }
    single() { this.um = "sim"; return this; }
    projetar(r) {
      const m = this.campos.match(/(\w+)\(([^)]*)\)/);
      if (!m) return { ...r };
      const [tab, fk] = relacoes[m[1]];
      return { ...r, [m[1]]: t(tab).find((x) => x.id === r[fk]) || null };
    }
    executar() {
      const linhas = t(this.nome);
      const casa = (r) => this.filtros.every((f) => f(r));
      let out = [];
      if (this.op === "select") out = linhas.filter(casa);
      if (this.op === "insert") {
        for (const v of this.valores) {
          const r = { id: randomUUID(), criado_em: new Date().toISOString(), mensagens: [], transcricao: [], ...v };
          if (this.nome === "visitas" && r.status === "marcada" && linhas.some((x) => x.conta_id === r.conta_id && x.status === "marcada" && x.inicio < r.fim && x.fim > r.inicio))
            return { data: null, error: { code: "23P01", message: "exclusion" } };
          linhas.push(r); out.push(r);
        }
      }
      if (this.op === "update") for (const r of linhas.filter(casa)) { Object.assign(r, this.valores); out.push(r); }
      if (this.op === "upsert") {
        for (const v of this.valores) {
          const ex = linhas.find((r) => this.conflito.every((c) => r[c] === v[c]));
          if (ex) { if (!this.ignorar) { Object.assign(ex, v); out.push(ex); } }
          else { const r = { id: randomUUID(), mensagens: [], transcricao: [], ...v }; linhas.push(r); out.push(r); }
        }
      }
      if (this.op === "delete") { const fora = linhas.filter(casa); tabelas[this.nome] = linhas.filter((r) => !casa(r)); out = fora; }
      if (this.ordem) { const [c, asc] = this.ordem; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.lim) out = out.slice(0, this.lim);
      out = out.map((r) => this.projetar(r));
      if (this.um) return { data: out[0] ?? null, error: this.um === "sim" && !out.length ? { message: "0 linhas" } : null };
      return { data: this.op === "select" || this.retornar ? out : null, error: null };
    }
    then(ok, erro) { return Promise.resolve(this.executar()).then(ok, erro); }
  }
  // funções do banco usadas pelo Worker
  const rpc = async (nome, a) => {
    if (nome !== "registrar_uso_ia") return { data: null, error: { message: "rpc desconhecida" } };
    let u = t("ia_uso").find((r) => r.conta_id === a.p_conta && r.mes === a.p_mes);
    if (!u) { u = { conta_id: a.p_conta, mes: a.p_mes, mensagens: 0, tokens_entrada: 0, tokens_saida: 0 }; t("ia_uso").push(u); }
    u.mensagens += a.p_mensagens; u.tokens_entrada += a.p_entrada; u.tokens_saida += a.p_saida;
    return { data: { ...u }, error: null };
  };
  return { from: (n) => new Q(n), rpc, tabelas };
}
