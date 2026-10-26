// Avisa o corretor: visita marcada, visita cancelada, cliente pedindo atendimento humano.
// Canais: email (Resend, se configurado) e WhatsApp pessoal do corretor (melhor esforço:
// fora da janela de 24 h a Meta só aceita modelo aprovado, configurado em TEMPLATE_AVISO).
import { descreverHorario } from "./agenda.js";
import { enviarTexto } from "./whatsapp.js";

const soDigitos = (t) => String(t || "").replace(/\D/g, "");

function montar(tipo, ctx, dados) {
  const cliente = `${ctx.nome || "Cliente"} (+${ctx.telefone})`;
  if (tipo === "visita") {
    const v = dados.visita;
    return {
      assunto: `Visita marcada: ${dados.imovel.titulo} — ${descreverHorario(new Date(v.inicio))}`,
      texto: `📅 ${ctx.conta.nome_assistente} marcou uma visita\n\n*${dados.imovel.titulo}*${dados.imovel.codigo ? ` (${dados.imovel.codigo})` : ""}\n${descreverHorario(new Date(v.inicio))}\nCliente: ${v.cliente_nome || ""} · +${ctx.telefone}${v.observacoes ? `\nObs.: ${v.observacoes}` : ""}`,
    };
  }
  if (tipo === "cancelamento") {
    return {
      assunto: `Visita cancelada — ${descreverHorario(new Date(dados.visita.inicio))}`,
      texto: `❌ Visita cancelada pelo cliente\n${dados.visita.imoveis?.titulo || ""}\n${descreverHorario(new Date(dados.visita.inicio))}\nCliente: ${cliente}`,
    };
  }
  if (tipo === "captacao") {
    const c = dados.captacao;
    const brl = (v) => (v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
    const resumo = [[c.tipo, c.finalidade && `para ${c.finalidade}`].filter(Boolean).join(" "), c.bairro].filter(Boolean).join(" · ");
    const detalhes = [c.quartos != null && `${c.quartos} quarto${c.quartos === 1 ? "" : "s"}`, c.vagas != null && `${c.vagas} vaga${c.vagas === 1 ? "" : "s"}`, c.area_m2 && `${String(c.area_m2).replace(".", ",")} m²`,
      c.valor_pretendido && `pede ${brl(c.valor_pretendido)}`].filter(Boolean).join(" · ");
    return {
      assunto: `Imóvel para captar: ${resumo || "proprietário quer anunciar"}`,
      texto: `🏡 Um proprietário quer ${c.finalidade === "aluguel" ? "alugar" : "vender"} com você\n\n${c.nome || "Proprietário"} · +${ctx.telefone}\n${resumo}${detalhes ? `\n${detalhes}` : ""}${c.melhor_horario ? `\nMelhor horário: ${c.melhor_horario}` : ""}${(c.fotos || []).length ? `\n${c.fotos.length} foto(s) recebida(s)` : ""}\n\nVeja tudo na aba Captações do painel.`,
    };
  }
  if (tipo === "capacidade") {
    const { nivel, usadas, cota, temChavesProprias } = dados;
    const nome = ctx.conta.nome_assistente;
    if (nivel === 100) return {
      assunto: `${nome}: a capacidade incluída do mês acabou`,
      texto: temChavesProprias
        ? `⚡ ${nome} já respondeu ${usadas} mensagens este mês e usou toda a capacidade incluída no plano.\n\nTudo certo: ela continua atendendo com as suas chaves gratuitas. Se quiser mais garantia, cadastre as que faltam na aba IA do painel.`
        : `⚠️ ${nome} já respondeu ${usadas} mensagens este mês e usou toda a capacidade incluída no plano.\n\nAgora ela está usando uma reserva compartilhada, que pode falhar nos horários de pico. Para continuar sem interrupção, cadastre suas chaves gratuitas (Groq e Gemini) na aba IA do painel: leva uns 5 minutos.`,
    };
    return {
      assunto: `${nome}: 80% da capacidade do mês usada`,
      texto: `📈 ${nome} já respondeu ${usadas} de ${cota} mensagens incluídas este mês.${temChavesProprias ? " Quando acabar, ela continua com as suas chaves gratuitas." : `\n\nPara ela não parar quando acabar, cadastre suas chaves gratuitas (Groq e Gemini) na aba IA do painel: leva uns 5 minutos.`}`,
    };
  }
  return {
    assunto: `Cliente pedindo atendimento: ${cliente}`,
    texto: `🙋 Um cliente precisa de você\n${cliente}\nMotivo: ${dados.motivo}\n\nResponda pelo painel da ${ctx.conta.nome_assistente}. Ela fica em silêncio nessa conversa até você marcar como resolvida.`,
  };
}

export async function notificarCorretor(ctx, tipo, dados) {
  const { env, conta } = ctx;
  const { assunto, texto } = montar(tipo, ctx, dados);
  const tarefas = [];

  if (env.RESEND_API_KEY && env.EMAIL_REMETENTE && conta.email_notificacao) {
    tarefas.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE, to: [conta.email_notificacao], subject: assunto,
        text: `${texto}\n\nPainel: ${env.PAINEL_URL || ""}`,
      }),
    }));
  }

  const pessoal = soDigitos(conta.whatsapp_pessoal);
  if (ctx.conexao && pessoal && pessoal !== soDigitos(ctx.telefone) && ctx.canal !== "simulador") {
    if (env.TEMPLATE_AVISO) {
      // Modelo de utilidade com uma variável: {{1}} = texto do aviso
      tarefas.push(fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || "v23.0"}/${ctx.conexao.phone_number_id}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${ctx.conexao.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: pessoal, type: "template",
          template: {
            name: env.TEMPLATE_AVISO, language: { code: "pt_BR" },
            components: [{ type: "body", parameters: [{ type: "text", text: texto.replace(/\n+/g, " · ").slice(0, 1000) }] }],
          },
        }),
      }));
    } else {
      tarefas.push(enviarTexto(env, ctx.conexao, pessoal, texto));
    }
  }
  // Aviso nunca derruba o atendimento
  await Promise.allSettled(tarefas);
}
