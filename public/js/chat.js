// AI-чат: выбор направления и сценария, поток ответа (NDJSON), стоп, оценки, «В задачи».
import { state, save, createChat, touchChat, deleteChat, uid, now, addTask } from './store.js';
import { esc, icon, applyColors, toast, openModal, confirmDialog, todayISO } from './ui.js';
import { DIRECTIONS, directionById } from './directions.js';
import { renderMarkdown, extractSteps } from './markdown.js';

const MAX_MESSAGES = 40;
const MAX_TOTAL = 60000;
const MAX_MESSAGE = 8000;

/* ---------- Статус AI ---------- */
let statusPromise;
export function aiStatus() {
  statusPromise ||= fetch('/api/ai/status').then(r => r.json()).catch(() => ({ enabled: false, provider: 'none', reason: 'сервер недоступен' }));
  return statusPromise;
}

async function renderBanner(el) {
  const s = await aiStatus();
  if (!el.isConnected) return;
  if (!s.enabled) {
    el.innerHTML = `<div class="banner">${icon('sparkle')}<span><b>AI пока не подключён.</b> Задачи и калькулятор работают. Чтобы включить ответы, добавьте ключ <code>ANTHROPIC_API_KEY</code> на сервере.</span></div>`;
  } else if (s.provider === 'mock') {
    el.innerHTML = `<div class="banner banner-demo"><span class="badge">Демо-режим</span><span>Ответы шаблонные, без обращения к AI.</span></div>`;
  }
}

/* ---------- Активные генерации живут вне экрана: можно уйти и вернуться ---------- */
const active = new Map(); // chatId → { controller, message }
let mounted = null;       // { chat, root } — открытый сейчас чат

function buildHistory(chat) {
  const out = [];
  for (const m of chat.messages) {
    if (m.pending || !m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) });
  }
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  const size = () => out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 1 && (out.length > MAX_MESSAGES || size() > MAX_TOTAL || out[0].role !== 'user')) out.shift();
  return out;
}

