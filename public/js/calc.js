// Калькулятор метрик: каталог с поиском, экран метрики, калькулятор воронки, «Разобрать с AI».
import { esc, icon } from './ui.js';
import { GROUPS, METRICS, metricById, searchMetrics, parseNum, fmt, FUNNEL_INPUTS, FUNNEL_BENCHMARKS, computeFunnel } from './metrics.js';
import { startChat } from './chat.js';

const lastInputs = {}; // значения полей живут до перезагрузки страницы

const fmtInput = n => (n === null || n === undefined ? '' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(n));

/* ---------- Каталог ---------- */
export function renderCalcCatalog(main, query) {
  main.innerHTML = `
    <div class="page page-wide">
      <header class="page-head"><div>
        <h1>Калькулятор <span class="accent-word">метрик</span></h1>
        <p class="muted">${METRICS.length} метрик с формулами, ориентирами и разбором от AI.</p>
      </div></header>
      <a class="card card-gradient card-interactive funnel-promo" href="#/calc/funnel">
        <div>${icon('funnel')}<h2>Калькулятор <span class="accent-word">воронки</span></h2>
        <p class="muted">Бюджет → показы → клики → лиды → продажи → выручка. Покажет ROMI, ДРР и узкое место.</p></div>
        <span class="btn btn-dark">Открыть</span>
      </a>
      <label class="search search-lg"><span class="sr-only">Поиск метрики</span>${icon('search')}
        <input class="input" type="search" id="metric-search" placeholder="Найти метрику: ROMI, ДРР, отток, вовлечённость…" value="${esc(query.q || '')}" autocomplete="off"></label>
      <div data-list></div>
    </div>`;
  const list = main.querySelector('[data-list]');
  const input = main.querySelector('#metric-search');
  const draw = () => {
    const found = new Set(searchMetrics(input.value).map(m => m.id));
    const html = GROUPS.map(g => {
      const items = METRICS.filter(m => m.group === g.id && found.has(m.id));
      if (!items.length) return '';
      return `<section class="metric-group"><h2 class="group-title">${g.name} <span>${items.length}</span></h2>
        <div class="metric-grid">${items.map(m => `<a class="card card-interactive metric-card" href="#/calc/${m.id}">
          <b>${esc(m.name)}</b><span>${esc(m.full)}</span><code>${esc(m.formula)}</code></a>`).join('')}</div></section>`;
    }).join('');
    list.innerHTML = html || `<div class="empty card"><p class="muted">Ничего не нашлось по запросу «${esc(input.value)}».</p></div>`;
  };
  input.addEventListener('input', () => {
    history.replaceState(null, '', `#/calc${input.value ? `?q=${encodeURIComponent(input.value)}` : ''}`);
    draw();
  });
  draw();
}

