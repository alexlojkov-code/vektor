// Установка «Вектора» как приложения (PWA): service worker, кнопка «Установить», подсказка для iPhone,
// уведомления о пропаже и возврате связи. Подключается в приложении и на лендинге.
import { icon, openModal, toast } from './ui.js';

const DISMISS_KEY = 'pilot:install-dismissed';
let deferred = null; // событие beforeinstallprompt: Chrome, Edge, Android
const listeners = new Set();

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPhone и iPad (iPadOS представляется как Mac с сенсорным экраном): установка только через «Поделиться»
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canInstall = () => !isStandalone() && (!!deferred || isIOS());
export const onInstallChange = fn => listeners.add(fn);
const notify = () => listeners.forEach(fn => fn());

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker не зарегистрирован', err)));
  // Сеть была медленной и страница открылась из сохранённой копии, а на сервере уже новая версия
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'vektor-updated') toast('Вышла новая версия Вектора', { action: 'Обновить', onAction: () => location.reload(), duration: 15000 });
  });
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // своё приглашение вместо стандартной плашки браузера
  deferred = e;
  notify();
});
addEventListener('appinstalled', () => {
  deferred = null;
  notify();
  toast('Вектор установлен — ищите иконку на главном экране', { type: 'success' });
});
addEventListener('offline', () => toast('Нет интернета: задачи и калькулятор работают, AI-чат — когда связь вернётся'));
addEventListener('online', () => toast('Связь восстановлена', { type: 'success' }));

export async function install() {
  if (deferred) {
    const prompt = deferred;
    deferred = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    notify();
    return;
  }
  if (isIOS()) showIOSHelp();
}

function showIOSHelp() {
  const share = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  openModal({
    title: 'Установить на iPhone',
    body: `
      <ol class="install-steps">
        <li><span class="install-step-icon">${share}</span><span>Нажмите <b>«Поделиться»</b> в панели Safari — внизу экрана или рядом с адресной строкой.</span></li>
        <li><span class="install-step-icon">${icon('plus')}</span><span>Выберите <b>«На экран „Домой“»</b>. Если пункта не видно, прокрутите список вниз.</span></li>
        <li><span class="install-step-icon"><img src="/icons/icon-192.png" alt="" width="24" height="24"></span><span>Нажмите <b>«Добавить»</b> — иконка «Вектора» появится на главном экране.</span></li>
      </ol>
      <p class="subtle">Установленное приложение открывается на весь экран и работает без интернета (кроме AI-чата).</p>`,
    footer: '<button class="btn btn-primary" data-close autofocus>Понятно</button>',
  });
}

// Плашка на экране «Сегодня» показывается, пока её не закрыли
export const installHintDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };
export function dismissInstallHint() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
}
