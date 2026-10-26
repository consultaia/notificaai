// WhatsApp Cloud API (Meta): envio, assinatura do webhook e conexão manual (app da Meta do próprio corretor).

export const graph = (env) => `https://graph.facebook.com/${env.GRAPH_VERSION || "v23.0"}`;

async function chamar(env, token, caminho, corpo, metodo = "POST") {
  const r = await fetch(`${graph(env)}/${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Meta respondeu ${r.status}`);
  return j;
}

export const enviarTexto = (env, conexao, para, texto) =>
  chamar(env, conexao.token, `${conexao.phone_number_id}/messages`, {
    messaging_product: "whatsapp", to: para, type: "text",
    text: { body: texto.slice(0, 4096), preview_url: true },
  });

export const enviarImagem = (env, conexao, para, url, legenda) =>
  chamar(env, conexao.token, `${conexao.phone_number_id}/messages`, {
    messaging_product: "whatsapp", to: para, type: "image",
    image: { link: url, ...(legenda ? { caption: legenda.slice(0, 1024) } : {}) },
  });

export const enviarDocumento = (env, conexao, para, url, nomeArquivo, legenda) =>
  chamar(env, conexao.token, `${conexao.phone_number_id}/messages`, {
    messaging_product: "whatsapp", to: para, type: "document",
    document: { link: url, filename: nomeArquivo, ...(legenda ? { caption: legenda.slice(0, 1024) } : {}) },
  });

export const marcarLida = (env, conexao, messageId) =>
  chamar(env, conexao.token, `${conexao.phone_number_id}/messages`, {
    messaging_product: "whatsapp", status: "read", message_id: messageId,
  }).catch(() => {});

export const lerNumero = (env, token, phoneNumberId) =>
  chamar(env, token, `${phoneNumberId}?fields=display_phone_number,verified_name`, null, "GET");

// A Meta assina o corpo com a chave secreta do app: header X-Hub-Signature-256 = "sha256=<hex>"
export async function assinaturaValida(appSecret, corpoBruto, header) {
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoBruto)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = header.slice(7);
  if (recebido.length !== hex.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// Webhook -> lista de mensagens recebidas, já normalizadas
export function extrairMensagens(payload) {
  const saida = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        let texto = null;
        if (m.type === "text") texto = m.text?.body;
        else if (m.type === "button") texto = m.button?.text;
        else if (m.type === "interactive")
          texto = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        else if (m.type === "location")
          texto = `[O cliente enviou uma localização: ${m.location?.name || ""} ${m.location?.address || ""} (${m.location?.latitude}, ${m.location?.longitude})]`;
        else if (m.type === "image" && m.image?.caption) texto = `[Imagem] ${m.image.caption}`;
        saida.push({
          phoneNumberId, id: m.id, de: m.from, nome: nomes[m.from] || null,
          tipo: m.type, texto, em: new Date(Number(m.timestamp) * 1000 || Date.now()),
          ...(m.type === "audio" && m.audio?.id ? { midiaId: m.audio.id } : {}),
        });
      }
    }
  }
  return saida;
}

export const assinarWaba = (env, token, wabaId) => chamar(env, token, `${wabaId}/subscribed_apps`, {});

// Número adicionado na API precisa ser registrado uma vez, com um PIN de 6 dígitos
// (verificação em duas etapas). Se já estiver registrado, a Meta aceita de novo com o mesmo PIN.
export const registrarNumero = (env, token, phoneNumberId, pin) =>
  chamar(env, token, `${phoneNumberId}/register`, { messaging_product: "whatsapp", pin });

// Baixa a mídia que o cliente mandou (o link da Meta vale por alguns minutos e exige o token)
export async function baixarMidia(env, conexao, midiaId) {
  const info = await chamar(env, conexao.token, midiaId, null, "GET");
  const r = await fetch(info.url, { headers: { authorization: `Bearer ${conexao.token}` } });
  if (!r.ok) throw new Error(`Meta não entregou a mídia (${r.status})`);
  return { dados: await r.arrayBuffer(), tipo: info.mime_type || "audio/ogg" };
}
