// Аккаунт и синхронизация: вход по почте и паролю, код восстановления, обмен данными с /api/sync.
// Данные по-прежнему живут в localStorage; при входе они объединяются с аккаунтом и дальше
// отправляются на сервер через 2 с после изменения. Версия на сервере (rev) защищает от затирания.
import { state, onChange, snapshot, replaceData, clearLocal } from './store.js';
import { mergeData } from './merge.js';
import { refreshAiStatus } from './chat.js';
import { esc, errorText, icon, openModal, toast, confirmDialog } from './ui.js';

const META_KEY = 'pilot:sync'; // { rev, dirty, email }: что это устройство знает о версии на сервере
const STATUS = {
  idle: 'Не синхронизировано', syncing: 'Синхронизация…', synced: 'Синхронизировано',
  offline: 'Нет связи — данные сохранены на устройстве', error: 'Ошибка синхронизации',
};

export const account = { enabled: false, user: null, status: 'idle', syncedAt: null };
let meta = readMeta();
let lastSynced = ''; // снимок, совпадающий с сервером: одинаковые данные повторно не отправляем
let busy = false, again = false, timer = 0, onRemote = () => {};

function readMeta() {
  try { return { rev: 0, dirty: false, email: null, ...JSON.parse(localStorage.getItem(META_KEY)) }; }
  catch { return { rev: 0, dirty: false, email: null }; }
}
function writeMeta(patch) {
  Object.assign(meta, patch);
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

const api = (path, { method = 'GET', data } = {}) => fetch(path, {
  method,
  headers: { 'content-type': 'application/json', 'x-pilot': '1' },
  ...(data && { body: JSON.stringify(data) }),
}).then(async r => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));

// Версия последней синхронизации — общий предок для трёхстороннего слияния
const base = () => (lastSynced ? JSON.parse(lastSynced) : null);
// Пока AI пишет ответ, данные не подменяем: чат держит ссылку на сообщение
const generating = () => state.chats.some(c => c.messages.some(m => m.pending));
const live = () => ({ brand: state.brand, chats: state.chats, tasks: state.tasks, settings: state.settings, deleted: state.deleted });

function setStatus(status) {
  account.status = status;
  if (status === 'synced') account.syncedAt = new Date();
  renderAccountButton();
}

// Применяет объединённые данные, если они отличаются от того, что на экране
function apply(merged) {
  const before = JSON.stringify(snapshot());
  replaceData(merged);
  if (JSON.stringify(snapshot()) !== before) onRemote();
}

/* ---------- обмен с сервером ---------- */
async function pull() {
  if (!account.user) return;
  if (busy || generating()) { again = true; return schedule(3000); }
  busy = true;
  setStatus('syncing');
  try {
    const r = await api('/api/sync');
    if (r.status === 401) return signedOut();
    if (!r.ok) return setStatus('error');
    if (r.body.rev !== meta.rev && r.body.data) {
      // На новом устройстве и без несохранённых правок главнее сервер, иначе — это устройство
      apply(mergeData(live(), r.body.data, meta.dirty ? 'local' : 'remote', base()));
    }
    lastSynced = r.body.data ? JSON.stringify(r.body.data) : '';
    writeMeta({ rev: r.body.rev, dirty: JSON.stringify(snapshot()) !== lastSynced });
    if (!meta.dirty) setStatus('synced');
  } catch {
    setStatus('offline');
  } finally {
    busy = false;
  }
  if (meta.dirty || again) { again = false; await push(); }
}

