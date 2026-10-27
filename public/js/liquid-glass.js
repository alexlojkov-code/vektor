// Liquid Glass: преломление у кромок (SVG-фильтр в backdrop-filter, только Chromium) и блик за курсором.
// Слой съёмный: без этого файла стекло остаётся матовым (размытие из liquid-glass.css).
const SURFACES = '.nav, .sidebar, .topbar, .tabbar, .composer, .modal, .toast, .segmented, .btn-ghost';
// Преломление дорогое — только у крупных панелей
const REFRACT = '.nav, .sidebar, .tabbar, .topbar, .composer, .modal';
const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const chromium = !!navigator.userAgentData?.brands?.some(b => /Chromium/.test(b.brand));

if (document.documentElement.hasAttribute('data-glass')) {
  initSheen();
  if (chromium) initRefraction();
}

// Блик следует за курсором: пишем координаты в саму панель
function initSheen() {
  let target = null;
  addEventListener('pointermove', e => {
    if (!finePointer.matches || reduceMotion.matches) return;
    const el = e.target.closest?.(SURFACES);
    if (target && target !== el) { target.style.removeProperty('--lg-x'); target.style.removeProperty('--lg-y'); }
    target = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`);
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// Карта смещений: у левой/верхней кромки фон «тянется» внутрь, в центре — без искажений.
// Красный канал — смещение по X, зелёный — по Y, 128 — ноль.
function displacementMap(w, h, band) {
  const bx = Math.min(band / w, 0.45), by = Math.min(band / h, 0.45);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="x" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#ff0000"/><stop offset="${bx}" stop-color="#800000"/>
        <stop offset="${1 - bx}" stop-color="#800000"/><stop offset="1" stop-color="#000000"/>
      </linearGradient>
      <linearGradient id="y" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#00ff00"/><stop offset="${by}" stop-color="#008000"/>
        <stop offset="${1 - by}" stop-color="#008000"/><stop offset="1" stop-color="#000000"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#x)"/>
    <rect width="100%" height="100%" fill="url(#y)" style="mix-blend-mode:screen"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function initRefraction() {
  const NS = 'http://www.w3.org/2000/svg';
  const host = document.createElementNS(NS, 'svg');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.style.position = 'absolute';
  document.body.appendChild(host);
  const state = new WeakMap();
  let seq = 0;

  const resize = new ResizeObserver(entries => entries.forEach(e => update(e.target)));

  const live = new Set();
  function setup(el) {
    if (state.has(el)) return;
    // Экран перерисован — убираем фильтры исчезнувших панелей
    for (const old of live) {
      if (old.isConnected) continue;
      state.get(old).filter.remove();
      resize.unobserve(old);
      live.delete(old);
    }
    live.add(el);
    const id = `lg-refract-${++seq}`;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%'); filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.innerHTML = `<feImage result="map" preserveAspectRatio="none"/>
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G"/>`;
    host.appendChild(filter);
    state.set(el, { id, filter });
    update(el);
    resize.observe(el);
  }

  function update(el) {
    const s = state.get(el);
    if (!s) return;
    const w = Math.max(1, Math.round(el.offsetWidth)), h = Math.max(1, Math.round(el.offsetHeight));
    if (s.w === w && s.h === h) return;
    s.w = w; s.h = h;
    const img = s.filter.querySelector('feImage');
    img.setAttribute('href', displacementMap(w, h, 22));
    img.setAttribute('width', w); img.setAttribute('height', h);
    s.filter.querySelector('feDisplacementMap').setAttribute('scale', String(Math.min(48, Math.max(18, h * 0.5))));
    apply(el);
  }

  function apply(el) {
    const s = state.get(el);
    if (!s) return;
    if (reduceTransparency.matches) { el.style.removeProperty('backdrop-filter'); return; }
    const thick = el.matches('.sidebar, .modal');
    el.style.backdropFilter = `url(#${s.id}) blur(${thick ? 30 : 16}px) saturate(1.6) brightness(1.04)`;
  }

  const scan = root => {
    if (root.nodeType !== 1) return;
    if (root.matches(REFRACT)) setup(root);
    root.querySelectorAll(REFRACT).forEach(setup);
  };
  scan(document.body);
  // Модальные окна, поле ввода и панели появляются при смене экрана
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(scan)))
    .observe(document.body, { childList: true, subtree: true });
  reduceTransparency.addEventListener('change', () => document.querySelectorAll(REFRACT).forEach(apply));
}
