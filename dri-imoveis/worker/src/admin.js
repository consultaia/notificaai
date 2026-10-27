// Área do administrador da plataforma (emails em ADMIN_EMAILS): métricas, contas, cortesia,
// cobrança, parceiros divulgadores (PIX por adesão) e valores do plano. Tudo passa pelo Worker (service role).
import { lerConfig, situacao, enviarAvisoCobranca, textoAvisoCobranca } from "./cobranca.js";
import { normalizarCodigo, linkDoParceiro, codigoReservado } from "./parceiros.js";

const DIA = 24 * 3600e3;
const inicioDoMes = (agora) => {
  const d = new Date(agora.toLocaleString("en-US", { timeZone: "America/Bahia" }));
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1, 3)).toISOString(); // 00h de Brasília
};
const mesTexto = (agora) => new Date(agora.toLocaleString("en-US", { timeZone: "America/Bahia" })).toISOString().slice(0, 7);
const soma = (xs, c) => Math.round(xs.reduce((a, x) => a + (Number(x[c]) || 0), 0) * 100) / 100;

async function emailsDosUsuarios(db) {
  const mapa = {};
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) mapa[u.id] = { email: u.email, confirmado: !!u.email_confirmed_at, ultimo_login: u.last_sign_in_at };
    if (data.users.length < 1000) break;
  }
  return mapa;
}

async function carregarTudo(db, agora) {
  const desde30 = new Date(agora.getTime() - 30 * DIA).toISOString();
  const [contas, assinaturas, conexoes, uso, conversas, visitas, captacoes, pagamentos, parceiros, comissoes, cfg, usuarios] = await Promise.all([
    db.from("contas").select("id,owner_id,nome,tipo,cidade,whatsapp_pessoal,email_notificacao,nome_assistente,onboarding_etapa,criado_em"),
    db.from("assinaturas").select("*"),
    db.from("whatsapp_conexoes").select("conta_id,status,numero_exibicao,ultima_mensagem_em"),
    db.from("ia_uso").select("conta_id,mensagens,tokens_entrada,tokens_saida").eq("mes", mesTexto(agora)),
    db.from("conversas").select("conta_id,telefone,atualizado_em").gte("atualizado_em", desde30),
    db.from("visitas").select("conta_id,status,criado_em").gte("criado_em", desde30),
    db.from("captacoes").select("conta_id,criado_em").gte("criado_em", desde30),
    db.from("pagamentos").select("*").gte("criado_em", inicioDoMes(agora)),
    db.from("parceiros").select("*").order("criado_em", { ascending: false }),
    db.from("comissoes").select("*").order("criado_em", { ascending: false }),
    lerConfig(db),
    emailsDosUsuarios(db),
  ]);
  return {
    contas: contas.data || [], assinaturas: assinaturas.data || [], conexoes: conexoes.data || [], uso: uso.data || [],
    conversas: (conversas.data || []).filter((c) => c.telefone !== "simulador"),
    visitas: (visitas.data || []).filter((v) => v.status !== "teste"),
    captacoes: captacoes.data || [], pagamentos: pagamentos.data || [], parceiros: parceiros.data || [],
    comissoes: comissoes.data || [], cfg, usuarios,
  };
}

function montarContas(t, agora) {
  const por = (xs, id) => xs.filter((x) => x.conta_id === id);
  return t.contas.map((c) => {
    const a = t.assinaturas.find((x) => x.conta_id === c.id) || null;
    const s = situacao(a, t.cfg, agora);
    const u = t.uso.find((x) => x.conta_id === c.id);
    const wa = t.conexoes.find((x) => x.conta_id === c.id);
    return {
      id: c.id, nome: c.nome, tipo: c.tipo, cidade: c.cidade, whatsapp_pessoal: c.whatsapp_pessoal,
      email: t.usuarios[c.owner_id]?.email || c.email_notificacao, ultimo_login: t.usuarios[c.owner_id]?.ultimo_login || null,
      criado_em: c.criado_em, onboarding_etapa: c.onboarding_etapa,
      whatsapp: wa?.status === "conectado" ? wa.numero_exibicao || "conectado" : null,
      status: s.status, pode_atender: s.pode_atender, motivo: s.motivo || null,
      teste_ate: a?.teste_ate || null, dias_restantes: s.dias_restantes ?? null, pausa_em: s.pausa_em || null,
      falhou_em: a?.falhou_em || null, aviso_enviado_em: a?.aviso_enviado_em || null, cortesia_motivo: a?.cortesia_motivo || null,
      assinou_em: a?.assinou_em || null, proxima_cobranca: a?.proxima_cobranca || null, valor_mensal: a?.valor_mensal ?? null,
      tem_cartao: !!a?.mp_preapproval_id,
      parceiro: t.parceiros.find((p) => p.id === a?.parceiro_id)?.codigo || null,
      ia_mensagens_mes: u?.mensagens || 0, tokens_mes: (u?.tokens_entrada || 0) + (u?.tokens_saida || 0),
      conversas_30d: por(t.conversas, c.id).length, visitas_30d: por(t.visitas, c.id).length, captacoes_30d: por(t.captacoes, c.id).length,
    };
  }).sort((x, y) => (y.criado_em > x.criado_em ? 1 : -1));
}

