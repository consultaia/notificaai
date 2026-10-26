// WhatsApp Cloud API (Meta): envio, assinatura do webhook e conexão (Embedded Signup).

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

export const marcarLida = (env, conexao, messageId) =>
  chamar(env, conexao.token, `${conexao.phone_number_id}/messages`, {
    messaging_product: "whatsapp", status: "read", message_id: messageId,
  }).catch(() => {});

export const lerNumero = (env, token, phoneNumberId) =>
  chamar(env, token, `${phoneNumberId}?fields=display_phone_number,verified_name`, null, "GET");

// A Meta assina o corpo com o App Secret: header X-Hub-Signature-256 = "sha256=<hex>"
export async function assinaturaValida(env, corpoBruto, header) {
  if (!env.META_APP_SECRET) return false;
  if (!header?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.META_APP_SECRET),
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
        });
      }
    }
  }
  return saida;
}

// Embedded Signup: troca o "code" pelo token da empresa e liga o número ao app da Dri
export async function concluirEmbeddedSignup(env, { code, phone_number_id, waba_id, coexistencia }) {
  const u = new URL(`${graph(env)}/oauth/access_token`);
  u.searchParams.set("client_id", env.META_APP_ID);
  u.searchParams.set("client_secret", env.META_APP_SECRET);
  u.searchParams.set("code", code);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j?.error?.message || "A Meta não devolveu o token.");
  const token = j.access_token;
  await assinarWaba(env, token, waba_id);
  if (!coexistencia) {
    // Número novo na API precisa ser registrado (PIN de 2 etapas). Já registrado = ok.
    await chamar(env, token, `${phone_number_id}/register`, {
      messaging_product: "whatsapp", pin: env.META_REGISTRO_PIN || "202611",
    }).catch((e) => { if (!/already|registered/i.test(e.message)) throw e; });
  }
  const numero = await lerNumero(env, token, phone_number_id);
  return { token, numero };
}

export const assinarWaba = (env, token, wabaId) => chamar(env, token, `${wabaId}/subscribed_apps`, {});
