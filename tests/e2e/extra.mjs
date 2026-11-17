// Вторая волна: экраны компьютера и планшета, светлая тема, крайние случаи чата,
// ошибки аккаунта и сброс пароля, два устройства одновременно, работа без интернета, длинные данные.
// Создаёт тестовый аккаунт и удаляет его в конце; расходует 1–2 запроса к AI.
import { webkit, devices } from 'playwright';
import { randomUUID } from 'node:crypto';
import { BASE as B, OUT, results, step, expect, watch, overflow, lowContrast, report } from './lib.mjs';

const browser = await webkit.launch();
const SCREENS = ['/', '/app.html#/today', '/app.html#/chat', '/app.html#/tasks', '/app.html#/calc', '/app.html#/calc/funnel', '/app.html#/calc/cpa', '/app.html#/brand', '/privacy.html'];

/* ---------- 1. Компьютер, планшет, светлая тема: все экраны без вылезания за край и с читаемым текстом ---------- */
for (const [label, opts] of [
  ['компьютер 1440', { viewport: { width: 1440, height: 900 } }],
  ['планшет 768', { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } }],
  ['телефон, светлая тема', { ...devices['iPhone 13'] }],
]) {
  const ctx = await browser.newContext({ ...opts, locale: 'ru-RU' });
  const page = await ctx.newPage();
  watch(page, label);
  if (label.includes('светлая')) {
    await page.goto(`${B}/app.html#/today`);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pilot:v1') || '{}'); s.version = 1; s.settings = { ...(s.settings || {}), theme: 'light' }; localStorage.setItem('pilot:v1', JSON.stringify(s)); });
  }
  const bad = [];
  for (const path of SCREENS) {
    await page.goto(`${B}${path}`);
    await page.waitForTimeout(path === '/' ? 2500 : 900);
    const o = await overflow(page);
    if (o.page || o.items.length) bad.push(`${path}: ${o.page ? 'прокрутка ' : ''}${o.items.join(',')}`);
    const dim = await lowContrast(page);
    if (dim.length) bad.push(`${path}: плохо читается ${dim.join(', ')}`);
    const name = path.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '') || 'landing';
    await page.screenshot({ path: `${OUT}/${label.split(' ')[0]}-${label.includes('светлая') ? 'light-' : ''}${name}.png` });
  }
  results.push(`${bad.length ? 'НЕ ПРОШЁЛ' : 'ок       '} | ${label}: ${SCREENS.length} экранов: ничего не вылезает за край, текст читается${bad.length ? ' — ' + bad.join('; ') : ''}`);
  await ctx.close();
}

