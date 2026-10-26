import { test } from "node:test";
import assert from "node:assert/strict";
import { horariosLivres, descreverHorario, utcDe } from "../src/agenda.js";

// segunda 26/10/2026 08:00 em Brasília
const agora = utcDe(2026, 10, 26, "08:00");
const disp = [
  { imovel_id: null, dia_semana: 1, hora_inicio: "09:00:00", hora_fim: "12:00:00" }, // segunda
  { imovel_id: null, dia_semana: 6, hora_inicio: "09:00", hora_fim: "11:00" },       // sábado
  { imovel_id: "B", dia_semana: 3, hora_inicio: "14:00", hora_fim: "16:00" },        // quarta, só imóvel B
];

test("janelas gerais, antecedência e passo de 30 min", () => {
  const h = horariosLivres({ disponibilidades: disp, ocupados: [], imovelId: "A", agora, dias: 7, duracaoMin: 60, antecedenciaHoras: 2 });
  assert.deepEqual(h.map(descreverHorario), [
    "segunda 26/10 às 10:00", "segunda 26/10 às 10:30", "segunda 26/10 às 11:00",
    "sábado 31/10 às 09:00", "sábado 31/10 às 09:30", "sábado 31/10 às 10:00",
  ]);
});

test("imóvel com janela própria ignora as gerais", () => {
  const h = horariosLivres({ disponibilidades: disp, ocupados: [], imovelId: "B", agora, dias: 7, duracaoMin: 60, antecedenciaHoras: 0 });
  assert.deepEqual(h.map(descreverHorario), ["quarta 28/10 às 14:00", "quarta 28/10 às 14:30", "quarta 28/10 às 15:00"]);
});

test("visitas e bloqueios ocupam a agenda", () => {
  const ocupados = [
    { inicio: utcDe(2026, 10, 26, "10:30").toISOString(), fim: utcDe(2026, 10, 26, "11:30").toISOString() },
    { inicio: utcDe(2026, 10, 31, "00:00").toISOString(), fim: utcDe(2026, 11, 1, "00:00").toISOString() },
  ];
  const h = horariosLivres({ disponibilidades: disp, ocupados, imovelId: "A", agora, dias: 7, duracaoMin: 60, antecedenciaHoras: 2 });
  assert.deepEqual(h.map(descreverHorario), []); // 10:00 colide com 10:30; 11:00 também; sábado bloqueado
});

test("data inicial informada pelo cliente", () => {
  const h = horariosLivres({ disponibilidades: disp, ocupados: [], imovelId: "A", agora, dataInicio: "2026-11-02", dias: 1, duracaoMin: 90, antecedenciaHoras: 2 });
  assert.deepEqual(h.map(descreverHorario), ["segunda 02/11 às 09:00", "segunda 02/11 às 09:30", "segunda 02/11 às 10:00", "segunda 02/11 às 10:30"]);
});

test("horário local 22h vira dia seguinte em UTC sem quebrar", () => {
  const d = utcDe(2026, 10, 30, "22:00");
  assert.equal(d.toISOString(), "2026-10-31T01:00:00.000Z");
  assert.equal(descreverHorario(d), "sexta 30/10 às 22:00");
});
