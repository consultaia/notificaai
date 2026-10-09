// ============================================================
// NotificaAI — Cloudflare Worker (notificaai-proxy)
// Rotas:
//   POST /         → proxy Groq (IA) com cadeia de modelos
//   POST /hashpin  → hash de PIN com pepper secreto
//   POST /email    → envio de e-mail via Resend
//   GET  /         → diagnostico (quais segredos estao configurados)
//
// Segredos (Cloudflare > Workers & Pages > notificaai-proxy > Settings > Variables and Secrets):
//   GROQ_API_KEY, RESEND_API_KEY, PIN_PEPPER  (obrigatorios)
//   EMAILS_PERMITIDOS   (opcional) e-mails extras aceitos como destinatario, separados por virgula
//   DOMINIOS_PERMITIDOS (opcional) dominios aceitos como destinatario, separados por virgula
//   RATE_LIMIT_KV       (opcional) binding KV para limitar tentativas de PIN
//
// Nenhuma chave fica neste arquivo. Para publicar: cole este codigo em
// Workers & Pages > notificaai-proxy > Edit code > Deploy.
// ============================================================

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Cadeia de modelos: se o primeiro sumir ou estiver sobrecarregado, tenta o proximo.
// Em ago/2026 a Groq aposentou toda a familia Llama (llama-3.3-70b-versatile virou 404)
// e o sistema parou do nada, porque apontava para um unico modelo fixo.
const GROQ_MODELS = [
  'openai/gpt-oss-120b',   // principal — melhor qualidade para RCA e relatorios
  'openai/gpt-oss-20b',    // reserva — mais rapido e mais barato
];
// Limite de tokens por chamada (o app usa ate ~1500 em relatorios); protege a cota da Groq.
const MAX_TOKENS_LIMITE = 4000;

// Origens permitidas — restringe quem pode chamar este Worker.
// O acesso via http:// precisa constar aqui: sem isso o preflight responde com a
// origem errada, o navegador rejeita e o POST nem chega a ser enviado (falha silenciosa).
const ALLOWED_ORIGINS = [
  'https://notificaai.ia.br',
  'http://notificaai.ia.br',
  'https://consultaia.github.io',
];
function resolveOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
// Bloqueia chamadas que nao vem dos dominios oficiais. Atencao: o cabecalho Origin pode
// ser forjado fora do navegador (curl); isto reduz abuso casual, mas nao substitui login.
function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin);
}
const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = 'NotificaAI <nsp@notificaai.ia.br>';
const EMAIL_ADMIN = 'janan.almeida@gmail.com';
const DOMINIOS_PADRAO = ['marinha.mil.br'];