function montarParceiros(t, contas, site) {
  return t.parceiros.map((p) => {
    const clientes = contas.filter((c) => c.parceiro === p.codigo);
    const cs = t.comissoes.filter((c) => c.parceiro_id === p.id);
    return {
      ...p, link: linkDoParceiro(site, p.codigo), corretor: !!p.conta_id,
      cadastros: clientes.length, pagantes: clientes.filter((c) => c.status === "ativa").length,
      adesoes: cs.filter((c) => c.status !== "cancelada").length,
      // cruzamento: cada conta que chegou pelo link e o que aconteceu com ela
      indicados: clientes.map((c) => {
        const com = cs.find((x) => x.conta_id === c.id);
        return { nome: c.nome, cadastro_em: c.criado_em, status: c.status, assinou_em: c.assinou_em, comissao: com ? com.status : null };
      }),
      a_pagar: soma(cs.filter((c) => c.status === "a pagar"), "valor"), pago: soma(cs.filter((c) => c.status === "pago"), "valor"),
    };
  });
}

function montarComissoes(t) {
  return t.comissoes.map((c) => {
    const p = t.parceiros.find((x) => x.id === c.parceiro_id);
    const conta = t.contas.find((x) => x.id === c.conta_id);
    return { ...c, parceiro: p?.nome || "?", codigo: p?.codigo || null, pix: p?.pix || null, conta: conta?.nome || "?",
      cadastro_em: c.cadastro_em || conta?.criado_em || null };
  });
}

