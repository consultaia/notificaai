// NotificaAI — modo demonstração (notificaai.ia.br/demo)
// Carregado só nessa rota. Substitui as chamadas ao banco por um banco fictício em memória:
// nada sai do navegador, nada é gravado de verdade e tudo volta ao original ao recarregar.
// A IA (conversa da notificação) continua real, com limite por sessão; e-mails não são enviados.
(function () {
  'use strict';
  window.NAI_DEMO = true;
  var HID = 'demo';
  var LIMITE_IA = 25;

  // ---------- gerador determinístico ----------
  var seed = 20260901;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function uuid() { var h = '0123456789abcdef', s = ''; for (var i = 0; i < 32; i++) s += h[Math.floor(rnd() * 16)]; return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function diasAtras(n) { var d = new Date(); d.setDate(d.getDate() - n); return d; }
  function mesStr(off) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  var SETORES = ['UTI Adulto', 'Clínica Médica', 'Centro Cirúrgico', 'Pronto-Socorro', 'Pediatria', 'Ambulatório'];
  var EVENTOS = [
    ['Queda', 'Paciente idoso caiu ao levantar sozinho para ir ao banheiro durante a madrugada.'],
    ['Lesao por pressao', 'Identificada lesão por pressão estágio 2 em região sacral durante o banho.'],
    ['Erro de medicacao', 'Dose de dipirona administrada em horário diferente do prescrito.'],
    ['Falha na identificacao', 'Pulseira de identificação ausente em paciente transferido do pronto-socorro.'],
    ['Cirurgia segura', 'Checklist de cirurgia segura iniciado sem a pausa cirúrgica (time out).'],
    ['Perda de AVP', 'Perda de acesso venoso periférico por tracionamento durante mobilização.'],
    ['Comunicacao / passagem de plantao', 'Informação sobre alergia não repassada na passagem de plantão.'],
    ['Near miss', 'Medicamento com nome parecido quase dispensado no lugar do prescrito; percebido a tempo.'],
    ['Circunstancia de risco', 'Piso molhado sem sinalização no corredor da enfermaria.'],
  ];
  var ADM = [['Infraestrutura / manutencao', 'Lâmpada queimada no posto de enfermagem há três dias.'], ['Farmacia', 'Atraso na entrega de medicamentos de horário.'], ['Hotelaria / limpeza', 'Roupa de cama insuficiente no plantão noturno.']];

  var DB = null;
  function construir() {
    DB = { hospitals: [], notifications: [], plano_acoes: [], protocolos: [], treinamentos_nsp: [], indicadores_dsm: [], indicadores_mensais: [], config_dsm: [], nsp_usuarios: [], saq_respostas: [], audit_log: [], setor_emails: [], notivisa_analise: [], semestres_dsm: [], acao_comentarios: [], tickets: [] };
    DB.hospitals.push({ id: HID, name: 'Hospital Demonstração', short_name: 'Demonstração', logo: 'hospital', sectors: SETORES, sectorsInternacao: SETORES.slice(0, 5), nsp_label: 'NSP', ativo: true, org_header: [], diretor_titulo: 'Diretora Técnica' });

    // notificações dos últimos 14 meses
    for (var i = 0; i < 70; i++) {
      var dias = Math.floor(rnd() * 420), d = diasAtras(dias), adm = rnd() < 0.18, ev = adm ? pick(ADM) : pick(EVENTOS);
      var grav = !adm && rnd() < 0.06 ? 'Evento sentinela' : (ev[0] === 'Near miss' ? 'Near miss' : ev[0] === 'Circunstancia de risco' ? 'Circunstancia de risco' : null);
      var antigo = dias > 45, comRCA = !adm && (antigo ? rnd() < 0.8 : rnd() < 0.35);
      DB.notifications.push({ id: uuid(), created_at: d.toISOString(), hospital_id: HID, notification_type: adm ? 'administrativa' : (ev[0] === 'Perda de AVP' && rnd() < 0.3 ? 'ccih' : 'seguranca_paciente'),
        sector: pick(SETORES), event_date: iso(d), shift: rnd() < 0.55 ? 'Dia' : 'Noite', event_subtype: ev[0], description: ev[1], measures_taken: 'Equipe acionada e paciente avaliado.',
        gravidade: grav, status: 'aberto', rca_gerado: comRCA, rca_concluido_em: comRCA ? diasAtras(Math.max(0, dias - 5)).toISOString() : null, is_test: false,
        patient_age: adm ? null : 25 + Math.floor(rnd() * 60), plano_fechado_em: comRCA && antigo && rnd() < 0.6 ? diasAtras(Math.max(0, dias - 30)).toISOString() : null,
        risco_probabilidade: comRCA ? 1 + Math.floor(rnd() * 4) : null, notivisa_enviado: comRCA && rnd() < 0.5 });
    }
    // planos de ação das notificações com RCA
    DB.notifications.filter(function (n) { return n.rca_gerado; }).forEach(function (n) {
      var k = 1 + Math.floor(rnd() * 3);
      for (var j = 0; j < k; j++) {
        var fechado = !!n.plano_fechado_em, prazo = new Date(new Date(n.event_date).getTime() + (20 + Math.floor(rnd() * 60)) * 864e5);
        var st = fechado ? 'concluido' : pick(['pendente', 'em_andamento', 'concluido']);
        DB.plano_acoes.push({ id: uuid(), created_at: n.created_at, notification_id: n.id, hospital_id: HID, acao: pick(['Treinar equipe no protocolo', 'Revisar o POP do setor', 'Instalar sinalização', 'Auditar prontuários por 30 dias', 'Ajustar escala de checagem']),
          responsavel: pick(['Enf. Coordenadora', 'Farmácia', 'Chefe do setor', 'NSP']), prazo: iso(prazo), prioridade: pick(['alta', 'media', 'baixa']), status: st,
          concluido_em: st === 'concluido' ? prazo.toISOString() : null, efetividade_verificada: st === 'concluido' && fechado ? 'efetiva' : null, efetividade_em: null });
      }
    });
    // protocolos (alguns vencidos, um sem cadastro)
    [['Higienizacao das Maos', 300], ['Identificacao do Paciente', 500], ['Comunicacao Efetiva', 200], ['Cirurgia Segura', 900], ['Prevencao de Lesao por Pressao (LPP)', 400],
     ['Prevencao de Quedas', 760], ['Seguranca na Prescricao e Uso de Medicamentos', 120], ['Prevencao de IPCS Associada ao CVC', 800], ['Prevencao de PAV', 100]].forEach(function (p, k) {
      var ap = diasAtras(p[1]), venc = new Date(ap); venc.setFullYear(venc.getFullYear() + 2);
      DB.protocolos.push({ id: uuid(), hospital_id: HID, nome: p[0], numero: 'POP-NSP-' + String(k + 1).padStart(2, '0'), aprovado_em: iso(ap), proxima_revisao: iso(venc), responsavel: 'Núcleo de Segurança do Paciente', link: null, categoria: null, status: 'ativo' });
    });
    // treinamentos
    var SUBS = ['comunicacao', 'medicamentos', 'identificacao', 'queda', 'lpp', 'cirurgia', 'ccih'];
    var TEMAS = { comunicacao: 'SBAR na passagem de plantão', medicamentos: 'Os 9 certos da medicação', identificacao: 'Dois identificadores', queda: 'Escala de Morse', lpp: 'Escala de Braden', cirurgia: 'Lista de verificação cirúrgica', ccih: 'Os 5 momentos da higiene das mãos' };
    for (var t = 0; t < 26; t++) {
      var sb = SUBS[t % SUBS.length]; if (sb === 'medicamentos' && t > 10) continue;
      DB.treinamentos_nsp.push({ id: uuid(), created_at: new Date().toISOString(), hospital_id: HID, tipo: 'treinamento', subnucleo: sb, protocolo: TEMAS[sb], data: iso(diasAtras(10 + Math.floor(rnd() * 380))), participantes: 8 + Math.floor(rnd() * 30), descricao: null, responsavel: 'membro_nsp', link_gdrive: null });
    }
    for (var r = 1; r <= 6; r++) DB.treinamentos_nsp.push({ id: uuid(), hospital_id: HID, tipo: 'reuniao_mensal', subnucleo: 'nsp_pleno', data: iso(diasAtras(r * 30)), participantes: 9, descricao: 'Reunião mensal do NSP', link_gdrive: null });
    // indicadores: meses anteriores completos para alguns subnúcleos, mês passado incompleto
    for (var m = 1; m <= 10; m++) {
      var row = { id: uuid(), hospital_id: HID, mes: mesStr(m) + '-01', paciente_dia_total: 2600 + Math.floor(rnd() * 400),
        pacientes_identificados: 300 + Math.floor(rnd() * 40), pacientes_atendidos: 350, queda_prontuarios_ok: 80 + Math.floor(rnd() * 15), queda_prontuarios_total: 100, quedas_com_dano: Math.floor(rnd() * 2), quedas_total: 2 + Math.floor(rnd() * 4),
        lpp_avaliacao_admissao: 180 + Math.floor(rnd() * 20), total_admitidos: 210, lpp_medidas_preventivas: 60, lpp_pacientes_risco: 70, lpp_avaliacao_diaria: 1500, lpp_internados_risco: 1700, lpp_casos_novos: Math.floor(rnd() * 4), lpp_paciente_dia_risco: 1700,
        alcool_gel_ml: 50000 + Math.floor(rnd() * 15000), clorexidina_ml: 9000, sabonete_ml: 30000 };
      if (m === 1) { delete row.lpp_casos_novos; delete row.lpp_paciente_dia_risco; delete row.alcool_gel_ml; }
      DB.indicadores_dsm.push(row);
      DB.indicadores_mensais.push({ id: uuid(), hospital_id: HID, mes_ref: mesStr(m), pd_setores: { 'UTI Adulto': 300, 'Clínica Médica': 1200, 'Centro Cirúrgico': 150, 'Pronto-Socorro': 600, 'Pediatria': 450 }, pd_geral: 2700 });
    }
    DB.config_dsm.push({ id: uuid(), hospital_id: HID, data_atualizacao_psp: iso(diasAtras(400)), numero_portaria_nsp: 'Portaria 012/2025', gestor_nsp: 'Coordenadora do NSP' });
    // pesquisa de cultura (respostas 1 a 5)
    try {
      var dominios = typeof SAQ_DOMINIOS !== 'undefined' ? SAQ_DOMINIOS : [];
      var ciclo = typeof saqCicloAtual === 'function' ? saqCicloAtual() : String(new Date().getFullYear());
      for (var q = 0; q < 24; q++) {
        var resp = {}; dominios.forEach(function (dm) { dm.itens.forEach(function (it, ii) { resp[dm.id + '_' + ii] = Math.min(5, Math.max(1, Math.round(3.4 + (rnd() - 0.4) * 2.4))); }); });
        DB.saq_respostas.push({ id: uuid(), created_at: diasAtras(Math.floor(rnd() * 60)).toISOString(), hospital_id: HID, setor: pick(SETORES), categoria: pick(['Enfermagem', 'Medicina', 'Técnico de enfermagem', 'Apoio']), ciclo: ciclo, respostas: resp });
      }
    } catch (e) { }
  }

  // usuários de demonstração (PIN com o mesmo cálculo local do app)
  var usuariosProntos = null;
  function hashLocal(pin) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + ':' + HID + ':notificaai_fallback_salt')).then(function (b) {
      return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function prepararUsuarios() {
    if (usuariosProntos) return usuariosProntos;
    var lista = [['Gestora do NSP (demonstração)', 'gestor', null, '1234'], ['Subnúcleo LPP (demonstração)', 'membro_nsp', 'lpp', '1111'], ['Subnúcleo Queda (demonstração)', 'membro_nsp', 'queda', '2222'], ['Subnúcleo Cirurgia (demonstração)', 'membro_nsp', 'cirurgia', '3333']];
    usuariosProntos = Promise.all(lista.map(function (u) { return hashLocal(u[3]); })).then(function (hs) {
      lista.forEach(function (u, k) { DB.nsp_usuarios.push({ id: k + 1, nome: u[0], perfil: u[1], subnucleo: u[2], ativo: true, pin_hash: hs[k], hospital_id: HID, created_at: new Date().toISOString() }); });
    });
    return usuariosProntos;
  }

  // ---------- emulação do PostgREST ----------
  function valorDe(v) { if (v === 'null') return null; if (v === 'true') return true; if (v === 'false') return false; return v; }
  function cmp(a, b) { if (a == null) return -1; if (b == null) return 1; if (!isNaN(a) && !isNaN(b) && a !== '' && b !== '') return Number(a) - Number(b); return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }
  function testar(row, col, expr) {
    var neg = false; if (expr.indexOf('not.') === 0) { neg = true; expr = expr.slice(4); }
    var p = expr.indexOf('.'), op = expr.slice(0, p), val = expr.slice(p + 1), v = row[col], ok;
    if (op === 'eq') ok = String(v) === String(valorDe(val)) || (v === true && val === 'true') || (v === false && val === 'false');
    else if (op === 'neq') ok = String(v) !== String(valorDe(val));
    else if (op === 'gt') ok = v != null && cmp(v, val) > 0;
    else if (op === 'gte') ok = v != null && cmp(v, val) >= 0;
    else if (op === 'lt') ok = v != null && cmp(v, val) < 0;
    else if (op === 'lte') ok = v != null && cmp(v, val) <= 0;
    else if (op === 'in') ok = val.replace(/^\(|\)$/g, '').split(',').indexOf(String(v)) >= 0;
    else if (op === 'is') ok = val === 'null' ? v == null : val === 'true' ? v === true : v === false || v == null && val === 'false';
    else if (op === 'like' || op === 'ilike') { var re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', op === 'ilike' ? 'i' : ''); ok = re.test(String(v == null ? '' : v)); }
    else ok = true;
    return neg ? !ok : ok;
  }
  var RESERVADOS = ['select', 'order', 'limit', 'offset', 'on_conflict'];
  function filtrar(rows, params) {
    var out = rows.filter(function (row) {
      for (var i = 0; i < params.length; i++) { var k = params[i][0]; if (RESERVADOS.indexOf(k) >= 0) continue; if (!testar(row, k, params[i][1])) return false; }
      return true;
    });
    return out;
  }
  function responder(url, method, body, prefer) {
    var u = new URL(url), tabela = u.pathname.split('/rest/v1/')[1];
    var params = []; u.searchParams.forEach(function (v, k) { params.push([k, v]); });
    if (!DB[tabela]) DB[tabela] = [];
    var rows = DB[tabela];
    var json = function (x, st) { return new Response(JSON.stringify(x), { status: st || 200, headers: { 'Content-Type': 'application/json' } }); };
    if (method === 'GET') {
      var out = filtrar(rows, params);
      var ord = u.searchParams.get('order');
      if (ord) { var partes = ord.split(',').map(function (o) { var p = o.split('.'); return [p[0], p[1] === 'desc' ? -1 : 1]; }); out = out.slice().sort(function (a, b) { for (var i = 0; i < partes.length; i++) { var c = cmp(a[partes[i][0]], b[partes[i][0]]); if (c) return c * partes[i][1]; } return 0; }); }
      var off = Number(u.searchParams.get('offset') || 0), lim = u.searchParams.get('limit');
      out = out.slice(off, lim ? off + Number(lim) : undefined);
      return json(JSON.parse(JSON.stringify(out)));
    }
    var dados = body ? JSON.parse(body) : {};
    if (method === 'POST') {
      var lista = Array.isArray(dados) ? dados : [dados], criados = [];
      var alvo = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      lista.forEach(function (d) {
        var ex = null;
        if (/merge-duplicates/.test(prefer || '') && alvo.length) ex = rows.find(function (r) { return alvo.every(function (c) { return String(r[c]) === String(d[c]); }); });
        if (ex) { Object.assign(ex, d); criados.push(ex); }
        else { var novo = Object.assign({ id: uuid(), created_at: new Date().toISOString() }, d); rows.push(novo); criados.push(novo); }
      });
      return json(criados, 201);
    }
    var alvos = filtrar(rows, params);
    if (method === 'PATCH') { alvos.forEach(function (r) { Object.assign(r, dados); }); return new Response(null, { status: 204 }); }
    if (method === 'DELETE') { DB[tabela] = rows.filter(function (r) { return alvos.indexOf(r) < 0; }); return json(alvos); }
    return json([]);
  }

  // ---------- intercepta o fetch ----------
  var original = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var headers = (init && init.headers) || {};
    var prefer = headers.Prefer || headers.prefer || '';
    if (/\/rest\/v1\//.test(url)) {
      if (!DB) construir();
      return prepararUsuarios().then(function () { return responder(url, method, init && init.body, prefer); });
    }
    if (/\/storage\/v1\//.test(url)) {
      if (/object\/list/.test(url)) return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (method === 'POST' || method === 'PUT') return Promise.resolve(new Response('{"Key":"demo"}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('%PDF-1.4 documento de demonstração', { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    }
    if (/workers\.dev/.test(url)) {
      if (/\/email$/.test(url)) return Promise.resolve(new Response('{"ok":true,"demo":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (/\/hashpin$/.test(url)) return Promise.resolve(new Response('{"error":"demo"}', { status: 503 }));
      var n = 0; try { n = Number(sessionStorage.getItem('nai_demo_ia') || 0); sessionStorage.setItem('nai_demo_ia', String(n + 1)); } catch (e) { }
      if (n >= LIMITE_IA) return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Limite de uso da IA na demonstração atingido. Fale com a gente para conhecer a versão completa.' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
      return original(input, init);
    }
    return original(input, init);
  };
})();
