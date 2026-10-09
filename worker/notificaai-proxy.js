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
// Lembrete mensal de pendencias (opcional):
//   Gatilho Cron em Settings > Triggers > Cron Triggers, ex.: 0 11 5 * *  (dia 5, 8h de Brasilia)
//   SUPABASE_URL, SUPABASE_KEY  URL do projeto e chave publica (a mesma do app)
//   LEMBRETE_DESTINOS           e-mails que recebem o resumo, separados por virgula
//   LEMBRETE_HOSPITAIS          ids das instituicoes (padrao: hnsa)
//   Previa sem enviar nada: GET /lembrete-previa?h=hnsa
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
  // Gatilho Cron: envia o resumo mensal de pendencias dos subnucleos
  async scheduled(event, env, ctx) {
    ctx.waitUntil(enviarLembretes(env).catch(e => console.error('Lembrete falhou:', e.message)));
  },

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

    // ── GET /lembrete-previa — mostra o e-mail do lembrete sem enviar ──
    if (url.pathname === '/lembrete-previa' && request.method === 'GET') {
      try {
        const r = await montarLembrete(env, slugValido(url.searchParams.get('h')));
        return new Response(r.html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (e) {
        return new Response('Erro: ' + esc(e.message), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }

    // ── GET — diagnostico rapido pelo navegador ─────────────
    return new Response(JSON.stringify({
      status: 'ok',
      servico: 'NotificaAI Worker',
      modelos: GROQ_MODELS,
      groq_configurada: Boolean(env.GROQ_API_KEY),
      resend_configurada: Boolean(env.RESEND_API_KEY),
      pepper_configurado: Boolean(env.PIN_PEPPER),
      rate_limit_kv: Boolean(env.RATE_LIMIT_KV),
      lembrete_configurado: Boolean(env.SUPABASE_URL && env.SUPABASE_KEY && env.LEMBRETE_DESTINOS),
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

// ── Lembrete mensal de pendencias dos subnucleos ────────────
// Mesmas regras do quadro "Pendencias por subnucleo" do app: indicadores do mes anterior (ja fechado),
// protocolos vencidos ou sem cadastro, notificacoes de seguranca do paciente sem RCA e ao menos 1
// treinamento no semestre. As tabelas abaixo foram copiadas do app (PROTOCOLOS_DSM, SUB_PROTOCOLOS,
// DSM_CAMPOS_SUB, SUBNUCLEOS_HNSA) — se mudarem la, atualize aqui.
const REGRAS = {"protocolos":[{"crit":"C3","nome":"Higienizacao das Maos"},{"crit":"C4","nome":"Identificacao do Paciente"},{"crit":"C5","nome":"Comunicacao Efetiva"},{"crit":"C6","nome":"Cirurgia Segura"},{"crit":"C7","nome":"Prevencao de Lesao por Pressao (LPP)"},{"crit":"C8","nome":"Prevencao de Quedas"},{"crit":"C9","nome":"Seguranca na Prescricao e Uso de Medicamentos"},{"crit":"C10","nome":"Prevencao de IPCS Associada ao CVC"},{"crit":"C11","nome":"Prevencao de ITU Associada ao CVD"},{"crit":"C12","nome":"Prevencao de PAV"},{"crit":"C13","nome":"Prevencao de Infeccao do Sitio Cirurgico (ISC)"},{"crit":"C14","nome":"Precaucoes e Isolamento"}],"subProtocolos":{"comunicacao":["C5"],"lpp":["C7"],"queda":["C8"],"medicamentos":["C9"],"identificacao":["C4"],"cirurgia":["C6","C13"],"ccih":["C3","C10","C11","C12"]},"campos":{"comunicacao":[],"identificacao":[{"key":"pacientes_identificados","label":"Pacientes com pulseira de identificacao"},{"key":"pacientes_atendidos","label":"Total de pacientes atendidos/internados"}],"queda":[{"key":"queda_prontuarios_ok","label":"Prontuarios com avaliacao de risco de queda"},{"key":"queda_prontuarios_total","label":"Total de prontuarios analisados"},{"key":"quedas_com_dano","label":"Quedas com dano ao paciente"},{"key":"quedas_total","label":"Total de quedas no mes"}],"lpp":[{"key":"lpp_avaliacao_admissao","label":"Avaliacoes de risco LPP na admissao"},{"key":"total_admitidos","label":"Total de pacientes admitidos"},{"key":"lpp_medidas_preventivas","label":"Pacientes com risco e medidas preventivas LPP"},{"key":"lpp_pacientes_risco","label":"Pacientes classificados com risco LPP"},{"key":"lpp_avaliacao_diaria","label":"Avaliacao diaria de risco LPP"},{"key":"lpp_internados_risco","label":"Pacientes internados com risco LPP"},{"key":"lpp_casos_novos","label":"Casos novos de LPP"},{"key":"lpp_paciente_dia_risco","label":"Pacientes-dia expostos ao risco LPP"}],"medicamentos":[{"key":"erros_prescricao","label":"Medicamentos prescritos com erro"},{"key":"total_prescricoes","label":"Total de medicamentos prescritos"},{"key":"erros_dispensacao","label":"Medicamentos dispensados com erro"},{"key":"total_dispensacoes","label":"Total de medicamentos dispensados"},{"key":"erros_administracao","label":"Erros na administracao de medicamentos"},{"key":"total_doses","label":"Total de doses administradas"}],"cirurgia":[{"key":"lvcs_preenchidas","label":"LVCS preenchidas adequadamente"},{"key":"cirurgias_realizadas","label":"Total de cirurgias realizadas"},{"key":"antibiotico_adequado","label":"Antibioticoprofilaxia no momento adequado"},{"key":"cirurgias_periodo","label":"Total de cirurgias (antibiotico)"},{"key":"obitos_cirurgicos_7d","label":"Obitos cirurgicos em ate 7 dias"},{"key":"total_cirurgias","label":"Total de cirurgias (mortalidade)"},{"key":"isc_casos","label":"ISC - infeccoes do sitio cirurgico"},{"key":"procedimentos_cirurgicos","label":"Total de procedimentos cirurgicos"}],"ccih":[{"key":"alcool_gel_ml","label":"Alcool gel 70% consumido (mL)"},{"key":"clorexidina_ml","label":"Clorexidina consumida (mL)"},{"key":"sabonete_ml","label":"Sabonete liquido consumido (mL)"},{"key":"pav_casos_novos","label":"Casos novos de PAV"},{"key":"pacientes_vm","label":"Pacientes em ventilacao mecanica"},{"key":"ipcs_cvc","label":"IRAS associadas a CVC (IPCS)"},{"key":"cateter_dia_cvc","label":"Cateter-dia CVC"},{"key":"itu_cvd","label":"ITU associadas ao CVD"},{"key":"paciente_dia_cvd","label":"Pacientes-dia com CVD"}]},"subnucleos":[{"id":"comunicacao","label":"Comunicacao Efetiva"},{"id":"medicamentos","label":"Seguranca na Administracao de Medicamentos"},{"id":"identificacao","label":"Identificacao Correta"},{"id":"queda","label":"Queda"},{"id":"lpp","label":"LPP - Lesao por Pressao"},{"id":"cirurgia","label":"Cirurgia Segura"},{"id":"ccih","label":"Higiene das Mãos / SCIH"}]};
const SUBS_USAM_PD = ['queda', 'ccih'];
const VALIDADE_DOC_ANOS = 2;
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' em ' + path.split('?')[0]);
  return r.json();
}

function notifDoSub(n, f) {
  const st = (n.event_subtype || n.occurrence_subtype || '').toLowerCase();
  if (f === 'queda') return st.startsWith('queda');
  if (f === 'lpp') return st.includes('press') || st.includes('lpp');
  if (f === 'medicamentos') return st.includes('medic') || st.includes('farmac');
  if (f === 'identificacao') return st.startsWith('falha na identif') || st.startsWith('falha de identif');
  if (f === 'comunicacao') return st.includes('comuni') || st.includes('sbar');
  if (f === 'cirurgia') return st.includes('cirurg');
  if (f === 'ccih') return n.notification_type === 'ccih' || !!n.infection_topography || /infec|iras|higien/.test(st);
  return false;
}

async function montarLembrete(env, hospitalId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) throw new Error('Configure SUPABASE_URL e SUPABASE_KEY no Worker.');
  const agora = new Date();
  const ref = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 15));
  const mes = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
  const nomeMes = MESES[ref.getUTCMonth()] + ' de ' + ref.getUTCFullYear();
  const s1 = ref.getUTCMonth() < 6;
  const semIni = `${ref.getUTCFullYear()}-${s1 ? '01-01' : '07-01'}`, semFim = `${ref.getUTCFullYear()}-${s1 ? '06-30' : '12-31'}`;
  const hoje = agora.toISOString().slice(0, 10);
  const h = encodeURIComponent(hospitalId);

  const [hosp, dsm, mens, prots, notifs, treins] = await Promise.all([
    sbGet(env, `hospitals?id=eq.${h}&select=name,short_name&limit=1`).catch(() => []),
    sbGet(env, `indicadores_dsm?hospital_id=eq.${h}&mes=eq.${mes}-01&select=*`).catch(() => []),
    sbGet(env, `indicadores_mensais?hospital_id=eq.${h}&mes_ref=eq.${mes}&select=pd_setores`).catch(() => []),
    sbGet(env, `protocolos?hospital_id=eq.${h}&select=nome,aprovado_em,proxima_revisao`),
    sbGet(env, `notifications?hospital_id=eq.${h}&is_test=neq.true&notification_type=in.(seguranca_paciente,ccih)&rca_gerado=not.is.true&select=notification_type,event_subtype,occurrence_subtype,infection_topography&limit=5000`),
    sbGet(env, `treinamentos_nsp?hospital_id=eq.${h}&tipo=eq.treinamento&data=gte.${semIni}&data=lte.${semFim}&select=subnucleo`),
  ]);
  const nomeHosp = (hosp[0] && (hosp[0].name || hosp[0].short_name)) || (hospitalId === 'hnsa' ? 'Hospital Naval de Salvador' : hospitalId);
  const row = dsm[0] || {};
  const pdSetores = mens[0] && mens[0].pd_setores ? Object.values(mens[0].pd_setores).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
  const vazio = v => v === '' || v === null || v === undefined;
  const protPorNome = {}; prots.forEach(p => { protPorNome[p.nome] = p; });
  const venc = p => p.proxima_revisao || (() => { const d = new Date(p.aprovado_em + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + VALIDADE_DOC_ANOS); return d.toISOString().slice(0, 10); })();

  const linhas = REGRAS.subnucleos.map(sn => {
    const campos = REGRAS.campos[sn.id] || [];
    const ind = campos.length === 0 ? 0 :
      ((SUBS_USAM_PD.includes(sn.id) && vazio(row.paciente_dia_total) && !pdSetores) ? 1 : 0) + campos.filter(f => vazio(row[f.key])).length;
    const crits = REGRAS.subProtocolos[sn.id] || [];
    const protPend = REGRAS.protocolos.filter(p => crits.includes(p.crit)).filter(p => {
      const r = protPorNome[p.nome]; return !r || !r.aprovado_em || venc(r) < hoje;
    }).map(p => p.crit);
    const semRCA = notifs.filter(n => notifDoSub(n, sn.id)).length;
    const semTrein = !treins.some(t => t.subnucleo === sn.id);
    const total = ind + protPend.length + semRCA + (semTrein ? 1 : 0);
    return { sn, ind, protPend, semRCA, semTrein, total };
  }).sort((a, b) => b.total - a.total);

  const emDia = linhas.filter(l => l.total === 0).length;
  const link = 'https://notificaai.ia.br/' + slugValido(hospitalId);
  const cel = (v, ok) => `<td style="padding:8px 10px;border-bottom:1px solid #e8ecf0;text-align:center;color:${ok ? '#059669' : '#b45309'};font-weight:bold">${v}</td>`;
  const tabela = linhas.map(l => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e8ecf0;font-weight:bold;color:#0F172A">${esc(l.sn.label)}</td>
      ${cel(l.ind ? l.ind + ' campo(s)' : '✓', !l.ind)}
      ${cel(l.protPend.length ? esc(l.protPend.join(', ')) : '✓', !l.protPend.length)}
      ${cel(l.semRCA ? l.semRCA : '✓', !l.semRCA)}
      ${cel(l.semTrein ? 'nenhum' : '✓', !l.semTrein)}
    </tr>`).join('');
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
  <div style="background:#06101F;color:#fff;padding:20px 24px">
    <div style="font-size:18px;font-weight:bold">NotificaAI — Pendências dos subnúcleos</div>
    <div style="font-size:12px;opacity:.8;margin-top:4px">${esc(nomeHosp)} · indicadores de ${esc(nomeMes)}</div>
  </div>
  <div style="padding:20px 24px">
    <p style="font-size:14px;color:#334155;margin:0 0 14px"><b>${emDia} de ${linhas.length}</b> subnúcleos em dia. Cada subnúcleo vê o próprio checklist em <b>“O que falta”</b> ao entrar.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr style="background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:10px">
        <th style="padding:8px 10px;text-align:left">Subnúcleo</th><th style="padding:8px">Indicadores ${esc(MESES[ref.getUTCMonth()].slice(0, 3))}</th>
        <th style="padding:8px">Protocolos</th><th style="padding:8px">Sem RCA</th><th style="padding:8px">Treinamento ${s1 ? '1º' : '2º'} sem</th>
      </tr>${tabela}
    </table>
    <div style="text-align:center;margin-top:22px">
      <a href="${link}" style="background:#003087;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:bold">Abrir o NotificaAI</a>
    </div>
  </div>
  <div style="background:#f4f6f9;padding:12px 24px;font-size:11px;color:#94a3b8;text-align:center">Lembrete automático mensal do NotificaAI · ${esc(link.replace('https://', ''))}</div>
</div></body></html>`;
  return { html, nomeHosp, nomeMes, emDia, total: linhas.length };
}

async function enviarLembretes(env) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nao configurada');
  const destinos = String(env.LEMBRETE_DESTINOS || '').split(',').map(s => s.trim()).filter(e => e && destinatarioPermitido(e, env));
  if (!destinos.length) throw new Error('LEMBRETE_DESTINOS vazio ou sem e-mails permitidos');
  const hospitais = String(env.LEMBRETE_HOSPITAIS || 'hnsa').split(',').map(s => slugValido(s.trim()));
  for (const hid of hospitais) {
    const r = await montarLembrete(env, hid);
    const resp = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: destinos, subject: umaLinha(`[NotificaAI] Pendências dos subnúcleos — ${r.nomeMes} (${r.emDia}/${r.total} em dia)`), html: r.html }),
    });
    if (!resp.ok) console.error('Lembrete', hid, 'falhou:', resp.status, await resp.text());
  }
}