async function push() {
  if (!account.user) return;
  if (busy || generating()) { again = true; return schedule(3000); }
  busy = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = snapshot();
      const json = JSON.stringify(data);
      if (json === lastSynced) { writeMeta({ dirty: false }); return setStatus('synced'); }
      setStatus('syncing');
      const r = await api('/api/sync', { method: 'PUT', data: { baseRev: meta.rev, data } });
      if (r.ok) {
        lastSynced = json;
        writeMeta({ rev: r.body.rev, dirty: false });
        return setStatus('synced');
      }
      if (r.status === 409) { // кто-то успел раньше: объединяем и пробуем снова
        if (r.body.data) apply(mergeData(live(), r.body.data, 'local', base()));
        writeMeta({ rev: r.body.rev });
        continue;
      }
      if (r.status === 401) return signedOut();
      if (r.status === 413) toast(r.body.detail, { type: 'error' });
      return setStatus('error');
    }
    setStatus('error');
  } catch {
    setStatus('offline');
  } finally {
    busy = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule(delay = 2000) {
  clearTimeout(timer);
  timer = setTimeout(() => (meta.dirty ? push() : pull()), delay);
}

onChange(e => {
  if (e?.remote || !account.user) return;
  writeMeta({ dirty: true });
  schedule();
});
document.addEventListener('visibilitychange', () => {
  if (!account.user) return;
  if (document.visibilityState === 'hidden' && meta.dirty) { clearTimeout(timer); push(); }
  if (document.visibilityState === 'visible') pull();
});
addEventListener('online', () => account.user && pull());

function signedOut() {
  account.user = null;
  refreshAiStatus();
  // Почту оставляем: если войдёт другой человек, данные этого аккаунта не попадут в его аккаунт
  writeMeta({ rev: 0 });
  lastSynced = '';
  setStatus('idle');
  toast('Сессия завершена — войдите снова, чтобы синхронизировать данные');
}

async function signedIn(user) {
  // Данные другого аккаунта с этого устройства не смешиваем с новым
  const other = meta.email && meta.email !== user.email;
  if (other) {
    replaceData({});
    onRemote();
  }
  account.user = user;
  refreshAiStatus();
  // Тот же аккаунт после истёкшей сессии: неотправленные правки сохраняем
  writeMeta({ email: user.email, rev: 0, dirty: !other && meta.dirty });
  lastSynced = '';
  await pull();
}

/* ---------- старт ---------- */
export async function initAccount(onRemoteChange) {
  onRemote = onRemoteChange;
  document.getElementById('account-btn').addEventListener('click', openAccount);
  try {
    const r = await api('/api/account');
    account.enabled = !!r.body.enabled;
    account.user = r.body.user || null;
  } catch {
    account.enabled = false;
  }
  renderAccountButton();
  if (account.user) {
    if (meta.email !== account.user.email) await signedIn(account.user);
    else pull();
  }
}

export function renderAccountButton() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  btn.hidden = !account.enabled;
  btn.innerHTML = account.user
    ? `<span class="sync-dot" data-status="${account.status}"></span><span class="account-text"><b>${esc(account.user.email)}</b><small>${STATUS[account.status]}</small></span>`
    : `${icon('user')}<span class="account-text"><b>Войти</b><small>Синхронизация между устройствами</small></span>`;
  btn.setAttribute('aria-label', account.user ? `Аккаунт ${account.user.email}: ${STATUS[account.status]}` : 'Войти в аккаунт');
}

/* ---------- окна ---------- */
function openAccount() {
  if (account.user) openProfile();
  else openAuth('login');
}

const FORMS = {
  login: {
    title: 'Вход', submit: 'Войти',
    fields: [['email', 'Почта', 'email', 'email'], ['password', 'Пароль', 'password', 'current-password']],
  },
  register: {
    title: 'Регистрация', submit: 'Создать аккаунт',
    fields: [['email', 'Почта', 'email', 'email'], ['password', 'Пароль, минимум 8 символов', 'password', 'new-password']],
  },
  reset: {
    title: 'Новый пароль', submit: 'Сменить пароль',
    fields: [['email', 'Почта', 'email', 'email'], ['recoveryCode', 'Код восстановления', 'text', 'off'], ['password', 'Новый пароль', 'password', 'new-password']],
  },
};

function openAuth(mode) {
  const f = FORMS[mode];
  const local = state.chats.length + state.tasks.length;
  openModal({
    title: mode === 'reset' ? 'Восстановление доступа' : 'Аккаунт Вектора',
    body: `
      ${mode === 'reset' ? '<p class="muted">Введите код восстановления, который вы сохранили при регистрации.</p>' : `
      <div class="segmented auth-tabs" role="group" aria-label="Вход или регистрация">
        <button type="button" data-mode="login" aria-pressed="${mode === 'login'}">Вход</button>
        <button type="button" data-mode="register" aria-pressed="${mode === 'register'}">Регистрация</button>
      </div>`}
      <form class="auth-form" novalidate>
        ${f.fields.map(([name, label, type, ac], i) => `<label class="field"><span>${label}</span>
          <input class="input" name="${name}" type="${type}" autocomplete="${ac}"${type === 'email' ? ' inputmode="email" spellcheck="false"' : ''}${name === 'recoveryCode' ? ' placeholder="XXXX-XXXX-XXXX-XXXX" spellcheck="false"' : ''}${i === 0 ? ' autofocus' : ''} required></label>`).join('')}
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">${f.submit}</button>
        ${mode === 'login' ? '<button class="btn-link" type="button" data-mode="reset">Забыли пароль?</button>' : ''}
        ${mode === 'reset' ? '<button class="btn-link" type="button" data-mode="login">Вспомнил пароль</button>' : ''}
      </form>
      <p class="subtle">Входя или регистрируясь, вы соглашаетесь с <a href="privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a>.</p>
      <p class="subtle">${local ? `Чаты (${state.chats.length}), задачи (${state.tasks.length}) и профиль бренда с этого устройства сохранятся в аккаунте.` : 'Чаты, задачи и профиль бренда будут доступны на всех ваших устройствах.'}</p>`,
    onMount(modal, close) {
      modal.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.mode === mode) return;
        close();
        openAuth(b.dataset.mode);
      }));
      const form = modal.querySelector('form');
      const error = modal.querySelector('.form-error');
      const submit = form.querySelector('[type="submit"]');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        error.hidden = true;
        submit.disabled = true;
        submit.textContent = 'Подождите…';
        try {
          const r = await api('/api/account', { method: 'POST', data: { action: mode, ...data } });
          if (!r.ok) throw new Error(r.body.detail || 'Не получилось, попробуйте ещё раз');
          close();
          await signedIn(r.body.user);
          if (r.body.recoveryCode) showRecoveryCode(r.body.recoveryCode, mode === 'register');
          else toast('Вы вошли — данные синхронизируются', { type: 'success' });
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          submit.disabled = false;
          submit.textContent = f.submit;
        }
      });
    },
  });
}