async function generate(chat) {
  if (active.has(chat.id)) return;
  const history = buildHistory(chat);
  if (!history.length) return;
  const message = { id: uid(), role: 'assistant', content: '', createdAt: now(), pending: true };
  chat.messages.push(message);
  const controller = new AbortController();
  active.set(chat.id, { controller, message });
  touchChat(chat);
  refresh(chat);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pilot': '1' },
      body: JSON.stringify({ direction: chat.direction, brand: state.brand, messages: history }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const p = await res.json().catch(() => ({}));
      throw new Error(p.detail || `Ошибка сервера (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'delta') { message.content += ev.text; paint(chat, message); }
        if (ev.type === 'error') throw new Error(ev.detail || 'Ошибка AI');
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') message.stopped = true;
    else if (message.content) { message.error = `Ответ прерван: ${err.message}`; }
    else message.error = err.message === 'Failed to fetch' ? 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' : err.message;
  } finally {
    delete message.pending;
    active.delete(chat.id);
    touchChat(chat);
    refresh(chat);
  }
}

/* ---------- Отрисовка сообщений ---------- */
function messageHTML(chat, m, isLast) {
  if (m.role === 'user') {
    return `<article class="msg msg-user" data-id="${m.id}"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></article>`;
  }
  const steps = m.content && !m.pending ? extractSteps(m.content) : [];
  const body = m.content ? renderMarkdown(m.content) : (m.pending ? '<p class="typing" aria-label="AI печатает"><i></i><i></i><i></i></p>' : '');
  return `<article class="msg msg-ai${m.error ? ' msg-error' : ''}" data-id="${m.id}">
    <div class="ai-avatar" aria-hidden="true"></div>
    <div class="msg-main">
      <div class="md${m.pending ? ' streaming' : ''}">${body}</div>
      ${m.stopped ? '<p class="subtle msg-note">Остановлено</p>' : ''}
      ${m.error ? `<p class="msg-err">${esc(m.error)}</p>` : ''}
      ${m.pending ? '' : `<div class="msg-actions">
        ${m.content ? `<button class="btn btn-icon btn-act" data-act="copy" title="Копировать" aria-label="Копировать">${icon('copy')}</button>` : ''}
        ${isLast ? `<button class="btn btn-icon btn-act" data-act="retry" title="Повторить" aria-label="Повторить">${icon('retry')}</button>` : ''}
        ${m.content ? `<button class="btn btn-icon btn-act" data-act="up" aria-pressed="${m.rating === 'up'}" title="Полезно" aria-label="Полезно">${icon('up')}</button>
        <button class="btn btn-icon btn-act" data-act="down" aria-pressed="${m.rating === 'down'}" title="Не полезно" aria-label="Не полезно">${icon('down')}</button>
        <button class="btn btn-soft btn-sm" data-act="tasks"${steps.length ? '' : ' disabled title="В ответе нет списка шагов"'}>${icon('task')}<span>В задачи${steps.length ? ` · ${steps.length}` : ''}</span></button>` : ''}
      </div>`}
    </div>
  </article>`;
}

let raf = 0;
function paint(chat, message) {
  if (!mounted || mounted.chat !== chat) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const md = mounted?.root.querySelector(`[data-id="${message.id}"] .md`);
    if (!md) return;
    const log = mounted.root.querySelector('.log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    md.innerHTML = renderMarkdown(message.content);
    if (atBottom) log.scrollTop = log.scrollHeight;
  });
}

function refresh(chat) {
  if (!mounted || mounted.chat !== chat) return;
  const { root } = mounted;
  const log = root.querySelector('.log');
  const last = chat.messages[chat.messages.length - 1];
  log.innerHTML = chat.messages.length
    ? chat.messages.map(m => messageHTML(chat, m, m === last && m.role === 'assistant')).join('')
    : '';
  log.scrollTop = log.scrollHeight;
  const busy = active.has(chat.id);
  root.querySelector('[data-send]').hidden = busy;
  root.querySelector('[data-stop]').hidden = !busy;
  root.querySelector('.chat-title').textContent = chat.title;
  if (!busy && last?.role === 'assistant' && !last.error) root.querySelector('.sr-live').textContent = 'Ответ готов';
}

/* ---------- Поле ввода ---------- */
function composerHTML(placeholder = 'Опишите задачу или выберите сценарий…') {
  return `<form class="composer" data-composer>
    <label class="sr-only" for="prompt">Сообщение</label>
    <textarea id="prompt" class="composer-input" rows="1" maxlength="${MAX_MESSAGE}" placeholder="${esc(placeholder)}"></textarea>
    <button class="btn btn-primary composer-send" type="submit" data-send aria-label="Отправить">${icon('send')}</button>
    <button class="btn btn-dark composer-send" type="button" data-stop hidden aria-label="Остановить генерацию">${icon('stop')}</button>
  </form>
  <p class="composer-hint subtle">Enter — отправить, Shift+Enter — новая строка. Не вводите персональные данные клиентов.</p>`;
}

function bindComposer(root, onSend, onStop) {
  const form = root.querySelector('[data-composer]');
  const ta = form.querySelector('textarea');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 8 * 24 + 24)}px`; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    if (/\[[^\]]+\]/.test(text) && !form.dataset.confirmed) {
      form.dataset.confirmed = '1';
      toast('В запросе остались поля в [скобках] — заполните их или отправьте ещё раз как есть');
      selectPlaceholder(ta);
      return;
    }
    delete form.dataset.confirmed;
    ta.value = '';
    fit();
    onSend(text);
  });
  form.querySelector('[data-stop]').addEventListener('click', onStop);
  return { ta, fit, setText(text) { ta.value = text; fit(); ta.focus(); selectPlaceholder(ta); } };
}

function selectPlaceholder(ta) {
  const m = ta.value.match(/\[[^\]]+\]/);
  if (m) ta.setSelectionRange(m.index, m.index + m[0].length);
}