// Texto vindo do formulario vai para dentro do HTML do e-mail: precisa ser escapado,
// senao uma notificacao pode injetar links/HTML num e-mail enviado pelo dominio oficial.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const umaLinha = v => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 150);
const slugValido = v => /^[a-z0-9-]{2,40}$/.test(String(v || '')) ? String(v) : 'hnsa';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': resolveOrigin(request),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      });
    }

    // ── Bloqueio de origem para todas as rotas POST ─────────
    if (request.method === 'POST' && !isAllowedOrigin(request)) {
      return new Response(JSON.stringify({ error: 'Origem nao autorizada' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/hashpin' && request.method === 'POST') return handleHashPin(request, env);
    if (url.pathname === '/email' && request.method === 'POST') return handleEmail(request, env);
    if (request.method === 'POST') return handleGroq(request, env);

    // ── GET — diagnostico rapido pelo navegador ─────────────
    return new Response(JSON.stringify({
      status: 'ok',
      servico: 'NotificaAI Worker',
      modelos: GROQ_MODELS,
      groq_configurada: Boolean(env.GROQ_API_KEY),
      resend_configurada: Boolean(env.RESEND_API_KEY),
      pepper_configurado: Boolean(env.PIN_PEPPER),
      rate_limit_kv: Boolean(env.RATE_LIMIT_KV),
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
};

// ── Hash de PIN (pepper secreto, nunca visivel no cliente) ──────────────────
// IMPORTANTE: depois de configurado, o PIN_PEPPER NUNCA pode ser trocado — todos os PINs
// gravados com ele deixariam de funcionar.
async function handleHashPin(request, env) {
  const corsHeaders = { 'Access-Control-Allow-Origin': resolveOrigin(request), 'Content-Type': 'application/json' };

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Payload invalido' }), { status: 400, headers: corsHeaders }); }

  const { pin, hospital_id } = body;
  if (!pin || !hospital_id) {
    return new Response(JSON.stringify({ error: 'pin e hospital_id sao obrigatorios' }), { status: 400, headers: corsHeaders });
  }

  const pepper = env.PIN_PEPPER;
  if (!pepper) {
    // 503 (servico indisponivel) em vez de 500: o app cai no hash local e segue funcionando.
    return new Response(JSON.stringify({ error: 'PIN_PEPPER nao configurado no Worker' }), { status: 503, headers: corsHeaders });
  }

  if (env.RATE_LIMIT_KV) {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = `pin_attempts:${ip}`;
      const attempts = parseInt(await env.RATE_LIMIT_KV.get(key) || '0');
      // 60/5min — o hospital inteiro sai por um unico IP (NAT); 20 travava a equipe em plantao
      if (attempts >= 60) {
        return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos.' }), { status: 429, headers: corsHeaders });
      }
      await env.RATE_LIMIT_KV.put(key, String(attempts + 1), { expirationTtl: 300 });
    } catch (e) { console.error('RATE_LIMIT_KV falhou:', e.message); }
  }

  // Hash: PIN + hospital_id (sal por-tenant) + pepper secreto (nunca no cliente)
  const data = pin + ':' + hospital_id + ':' + pepper;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return new Response(JSON.stringify({ hash }), { status: 200, headers: corsHeaders });
}

// ── E-mail ──────────────────────────────────────────────────
// Os destinatarios vem do navegador; sem filtro, qualquer um poderia usar esta rota para
// mandar e-mail para qualquer endereco em nome de nsp@notificaai.ia.br.
function destinatarioPermitido(email, env) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  const extras = String(env.EMAILS_PERMITIDOS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const dominios = (env.DOMINIOS_PERMITIDOS
    ? String(env.DOMINIOS_PERMITIDOS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
    : DOMINIOS_PADRAO);
  if (e === EMAIL_ADMIN || extras.includes(e)) return true;
  const dominio = e.split('@')[1];
  return dominios.some(d => dominio === d || dominio.endsWith('.' + d));
}

async function handleEmail(request, env) {
  const corsHeaders = { 'Access-Control-Allow-Origin': resolveOrigin(request), 'Content-Type': 'application/json' };

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Payload inválido' }), { status: 400, headers: corsHeaders }); }

  const {
    nsp_email, nsp_email_cc, setor_email, hospital_name, hospital_id, protocolo,
    notification_type, sector, event_date, shift, event_subtype, gravidade,
    description, measures_taken, patient_age, admission_reason,
  } = body;

  // Destinatarios (somente os permitidos)
  const recusados = [];
  const filtrar = e => { if (!e) return null; if (destinatarioPermitido(e, env)) return String(e).trim(); recusados.push(e); return null; };
  const principal = filtrar(nsp_email);
  const to = [principal || EMAIL_ADMIN];
  const cc = [];
  [nsp_email_cc, setor_email, EMAIL_ADMIN].map(filtrar).forEach(e => {
    if (e && !to.includes(e) && !cc.includes(e)) cc.push(e);
  });
  if (recusados.length) console.warn('Destinatarios recusados:', recusados.join(', '));

  const tipoLabel =
    notification_type === 'seguranca_paciente' ? '🔴 Segurança do Paciente'
    : notification_type === 'ccih'              ? '🟠 CCIH / Infecção'
    : '🔵 Administrativa';

  const dataFormatada = event_date && /^\d{4}-\d{2}-\d{2}$/.test(event_date)
    ? new Date(event_date + 'T12:00:00').toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');

  const nomeHospital = hospital_name || 'NotificaAI';
  const link = 'https://notificaai.ia.br/' + slugValido(hospital_id);
  const subject = umaLinha(`[NotificaAI] Nova notificação — ${event_subtype || tipoLabel} · ${sector || 'Setor não informado'} · ${dataFormatada}`);

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: #003087; color: #ffffff; padding: 20px 24px; }
  .header h1 { margin: 0; font-size: 18px; }
  .header p { margin: 4px 0 0; font-size: 12px; opacity: 0.8; }
  .badge { display: inline-block; background: #00BFA6; color: #fff; border-radius: 4px; padding: 3px 10px; font-size: 12px; font-weight: bold; margin-top: 8px; }
  .body { padding: 24px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 3px; font-weight: bold; }
  .field p { margin: 0; background: #f5f7fa; border-radius: 6px; padding: 10px 12px; font-size: 13px; color: #222; white-space: pre-wrap; }
  .alert { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; color: #856404; }
  .footer { background: #f4f6f9; padding: 14px 24px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #e8ecf0; }
  .protocol { font-size: 20px; font-weight: bold; color: #003087; margin-bottom: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>⚕️ NotificaAI — Nova Notificação</h1>
    <p>${esc(nomeHospital)} · NSP</p>
    <span class="badge">${tipoLabel}</span>
  </div>
  <div class="body">
    ${gravidade === 'Evento sentinela' ? '<div class="alert">⚠️ <strong>EVENTO SENTINELA</strong> — Requer análise imediata do NSP.</div>' : ''}
    <div class="protocol">Protocolo: ${esc(protocolo || 'N/A')}</div>
    ${setor_email && cc.includes(String(setor_email).trim()) ? `<div style="font-size:11px;color:#00907E;margin-bottom:12px;">📧 Cópia enviada ao setor responsável</div>` : ''}

    <div class="field"><label>Data / Turno</label><p>${esc(dataFormatada)} · ${esc(shift || 'Não informado')}</p></div>
    <div class="field"><label>Setor</label><p>${esc(sector || 'Não informado')}</p></div>
    <div class="field"><label>Tipo de incidente</label><p>${esc(event_subtype || tipoLabel)}</p></div>
    ${gravidade ? `<div class="field"><label>Gravidade</label><p>${esc(gravidade)}</p></div>` : ''}
    ${description ? `<div class="field"><label>Descrição</label><p>${esc(description)}</p></div>` : ''}
    ${measures_taken ? `<div class="field"><label>Ação imediata tomada</label><p>${esc(measures_taken)}</p></div>` : ''}
    ${patient_age || admission_reason ? `<div class="field"><label>Paciente</label><p>${patient_age ? esc(patient_age) + ' anos' : ''}${admission_reason ? ' · ' + esc(admission_reason) : ''}</p></div>` : ''}

    <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e8ecf0;text-align:center;">
      <a href="${link}" style="background:#003087;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:bold;">
        Acessar NotificaAI
      </a>
    </div>
  </div>
  <div class="footer">
    Enviado automaticamente pelo NotificaAI · ${esc(link.replace('https://', ''))}<br>
    ${esc(nomeHospital)} · NSP
  </div>
</div>
</body>
</html>`;

  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada no Worker' }), { status: 500, headers: corsHeaders });
  }

  const payload = { from: FROM_EMAIL, to, subject, html };
  if (cc.length > 0) payload.cc = cc;

  const resendResp = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await resendResp.json().catch(() => ({}));

  if (!resendResp.ok) {
    console.error('Resend error:', JSON.stringify(result));
    return new Response(JSON.stringify({ error: 'Resend falhou', detail: result }), { status: resendResp.status, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, id: result.id, recusados: recusados.length }), { status: 200, headers: corsHeaders });
}

// ── Proxy Groq (com cadeia de modelos) ──────────────────────
async function handleGroq(request, env) {
  const corsHeaders = { 'Access-Control-Allow-Origin': resolveOrigin(request), 'Content-Type': 'application/json' };

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Payload invalido' }), { status: 400, headers: corsHeaders }); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_LIMITE);

  // So aceita modelos da lista (evita que alguem use a chave para modelos mais caros);
  // um modelo pedido pelo app entra na frente da fila.
  const modelos = body.model && GROQ_MODELS.includes(body.model)
    ? [body.model, ...GROQ_MODELS.filter(m => m !== body.model)]
    : GROQ_MODELS;

  const groqKey = env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY não configurada' }), { status: 500, headers: corsHeaders });
  }

  const tentativas = [];
  for (const model of modelos) {
    try {
      const groqResp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens }),
      });
      const result = await groqResp.json().catch(() => null);

      if (groqResp.ok && result && result.choices && result.choices.length) {
        return new Response(JSON.stringify({ ...result, modelo_usado: model }), { status: 200, headers: corsHeaders });
      }
      const msg = (result && result.error && result.error.message) || `HTTP ${groqResp.status}`;
      tentativas.push(`${model}: ${msg}`);
      console.error(`Modelo ${model} falhou (${groqResp.status}): ${msg}`);
      // 401/403 sao problema de credencial: trocar de modelo nao resolve.
      if (groqResp.status === 401 || groqResp.status === 403) break;
    } catch (e) {
      tentativas.push(`${model}: ${e.message}`);
      console.error(`Erro de rede com ${model}:`, e.message);
    }
  }

  return new Response(JSON.stringify({
    error: { message: 'Nenhum modelo de IA disponivel respondeu.', detalhes: tentativas },
  }), { status: 502, headers: corsHeaders });
}
