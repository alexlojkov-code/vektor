// Каркас приложения: hash-роутинг, боковая панель, таб-бар, тема, экраны «Сегодня» и «Профиль бренда».
import { state, save, onChange, getChat } from './store.js';
import { esc, icon, applyColors, toast, daysFromToday, timeAgo, todayISO } from './ui.js';
import { directionById } from './directions.js';
import { renderChatHome, renderChat, aiStatus } from './chat.js';
import { renderTasks, taskRow, bindTaskRows, openTaskEditor } from './tasks.js';
import { renderCalcCatalog, renderMetric, renderFunnel } from './calc.js';
import { setCurrency } from './metrics.js';
import { initAccount } from './account.js';
import { canInstall, install, onInstallChange, installHintDismissed, dismissInstallHint } from './pwa.js';

const main = document.getElementById('main');
const NAV = [
  { id: 'today', label: 'Сегодня', href: '#/today', icon: 'today' },
  { id: 'chat', label: 'AI-чат', href: '#/chat', icon: 'chat' },
  { id: 'tasks', label: 'Задачи', href: '#/tasks', icon: 'tasks' },
  { id: 'calc', label: 'Калькулятор', href: '#/calc', icon: 'calc' },
  { id: 'brand', label: 'Профиль бренда', href: '#/brand', icon: 'brand' },
];

/* ---------- Тема ---------- */
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  const light = state.settings.theme === 'light';
  document.querySelector('meta[name="theme-color"]').content = light ? '#F7F4FC' : '#0D071A';
  const btn = document.getElementById('theme-toggle');
  btn.innerHTML = `${icon(light ? 'moon' : 'sun')}<span>${light ? 'Тёмная тема' : 'Светлая тема'}</span>`;
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
  save();
  applyTheme();
});

/* ---------- Установка приложения (PWA) ---------- */
const installBtn = document.getElementById('install-btn');
installBtn.innerHTML = `${icon('download')}<span>Установить приложение</span>`;
installBtn.addEventListener('click', install);
const narrowMQ = matchMedia('(max-width: 1023px)');
// Кнопка — в боковой панели; на телефоне ещё и плашка на экране «Сегодня», пока её не скрыли
function updateInstallUI() {
  installBtn.hidden = !canInstall();
  const card = document.getElementById('install-card');
  if (card) card.hidden = !canInstall() || !narrowMQ.matches || installHintDismissed();
}
onInstallChange(updateInstallUI);
narrowMQ.addEventListener('change', updateInstallUI);

/* ---------- Боковая панель ---------- */
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('sidebar-scrim');
document.getElementById('menu-btn').innerHTML = icon('menu');
document.getElementById('sidebar-close').innerHTML = icon('close');
document.querySelector('.new-chat').innerHTML = `${icon('plus')}<span>Новый чат</span>`;
const setSidebar = open => {
  sidebar.classList.toggle('open', open);
  scrim.hidden = !open;
  if (open) sidebar.querySelector('a, button')?.focus();
};
document.getElementById('menu-btn').addEventListener('click', () => setSidebar(true));
document.getElementById('sidebar-close').addEventListener('click', () => setSidebar(false));
scrim.addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sidebar.classList.contains('open')) setSidebar(false); });

function renderSidebar(section, chatId) {
  document.getElementById('side-nav').innerHTML = NAV.map(n =>
    `<a href="${n.href}" class="side-link"${n.id === section ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span></a>`).join('');
  document.getElementById('tabbar').innerHTML = NAV.slice(0, 4).map(n =>
    `<a href="${n.href}"${n.id === section ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label === 'AI-чат' ? 'Чат' : n.label}</span></a>`).join('');
  renderChatList(chatId);
}

/* ---------- Список чатов с поиском (CH-6): по названию и тексту сообщений, среди всех чатов ---------- */
const chatSearch = document.getElementById('chat-search');
const normalize = s => String(s).toLowerCase().replace(/ё/g, 'е');
let listChatId = null;

function renderChatList(chatId = listChatId) {
  listChatId = chatId;
  const list = document.getElementById('chat-list');
  const q = normalize(chatSearch.value.trim());
  document.getElementById('chat-search-wrap').hidden = state.chats.length < 2 && !q;
  const found = q
    ? state.chats.filter(c => normalize(c.title).includes(q) || c.messages.some(m => normalize(m.content).includes(q))).slice(0, 50)
    : state.chats.slice(0, 30);
  list.innerHTML = found.length
    ? found.map(c => {
      const d = directionById(c.direction);
      return `<li><a href="#/chat/${esc(c.id)}" class="chat-link"${c.id === chatId ? ' aria-current="page"' : ''}>
        <span class="dot" data-color="${d.color}"></span><span class="chat-link-title">${esc(c.title)}</span></a></li>`;
    }).join('')
    : `<li class="subtle chat-empty">${q ? 'Ничего не нашлось' : 'Пока нет чатов'}</li>`;
  list.querySelectorAll('.dot[data-color]').forEach(el => { el.style.background = el.dataset.color; });
}
chatSearch.before(document.createRange().createContextualFragment(icon('search')));
chatSearch.addEventListener('input', () => renderChatList());

