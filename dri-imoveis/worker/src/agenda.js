// Cálculo de horários livres para visita.
// O Brasil não tem horário de verão desde 2019: todo o país usa offset fixo.
// Brasília (e Salvador) = UTC-3. Contas em outro fuso podem mudar FUSO_MIN.

export const FUSO_MIN = -180;
const MIN = 60_000;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Date (UTC) -> partes no horário local
export function local(date) {
  const d = new Date(date.getTime() + FUSO_MIN * MIN);
  return {
    ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
    diaSemana: d.getUTCDay(), hora: d.getUTCHours(), minuto: d.getUTCMinutes(),
  };
}

// Data local (ano, mês, dia) + "HH:MM" -> Date UTC
export function utcDe(ano, mes, dia, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia, h, m) - FUSO_MIN * MIN);
}

const dd = (n) => String(n).padStart(2, "0");

export function descreverHorario(date) {
  const l = local(date);
  return `${DIAS[l.diaSemana]} ${dd(l.dia)}/${dd(l.mes)} às ${dd(l.hora)}:${dd(l.minuto)}`;
}

export function descreverAgora(date) {
  const l = local(date);
  return `${DIAS[l.diaSemana]}, ${dd(l.dia)}/${dd(l.mes)}/${l.ano} ${dd(l.hora)}:${dd(l.minuto)}`;
}

/**
 * Horários livres para visitar um imóvel.
 * - disponibilidades: [{imovel_id|null, dia_semana, hora_inicio "HH:MM[:SS]", hora_fim}]
 *   Se o imóvel tem janelas próprias, valem só elas; senão valem as gerais (imovel_id nulo).
 * - ocupados: [{inicio, fim}] visitas marcadas (de qualquer imóvel) e bloqueios.
 * Devolve Date[] de inícios, em passos de 30 min, ordenados.
 */
export function horariosLivres({
  disponibilidades, ocupados, imovelId, agora, dataInicio = null, dias = 7,
  duracaoMin = 60, antecedenciaHoras = 2, passoMin = 30, limite = 40,
}) {
  const proprias = disponibilidades.filter((d) => d.imovel_id === imovelId);
  const janelas = proprias.length ? proprias : disponibilidades.filter((d) => !d.imovel_id);
  const minimo = agora.getTime() + antecedenciaHoras * 60 * MIN;
  const ocup = ocupados.map((o) => [new Date(o.inicio).getTime(), new Date(o.fim).getTime()]);

  let base = local(agora);
  if (dataInicio) {
    const [a, m, d] = dataInicio.split("-").map(Number);
    if (a && m && d) base = { ano: a, mes: m, dia: d };
  }
  const saida = [];
  for (let i = 0; i < dias && saida.length < limite; i++) {
    const meiaNoite = utcDe(base.ano, base.mes, base.dia + i, "00:00");
    const l = local(meiaNoite);
    for (const j of janelas.filter((j) => j.dia_semana === l.diaSemana)
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))) {
      const ini = utcDe(l.ano, l.mes, l.dia, j.hora_inicio.slice(0, 5)).getTime();
      const fim = utcDe(l.ano, l.mes, l.dia, j.hora_fim.slice(0, 5)).getTime();
      for (let t = ini; t + duracaoMin * MIN <= fim; t += passoMin * MIN) {
        const tf = t + duracaoMin * MIN;
        if (t < minimo) continue;
        if (ocup.some(([a, b]) => t < b && tf > a)) continue;
        saida.push(new Date(t));
        if (saida.length >= limite) break;
      }
    }
  }
  return saida;
}
