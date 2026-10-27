// To do list: список с группами по срокам и канбан-доска, фильтры в URL, редактор задачи.
import { state, save, addTask, updateTask, removeTask, restoreTask, getChat } from './store.js';
import { esc, icon, applyColors, toast, openModal, daysFromToday, formatDue, todayISO } from './ui.js';
import { DIRECTIONS, directionById } from './directions.js';

const STATUSES = [
  { id: 'todo', name: 'К работе' },
  { id: 'doing', name: 'В работе' },
  { id: 'done', name: 'Готово' },
];
const PRIORITIES = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/* ---------- Строка задачи (используется и на экране «Сегодня») ---------- */
export function taskRow(t) {
  const d = directionById(t.direction);
  const days = daysFromToday(t.dueDate);
  const overdue = t.status !== 'done' && days !== null && days < 0;
  const hasSource = t.source && getChat(t.source.chatId);
  return `<li class="task${t.status === 'done' ? ' is-done' : ''}" data-id="${t.id}">
    <label class="task-check"><input type="checkbox" data-toggle ${t.status === 'done' ? 'checked' : ''} aria-label="Выполнено: ${esc(t.title)}"><span></span></label>
    <button class="task-body" type="button" data-edit>
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">
        <span class="dot dot-${t.priority}" title="Приоритет: ${PRIORITIES[t.priority]}"></span>
        <span class="badge badge-dir" data-color="${d.color}">${esc(d.name)}</span>
        ${t.status === 'doing' ? '<span class="badge">В работе</span>' : ''}
        ${t.dueDate ? `<span class="due${overdue ? ' overdue' : ''}">${formatDue(t.dueDate)}</span>` : ''}
      </span>
    </button>
    ${hasSource ? `<a class="btn btn-icon" href="#/chat/${t.source.chatId}" title="Открыть чат, из которого создана задача" aria-label="Открыть исходный чат">${icon('link')}</a>` : ''}
    <button class="btn btn-icon task-del" type="button" data-del title="Удалить" aria-label="Удалить задачу">${icon('trash')}</button>
  </li>`;
}

export function bindTaskRows(root, rerender) {
  applyColors(root);
  root.addEventListener('change', e => {
    const box = e.target.closest('[data-toggle]');
    if (!box) return;
    const id = box.closest('[data-id]').dataset.id;
    updateTask(id, { status: box.checked ? 'done' : 'todo' });
    rerender();
  });
  root.addEventListener('click', e => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const task = state.tasks.find(t => t.id === row.dataset.id);
    if (e.target.closest('[data-edit]')) openTaskEditor(task, rerender);
    if (e.target.closest('[data-del]')) deleteWithUndo(task.id, rerender);
  });
}

function deleteWithUndo(id, rerender) {
  const removed = removeTask(id);
  if (!removed) return;
  rerender();
  toast('Задача удалена', { action: 'Отменить', onAction: () => { restoreTask(removed); rerender(); } });
}