/* ---------- Роутинг ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'today';
  const [path, qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}

let cleanup = null;
function route() {
  cleanup?.();
  cleanup = null;
  setSidebar(false);
  const { parts, query } = parseHash();
  const [section = 'today', id] = parts;
  renderSidebar(section, section === 'chat' ? id : null);
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  document.body.dataset.section = section;

  if (section === 'chat' && id) {
    const chat = getChat(id);
    if (!chat) { toast('Чат не найден'); location.hash = '#/chat'; return; }
    cleanup = renderChat(main, chat, query);
  } else if (section === 'chat') {
    renderChatHome(main, query);
  } else if (section === 'tasks') {
    cleanup = renderTasks(main, query);
  } else if (section === 'calc' && id === 'funnel') {
    renderFunnel(main, query);
  } else if (section === 'calc' && id) {
    renderMetric(main, id, query);
  } else if (section === 'calc') {
    renderCalcCatalog(main, query);
  } else if (section === 'brand') {
    renderBrand();
  } else {
    renderToday();
  }
  applyColors(main);
  document.title = `${NAV.find(n => n.id === section)?.label || 'Вектор'} — Вектор`;
}
window.addEventListener('hashchange', route);
onChange(() => {
  const { parts } = parseHash();
  renderSidebar(parts[0] || 'today', parts[0] === 'chat' ? parts[1] : null);
});

/* ---------- Сегодня ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

function renderToday() {
  const due = state.tasks
    .filter(t => t.status !== 'done' && t.dueDate && daysFromToday(t.dueDate) <= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const open = state.tasks.filter(t => t.status !== 'done').length;
  const brandFilled = Object.values(state.brand).some(Boolean);
  const quick = [
    ['pr', 0], ['content', 0], ['performance', 0], ['research', 0],
  ].map(([dir, i]) => ({ d: directionById(dir), s: directionById(dir).scenarios[i] }));

  main.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div>
          <p class="subtle">${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>${greeting()}${state.brand.name ? `, <span class="accent-word">${esc(state.brand.name)}</span>` : ''}</h1>
        </div>
        <a class="btn btn-primary" href="#/chat">${icon('sparkle')}<span>Спросить AI</span></a>
      </header>

      ${brandFilled ? '' : `
      <a class="card card-gradient hint-card card-interactive" href="#/brand">
        <div><h2>Заполните <span class="accent-word">профиль бренда</span></h2>
        <p class="muted">Две минуты — и ассистент будет учитывать продукт, аудиторию и tone of voice в каждом ответе.</p></div>
        <span class="btn btn-dark">Заполнить</span>
      </a>`}

      <section class="card install-card" id="install-card" hidden>
        <img src="icons/icon-192.png" alt="" width="48" height="48">
        <div class="install-text"><h2>Установите <span class="accent-word">Вектор</span></h2>
          <p class="muted">Иконка на главном экране, запуск на весь экран и работа без интернета.</p></div>
        <div class="install-actions">
          <button class="btn btn-primary btn-sm" type="button" data-install>Установить</button>
          <button class="btn btn-icon" type="button" data-dismiss aria-label="Скрыть подсказку">${icon('close')}</button>
        </div>
      </section>

      <div class="today-grid">
        <section class="card">
          <div class="card-head"><h2>Задачи на сегодня</h2><a href="#/tasks?due=today" class="subtle">Все задачи · ${open}</a></div>
          ${due.length ? `<ul class="task-list" id="today-tasks">${due.slice(0, 7).map(taskRow).join('')}</ul>`
            : `<div class="empty"><p>На сегодня задач нет.</p><button class="btn btn-soft btn-sm" id="today-add">${icon('plus')}<span>Добавить задачу</span></button></div>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Последние чаты</h2><a href="#/chat" class="subtle">Новый чат</a></div>
          ${state.chats.length ? `<ul class="recent">${state.chats.slice(0, 4).map(c => {
            const d = directionById(c.direction);
            return `<li><a href="#/chat/${esc(c.id)}"><span class="mono" data-color="${d.color}">${esc(d.mono)}</span>
              <span><b>${esc(c.title)}</b><small>${esc(d.name)} · ${timeAgo(c.updatedAt)}</small></span></a></li>`;
          }).join('')}</ul>` : '<div class="empty"><p>Чатов пока нет. Начните с быстрого сценария ниже.</p></div>'}
        </section>
      </div>

      <section>
        <h2 class="block-title">Быстрые <span class="accent-word">сценарии</span></h2>
        <div class="quick-grid">
          ${quick.map(({ d, s }) => `<a class="card card-interactive quick" href="#/chat?dir=${d.id}&s=0">
            <span class="mono" data-color="${d.color}">${esc(d.mono)}</span><b>${esc(s.title)}</b><small>${esc(d.name)}</small></a>`).join('')}
        </div>
      </section>

      <section class="tools-row">
        <a class="card card-gradient card-interactive tool" href="#/calc/funnel">
          ${icon('funnel')}<h3>Калькулятор <span class="accent-word">воронки</span></h3>
          <p class="muted">Бюджет → показы → клики → лиды → продажи → ROMI</p>
        </a>
        <a class="card card-interactive tool" href="#/calc">
          ${icon('calc')}<h3>30+ метрик</h3>
          <p class="muted">ROMI, ДРР, CAC, LTV, CTR, ER, NPS — с формулами и оценкой</p>
        </a>
      </section>
    </div>`;
  const installCard = document.getElementById('install-card');
  installCard.querySelector('[data-install]').addEventListener('click', install);
  installCard.querySelector('[data-dismiss]').addEventListener('click', () => { dismissInstallHint(); updateInstallUI(); });
  updateInstallUI();
  const list = document.getElementById('today-tasks');
  if (list) bindTaskRows(list, renderToday);
  document.getElementById('today-add')?.addEventListener('click', () => openTaskEditor(null, renderToday, { dueDate: todayISO() }));
}

/* ---------- Профиль бренда ---------- */
const BRAND_FIELDS = [
  ['name', 'Название бренда', 'input', 'Кофейня «Зерно»', 100],
  ['product', 'Продукт или услуга', 'textarea', 'Что продаёте, ключевые товары, цены', 500],
  ['audience', 'Целевая аудитория', 'textarea', 'Кто покупает: возраст, интересы, задачи, боли', 500],
  ['usp', 'УТП', 'textarea', 'Чем вы лучше альтернатив', 300],
  ['competitors', 'Конкуренты', 'input', 'Основные конкуренты через запятую', 300],
  ['tone', 'Tone of voice', 'input', 'Например: дружелюбный, на «ты», с юмором', 200],
  ['geo', 'География', 'input', 'Город, регион или «онлайн, весь Узбекистан»', 100],
  ['budget', 'Маркетинговый бюджет', 'input', 'Например: 30 млн сум или $2 500 в месяц', 100],
];

