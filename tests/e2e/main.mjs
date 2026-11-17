// Основные сценарии на телефоне (iPhone 13, Safari): лендинг, «Сегодня», профиль бренда, меню,
// калькулятор, задачи, аккаунт, AI-чат, выход и вход, тема, политика. Тестовый аккаунт удаляется в конце.
// Расходует 1 запрос к AI из лимита аккаунта.
import { webkit, devices } from 'playwright';
import { randomUUID } from 'node:crypto';
import { BASE as B, step, expect, watch, overflow, report } from './lib.mjs';

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const page = await ctx.newPage();
watch(page);
const s = (name, fn) => step(page, name, fn);
const toastText = () => page.locator('.toast').last().innerText({ timeout: 4000 }).catch(() => '');
const gotoApp = async hash => { await page.goto(`${B}/app.html${hash}`); await page.waitForTimeout(700); };
const openMenu = async () => { await page.locator('#menu-btn').click(); await page.waitForTimeout(400); };
const state = () => page.evaluate(async () => (await import('/js/store.js')).state);

/* ---------- Лендинг ---------- */
await s('Лендинг открывается без горизонтальной прокрутки', async () => {
  await page.goto(B, { waitUntil: 'networkidle' });
  expect((await page.locator('h1').innerText()).includes('маркетингу'), 'нет заголовка');
  const o = await overflow(page);
  expect(!o.page && !o.items.length, JSON.stringify(o));
});
await s('Демо ROMI пересчитывается', async () => {
  await page.locator('#romi-demo').scrollIntoViewIfNeeded();
  await page.locator('#romi-demo [name=income]').fill('50 000 000');
  await page.waitForTimeout(900);
  const v = await page.locator('#romi-value').innerText();
  expect(/%/.test(v), `значение «${v}»`);
  return `ROMI ${v}`;
});
await s('FAQ раскрывается', async () => {
  const d = page.locator('.faq details').first();
  await d.scrollIntoViewIfNeeded();
  await d.locator('summary').click();
  await page.waitForTimeout(500);
  expect(await d.evaluate(e => e.open), 'не раскрылся');
});
await s('Ссылка «Конфиденциальность» в подвале', async () => {
  const r = await page.request.get(`${B}/${await page.locator('footer a[href="privacy.html"]').getAttribute('href')}`);
  expect(r.status() === 200, `HTTP ${r.status()}`);
});
await s('Кнопка «Начать бесплатно» ведёт в приложение', async () => {
  await page.locator('.hero a.btn-primary').first().scrollIntoViewIfNeeded();
  await page.locator('.hero a.btn-primary').first().click();
  await page.waitForURL(/app\.html/);
  await page.waitForTimeout(800);
});

/* ---------- Сегодня, установка, профиль бренда, меню ---------- */
await s('«Сегодня»: плашка установки и подсказка для iPhone', async () => {
  const card = page.locator('#install-card');
  expect(await card.isVisible(), 'плашки нет');
  await card.locator('[data-install]').click();
  await page.waitForTimeout(400);
  const title = await page.locator('.modal h2').innerText();
  expect(title.includes('iPhone'), `окно «${title}»`);
  await page.locator('.modal [data-close]').first().click();
});
await s('Профиль бренда сохраняется и попадает в приветствие', async () => {
  await gotoApp('#/brand');
  await page.locator('#brand-form [name=name]').fill('Кофейня «Зерно»');
  await page.locator('#brand-form [name=geo]').fill('Ташкент');
  await page.locator('#brand-form button[type=submit]').click();
  const t = await toastText();
  await gotoApp('#/today');
  expect((await page.locator('h1').innerText()).includes('Зерно'), 'нет названия в приветствии');
  return t;
});
await s('Меню открывается и переходит в разделы', async () => {
  await openMenu();
  expect(await page.locator('#sidebar').evaluate(e => e.classList.contains('open')), 'меню не открылось');
  await page.locator('#side-nav a[href="#/calc"]').click();
  await page.waitForTimeout(500);
  expect(page.url().includes('#/calc'), page.url());
  expect(!(await page.locator('#sidebar').evaluate(e => e.classList.contains('open'))), 'меню не закрылось');
});