/* ---------- Новый чат ---------- */
export function renderChatHome(main, query) {
  const dir = directionById(query.dir || state.settings.lastDirection);
  main.innerHTML = `
    <div class="page chat-home">
      <header class="page-head"><div>
        <h1>О чём <span class="accent-word">подумаем</span> сегодня?</h1>
        <p class="muted">Выберите направление — ассистент переключится в режим профильного эксперта.</p>
      </div></header>
      <div data-banner></div>
      <div class="dir-picker" role="radiogroup" aria-label="Направление">
        ${DIRECTIONS.map(d => `<button type="button" role="radio" class="dir-chip" data-dir="${d.id}" data-color="${d.color}" aria-checked="${d.id === dir.id}">
          <span class="mono">${esc(d.mono)}</span><span>${esc(d.name)}</span></button>`).join('')}
      </div>
      <section class="scenarios-wrap">
        <h2 class="block-title" data-dir-title></h2>
        <div class="scenarios" data-scenarios></div>
      </section>
      <div class="composer-wrap">${composerHTML()}</div>
    </div>`;
  let current = dir;
  const scen = main.querySelector('[data-scenarios]');
  const composer = bindComposer(main, text => startChat(current.id, text), () => {});
  function show(d) {
    current = d;
    main.querySelectorAll('.dir-chip').forEach(b => b.setAttribute('aria-checked', String(b.dataset.dir === d.id)));
    main.querySelector('[data-dir-title]').innerHTML = `Сценарии: <span class="accent-word">${esc(d.name)}</span>`;
    scen.innerHTML = d.scenarios.map((s, i) => `<button type="button" class="card card-interactive scenario" data-i="${i}"><b>${esc(s.title)}</b><small>${esc(s.template)}</small></button>`).join('');
  }
  main.querySelector('.dir-picker').addEventListener('click', e => {
    const b = e.target.closest('.dir-chip');
    if (b) show(directionById(b.dataset.dir));
  });
  scen.addEventListener('click', e => {
    const b = e.target.closest('.scenario');
    if (b) composer.setText(current.scenarios[+b.dataset.i].template);
  });
  show(dir);
  if (query.s !== undefined && dir.scenarios[+query.s]) composer.setText(dir.scenarios[+query.s].template);
  renderBanner(main.querySelector('[data-banner]'));
}

export function startChat(direction, text) {
  const chat = createChat(direction);
  chat.title = text.replace(/\s+/g, ' ').slice(0, 60);
  chat.messages.push({ id: uid(), role: 'user', content: text, createdAt: now() });
  touchChat(chat);
  location.hash = `#/chat/${chat.id}`;
  generate(chat);
  return chat;
}