function renderBrand() {
  main.innerHTML = `
    <div class="page page-narrow">
      <header class="page-head"><div>
        <h1>Профиль <span class="accent-word">бренда</span></h1>
        <p class="muted">Ассистент учитывает эти данные в каждом ответе. Хранятся в браузере, а после входа в аккаунт — синхронизируются между устройствами.</p>
      </div></header>
      <form class="card form-grid" id="brand-form" novalidate>
        ${BRAND_FIELDS.map(([key, label, type, ph, max]) => `
          <label class="field${type === 'textarea' ? ' field-wide' : ''}"><span>${label}</span>
            ${type === 'textarea'
              ? `<textarea class="textarea" name="${key}" maxlength="${max}" placeholder="${esc(ph)}">${esc(state.brand[key])}</textarea>`
              : `<input class="input" name="${key}" maxlength="${max}" placeholder="${esc(ph)}" value="${esc(state.brand[key])}">`}
          </label>`).join('')}
        <div class="form-actions field-wide">
          <button class="btn btn-primary" type="submit">Сохранить</button>
          <span class="subtle" id="brand-saved" aria-live="polite"></span>
        </div>
      </form>
    </div>`;
  const form = document.getElementById('brand-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    for (const [key] of BRAND_FIELDS) state.brand[key] = form.elements[key].value.trim();
    save();
    toast('Профиль бренда сохранён', { type: 'success' });
    document.getElementById('brand-saved').textContent = 'Сохранено';
  });
}

/* ---------- Старт ---------- */
setCurrency(state.settings.currency);
applyTheme();
updateInstallUI();
route();
aiStatus();
// Пришли данные с другого устройства: тема, валюта и текущий экран — по новым данным
initAccount(() => {
  setCurrency(state.settings.currency);
  applyTheme();
  route();
});
export { route };