function showRecoveryCode(code, isNew) {
  openModal({
    title: 'Сохраните код восстановления',
    body: `
      <p class="muted">${isNew ? 'Аккаунт создан.' : 'Пароль изменён, на других устройствах нужно войти заново.'} Если забудете пароль, войти можно будет только с этим кодом: писем на почту мы не отправляем.</p>
      <div class="recovery-code"><code>${esc(code)}</code>
        <button class="btn btn-soft btn-sm" type="button" data-copy>${icon('copy')}<span>Скопировать</span></button></div>
      <p class="subtle">Код одноразовый: после восстановления выдадим новый.</p>`,
    footer: '<button class="btn btn-primary" data-close autofocus>Я сохранил код</button>',
    onMount(modal) {
      modal.querySelector('[data-copy]').addEventListener('click', async e => {
        try { await navigator.clipboard.writeText(code); e.currentTarget.lastElementChild.textContent = 'Скопировано'; }
        catch { toast('Не удалось скопировать — перепишите код вручную'); }
      });
    },
  });
}

function openProfile() {
  openModal({
    title: 'Аккаунт',
    body: `
      <div class="account-card">
        <span class="account-avatar" aria-hidden="true">${esc(account.user.email[0].toUpperCase())}</span>
        <div><b>${esc(account.user.email)}</b>
          <p class="subtle" data-status>${STATUS[account.status]}${account.syncedAt && account.status === 'synced' ? ` · ${account.syncedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
      </div>
      <p class="muted">Чаты, задачи, профиль бренда и настройки синхронизируются между устройствами, где вы вошли.</p>
      <div class="account-actions">
        <button class="btn btn-soft" type="button" data-sync>${icon('retry')}<span>Синхронизировать</span></button>
        <button class="btn btn-ghost" type="button" data-logout>Выйти</button>
      </div>
      <details class="danger-zone"><summary>Удалить аккаунт</summary>
        <form class="auth-form" novalidate>
          <p class="subtle">Аккаунт и данные на сервере удалятся навсегда. На этом устройстве данные останутся.</p>
          <label class="field"><span>Пароль для подтверждения</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-ghost btn-danger" type="submit">Удалить навсегда</button>
        </form>
      </details>`,
    onMount(modal, close) {
      modal.querySelector('[data-sync]').addEventListener('click', async () => {
        await (meta.dirty ? push() : pull());
        modal.querySelector('[data-status]').textContent = STATUS[account.status];
      });
      modal.querySelector('[data-logout]').addEventListener('click', async () => {
        close();
        if (meta.dirty) await push();
        const ok = await confirmDialog('Выйти из аккаунта?', meta.dirty
          ? 'Последние изменения не успели сохраниться в аккаунте и пропадут. С этого устройства данные будут удалены.'
          : 'Данные останутся в аккаунте, а с этого устройства будут удалены.', 'Выйти');
        if (!ok) return;
        await api('/api/account', { method: 'POST', data: { action: 'logout' } }).catch(() => {});
        clearLocal();
        try { localStorage.removeItem(META_KEY); } catch {}
        location.reload();
      });
      const form = modal.querySelector('.danger-zone form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const error = form.querySelector('.form-error');
        const r = await api('/api/account', { method: 'POST', data: { action: 'delete', password: form.elements.password.value } })
          .catch(() => ({ ok: false, body: { detail: 'Нет связи с сервером' } }));
        if (!r.ok) { error.textContent = r.body.detail || 'Не получилось удалить аккаунт'; error.hidden = false; return; }
        close();
        account.user = null;
        refreshAiStatus();
        writeMeta({ rev: 0, email: null, dirty: false });
        setStatus('idle');
        toast('Аккаунт удалён. Данные на этом устройстве сохранены', { type: 'success' });
      });
    },
  });
}