/* ---------- Диалог ---------- */
export function renderChat(main, chat) {
  const d = directionById(chat.direction);
  main.innerHTML = `
    <div class="chat">
      <header class="chat-head">
        <span class="mono" data-color="${d.color}" data-mono>${esc(d.mono)}</span>
        <div class="chat-head-text">
          <h1 class="chat-title">${esc(chat.title)}</h1>
          <label class="sr-only" for="chat-dir">Направление</label>
          <select id="chat-dir" class="chat-dir">${DIRECTIONS.map(x => `<option value="${x.id}"${x.id === d.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        </div>
        <button class="btn btn-icon" data-rename title="Переименовать" aria-label="Переименовать">${icon('edit')}</button>
        <button class="btn btn-icon" data-delete title="Удалить чат" aria-label="Удалить чат">${icon('trash')}</button>
      </header>
      <div data-banner></div>
      <div class="log" role="log" aria-label="Сообщения"></div>
      <p class="sr-only sr-live" aria-live="polite"></p>
      <div class="composer-wrap">${composerHTML('Напишите сообщение…')}</div>
    </div>`;
  mounted = { chat, root: main };
  const send = text => {
    chat.messages.push({ id: uid(), role: 'user', content: text, createdAt: now() });
    if (chat.title === 'Новый чат') chat.title = text.slice(0, 60);
    touchChat(chat);
    refresh(chat);
    generate(chat);
  };
  const composer = bindComposer(main, send, () => active.get(chat.id)?.controller.abort());
  if (!chat.messages.length) composer.ta.focus();

  main.querySelector('#chat-dir').addEventListener('change', e => {
    chat.direction = e.target.value;
    state.settings.lastDirection = chat.direction;
    const nd = directionById(chat.direction);
    const mono = main.querySelector('[data-mono]');
    mono.textContent = nd.mono;
    mono.style.setProperty('--dir', nd.color);
    touchChat(chat);
    toast(`Направление: ${nd.name}`);
  });
  main.querySelector('[data-rename]').addEventListener('click', () => renameChat(chat));
  main.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!(await confirmDialog('Удалить чат?', `«${chat.title}» и все сообщения будут удалены.`))) return;
    active.get(chat.id)?.controller.abort();
    deleteChat(chat.id);
    location.hash = '#/chat';
  });

  main.querySelector('.log').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.msg').dataset.id;
    const m = chat.messages.find(x => x.id === id);
    const act = btn.dataset.act;
    if (act === 'copy') navigator.clipboard.writeText(m.content).then(() => toast('Скопировано', { type: 'success' }), () => toast('Не удалось скопировать', { type: 'error' }));
    if (act === 'up' || act === 'down') { m.rating = m.rating === act ? undefined : act; save(); refresh(chat); }
    if (act === 'retry') { chat.messages = chat.messages.filter(x => x !== m); save(); generate(chat); }
    if (act === 'tasks') openStepsToTasks(chat, m);
  });

  refresh(chat);
  // Баннер и шрифты появляются позже и меняют высоту ленты — после них ещё раз прокручиваем к концу
  const toBottom = () => {
    const log = main.querySelector('.log');
    if (mounted?.chat === chat && log) log.scrollTop = log.scrollHeight;
  };
  document.fonts?.ready.then(toBottom);
  applyColors(main);
  renderBanner(main.querySelector('[data-banner]')).then(toBottom);
  return () => { if (mounted?.chat === chat) mounted = null; };
}

function renameChat(chat) {
  openModal({
    title: 'Переименовать чат',
    body: `<label class="field"><span>Название</span><input class="input" name="title" maxlength="60" value="${esc(chat.title)}" autofocus></label>`,
    footer: '<button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Сохранить</button>',
    onMount(modal, close) {
      const input = modal.querySelector('input');
      const ok = () => {
        const v = input.value.trim();
        if (!v) return input.focus();
        chat.title = v;
        touchChat(chat);
        refresh(chat);
        close();
      };
      modal.querySelector('[data-ok]').addEventListener('click', ok);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    },
  });
}

/* ---------- «В задачи» ---------- */
function openStepsToTasks(chat, message) {
  const steps = extractSteps(message.content);
  if (!steps.length) return;
  openModal({
    title: 'Добавить шаги в задачи',
    body: `
      <p class="muted">Снимите отметку с лишних пунктов. Задачи получат направление «${esc(directionById(chat.direction).name)}» и ссылку на этот чат.</p>
      <ul class="step-list">${steps.map((s, i) => `<li><label class="check"><input type="checkbox" name="s${i}" checked><span>${esc(s)}</span></label></li>`).join('')}</ul>
      <div class="form-row">
        <label class="field"><span>Приоритет</span><select class="select" name="priority"><option value="high">Высокий</option><option value="medium" selected>Средний</option><option value="low">Низкий</option></select></label>
        <label class="field"><span>Срок</span><input class="input" type="date" name="due" min="${todayISO()}"></label>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Добавить</button>',
    onMount(modal, close) {
      const ok = modal.querySelector('[data-ok]');
      const sync = () => {
        const n = steps.filter((_, i) => modal.querySelector(`[name="s${i}"]`).checked).length;
        ok.textContent = n ? `Добавить ${n}` : 'Добавить';
        ok.disabled = !n;
      };
      modal.addEventListener('change', sync);
      sync();
      ok.addEventListener('click', () => {
        const priority = modal.querySelector('[name="priority"]').value;
        const dueDate = modal.querySelector('[name="due"]').value || undefined;
        const picked = steps.filter((_, i) => modal.querySelector(`[name="s${i}"]`).checked);
        picked.slice().reverse().forEach(title => addTask({ title, direction: chat.direction, priority, dueDate, source: { chatId: chat.id, messageId: message.id } }));
        close();
        toast(`Добавлено задач: ${picked.length}`, { type: 'success', action: 'Открыть', onAction: () => { location.hash = '#/tasks'; } });
      });
    },
  });
}

export { generate };