/* ---------- Экран метрики ---------- */
export function renderMetric(main, id) {
  const m = metricById(id);
  if (!m) { location.hash = '#/calc'; return; }
  const values = lastInputs[id] ||= {};
  const group = GROUPS.find(g => g.id === m.group);
  const related = METRICS.filter(x => x.group === m.group && x.id !== m.id).slice(0, 4);
  main.innerHTML = `
    <div class="page">
      <a class="back" href="#/calc">${icon('back')}<span>Все метрики</span></a>
      <header class="page-head"><div>
        <p class="subtle">${esc(group.name)}</p>
        <h1>${esc(m.name)} <span class="accent-word">${esc(m.full !== m.name ? m.full.toLowerCase() : '')}</span></h1>
        <p class="muted metric-about">${esc(m.about)}</p>
      </div></header>
      <div class="calc-layout">
        <form class="card calc-form" novalidate>
          ${m.inputs.map(i => `<label class="field"><span>${esc(i.label)}${i.unit ? `, ${i.unit}` : ''}</span>
            <input class="input" name="${i.key}" inputmode="decimal" autocomplete="off" value="${fmtInput(values[i.key])}">
            ${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</label>`).join('')}
          <button type="reset" class="btn btn-ghost btn-sm">Очистить</button>
        </form>
        <div class="result-col">
          <section class="card result" data-result aria-live="polite"></section>
          <section class="card formula"><p class="subtle">Формула</p><code>${esc(m.formula)}</code></section>
          <button type="button" class="btn btn-soft" data-ai disabled>${icon('sparkle')}<span>Разобрать с AI</span></button>
        </div>
      </div>
      ${related.length ? `<section><h2 class="block-title">Ещё в разделе <span class="accent-word">${esc(group.name.toLowerCase())}</span></h2>
        <div class="metric-grid">${related.map(x => `<a class="card card-interactive metric-card" href="#/calc/${x.id}"><b>${esc(x.name)}</b><span>${esc(x.full)}</span></a>`).join('')}</div></section>` : ''}
    </div>`;

  const form = main.querySelector('.calc-form');
  const result = main.querySelector('[data-result]');
  const aiBtn = main.querySelector('[data-ai]');
  let current = null;
  const update = () => {
    for (const i of m.inputs) values[i.key] = parseNum(form.elements[i.key].value);
    const r = m.compute(values);
    const a = r === null ? null : m.assess?.(r, values);
    current = r;
    const missing = m.inputs.filter(i => values[i.key] === null && !i.hint).map(i => i.label.toLowerCase());
    const zero = !missing.length && r === null;
    result.className = `card result${a ? ` result-${a.level}` : ''}`;
    result.innerHTML = `
      <p class="subtle">${esc(m.name)}</p>
      <strong class="result-value">${r === null ? '—' : (m.id.match(/^(roi|romi|growth)$/) && r > 0 ? '+' : '') + fmt(r, m.unit)}</strong>
      ${r === null
        ? `<p class="muted">${zero ? 'Знаменатель не может быть равен 0.' : `Заполните: ${esc(missing.join(', '))}.`}</p>`
        : a ? `<p class="assess"><span class="level">${{ good: 'Хорошо', ok: 'Норма', bad: 'Внимание' }[a.level]}</span>${esc(a.text)}</p><p class="subtle">Ориентир, зависит от ниши.</p>` : ''}`;
    aiBtn.disabled = r === null;
  };
  form.addEventListener('input', update);
  form.addEventListener('reset', () => setTimeout(update));
  form.addEventListener('submit', e => e.preventDefault());
  aiBtn.addEventListener('click', () => {
    const parts = m.inputs.filter(i => values[i.key] !== null).map(i => `${i.label.toLowerCase()} ${fmt(values[i.key], i.unit === 'шт' ? '' : i.unit)}`);
    startChat('research', `Разбери расчёт метрики «${m.name}» (${m.full}): ${parts.join(', ')} → ${m.name} ${fmt(current, m.unit)}.\nОбъясни, что это значит для бизнеса, назови вероятные причины и предложи 5 конкретных шагов для улучшения.`);
  });
  update();
}

/* ---------- Калькулятор воронки ---------- */
const FUNNEL_DEFAULTS = { budget: 100000, cpm: 200, ctr: 1, cr1: 5, cr2: 20, aov: 5000, margin: 50 };

export function renderFunnel(main) {
  const values = lastInputs.funnel ||= { ...FUNNEL_DEFAULTS };
  main.innerHTML = `
    <div class="page page-wide">
      <a class="back" href="#/calc">${icon('back')}<span>Все метрики</span></a>
      <header class="page-head"><div>
        <h1>Калькулятор <span class="accent-word">воронки</span></h1>
        <p class="muted">Сколько продаж и прибыли принесёт рекламный бюджет и где воронка теряет больше всего.</p>
      </div></header>
      <div class="funnel-layout">
        <form class="card calc-form" novalidate>
          ${FUNNEL_INPUTS.map(i => `<label class="field"><span>${esc(i.label)}, ${i.unit}</span>
            <input class="input" name="${i.key}" inputmode="decimal" autocomplete="off" value="${fmtInput(values[i.key])}">
            ${FUNNEL_BENCHMARKS[i.key] ? `<small>Ориентир: ${fmt(FUNNEL_BENCHMARKS[i.key], '%')}</small>` : ''}</label>`).join('')}
        </form>
        <div class="funnel-out" aria-live="polite">
          <section class="card" data-stages></section>
          <div class="kpi-grid" data-kpis></div>
          <button type="button" class="btn btn-soft" data-ai>${icon('sparkle')}<span>Разобрать воронку с AI</span></button>
        </div>
      </div>
    </div>`;
  const form = main.querySelector('.calc-form');
  const stages = main.querySelector('[data-stages]');
  const kpis = main.querySelector('[data-kpis]');
  const aiBtn = main.querySelector('[data-ai]');
  let res = null;

  const update = () => {
    for (const i of FUNNEL_INPUTS) values[i.key] = parseNum(form.elements[i.key].value);
    res = computeFunnel(values);
    aiBtn.disabled = !res;
    if (!res) {
      stages.innerHTML = '<p class="muted">Заполните все поля: бюджет и CPM должны быть больше нуля.</p>';
      kpis.innerHTML = '';
      return;
    }
    const rows = [
      ['Показы', res.impressions, ''], ['Клики', res.clicks, 'ctr'], ['Лиды', res.leads, 'cr1'], ['Продажи', res.sales, 'cr2'],
    ];
    const max = Math.log10(Math.max(res.impressions, 10));
    stages.innerHTML = `<h2 class="block-title-sm">Воронка</h2><ol class="funnel">${rows.map(([name, n, key]) => {
      const w = Math.max(14, Math.log10(Math.max(n, 1)) / max * 100);
      const weak = res.bottleneck?.key === key;
      return `<li class="${weak ? 'weak' : ''}"><span class="bar" data-w="${w}"><b>${fmt(n)}</b></span>
        <span class="stage-name">${name}${key ? ` · ${fmt(values[key], '%')}` : ''}${weak ? ' · узкое место' : ''}</span></li>`;
    }).join('')}
      <li class="revenue"><span class="bar" data-w="100"><b>${fmt(res.revenue, '₽')}</b></span><span class="stage-name">Выручка</span></li></ol>
      ${res.bottleneck ? `<p class="bottleneck">${icon('sparkle')}<span><b>Узкое место — ${esc(res.bottleneck.name.toLowerCase())}</b>: ${fmt(res.bottleneck.value, '%')} при ориентире ${fmt(res.bottleneck.benchmark, '%')}. Улучшение этого этапа даст самый большой прирост продаж.</span></p>`
        : '<p class="subtle">Все этапы на уровне ориентиров или выше.</p>'}`;
    stages.querySelectorAll('.bar[data-w]').forEach(b => { b.style.width = `${b.dataset.w}%`; });
    const romiLevel = res.romi > 0 ? 'good' : res.romi === 0 ? 'ok' : 'bad';
    const drrLevel = res.drr === null ? '' : res.drr < values.margin ? 'good' : 'bad';
    kpis.innerHTML = [
      ['ROMI', (res.romi > 0 ? '+' : '') + fmt(res.romi, '%'), romiLevel],
      ['Прибыль', fmt(res.profit, '₽'), res.profit >= 0 ? 'good' : 'bad'],
      ['ДРР', fmt(res.drr, '%'), drrLevel],
      ['CPC', fmt(res.cpc, '₽'), ''], ['CPL', fmt(res.cpl, '₽'), ''], ['CPA', fmt(res.cpa, '₽'), ''],
    ].map(([k, v, l]) => `<div class="card kpi${l ? ` kpi-${l}` : ''}"><small>${k}</small><strong>${v}</strong></div>`).join('');
  };
  form.addEventListener('input', update);
  form.addEventListener('submit', e => e.preventDefault());
  aiBtn.addEventListener('click', () => {
    if (!res) return;
    const v = values;
    startChat('research', `Разбери мою рекламную воронку.
Вводные: бюджет ${fmt(v.budget, '₽')}, CPM ${fmt(v.cpm, '₽')}, CTR ${fmt(v.ctr, '%')}, конверсия в лид ${fmt(v.cr1, '%')}, конверсия лида в продажу ${fmt(v.cr2, '%')}, средний чек ${fmt(v.aov, '₽')}, маржинальность ${fmt(v.margin, '%')}.
Результат: ${fmt(res.impressions)} показов → ${fmt(res.clicks)} кликов → ${fmt(res.leads)} лидов → ${fmt(res.sales)} продаж, выручка ${fmt(res.revenue, '₽')}, прибыль ${fmt(res.profit, '₽')}, ROMI ${fmt(res.romi, '%')}, ДРР ${fmt(res.drr, '%')}, CPA ${fmt(res.cpa, '₽')}.
${res.bottleneck ? `Узкое место по ориентирам: ${res.bottleneck.name.toLowerCase()} (${fmt(res.bottleneck.value, '%')} при ориентире ${fmt(res.bottleneck.benchmark, '%')}).` : 'Все этапы на уровне ориентиров.'}
Объясни, что это значит, и предложи 5 конкретных шагов для роста ROMI.`);
  });
  update();
}
