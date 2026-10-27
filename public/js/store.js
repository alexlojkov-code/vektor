// Хранилище в localStorage: один JSON-объект под ключом pilot:v1, запись с задержкой 300 мс.
import { toast } from './ui.js';

const KEY = 'pilot:v1';
const listeners = new Set();

const empty = () => ({
  version: 1,
  brand: { name: '', product: '', audience: '', usp: '', competitors: '', tone: '', geo: '', budget: '' },
  chats: [],
  tasks: [],
  settings: { theme: 'dark', lastDirection: 'general', tasksView: 'list' },
});

function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return empty(); }
  if (!raw) return empty();
  try {
    const data = JSON.parse(raw);
    if (data.version > 1) {
      setTimeout(() => toast('Данные сохранены более новой версией Вектора — изменения могут не сохраниться', { type: 'error' }));
      return { ...empty(), ...data, readOnly: true };
    }
    const base = empty();
    return { ...base, ...data, brand: { ...base.brand, ...data.brand }, settings: { ...base.settings, ...data.settings } };
  } catch {
    try { localStorage.setItem(`${KEY}:backup-${Date.now()}`, raw); } catch {}
    setTimeout(() => toast('Сохранённые данные повреждены: сделана резервная копия, начинаем с чистого листа', { type: 'error' }));
    return empty();
  }
}

export const state = load();
// Ответ, который генерировался в момент перезагрузки страницы, считается остановленным.
for (const chat of state.chats) {
  for (const m of chat.messages) if (m.pending) { delete m.pending; m.stopped = true; }
}

let timer = 0;
let warned = false;
function write() {
  clearTimeout(timer);
  timer = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    warned = false;
  } catch {
    if (!warned) toast('Не удалось сохранить данные в браузере', { type: 'error' });
    warned = true;
  }
}
export function save() {
  listeners.forEach(fn => fn());
  if (state.readOnly) return;
  clearTimeout(timer);
  timer = setTimeout(write, 300);
}
// Отложенная запись не должна теряться при перезагрузке или закрытии вкладки.
const flush = () => { if (timer) write(); };
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
export const onChange = fn => listeners.add(fn);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export const now = () => new Date().toISOString();

/* ---------- Чаты ---------- */
export const getChat = id => state.chats.find(c => c.id === id);
export function createChat(direction) {
  const chat = { id: uid(), title: 'Новый чат', direction, messages: [], createdAt: now(), updatedAt: now() };
  state.chats.unshift(chat);
  state.settings.lastDirection = direction;
  save();
  return chat;
}
export function touchChat(chat) {
  chat.updatedAt = now();
  state.chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  save();
}
export function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  save();
}

/* ---------- Задачи ---------- */
export function addTask(fields) {
  const task = { id: uid(), title: '', direction: 'general', status: 'todo', priority: 'medium', createdAt: now(), updatedAt: now(), ...fields };
  state.tasks.unshift(task);
  save();
  return task;
}
export function updateTask(id, patch) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  Object.assign(task, patch, { updatedAt: now() });
  save();
}
export function removeTask(id) {
  const i = state.tasks.findIndex(t => t.id === id);
  if (i < 0) return null;
  const [task] = state.tasks.splice(i, 1);
  save();
  return { task, index: i };
}
export function restoreTask({ task, index }) {
  state.tasks.splice(index, 0, task);
  save();
}
