// Общее для сквозных проверок: адрес сайта, папка снимков, шаги с отчётом, сбор ошибок консоли.
// Проверки идут в WebKit — движке Safari — и по умолчанию против живого сайта.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

export const BASE = (process.env.E2E_URL || 'https://vektor-ai-marketing.vercel.app').replace(/\/$/, '');
// Снимки каждого набора — в свою папку: tests/e2e/out/main, tests/e2e/out/extra
export const OUT = `${process.env.E2E_OUT || fileURLToPath(new URL('./out', import.meta.url))}/${basename(process.argv[1], '.mjs')}`;
mkdirSync(OUT, { recursive: true });

export const results = [];
export const consoleErrors = [];
let shot = 0;

// Playwright сам вставляет стиль для снимков, CSP его блокирует — это не ошибка сайта
export function watch(page, label = '') {
  page.on('console', m => {
    if (m.type() === 'error' && !/Refused to apply a stylesheet/.test(m.text())) {
      consoleErrors.push(`${label} ${page.url().replace(BASE, '')}: ${m.text().slice(0, 160)}`);
    }
  });
  page.on('pageerror', e => consoleErrors.push(`${label} JS: ${e.message.slice(0, 160)}`));
  page.on('dialog', d => d.dismiss());
}

export async function step(page, name, fn) {
  try {
    const note = await fn();
    results.push(`ок        | ${name}${note ? ` — ${String(note).replace(/\s+/g, ' ')}` : ''}`);
  } catch (e) {
    results.push(`НЕ ПРОШЁЛ | ${name} — ${String(e.message).split('\n')[0].slice(0, 220)}`);
  }
  await page.screenshot({ path: `${OUT}/${String(++shot).padStart(2, '0')}.png` }).catch(() => {});
}

export const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// Элементы, вылезающие за правый край. Декор (свечения, 3D, ленты) и прокручиваемые таблицы не считаются.
export const overflow = page => page.evaluate(() => {
  const w = innerWidth;
  const wide = [...document.querySelectorAll('body *')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed'; })
    .filter(e => !e.closest('.ticker, .obj3d, .scene3d, .md-table, .board, .hero-word, .orb'));
  return { page: document.documentElement.scrollWidth > w + 1, items: wide.slice(0, 3).map(e => `${e.tagName}.${String(e.className || '').split(' ')[0]}`) };
});

export const api = (page, path, body) => page.evaluate(async ({ path, body }) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-pilot': '1' }, body: JSON.stringify(body) } : {});
  return { status: res.status, body: await res.json().catch(() => null) };
}, { path, body });

export function report(title) {
  const ok = results.filter(r => r.startsWith('ок')).length;
  console.log(`\n== ${title}\n${results.join('\n')}`);
  console.log(`\nПройдено ${ok} из ${results.length}`);
  console.log(`Ошибки в консоли (${consoleErrors.length}):\n${[...new Set(consoleErrors)].join('\n') || 'нет'}`);
  console.log(`Снимки: ${OUT}`);
  return ok === results.length;
}
