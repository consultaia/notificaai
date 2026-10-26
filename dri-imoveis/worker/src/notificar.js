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
  if (ctx.conexao && pessoal && pessoal !== soDigitos(ctx.telefone)) {
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
