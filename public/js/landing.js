import { DIRECTIONS } from './directions.js';
import { metricById, parseNum, fmt } from './metrics.js';
import { esc } from './ui.js';
import { initMotion, tweenNumber } from './motion.js';

// Сетка направлений
const grid = document.getElementById('dir-grid');
grid.innerHTML = DIRECTIONS.filter(d => d.id !== 'general').map(d => `
  <a class="dir-card" href="app.html#/chat?dir=${d.id}" data-color="${d.color}" data-reveal data-spot>
    <span class="mono">${esc(d.mono)}</span>
    <span><b>${esc(d.name)}</b><small>${esc(d.about)}</small></span>
    <svg class="dir-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
  </a>`).join('');
grid.querySelectorAll('[data-color]').forEach(el => el.querySelector('.mono').style.setProperty('--dir', el.dataset.color));

// Бегущие строки: список повторён дважды, анимация сдвигает дорожку ровно на половину
const TICKERS = [
  DIRECTIONS.filter(d => d.id !== 'general').map(d => d.name),
  ['ROMI', 'ДРР', 'CAC', 'LTV', 'CTR', 'CPC', 'CPM', 'CPA', 'CPL', 'ROAS', 'ER', 'Churn', 'Retention', 'NPS', 'ARPU', 'Воронка продаж'],
];
document.querySelectorAll('[data-ticker]').forEach((track, i) => {
  const items = TICKERS[i].map(t => `<span class="ticker-item">${esc(t)}<i class="ticker-sep"></i></span>`).join('');
  track.innerHTML = `<span class="ticker-item-group">${items}</span><span class="ticker-item-group" aria-hidden="true">${items}</span>`;
});

// Демо ROMI: число плавно перетекает к новому значению
const form = document.getElementById('romi-demo');
const romi = metricById('romi');
const value = document.getElementById('romi-value');
const text = document.getElementById('romi-text');
const live = document.getElementById('romi-live');
const formatRomi = r => (r > 0.05 ? '+' : '') + fmt(r, '%');
let seen = false;
function update() {
  const v = Object.fromEntries(['income', 'margin', 'cost'].map(k => [k, parseNum(form.elements[k].value)]));
  const r = romi.compute(v);
  const message = r === null ? 'Заполните доход и расходы' : `${romi.assess(r).text} Каждый рубль вернул ${fmt(1 + r / 100)} ₽.`;
  text.textContent = message;
  live.textContent = r === null ? message : `ROMI ${formatRomi(r)}. ${message}`;
  if (r === null) { value.textContent = '—'; value._value = undefined; return; }
  if (seen) tweenNumber(value, r, formatRomi);
  else value.textContent = formatRomi(r);
}
form.addEventListener('input', update);
form.addEventListener('submit', e => e.preventDefault());
update();
// Первый показ блока: досчитываем от нуля
new IntersectionObserver((entries, io) => {
  if (!entries[0].isIntersecting) return;
  io.disconnect();
  seen = true;
  value._value = 0;
  update();
}, { threshold: 0.4 }).observe(form);

initMotion();

// 3D-объекты грузим после первой отрисовки: библиотека тяжёлая и не должна задерживать текст
const load3d = () => import('./scene3d.min.js').then(m => m.start()).catch(err => console.warn('3D-объекты не загрузились', err));
if ('requestIdleCallback' in window) requestIdleCallback(load3d, { timeout: 1500 });
else setTimeout(load3d, 300);