export async function rotaAdmin(rota, corpo, { env, db, url, agora = new Date() }) {
  const site = (env.SITE_URL || (env.PAINEL_ORIGEM || "").replace(/\/$/, "")) || url;

  if (rota === "POST /admin/resumo") {
    const t = await carregarTudo(db, agora);
    const contas = montarContas(t, agora);
    const ini = inicioDoMes(agora);
    const aprovados = t.pagamentos.filter((p) => p.status === "aprovado" && p.pago_em >= ini);
    const conta = (s) => contas.filter((c) => c.status === s).length;
    const { data: avisos } = await db.from("avisos_admin").select("*").order("criado_em", { ascending: false }).limit(30);
    return {
      config: t.cfg,
      numeros: {
        contas: contas.length, teste: conta("teste"), ativas: conta("ativa"), atrasadas: conta("atrasada"),
        pausadas: conta("pausada"), canceladas: conta("cancelada"), cortesia: conta("cortesia"),
        whatsapp_conectados: contas.filter((c) => c.whatsapp).length,
        receita_recorrente: Math.round(contas.filter((c) => c.status === "ativa").reduce((s, c) => s + Number(c.valor_mensal ?? t.cfg.preco_mensal), 0) * 100) / 100,
        recebido_mes: soma(aprovados, "valor"),
        comissoes_a_pagar: soma(t.comissoes.filter((c) => c.status === "a pagar"), "valor"),
        comissoes_em_analise: t.comissoes.filter((c) => c.status === "em análise").length,
        recusados_mes: t.pagamentos.filter((p) => p.status === "recusado" && p.criado_em >= ini).length,
        conversas_30d: t.conversas.length, visitas_30d: t.visitas.length, captacoes_30d: t.captacoes.length,
        ia_mensagens_mes: soma(t.uso, "mensagens"), ia_tokens_mes: soma(t.uso, "tokens_entrada") + soma(t.uso, "tokens_saida"),
      },
      contas, parceiros: montarParceiros(t, contas, site), comissoes: montarComissoes(t), avisos: avisos || [],
    };
  }

  if (rota === "POST /admin/conta") {
    const id = String(corpo.conta_id || "");
    const { data: conta } = await db.from("contas").select("*").eq("id", id).maybeSingle();
    if (!conta) return { erro: "Conta não encontrada.", status: 404 };
    const cfg = await lerConfig(db);
    const { data: a } = await db.from("assinaturas").select("*").eq("conta_id", id).maybeSingle();
    const quando = agora.toISOString();
    const mudar = async (campos) => {
      const r = a
        ? await db.from("assinaturas").update({ ...campos, atualizado_em: quando }).eq("conta_id", id)
        : await db.from("assinaturas").insert({ conta_id: id, teste_ate: quando, ...campos });
      if (r.error) throw new Error(r.error.message);
    };
    switch (corpo.acao) {
      case "cortesia":
        await mudar({ status: "cortesia", cortesia_motivo: String(corpo.motivo || "").slice(0, 200) || null, falhou_em: null, pausada_em: null });
        return { ok: "Conta marcada como cortesia." };
      case "tirar_cortesia":
        await mudar({ status: a?.mp_preapproval_id ? "ativa" : "pausada", cortesia_motivo: null, pausada_em: a?.mp_preapproval_id ? null : quando });
        return { ok: a?.mp_preapproval_id ? "Cortesia removida: volta a cobrar no cartão cadastrado." : "Cortesia removida. Sem cartão cadastrado, a conta fica pausada até assinar." };
      case "estender_teste": {
        const dias = Math.max(1, Math.min(60, Number(corpo.dias) || cfg.dias_teste));
        await mudar({ status: "teste", teste_ate: new Date(agora.getTime() + dias * DIA).toISOString(), pausada_em: null });
        return { ok: `Teste grátis por mais ${dias} dia(s).` };
      }
      case "pausar":
        await mudar({ status: "pausada", pausada_em: quando });
        return { ok: "Conta pausada: a assistente para de responder." };
      case "reativar":
        await mudar({ status: "ativa", falhou_em: null, pausada_em: null });
        return { ok: "Conta reativada." };
      case "previa_aviso":
        return { texto: textoAvisoCobranca(conta, situacao(a, cfg, agora)) };
      case "aviso": {
        const { data: wa } = await db.from("whatsapp_conexoes").select("*").eq("conta_id", id).maybeSingle();
        const { data: seg } = await db.from("whatsapp_segredos").select("access_token").eq("conta_id", id).maybeSingle();
        const conexao = wa?.status === "conectado" && seg?.access_token ? { ...wa, token: seg.access_token } : null;
        const { data: dono } = await db.auth.admin.getUserById(conta.owner_id).catch(() => ({ data: null }));
        const r = await enviarAvisoCobranca(env, db, conta, situacao(a, cfg, agora), {
          conexao, emailLogin: dono?.user?.email, texto: String(corpo.texto || "").trim().slice(0, 1000) || null,
        });
        return { ok: r.canais.length
          ? `Aviso enviado por ${r.canais.join(" e ")}. Ele também aparece no painel do corretor.`
          : "Não havia email (Resend) nem WhatsApp conectado para enviar: o aviso aparece só na faixa do painel do corretor." };
      }
      default:
        return { erro: "Ação desconhecida.", status: 400 };
    }
  }

  if (rota === "POST /admin/parceiro") {
    const codigo = normalizarCodigo(corpo.codigo);
    if (codigo.length < 2) return { erro: "O código do link precisa de pelo menos 2 letras (ex.: joao).", status: 400 };
    if (codigoReservado(codigo)) return { erro: "Esse nome de link é reservado.", status: 400 };
    if (!String(corpo.nome || "").trim()) return { erro: "Dê um nome ao parceiro.", status: 400 };
    const linha = {
      codigo, nome: String(corpo.nome).trim(), email: corpo.email || null, whatsapp: corpo.whatsapp || null, pix: corpo.pix || null,
      ativo: corpo.ativo !== false,
    };
    const r = corpo.id
      ? await db.from("parceiros").update(linha).eq("id", corpo.id).select().single()
      : await db.from("parceiros").insert(linha).select().single();
    if (r.error) return { erro: r.error.code === "23505" ? "Já existe um parceiro com esse código." : r.error.message, status: 400 };
    return { ok: "Parceiro salvo.", parceiro: r.data };
  }

  if (rota === "POST /admin/config") {
    const n = (v, min, max) => Math.max(min, Math.min(max, Number(v)));
    const campos = {};
    if (corpo.preco_mensal != null) campos.preco_mensal = n(corpo.preco_mensal, 1, 100000);
    if (corpo.dias_teste != null) campos.dias_teste = Math.round(n(corpo.dias_teste, 0, 60));
    if (corpo.dias_tolerancia != null) campos.dias_tolerancia = Math.round(n(corpo.dias_tolerancia, 0, 30));
    if (corpo.comissao_adesao != null) campos.comissao_adesao = n(corpo.comissao_adesao, 0, 100000);
    if (Object.values(campos).some((v) => Number.isNaN(v))) return { erro: "Use só números.", status: 400 };
    const r = await db.from("plataforma_config").update({ ...campos, atualizado_em: agora.toISOString() }).eq("id", true);
    if (r.error) return { erro: r.error.message, status: 400 };
    return { ok: "Valores salvos. O preço novo vale para quem assinar daqui em diante." };
  }

  if (rota === "POST /admin/comissao") {
    const status = { pago: "pago", cancelar: "cancelada", reabrir: "a pagar", aprovar: "a pagar" }[corpo.acao];
    if (!status) return { erro: "Ação desconhecida.", status: 400 };
    const r = await db.from("comissoes").update({ status, pago_em: status === "pago" ? agora.toISOString() : null }).eq("id", String(corpo.id || "")).select();
    if (r.error || !r.data?.length) return { erro: "Comissão não encontrada.", status: 404 };
    return { ok: status === "pago" ? "Comissão marcada como paga." : status === "cancelada" ? "Comissão cancelada." : corpo.acao === "aprovar" ? "Comissão aprovada: agora está a pagar." : "Comissão voltou para a pagar." };
  }

  if (rota === "POST /admin/avisos/lidos") {
    await db.from("avisos_admin").update({ lido: true }).eq("lido", false);
    return { ok: true };
  }
  return null;
}
