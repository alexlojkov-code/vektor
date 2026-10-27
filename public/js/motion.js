// Анимации лендинга: появление блоков, параллакс и вращение по скроллу, наклон карточек за курсором.
// Пишем transform прямо в элемент (не через CSS-переменную родителя), обновляем не чаще кадра.
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
const narrowMQ = matchMedia('(max-width: 900px)');
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function initMotion() {
  splitTitles();
  initReveal();
  initScroll();
  initPointerEffects();
  document.documentElement.classList.add('motion-ready');
}

// Заголовки с <br> режем на строки, каждая выезжает из-под маски
function splitTitles() {
  document.querySelectorAll('[data-split]').forEach(title => {
    title.innerHTML = title.innerHTML.split(/<br\s*\/?>/i)
      .map(part => `<span class="line"><span>${part.trim()}</span></span>`).join('');
    title.querySelectorAll('.line > span').forEach((span, i) => { span.style.transitionDelay = `${i * 90}ms`; });
  });
}

function initReveal() {
  // Каскад внутри группы: 70 мс между соседями, не дольше 0,5 с на всю группу
  document.querySelectorAll('[data-stagger]').forEach(group => {
    [...group.children].filter(el => el.hasAttribute('data-reveal')).forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i, 7) * 70}ms`;
    });
  });
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target); // один раз: повторное появление мешает читать
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  document.querySelectorAll('[data-reveal], [data-split]').forEach(el => io.observe(el));
}

function initScroll() {
  const nav = document.getElementById('nav');
  const word = document.getElementById('hero-word');
  const mock = document.querySelector('#hero-mock .mock');
  const stepsWrap = document.querySelector('.steps-wrap');
  const stepsFill = document.getElementById('steps-fill');
  let mx = 0, my = 0, tx = 0, ty = 0; // положение мыши: целевое и сглаженное
  let queued = false;

  function frame() {
    queued = false;
    const y = scrollY;
    const vh = innerHeight;
    nav.classList.toggle('scrolled', y > 24);
    if (reduceMQ.matches) return;

    mx += (tx - mx) * 0.08;
    my += (ty - my) * 0.08;

    // Hero: слово уходит медленнее страницы и бледнеет, мокап выпрямляется
    if (y < vh * 1.6) {
      const p = clamp(y / (vh * 0.7), 0, 1);
      if (word) {
        word.style.transform = `translate3d(${mx * -14}px, ${y * 0.35}px, 0) scale(${1 - p * 0.06})`;
        word.style.opacity = String(1 - p * 0.85);
      }
      if (mock) mock.style.transform = `rotateX(${(1 - p) * 16}deg) scale(${0.94 + p * 0.06})`;
    }

    // Линия прогресса шагов
    if (stepsWrap && stepsFill) {
      const r = stepsWrap.getBoundingClientRect();
      const p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35), 0, 1);
      stepsFill.style.transform = narrowMQ.matches ? `scaleY(${p})` : `scaleX(${p})`;
    }

    if (Math.abs(tx - mx) > 0.0005 || Math.abs(ty - my) > 0.0005) request();
  }
  function request() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  addEventListener('pointermove', e => {
    if (!fineMQ.matches) return;
    tx = e.clientX / innerWidth - 0.5;
    ty = e.clientY / innerHeight - 0.5;
    request();
  }, { passive: true });
  reduceMQ.addEventListener('change', () => {
    if (reduceMQ.matches) {
      for (const el of [word, mock, stepsFill]) if (el) el.style.transform = '';
      if (word) word.style.opacity = '';
    }
    request();
  });
  request();
}

// Блик за курсором ([data-spot]) и лёгкий 3D-наклон ([data-tilt]) — только для мыши
function initPointerEffects() {
  if (!fineMQ.matches) return;
  document.querySelectorAll('[data-tilt], [data-spot]').forEach(card => {
    const spot = document.createElement('span');
    spot.className = 'spot';
    spot.setAttribute('aria-hidden', 'true');
    card.prepend(spot);
    const tilt = card.hasAttribute('data-tilt');
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      spot.style.setProperty('--mx', `${x * 100}%`);
      spot.style.setProperty('--my', `${y * 100}%`);
      if (tilt && !reduceMQ.matches) {
        card.style.transform = `translateY(-6px) rotateX(${(0.5 - y) * 8}deg) rotateY(${(x - 0.5) * 10}deg)`;
      }
    });
    if (tilt) card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}

// Плавная смена числа: от текущего значения к новому
export function tweenNumber(el, to, format, duration = 600) {
  if (reduceMQ.matches || !Number.isFinite(to)) { el.textContent = format(to); el._value = to; return; }
  const from = Number.isFinite(el._value) ? el._value : 0;
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const k = 1 - Math.pow(1 - t, 4);
    el._value = from + (to - from) * k;
    el.textContent = format(el._value);
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