/* ---------- 2. Чат: стоп, повтор, таблица, удаление (в аккаунте — лимит 50) ---------- */
const email = `qa2-${Date.now()}@vektor.test`, password = `qa-${randomUUID()}`, password2 = `qa-${randomUUID()}`;
const ctxA = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const a = await ctxA.newPage();
watch(a, 'A');
let recoveryCode = '';
await step(a, 'Аккаунт: регистрация (устройство A)', async () => {
  await a.goto(`${B}/app.html#/today`);
  await a.waitForTimeout(800);
  const r = await a.evaluate(async ({ email, password }) => {
    const res = await fetch('/api/account', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pilot': '1' }, body: JSON.stringify({ action: 'register', email, password }) });
    return { status: res.status, body: await res.json() };
  }, { email, password });
  expect(r.status === 201, `HTTP ${r.status}`);
  recoveryCode = r.body.recoveryCode;
  await a.reload();
  await a.waitForTimeout(2000);
});
await step(a, 'Чат: «Стоп» останавливает ответ и оставляет пометку', async () => {
  await a.goto(`${B}/app.html#/chat?dir=content`);
  await a.locator('#prompt').fill('Сделай подробный контент-план на месяц для кофейни в Ташкенте таблицей: неделя, рубрика, тема, формат, канал.');
  await a.locator('[data-send]').click();
  await a.waitForSelector('.md.streaming', { timeout: 60000 });
  await a.waitForFunction(() => (document.querySelector('.md.streaming')?.innerText || '').length > 40, null, { timeout: 60000 }).catch(() => {});
  await a.locator('[data-stop]').click();
  await a.waitForTimeout(800);
  const note = await a.locator('.msg-note').allInnerTexts();
  expect(note.some(t => t.includes('Остановлено')), `пометки нет: ${note.join(',')}`);
  expect(!(await a.locator('[data-stop]').isVisible()), 'кнопка «Стоп» не спряталась');
});
await step(a, 'Чат: «Повторить» даёт новый полный ответ, таблица отображается', async () => {
  await a.locator('[data-act=retry]').last().click();
  await a.waitForTimeout(500);
  await a.waitForFunction(() => !document.querySelector('.md.streaming'), null, { timeout: 120000 });
  await a.waitForTimeout(500);
  const err = await a.locator('.msg-err').allInnerTexts();
  expect(!err.length, err.join(' '));
  const tables = await a.locator('.msg-ai .md table').count();
  const w = await a.evaluate(() => { const t = document.querySelector('.md-table'); return t ? { box: t.clientWidth, table: t.scrollWidth, scroll: getComputedStyle(t).overflowX } : null; });
  expect(tables >= 1, 'таблицы нет в ответе');
  return `таблиц ${tables}; ширина ${w.table}px в окне ${w.box}px, прокрутка «${w.scroll}»`;
});
await step(a, 'Чат: удаление с подтверждением', async () => {
  const before = await a.evaluate(async () => (await import('/js/store.js')).state.chats.length);
  await a.locator('[data-delete]').click();
  await a.locator('.modal [data-ok]').click();
  await a.waitForTimeout(600);
  const after = await a.evaluate(async () => (await import('/js/store.js')).state.chats.length);
  expect(after === before - 1 && a.url().endsWith('#/chat'), `${before} → ${after}, ${a.url()}`);
});

/* ---------- 3. Длинные и странные данные ---------- */
await step(a, 'Длинные данные: название задачи 200 символов и чат без пробелов', async () => {
  await a.goto(`${B}/app.html#/tasks`);
  const long = 'Очень-длинное-название-задачи-без-пробелов-'.repeat(5).slice(0, 200);
  await a.locator('#quick-title').fill(long);
  await a.locator('#quick-title').press('Enter');
  await a.locator('#quick-title').fill('<img src=x onerror=alert(1)> «кавычки» & амперсанд');
  await a.locator('#quick-title').press('Enter');
  await a.waitForTimeout(400);
  const o = await overflow(a);
  const xss = await a.locator('.task-title img').count();
  await a.locator('[data-view=board]').click();
  await a.waitForTimeout(400);
  const ob = await overflow(a);
  await a.locator('[data-view=list]').click();
  expect(!o.page && !o.items.length && !ob.page && xss === 0, `список ${JSON.stringify(o)}, доска ${JSON.stringify(ob)}, img ${xss}`);
});
await step(a, 'Длинные данные: профиль бренда на пределе длины', async () => {
  await a.goto(`${B}/app.html#/brand`);
  for (const [n, max] of [['name', 100], ['product', 500], ['audience', 500]]) await a.locator(`#brand-form [name=${n}]`).fill('Ж'.repeat(max + 50));
  await a.locator('#brand-form button[type=submit]').click();
  await a.goto(`${B}/app.html#/today`);
  await a.waitForTimeout(600);
  const o = await overflow(a);
  const h1 = await a.locator('h1').evaluate(e => ({ w: e.scrollWidth, box: e.clientWidth }));
  expect(!o.page && h1.w <= h1.box + 1, `${JSON.stringify(o)}, заголовок ${h1.w}/${h1.box}`);
});

/* ---------- 4. Два устройства одновременно ---------- */
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const bpage = await ctxB.newPage();
watch(bpage, 'B');
await step(bpage, 'Вход на втором устройстве (B): данные с A на месте', async () => {
  await bpage.goto(`${B}/app.html#/today`);
  await bpage.waitForTimeout(800);
  await bpage.locator('#account-btn').click();
  await bpage.locator('.modal [name=email]').fill(email);
  await bpage.locator('.modal [name=password]').fill(password);
  await bpage.locator('.modal button[type=submit]').click();
  await bpage.waitForTimeout(3500);
  const st = await bpage.evaluate(async () => (await import('/js/store.js')).state);
  expect(st.tasks.length >= 2 && st.brand.name.length >= 100, `задач ${st.tasks.length}, бренд ${st.brand.name.length}`);
  return `задач ${st.tasks.length}`;
});
await step(bpage, 'Одновременные правки на A и B не теряются', async () => {
  await a.goto(`${B}/app.html#/tasks`);
  await a.locator('#quick-title').fill('Задача с телефона');
  await a.locator('#quick-title').press('Enter');
  await bpage.goto(`${B}/app.html#/tasks`);
  await bpage.locator('#quick-title').fill('Задача с компьютера');
  await bpage.locator('#quick-title').press('Enter');
  await a.waitForTimeout(6000);
  // Возврат на вкладку забирает свежие данные
  for (const p of [a, bpage]) await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await a.waitForTimeout(5000);
  const server = await a.evaluate(() => fetch('/api/sync').then(r => r.json()));
  const titles = server.data.tasks.map(t => t.title);
  const onA = await a.evaluate(async () => (await import('/js/store.js')).state.tasks.map(t => t.title));
  const onB = await bpage.evaluate(async () => (await import('/js/store.js')).state.tasks.map(t => t.title));
  const both = list => list.includes('Задача с телефона') && list.includes('Задача с компьютера');
  expect(both(titles) && both(onA) && both(onB), `сервер ${both(titles)}, A ${both(onA)}, B ${both(onB)}`);
  return `на сервере задач ${titles.length}, rev ${server.rev}`;
});

/* ---------- 5. Ошибки входа и сброс пароля ---------- */
const ctxC = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const c = await ctxC.newPage();
watch(c, 'C');
await step(c, 'Неверный пароль — понятная ошибка в окне', async () => {
  await c.goto(`${B}/app.html#/today`);
  await c.waitForTimeout(800);
  await c.locator('#menu-btn').click();
  await c.locator('#account-btn').click();
  await c.locator('.modal [name=email]').fill(email);
  await c.locator('.modal [name=password]').fill('wrong-password-1');
  await c.locator('.modal button[type=submit]').click();
  await c.waitForTimeout(2000);
  const e = await c.locator('.modal .form-error').innerText();
  expect(/Неверная почта или пароль/.test(e), e);
  return e;
});
await step(c, 'Регистрация с коротким паролем и занятой почтой', async () => {
  await c.locator('.modal [data-mode=register]').click();
  await c.locator('.modal [name=email]').fill(email);
  await c.locator('.modal [name=password]').fill('123');
  await c.locator('.modal button[type=submit]').click();
  await c.waitForTimeout(1500);
  const short = await c.locator('.modal .form-error').innerText();
  await c.locator('.modal [name=password]').fill('long-enough-pass');
  await c.locator('.modal button[type=submit]').click();
  await c.waitForTimeout(2000);
  const taken = await c.locator('.modal .form-error').innerText();
  expect(/минимум 8/.test(short) && /уже есть/.test(taken), `${short} / ${taken}`);
  return `${short} / ${taken}`;
});
await step(c, 'Сброс пароля по коду восстановления через окно', async () => {
  await c.locator('.modal [data-close]').first().click();
  await c.locator('#account-btn').click();
  await c.locator('.modal [data-mode=reset]').click();
  await c.waitForTimeout(300);
  await c.locator('.modal [name=email]').fill(email);
  await c.locator('.modal [name=recoveryCode]').fill(recoveryCode.toLowerCase());
  await c.locator('.modal [name=password]').fill(password2);
  await c.locator('.modal button[type=submit]').click();
  await c.waitForTimeout(3000);
  const title = await c.locator('.modal h2').innerText();
  expect(title.includes('код восстановления'), title);
  await c.locator('.modal [data-close]').last().click();
  const meB = await bpage.evaluate(() => fetch('/api/account').then(r => r.json()));
  expect(!meB.user, 'на устройстве B старая сессия не завершилась');
  return 'новый код показан, сессия на B завершена';
});

/* ---------- 6. Без интернета ---------- */
await step(c, 'Без интернета: приложение открывается, калькулятор считает, есть уведомление', async () => {
  await c.goto(`${B}/app.html#/calc/romi`);
  await c.waitForTimeout(3000); // service worker сохраняет файлы
  await c.reload();
  await c.waitForTimeout(1500);
  await ctxC.setOffline(true);
  await c.waitForTimeout(500);
  const t = await c.locator('.toast').last().innerText().catch(() => '');
  await c.reload().catch(() => {});
  await c.waitForTimeout(2500);
  await c.locator('.calc-form [name=income]').fill('1 000 000');
  await c.locator('.calc-form [name=cost]').fill('500 000');
  await c.waitForTimeout(300);
  const r = await c.locator('.result-value').innerText();
  await ctxC.setOffline(false);
  expect(/Нет интернета/.test(t) && r.includes('%'), `уведомление «${t}», результат ${r}`);
  return `ROMI ${r}`;
});

/* ---------- Уборка ---------- */
await step(c, 'Удаление тестового аккаунта', async () => {
  const r = await c.evaluate(async pw => {
    const res = await fetch('/api/account', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pilot': '1' }, body: JSON.stringify({ action: 'delete', password: pw }) });
    return res.status;
  }, password2);
  expect(r === 200, `HTTP ${r}`);
});

await browser.close();
process.exitCode = report('Вторая волна') ? 0 : 1;