/* ---------- Калькулятор ---------- */
await s('Калькулятор: поиск «дрр» находит ДРР', async () => {
  await gotoApp('#/calc');
  await page.locator('#metric-search').fill('дрр');
  await page.waitForTimeout(300);
  const names = await page.locator('.metric-card b').allInnerTexts();
  expect(names.some(n => /ДРР/.test(n)), names.join(','));
});
await s('Калькулятор: ROMI считается', async () => {
  await gotoApp('#/calc/romi');
  await page.locator('.calc-form [name=income]').fill('84 000 000');
  await page.locator('.calc-form [name=margin]').fill('45');
  await page.locator('.calc-form [name=cost]').fill('25 000 000');
  await page.waitForTimeout(300);
  const r = await page.locator('.result-value').innerText();
  expect(r.includes('51,2'), `результат ${r}`);
  return r;
});
await s('Калькулятор: деление на ноль без NaN', async () => {
  await page.locator('.calc-form [name=cost]').fill('0');
  await page.waitForTimeout(300);
  const t = await page.locator('[data-result]').innerText();
  expect(!/NaN|Infinity/.test(t) && t.includes('—'), t.slice(0, 80));
});
await s('Калькулятор: валюта доллар и обратно сум', async () => {
  await gotoApp('#/calc/funnel');
  await page.locator('[data-currency=usd]').click();
  await page.waitForTimeout(300);
  const label = await page.locator('.calc-form .field > span').first().innerText();
  const kpi = await page.locator('.kpi').nth(1).innerText();
  expect(label.includes('$') && kpi.includes('$'), `${label} / ${kpi}`);
  await page.locator('[data-currency=uzs]').click();
  await page.waitForTimeout(300);
  expect((await page.locator('.calc-form .field > span').first().innerText()).includes('сум'), 'не вернулось в сумы');
});

/* ---------- Задачи ---------- */
await s('Задачи: быстрое добавление трёх задач', async () => {
  await gotoApp('#/tasks');
  for (const t of ['Подготовить пресс-релиз', 'Собрать медиакарту', 'Написать питч в 5 СМИ']) {
    await page.locator('#quick-title').fill(t);
    await page.locator('#quick-title').press('Enter');
    await page.waitForTimeout(200);
  }
  expect(await page.locator('.task').count() >= 3, 'задач меньше трёх');
  const ph = await page.locator('#quick-title').getAttribute('placeholder');
  expect(ph === 'Новая задача', `плейсхолдер «${ph}»`);
  return await page.locator('[data-count]').innerText();
});
await s('Задачи: отметка «выполнено»', async () => {
  await page.locator('.task', { hasText: 'Написать питч' }).locator('[data-toggle]').check({ force: true });
  await page.waitForTimeout(300);
  const done = await page.locator('.task.is-done').count();
  expect(done === 1, `выполнено ${done} из 3`);
});
await s('Задачи: редактирование (приоритет, срок)', async () => {
  await page.locator('.task:not(.is-done) [data-edit]').first().click();
  await page.locator('.modal [name=priority]').selectOption('high');
  await page.locator('.modal [name=dueDate]').fill(new Date().toISOString().slice(0, 10));
  await page.locator('.modal [data-ok]').click();
  await page.waitForTimeout(300);
  expect(await page.locator('.dot-high').count() >= 1, 'приоритет не сохранился');
});
await s('Задачи: поиск и фильтр статуса', async () => {
  await page.locator('[data-f=q]').fill('медиакарт');
  await page.waitForTimeout(300);
  const n = await page.locator('.task').count();
  await page.locator('[data-f=q]').fill('');
  await page.locator('[data-f=status]').selectOption('done');
  await page.waitForTimeout(300);
  const done = await page.locator('.task').count();
  await page.locator('[data-f=status]').selectOption('');
  expect(n === 1 && done >= 1, `поиск ${n}, выполненных ${done}`);
});
await s('Задачи: доска и перенос в «В работе»', async () => {
  await page.locator('[data-view=board]').click();
  await page.waitForTimeout(400);
  await page.locator('.column[data-status=todo] [data-move]').first().selectOption('doing');
  await page.waitForTimeout(400);
  expect(await page.locator('.column[data-status=doing] .kcard').count() >= 1, 'карточка не перенеслась');
  await page.locator('[data-view=list]').click();
});
await s('Задачи: удаление и «Отменить»', async () => {
  const before = await page.locator('.task').count();
  await page.locator('.task [data-del]').first().click();
  await page.waitForTimeout(300);
  const after = await page.locator('.task').count();
  await page.locator('.toast button').last().click();
  await page.waitForTimeout(300);
  const restored = await page.locator('.task').count();
  expect(after === before - 1 && restored === before, `${before} → ${after} → ${restored}`);
});
await s('Задачи на сегодня видны на экране «Сегодня»', async () => {
  await gotoApp('#/today');
  expect(await page.locator('#today-tasks .task').count() >= 1, 'нет задач на сегодня');
});

