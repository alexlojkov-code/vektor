import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, metricById, computeFunnel, parseNum, searchMetrics, fmt } from '../public/js/metrics.js';

const calc = (id, v) => metricById(id).compute(v);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('у всех метрик уникальный id и есть входы', () => {
  const ids = new Set(METRICS.map(m => m.id));
  assert.equal(ids.size, METRICS.length);
  for (const m of METRICS) assert.ok(m.inputs.length >= 2, m.id);
});

test('пустой ввод даёт null у каждой метрики', () => {
  for (const m of METRICS) assert.equal(m.compute({}), null, m.id);
});

test('ноль в знаменателе даёт null', () => {
  assert.equal(calc('ctr', { impressions: 0, clicks: 5 }), null);
  assert.equal(calc('cpc', { spend: 100, clicks: 0 }), null);
  assert.equal(calc('romi', { income: 100, cost: 0 }), null);
  assert.equal(calc('nps', { promoters: 1, detractors: 1, total: 0 }), null);
});

test('рекламные метрики', () => {
  close(calc('ctr', { impressions: 10000, clicks: 150 }), 1.5);
  close(calc('cpc', { spend: 3000, clicks: 150 }), 20);
  close(calc('cpm', { spend: 2000, impressions: 10000 }), 200);
  close(calc('cpa', { spend: 10000, actions: 20 }), 500);
  close(calc('frequency', { impressions: 9000, reach: 3000 }), 3);
});

test('ROMI из критериев приёмки: −12 %', () => {
  const m = metricById('romi');
  const r = m.compute({ income: 264000, cost: 300000 });
  close(r, -12);
  assert.equal(m.assess(r).level, 'bad');
  close(m.compute({ income: 600000, margin: 50, cost: 200000 }), 50);
});

test('окупаемость и юнит-экономика', () => {
  close(calc('roi', { income: 150, cost: 100 }), 50);
  close(calc('roas', { income: 400, spend: 100 }), 400);
  close(calc('drr', { spend: 100, income: 1000 }), 10);
  close(calc('breakeven-cpa', { aov: 5000, margin: 40 }), 2000);
  close(calc('ltv', { aov: 1000, frequency: 2, lifetime: 12, margin: 50 }), 12000);
  close(calc('ltv-cac', { ltv: 12000, cac: 3000 }), 4);
  assert.equal(metricById('ltv-cac').assess(4).level, 'good');
  assert.equal(metricById('ltv-cac').assess(0.8).level, 'bad');
  close(calc('retention', { start: 100, end: 110, new: 30 }), 80);
  close(calc('nps', { promoters: 60, detractors: 10, total: 100 }), 50);
});

test('ДРР сравнивается с маржинальностью', () => {
  const m = metricById('drr');
  assert.equal(m.assess(35, { margin: 30 }).level, 'bad');
  assert.equal(m.assess(10, { margin: 30 }).level, 'good');
  assert.equal(m.assess(10, {}), null);
});

test('воронка: проверочный пример из SPEC', () => {
  const f = computeFunnel({ budget: 100000, cpm: 200, ctr: 1, cr1: 5, cr2: 20, aov: 5000, margin: 50 });
  close(f.impressions, 500000);
  close(f.clicks, 5000);
  close(f.leads, 250);
  close(f.sales, 50);
  close(f.revenue, 250000);
  close(f.profit, 25000);
  close(f.romi, 25);
  close(f.cpa, 2000);
  assert.equal(f.bottleneck, null);
});

test('воронка: узкое место и неполный ввод', () => {
  const f = computeFunnel({ budget: 100000, cpm: 200, ctr: 1.2, cr1: 4, cr2: 5, aov: 5000, margin: 50 });
  assert.equal(f.bottleneck.key, 'cr2');
  assert.equal(computeFunnel({ budget: 100000 }), null);
  assert.equal(computeFunnel({ budget: 100000, cpm: 0, ctr: 1, cr1: 1, cr2: 1, aov: 1, margin: 1 }), null);
});

test('разбор чисел и форматирование', () => {
  assert.equal(parseNum('1 200,5'), 1200.5);
  assert.equal(parseNum('300 000 ₽'), 300000);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
  assert.equal(parseNum('-12'), -12);
  assert.equal(fmt(null), '—');
  assert.equal(fmt(Infinity), '—');
});

test('поиск по синонимам', () => {
  assert.ok(searchMetrics('дрр').some(m => m.id === 'drr'));
  assert.ok(searchMetrics('ACoS').some(m => m.id === 'drr'));
  assert.ok(searchMetrics('окупаемость маркетинга').some(m => m.id === 'romi'));
});
