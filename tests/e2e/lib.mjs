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

/* Плохо читаемый текст: цвет букв сравниваем с фоном под ними (WCAG). У градиента берём худший из цветов.
   Полупрозрачные слои пропускаем и ищем плотный фон выше. Порог 3:1 — минимум для крупного текста. */
export const lowContrast = page => page.evaluate(() => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + .05) / (b + .05); };
  const backgrounds = el => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage.includes('gradient')) {
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(c => c.a >= .5);
        if (stops.length) return stops;
      }
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a >= .5) return [bg];
    }
    return [parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 }];
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own || el.closest('.sr-only, [hidden], .ticker, .hero-word, svg')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity < .3 || cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < .3) continue;
    const worst = Math.min(...backgrounds(el).map(b => ratio(fg, b)));
    if (worst < 3) bad.push(`«${el.textContent.trim().slice(0, 30)}» ${worst.toFixed(1)}:1`);
  }
  return bad.slice(0, 5);
});

export const api =(page, path, body) => page.evaluate(async ({ path, body }) => {
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