/* ---------- Аккаунт ---------- */
const email = `qa-${Date.now()}@vektor.test`, password = `qa-${randomUUID()}`;
await s('Аккаунт: регистрация через окно входа', async () => {
  await openMenu();
  await page.locator('#account-btn').click();
  await page.locator('.modal [data-mode=register]').click();
  await page.waitForTimeout(300);
  await page.locator('.modal [name=email]').fill(email);
  await page.locator('.modal [name=password]').fill(password);
  await page.locator('.modal button[type=submit]').click();
  await page.waitForTimeout(2500);
  expect((await page.locator('.modal h2').innerText()).includes('код восстановления'), 'нет окна с кодом');
  await page.locator('.modal [data-close]').last().click();
  await page.waitForTimeout(2500);
  expect((await page.locator('#account-btn').innerText()).includes(email), 'в меню нет почты');
});
await s('Аккаунт: данные ушли на сервер', async () => {
  const r = await page.evaluate(() => fetch('/api/sync').then(r => r.json()));
  expect(r.data && r.data.tasks.length >= 3 && r.data.brand.name.includes('Зерно'), JSON.stringify(r).slice(0, 120));
  return `rev ${r.rev}, задач ${r.data.tasks.length}`;
});

/* ---------- AI-чат ---------- */
await s('Чат: после входа нет баннера гостя, выбор направления и сценария', async () => {
  await gotoApp('#/chat');
  const banner = await page.locator('[data-banner]').innerText().catch(() => '');
  expect(!/из 15/.test(banner), `после входа баннер гостя: ${banner}`);
  await page.locator('.dir-chip[data-dir=pr]').click();
  await page.waitForTimeout(300);
  expect((await page.locator('[data-dir-title]').innerText()).includes('PR'), 'направление не переключилось');
  await page.locator('.scenarios button, .scenarios a').first().click();
  await page.waitForTimeout(300);
  expect((await page.locator('#prompt').inputValue()).length > 10, 'сценарий не подставился');
});
await s('Чат: ответ AI потоком', async () => {
  await page.locator('#prompt').fill('Короткий план PR-кампании к открытию второй кофейни в Ташкенте, бюджет 20 млн сум. Не больше 10 строк.');
  await page.locator('[data-send]').click();
  await page.waitForURL(/#\/chat\/.+/);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('.md.streaming'), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const err = await page.locator('.msg-err').allInnerTexts();
  expect(!err.length, `ошибка: ${err.join(' ')}`);
  const text = await page.locator('.msg-ai .md').last().innerText();
  expect(text.length > 150, `короткий ответ ${text.length}`);
  return `${text.length} символов`;
});
await s('Чат: «В задачи» создаёт задачи', async () => {
  const btn = page.locator('[data-act=tasks]').last();
  expect(await btn.isEnabled(), 'кнопка неактивна: в ответе нет шагов');
  await btn.click();
  await page.waitForTimeout(400);
  await page.locator('.modal [data-ok]').click();
  const t = await toastText();
  expect(/Добавлено задач/.test(t), t);
  return t.split('\n')[0];
});
await s('Чат: оценка, переименование, поиск по чатам', async () => {
  await page.locator('[data-act=up]').last().click();
  expect(await page.locator('[data-act=up][aria-pressed=true]').count() === 1, 'оценка не сохранилась');
  await page.locator('[data-rename]').click();
  await page.locator('.modal [name=title]').fill('PR кофейни QA');
  await page.locator('.modal [data-ok]').click();
  await page.waitForTimeout(300);
  expect((await page.locator('.chat-title').innerText()).includes('QA'), 'не переименован');
  await openMenu();
  const search = page.locator('#chat-search');
  if (await search.isVisible()) { await search.fill('QA'); await page.waitForTimeout(200); }
  const found = await page.locator('#chat-list .chat-link-title').allInnerTexts();
  expect(found.some(t => t.includes('QA')), found.join(','));
  await page.locator('#sidebar-close').click();
});
await s('Чат: выбор модели в шапке', async () => {
  const opts = await page.locator('#chat-model option').allInnerTexts();
  expect(opts.length >= 2, opts.join(','));
  return opts.join(' | ');
});

/* ---------- Выход и вход ---------- */
await s('Аккаунт: выход очищает устройство, вход возвращает данные', async () => {
  await page.waitForTimeout(3500); // отправка изменений через 2 с
  await openMenu();
  await page.locator('#account-btn').click();
  await page.locator('.modal [data-logout]').click();
  await page.waitForTimeout(600);
  await page.locator('.modal [data-ok]').click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  const empty = await page.evaluate(() => JSON.parse(localStorage.getItem('pilot:v1') || '{"tasks":[]}').tasks.length);
  await openMenu();
  await page.locator('#account-btn').click();
  await page.locator('.modal [name=email]').fill(email);
  await page.locator('.modal [name=password]').fill(password);
  await page.locator('.modal button[type=submit]').click();
  await page.waitForTimeout(3500);
  const st = await state();
  expect(empty === 0 && st.tasks.length >= 3 && st.chats.length >= 1, `после выхода ${empty}, после входа задач ${st.tasks.length}, чатов ${st.chats.length}`);
  return `задач ${st.tasks.length}, чатов ${st.chats.length}`;
});

/* ---------- Тема и политика ---------- */
await s('Светлая тема включается и выключается', async () => {
  await gotoApp('#/today');
  await openMenu();
  await page.locator('#theme-toggle').click();
  const light = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('#theme-toggle').click();
  const dark = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(light === 'light' && dark === 'dark', `${light}/${dark}`);
  await page.locator('#sidebar-close').click();
});
await s('Политика конфиденциальности открывается', async () => {
  await page.goto(`${B}/privacy.html`);
  expect((await page.locator('h1').innerText()).includes('конфиденциальности'), 'нет заголовка');
});

/* ---------- Уборка ---------- */
await s('Аккаунт: удаление через окно аккаунта', async () => {
  await gotoApp('#/today');
  await openMenu();
  await page.locator('#account-btn').click();
  await page.locator('.danger-zone summary').click();
  await page.locator('.danger-zone [name=password]').fill(password);
  await page.locator('.danger-zone button[type=submit]').click();
  await page.waitForTimeout(1500);
  const me = await page.evaluate(() => fetch('/api/account').then(r => r.json()));
  expect(!me.user, 'аккаунт остался');
});

await browser.close();
process.exitCode = report('Основные сценарии (телефон)') ? 0 : 1;