/* ---------- Редактор ---------- */
export function openTaskEditor(task, onSave, defaults = {}) {
  const t = task || { title: '', description: '', direction: defaults.direction || 'general', status: 'todo', priority: 'medium', dueDate: defaults.dueDate };
  openModal({
    title: task ? 'Задача' : 'Новая задача',
    body: `
      <label class="field"><span>Название</span><input class="input" name="title" maxlength="200" value="${esc(t.title)}" autofocus required></label>
      <label class="field"><span>Описание</span><textarea class="textarea" name="description" maxlength="2000">${esc(t.description || '')}</textarea></label>
      <div class="form-row">
        <label class="field"><span>Направление</span><select class="select" name="direction">${DIRECTIONS.map(d => `<option value="${d.id}"${d.id === t.direction ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Статус</span><select class="select" name="status">${STATUSES.map(s => `<option value="${s.id}"${s.id === t.status ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Приоритет</span><select class="select" name="priority">${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}"${k === t.priority ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Срок</span><input class="input" type="date" name="dueDate" value="${t.dueDate || ''}"></label>
      </div>
      <p class="field-error" data-error hidden>Введите название задачи</p>`,
    footer: `${task ? `<button class="btn btn-ghost" data-remove>${icon('trash')}<span>Удалить</span></button><span class="spacer"></span>` : ''}
      <button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${task ? 'Сохранить' : 'Создать'}</button>`,
    onMount(modal, close) {
      const f = name => modal.querySelector(`[name="${name}"]`);
      const ok = () => {
        const title = f('title').value.trim();
        if (!title) { modal.querySelector('[data-error]').hidden = false; f('title').focus(); return; }
        const fields = {
          title, description: f('description').value.trim() || undefined, direction: f('direction').value,
          status: f('status').value, priority: f('priority').value, dueDate: f('dueDate').value || undefined,
        };
        if (task) updateTask(task.id, fields); else addTask(fields);
        close();
        onSave();
      };
      modal.querySelector('[data-ok]').addEventListener('click', ok);
      f('title').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      modal.querySelector('[data-remove]')?.addEventListener('click', () => { close(); deleteWithUndo(task.id, onSave); });
    },
  });
}

/* ---------- Фильтры ---------- */
function bucket(t) {
  if (t.status === 'done') return 'done';
  const n = daysFromToday(t.dueDate);
  if (n === null) return 'none';
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 7) return 'week';
  return 'later';
}
const BUCKETS = [
  ['overdue', 'Просрочено'], ['today', 'Сегодня'], ['week', 'На неделе'], ['later', 'Позже'], ['none', 'Без срока'], ['done', 'Выполнено'],
];

function filtered(f) {
  const q = (f.q || '').trim().toLowerCase();
  return state.tasks.filter(t => {
    if (f.dir && t.direction !== f.dir) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.due === 'overdue' && bucket(t) !== 'overdue') return false;
    if (f.due === 'today' && !['overdue', 'today'].includes(bucket(t))) return false;
    if (f.due === 'week' && !['overdue', 'today', 'week'].includes(bucket(t))) return false;
    if (q && !`${t.title} ${t.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
const sortTasks = list => list.slice().sort((a, b) =>
  (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

/* ---------- Экран ---------- */
export function renderTasks(main, query) {
  const f = { dir: query.dir || '', status: query.status || '', due: query.due || '', q: query.q || '' };
  const view = () => state.settings.tasksView || 'list';
  main.innerHTML = `
    <div class="page page-wide">
      <header class="page-head">
        <div><h1>Задачи <span class="accent-word">маркетолога</span></h1><p class="muted" data-count></p></div>
        <div class="segmented" role="group" aria-label="Вид">
          <button type="button" data-view="list">Список</button><button type="button" data-view="board">Доска</button>
        </div>
      </header>
      <form class="quick-add card" data-quick>
        <label class="sr-only" for="quick-title">Новая задача</label>
        <input id="quick-title" class="input" maxlength="200" placeholder="Новая задача — Enter, чтобы добавить" autocomplete="off">
        <button class="btn btn-primary" type="submit">${icon('plus')}<span>Добавить</span></button>
      </form>
      <div class="filters">
        <label class="search"><span class="sr-only">Поиск</span>${icon('search')}<input class="input" type="search" data-f="q" placeholder="Поиск" value="${esc(f.q)}"></label>
        <label><span class="sr-only">Направление</span><select class="select" data-f="dir"><option value="">Все направления</option>${DIRECTIONS.map(d => `<option value="${d.id}"${d.id === f.dir ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        <label><span class="sr-only">Статус</span><select class="select" data-f="status"><option value="">Любой статус</option>${STATUSES.map(s => `<option value="${s.id}"${s.id === f.status ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
        <label><span class="sr-only">Срок</span><select class="select" data-f="due">
          <option value="">Любой срок</option><option value="overdue"${f.due === 'overdue' ? ' selected' : ''}>Просрочено</option>
          <option value="today"${f.due === 'today' ? ' selected' : ''}>На сегодня</option><option value="week"${f.due === 'week' ? ' selected' : ''}>На неделю</option></select></label>
      </div>
      <div data-content></div>
    </div>`;

  const content = main.querySelector('[data-content]');
  const draw = () => {
    const list = sortTasks(filtered(f));
    const open = state.tasks.filter(t => t.status !== 'done').length;
    main.querySelector('[data-count]').textContent = state.tasks.length ? `Открыто ${open} из ${state.tasks.length}` : 'Добавьте первую задачу или создайте их из ответа AI';
    main.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view())));
    if (!state.tasks.length) {
      content.innerHTML = `<div class="empty card"><h2>Пока пусто</h2><p class="muted">Попросите AI составить план — шаги из ответа можно отправить сюда одной кнопкой.</p><a class="btn btn-soft" href="#/chat">${icon('sparkle')}<span>Открыть AI-чат</span></a></div>`;
      return;
    }
    if (view() === 'board') content.innerHTML = boardHTML(list);
    else {
      const groups = BUCKETS.map(([id, name]) => [name, list.filter(t => bucket(t) === id), id]).filter(([, items]) => items.length);
      content.innerHTML = groups.length
        ? groups.map(([name, items, id]) => `<section class="task-group"><h2 class="group-title${id === 'overdue' ? ' overdue' : ''}">${name} <span>${items.length}</span></h2><ul class="task-list">${items.map(taskRow).join('')}</ul></section>`).join('')
        : '<div class="empty card"><p class="muted">Нет задач по выбранным фильтрам.</p></div>';
    }
    applyColors(content);
  };

  bindTaskRows(content, draw);
  content.addEventListener('change', e => {
    const sel = e.target.closest('[data-move]');
    if (!sel) return;
    updateTask(sel.closest('[data-id]').dataset.id, { status: sel.value });
    draw();
  });
  const stopDrag = enableBoardDrag(content, (id, status) => { updateTask(id, { status }); draw(); });

  main.querySelector('.segmented').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.settings.tasksView = b.dataset.view;
    save();
    draw();
  });
  const syncUrl = () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/tasks${qs ? `?${qs}` : ''}`);
  };
  main.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => { f[el.dataset.f] = el.value; syncUrl(); draw(); }));
  main.querySelector('[data-quick]').addEventListener('submit', e => {
    e.preventDefault();
    const input = main.querySelector('#quick-title');
    const title = input.value.trim();
    if (!title) return;
    addTask({ title, direction: f.dir || 'general', status: f.status || 'todo', dueDate: f.due === 'today' ? todayISO() : undefined });
    input.value = '';
    draw();
  });
  draw();
  return stopDrag;
}

function boardHTML(list) {
  return `<div class="board">${STATUSES.map(s => {
    const items = list.filter(t => t.status === s.id);
    return `<section class="column" data-status="${s.id}" aria-label="${s.name}">
      <h2 class="group-title">${s.name} <span>${items.length}</span></h2>
      <ul class="cards">${items.map(t => {
        const d = directionById(t.direction);
        const days = daysFromToday(t.dueDate);
        return `<li class="kcard" data-id="${t.id}">
          <button type="button" class="kcard-title" data-edit>${esc(t.title)}</button>
          <div class="task-meta">
            <span class="dot dot-${t.priority}" title="Приоритет: ${PRIORITIES[t.priority]}"></span>
            <span class="badge badge-dir" data-color="${d.color}">${esc(d.name)}</span>
            ${t.dueDate ? `<span class="due${t.status !== 'done' && days < 0 ? ' overdue' : ''}">${formatDue(t.dueDate)}</span>` : ''}
          </div>
          <label class="kcard-move"><span class="sr-only">Переместить в</span>
            <select class="select" data-move>${STATUSES.map(x => `<option value="${x.id}"${x.id === t.status ? ' selected' : ''}>${x.name}</option>`).join('')}</select></label>
        </li>`;
      }).join('') || '<li class="column-empty subtle">Перетащите сюда</li>'}</ul>
    </section>`;
  }).join('')}</div>`;
}

/* Перетаскивание карточек на доске через Pointer Events: мышью — сразу, пальцем — после удержания 350 мс. */
function enableBoardDrag(root, onDrop) {
  let drag = null;
  let pressTimer = 0;
  const DRAG_FROM = 6;

  const columnAt = (x, y) => document.elementFromPoint(x, y)?.closest('.column');
  const start = (card, e) => {
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('kcard-ghost');
    ghost.style.width = `${r.width}px`;
    document.body.appendChild(ghost);
    card.classList.add('kcard-placeholder');
    drag.ghost = ghost;
    drag.dx = e.clientX - r.left;
    drag.dy = e.clientY - r.top;
    move(e);
  };
  const move = e => {
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) rotate(2deg)`;
    const col = columnAt(e.clientX, e.clientY);
    root.querySelectorAll('.column').forEach(c => c.classList.toggle('drop-target', c === col));
  };
  const end = e => {
    clearTimeout(pressTimer);
    if (!drag) return;
    const { card, ghost } = drag;
    drag = null;
    if (!ghost) return;
    ghost.remove();
    card.classList.remove('kcard-placeholder');
    root.querySelectorAll('.column').forEach(c => c.classList.remove('drop-target'));
    const col = e.type === 'pointerup' ? columnAt(e.clientX, e.clientY) : null;
    if (col && col.dataset.status !== card.closest('.column').dataset.status) onDrop(card.dataset.id, col.dataset.status);
  };

  const onDown = e => {
    const card = e.target.closest('.kcard');
    if (!card || e.button > 0 || e.target.closest('select, a')) return;
    drag = { card, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', armed: e.pointerType === 'mouse' };
    if (drag.touch) pressTimer = setTimeout(() => { if (drag) { drag.armed = true; navigator.vibrate?.(10); start(card, { clientX: drag.x, clientY: drag.y }); } }, 350);
  };
  const onMove = e => {
    if (!drag) return;
    if (drag.ghost) { e.preventDefault(); move(e); return; }
    const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_FROM;
    if (!far) return;
    if (drag.armed) start(drag.card, e);
    else { clearTimeout(pressTimer); drag = null; } // палец сдвинулся раньше удержания — это прокрутка
  };
  const onTouchMove = e => { if (drag?.ghost) e.preventDefault(); };
  const onClick = e => { if (e.target.closest('.kcard') && root.dataset.justDragged) { e.stopPropagation(); e.preventDefault(); } };
  const onUp = e => {
    if (drag?.ghost) { root.dataset.justDragged = '1'; setTimeout(() => delete root.dataset.justDragged, 0); }
    end(e);
  };

  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', end);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('touchmove', onTouchMove);
  };
}
