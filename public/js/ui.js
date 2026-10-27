// Общие помощники интерфейса: экранирование, иконки, тосты, модальные окна, даты.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Цвет направления задаётся через CSS-переменную после вставки разметки (без inline-style — из-за CSP).
export function applyColors(root) {
  root.querySelectorAll('[data-color]').forEach(el => el.style.setProperty('--dir', el.dataset.color));
}

const P = {
  today: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  tasks: '<path d="m4 7 2 2 4-4M4 17l2 2 4-4M14 7h6M14 17h6"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
  brand: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  retry: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  up: '<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 3 2l-1 5h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7"/>',
  down: '<path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-3-2l1-5H5.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.7 4H17"/>',
  task: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  funnel: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/* ---------- Тосты ---------- */
let toastRoot;
export function toast(message, { type = 'info', action, onAction, duration = 5000 } = {}) {
  toastRoot ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toasts' });
  toastRoot.setAttribute('role', 'status');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  toastRoot.appendChild(el);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  const arm = () => { timer = setTimeout(close, duration); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.querySelector('button')?.addEventListener('click', () => { onAction?.(); close(); });
  arm();
  return close;
}

/* ---------- Модальное окно: ловушка фокуса, Esc, клик по фону ---------- */
export function openModal({ title, body, footer, onMount, wide = false }) {
  const prev = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="btn btn-icon" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(backdrop);
  const modal = backdrop.querySelector('.modal');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    prev?.focus?.();
  };
  const focusables = () => [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  onMount?.(modal, close);
  (modal.querySelector('[autofocus]') || focusables()[1] || focusables()[0])?.focus();
  return close;
}

export function confirmDialog(title, text, okLabel = 'Удалить') {
  return new Promise(resolve => {
    let result = false;
    openModal({
      title,
      body: `<p class="muted">${esc(text)}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok autofocus>${esc(okLabel)}</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); });
        new MutationObserver((_, obs) => { if (!modal.isConnected) { obs.disconnect(); resolve(result); } })
          .observe(document.body, { childList: true });
      },
    });
  });
}

/* ---------- Даты ---------- */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function daysFromToday(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}
export function formatDue(iso) {
  const n = daysFromToday(iso);
  if (n === null) return '';
  if (n === 0) return 'Сегодня';
  if (n === 1) return 'Завтра';
  if (n === -1) return 'Вчера';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
export function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
