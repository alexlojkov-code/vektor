// Быстрый обход всех экранов без аккаунта и AI: вылезание за край и читаемость текста
// в тёмной и светлой теме на телефоне, планшете и компьютере.
import { webkit, devices } from 'playwright';
import { BASE as B, OUT, results, overflow, lowContrast, watch, report } from './lib.mjs';

const SCREENS = ['/', '/app.html#/today', '/app.html#/chat', '/app.html#/tasks', '/app.html#/calc', '/app.html#/calc/funnel', '/app.html#/calc/romi', '/app.html#/brand', '/privacy.html'];
const browser = await webkit.launch();
for (const [label, opts] of [['телефон', devices['iPhone 13']], ['планшет', { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } }], ['компьютер', { viewport: { width: 1440, height: 900 } }]]) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...opts, locale: 'ru-RU' });
    const page = await ctx.newPage();
    watch(page, label);
    await page.goto(`${B}/app.html#/today`);
    await page.evaluate(theme => { const s = JSON.parse(localStorage.getItem('pilot:v1') || '{}'); s.version = 1; s.settings = { ...(s.settings || {}), theme }; localStorage.setItem('pilot:v1', JSON.stringify(s)); }, theme);
    const bad = [];
    for (const path of SCREENS) {
      await page.goto(`${B}${path}`);
      await page.waitForTimeout(path === '/' ? 2500 : 900);
      const o = await overflow(page);
      if (o.page || o.items.length) bad.push(`${path}: за край ${o.items.join(',')}`);
      const dim = await lowContrast(page);
      if (dim.length) bad.push(`${path}: плохо читается ${dim.join(', ')}`);
      await page.screenshot({ path: `${OUT}/${label}-${theme}-${path.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '') || 'landing'}.png` });
    }
    results.push(`${bad.length ? 'НЕ ПРОШЁЛ' : 'ок       '} | ${label}, ${theme === 'dark' ? 'тёмная' : 'светлая'} тема: ${SCREENS.length} экранов${bad.length ? ' — ' + bad.join('; ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
process.exitCode = report('Экраны: вёрстка и читаемость') ? 0 : 1;
