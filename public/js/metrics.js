// Формулы маркетинговых метрик. Чистые функции без DOM — тестируются в Node (tests/metrics.test.mjs).
// compute() возвращает null, если данных не хватает или знаменатель равен нулю.

export const GROUPS = [
  { id: 'ads', name: 'Реклама' },
  { id: 'funnel', name: 'Воронка и продажи' },
  { id: 'roi', name: 'Окупаемость' },
  { id: 'unit', name: 'Клиенты и юнит-экономика' },
  { id: 'social', name: 'Соцсети и контент' },
  { id: 'email', name: 'Email' },
  { id: 'loyalty', name: 'Лояльность' },
];

const has = (...xs) => xs.every(x => typeof x === 'number' && Number.isFinite(x));
const div = (a, b) => (has(a, b) && b !== 0 ? a / b : null);
const pct = (a, b) => { const r = div(a, b); return r === null ? null : r * 100; };

const level = (good, ok) => (good ? 'good' : ok ? 'ok' : 'bad');
const scale = (r, goodFrom, okFrom, texts) => {
  const l = r >= goodFrom ? 'good' : r >= okFrom ? 'ok' : 'bad';
  return { level: l, text: texts[l] };
};

const I = (key, label, unit, hint) => ({ key, label, unit, ...(hint && { hint }) });

export const METRICS = [
  /* ---------- Реклама ---------- */
  {
    id: 'ctr', name: 'CTR', full: 'Кликабельность', group: 'ads', unit: '%',
    aliases: ['ктр', 'click-through rate', 'кликабельность'],
    inputs: [I('impressions', 'Показы', 'шт'), I('clicks', 'Клики', 'шт')],
    formula: 'Клики / Показы × 100 %',
    about: 'Какая доля увидевших объявление кликнула по нему. Показывает, насколько креатив и оффер цепляют аудиторию.',
    compute: v => pct(v.clicks, v.impressions),
    assess: r => scale(r, 2, 0.5, {
      good: 'Хороший CTR для медийной и таргетированной рекламы.',
      ok: 'Средний уровень. Протестируйте новые креативы и заголовки.',
      bad: 'Низкий CTR: креатив или таргетинг не попадают в аудиторию.',
    }),
  },
  {
    id: 'cpc', name: 'CPC', full: 'Цена клика', group: 'ads', unit: '₽',
    aliases: ['цена клика', 'cost per click', 'стоимость клика'],
    inputs: [I('spend', 'Расход', '₽'), I('clicks', 'Клики', 'шт')],
    formula: 'Расход / Клики',
    about: 'Сколько в среднем стоит один переход на сайт.',
    compute: v => div(v.spend, v.clicks),
  },
  {
    id: 'cpm', name: 'CPM', full: 'Цена 1000 показов', group: 'ads', unit: '₽',
    aliases: ['цена тысячи показов', 'cost per mille'],
    inputs: [I('spend', 'Расход', '₽'), I('impressions', 'Показы', 'шт')],
    formula: 'Расход / Показы × 1000',
    about: 'Стоимость тысячи показов. Основная метрика охватных кампаний.',
    compute: v => { const r = div(v.spend, v.impressions); return r === null ? null : r * 1000; },
  },
  {
    id: 'cpv', name: 'CPV', full: 'Цена просмотра', group: 'ads', unit: '₽',
    aliases: ['цена просмотра', 'cost per view', 'видео'],
    inputs: [I('spend', 'Расход', '₽'), I('views', 'Просмотры', 'шт')],
    formula: 'Расход / Просмотры',
    about: 'Сколько стоит один просмотр видео или интеграции.',
    compute: v => div(v.spend, v.views),
  },
  {
    id: 'cpa', name: 'CPA', full: 'Цена целевого действия', group: 'ads', unit: '₽',
    aliases: ['цена действия', 'cost per action', 'cpo', 'цена заказа'],
    inputs: [I('spend', 'Расход', '₽'), I('actions', 'Целевые действия', 'шт'), I('aov', 'Средний чек', '₽', 'необязательно — для сравнения с допустимым CPA'), I('margin', 'Маржинальность', '%', 'необязательно')],
    formula: 'Расход / Целевые действия',
    about: 'Сколько стоит одно целевое действие: заказ, регистрация, звонок.',
    compute: v => div(v.spend, v.actions),
    assess: (r, v) => {
      if (!has(v.aov, v.margin)) return null;
      const max = v.aov * v.margin / 100;
      return { level: level(r <= max * 0.7, r <= max), text: `Допустимый CPA при таком чеке и марже — ${fmt(max, '₽')}. ${r <= max ? 'Заказ окупается.' : 'Каждый заказ убыточен.'}` };
    },
  },
  {
    id: 'cpl', name: 'CPL', full: 'Цена лида', group: 'ads', unit: '₽',
    aliases: ['цена лида', 'cost per lead', 'стоимость заявки'],
    inputs: [I('spend', 'Расход', '₽'), I('leads', 'Лиды', 'шт')],
    formula: 'Расход / Лиды',
    about: 'Сколько стоит одна заявка или контакт потенциального клиента.',
    compute: v => div(v.spend, v.leads),
  },
  {
    id: 'frequency', name: 'Частота', full: 'Частота показов', group: 'ads', unit: 'x',
    aliases: ['frequency', 'частота контакта'],
    inputs: [I('impressions', 'Показы', 'шт'), I('reach', 'Охват', 'шт')],
    formula: 'Показы / Охват',
    about: 'Сколько раз в среднем один человек увидел рекламу.',
    compute: v => div(v.impressions, v.reach),
    assess: r => r > 6
      ? { level: 'bad', text: 'Высокая частота: аудитория «выгорает», обновите креативы или расширьте охват.' }
      : r >= 2 ? { level: 'good', text: 'Оптимальная частота для запоминания.' }
        : { level: 'ok', text: 'Низкая частота: сообщение могут не запомнить.' },
  },

  /* ---------- Воронка и продажи ---------- */
  {
    id: 'cr', name: 'CR', full: 'Конверсия', group: 'funnel', unit: '%',
    aliases: ['конверсия', 'conversion rate', 'кр'],
    inputs: [I('visitors', 'Посетители', 'шт'), I('conversions', 'Конверсии', 'шт')],
    formula: 'Конверсии / Посетители × 100 %',
    about: 'Доля посетителей, совершивших целевое действие.',
    compute: v => pct(v.conversions, v.visitors),
  },
  {
    id: 'cr-sales', name: 'CR лид → продажа', full: 'Конверсия лидов в продажи', group: 'funnel', unit: '%',
    aliases: ['конверсия в продажу', 'lead to sale', 'конверсия отдела продаж'],
    inputs: [I('leads', 'Лиды', 'шт'), I('sales', 'Продажи', 'шт')],
    formula: 'Продажи / Лиды × 100 %',
    about: 'Какая доля заявок превращается в оплаты. Показывает качество лидов и работу продаж.',
    compute: v => pct(v.sales, v.leads),
  },
  {
    id: 'aov', name: 'Средний чек', full: 'Average order value (AOV)', group: 'funnel', unit: '₽',
    aliases: ['aov', 'средний чек', 'average check'],
    inputs: [I('revenue', 'Выручка', '₽'), I('orders', 'Заказы', 'шт')],
    formula: 'Выручка / Заказы',
    about: 'Сколько в среднем приносит один заказ.',
    compute: v => div(v.revenue, v.orders),
  },
  {
    id: 'revenue', name: 'Выручка', full: 'Выручка', group: 'funnel', unit: '₽',
    aliases: ['revenue', 'доход', 'оборот'],
    inputs: [I('orders', 'Заказы', 'шт'), I('aov', 'Средний чек', '₽')],
    formula: 'Заказы × Средний чек',
    about: 'Сумма продаж за период.',
    compute: v => (has(v.orders, v.aov) ? v.orders * v.aov : null),
  },

  /* ---------- Окупаемость ---------- */
  {
    id: 'roi', name: 'ROI', full: 'Окупаемость инвестиций', group: 'roi', unit: '%',
    aliases: ['рои', 'return on investment', 'окупаемость'],
    inputs: [I('income', 'Доход (прибыль до вычета вложений)', '₽'), I('cost', 'Вложения', '₽')],
    formula: '(Доход − Вложения) / Вложения × 100 %',
    about: 'Сколько рублей прибыли принёс каждый вложенный рубль.',
    compute: v => (has(v.income, v.cost) && v.cost !== 0 ? (v.income - v.cost) / v.cost * 100 : null),
    assess: r => roiAssess(r),
  },
  {
    id: 'romi', name: 'ROMI', full: 'Окупаемость маркетинговых инвестиций', group: 'roi', unit: '%',
    aliases: ['роми', 'return on marketing investment', 'окупаемость маркетинга', 'окупаемость рекламы'],
    inputs: [I('income', 'Доход от маркетинга', '₽'), I('margin', 'Маржинальность', '%', 'по умолчанию 100 % — укажите маржу для честного ROMI'), I('cost', 'Маркетинговые расходы', '₽')],
    formula: '(Доход × Маржа − Расходы) / Расходы × 100 %',
    about: 'Окупились ли расходы на маркетинг с учётом маржи. Больше 0 % — кампания приносит прибыль.',
    compute: v => {
      const m = has(v.margin) ? v.margin / 100 : 1;
      return has(v.income, v.cost) && v.cost !== 0 ? (v.income * m - v.cost) / v.cost * 100 : null;
    },
    assess: r => roiAssess(r),
  },
  {
    id: 'roas', name: 'ROAS', full: 'Возврат рекламных расходов', group: 'roi', unit: '%',
    aliases: ['роас', 'return on ad spend'],
    inputs: [I('income', 'Доход с рекламы', '₽'), I('spend', 'Расход на рекламу', '₽'), I('margin', 'Маржинальность', '%', 'необязательно — для точки безубыточности')],
    formula: 'Доход / Расход × 100 %',
    about: 'Сколько выручки принёс каждый рубль рекламы. В отличие от ROMI не учитывает себестоимость.',
    compute: v => pct(v.income, v.spend),
    assess: (r, v) => {
      if (!has(v.margin) || v.margin <= 0) return null;
      const breakeven = 100 / (v.margin / 100);
      return { level: level(r >= breakeven * 1.3, r >= breakeven), text: `Точка безубыточности при марже ${fmt(v.margin, '%')} — ROAS ${fmt(breakeven, '%')}.` };
    },
  },
  {
    id: 'drr', name: 'ДРР', full: 'Доля рекламных расходов (ACoS)', group: 'roi', unit: '%',
    aliases: ['drr', 'acos', 'доля рекламных расходов'],
    inputs: [I('spend', 'Расход на рекламу', '₽'), I('income', 'Доход с рекламы', '₽'), I('margin', 'Маржинальность', '%', 'необязательно — для оценки')],
    formula: 'Расход / Доход × 100 %',
    about: 'Какая часть выручки уходит на рекламу. Популярна на маркетплейсах.',
    compute: v => pct(v.spend, v.income),
    assess: (r, v) => {
      if (!has(v.margin)) return null;
      return { level: level(r <= v.margin * 0.6, r < v.margin), text: r < v.margin ? `ДРР ниже маржинальности (${fmt(v.margin, '%')}) — реклама прибыльна.` : `ДРР выше маржинальности (${fmt(v.margin, '%')}) — реклама убыточна.` };
    },
  },
  {
    id: 'breakeven-cpa', name: 'Допустимый CPA', full: 'Точка безубыточности по цене заказа', group: 'roi', unit: '₽',
    aliases: ['break-even cpa', 'максимальный cpa', 'безубыточность'],
    inputs: [I('aov', 'Средний чек', '₽'), I('margin', 'Маржинальность', '%')],
    formula: 'Средний чек × Маржа',
    about: 'Максимальная цена привлечения заказа, при которой реклама не уходит в минус.',
    compute: v => (has(v.aov, v.margin) ? v.aov * v.margin / 100 : null),
  },
  {
    id: 'gross-profit', name: 'Маржинальная прибыль', full: 'Маржинальная прибыль', group: 'roi', unit: '₽',
    aliases: ['маржа', 'gross profit', 'валовая прибыль'],
    inputs: [I('revenue', 'Выручка', '₽'), I('variable', 'Переменные затраты', '₽')],
    formula: 'Выручка − Переменные затраты',
    about: 'Сколько остаётся после себестоимости и переменных расходов на покрытие постоянных затрат.',
    compute: v => (has(v.revenue, v.variable) ? v.revenue - v.variable : null),
  },

  /* ---------- Клиенты и юнит-экономика ---------- */
  {
    id: 'cac', name: 'CAC', full: 'Стоимость привлечения клиента', group: 'unit', unit: '₽',
    aliases: ['сак', 'customer acquisition cost', 'стоимость привлечения'],
    inputs: [I('cost', 'Расходы на маркетинг и продажи', '₽'), I('customers', 'Новые клиенты', 'шт')],
    formula: 'Расходы / Новые клиенты',
    about: 'Во сколько обходится один новый платящий клиент с учётом всех расходов на привлечение.',
    compute: v => div(v.cost, v.customers),
  },
  {
    id: 'ltv', name: 'LTV', full: 'Пожизненная ценность клиента', group: 'unit', unit: '₽',
    aliases: ['cltv', 'lifetime value', 'пожизненная ценность'],
    inputs: [I('aov', 'Средний чек', '₽'), I('frequency', 'Покупок в месяц', 'шт'), I('lifetime', 'Срок жизни клиента', 'мес'), I('margin', 'Маржинальность', '%', 'по умолчанию 100 %')],
    formula: 'Чек × Покупок в месяц × Срок жизни × Маржа',
    about: 'Сколько маржинальной прибыли приносит клиент за всё время отношений с компанией.',
    compute: v => {
      const m = has(v.margin) ? v.margin / 100 : 1;
      return has(v.aov, v.frequency, v.lifetime) ? v.aov * v.frequency * v.lifetime * m : null;
    },
  },
  {
    id: 'ltv-cac', name: 'LTV / CAC', full: 'Отношение ценности клиента к цене привлечения', group: 'unit', unit: 'x',
    aliases: ['ltv cac', 'юнит-экономика'],
    inputs: [I('ltv', 'LTV', '₽'), I('cac', 'CAC', '₽')],
    formula: 'LTV / CAC',
    about: 'Во сколько раз клиент приносит больше, чем стоит его привлечение.',
    compute: v => div(v.ltv, v.cac),
    assess: r => scale(r, 3, 1, {
      good: 'Здоровая юнит-экономика: можно масштабировать привлечение.',
      ok: 'Клиенты окупаются, но запас небольшой. Работайте над удержанием и чеком.',
      bad: 'Клиент стоит дороже, чем приносит. Масштабирование увеличит убыток.',
    }),
  },
  {
    id: 'cac-payback', name: 'Окупаемость CAC', full: 'Срок окупаемости привлечения', group: 'unit', unit: 'мес',
    aliases: ['payback', 'срок окупаемости'],
    inputs: [I('cac', 'CAC', '₽'), I('monthly', 'Маржинальный доход с клиента в месяц', '₽')],
    formula: 'CAC / Доход с клиента в месяц',
    about: 'За сколько месяцев клиент возвращает деньги, потраченные на его привлечение.',
    compute: v => div(v.cac, v.monthly),
    assess: r => (r <= 12 ? { level: r <= 6 ? 'good' : 'ok', text: r <= 6 ? 'Быстрая окупаемость.' : 'Приемлемо: окупается в течение года.' } : { level: 'bad', text: 'Долгая окупаемость: нужен большой запас денег на рост.' }),
  },
  {
    id: 'arpu', name: 'ARPU', full: 'Средний доход на пользователя', group: 'unit', unit: '₽',
    aliases: ['арпу', 'average revenue per user'],
    inputs: [I('revenue', 'Выручка', '₽'), I('users', 'Все пользователи', 'шт')],
    formula: 'Выручка / Пользователи',
    about: 'Средняя выручка на одного пользователя, включая неплатящих.',
    compute: v => div(v.revenue, v.users),
  },
  {
    id: 'arppu', name: 'ARPPU', full: 'Средний доход на платящего пользователя', group: 'unit', unit: '₽',
    aliases: ['арппу', 'average revenue per paying user'],
    inputs: [I('revenue', 'Выручка', '₽'), I('paying', 'Платящие пользователи', 'шт')],
    formula: 'Выручка / Платящие',
    about: 'Средняя выручка на одного платящего клиента.',
    compute: v => div(v.revenue, v.paying),
  },
  {
    id: 'churn', name: 'Churn rate', full: 'Отток клиентов', group: 'unit', unit: '%',
    aliases: ['отток', 'чёрн', 'churn'],
    inputs: [I('start', 'Клиентов на начало периода', 'шт'), I('lost', 'Ушло за период', 'шт')],
    formula: 'Ушедшие / Клиенты на начало × 100 %',
    about: 'Какая доля клиентов перестала пользоваться продуктом за период (обычно месяц).',
    compute: v => pct(v.lost, v.start),
    assess: r => (r < 5 ? { level: 'good', text: 'Низкий отток для месячного периода.' } : r <= 10 ? { level: 'ok', text: 'Средний отток. Найдите момент, когда клиенты уходят.' } : { level: 'bad', text: 'Высокий отток: удержание важнее привлечения.' }),
  },
  {
    id: 'retention', name: 'Retention rate', full: 'Удержание клиентов', group: 'unit', unit: '%',
    aliases: ['удержание', 'ретеншн', 'crr'],
    inputs: [I('start', 'Клиентов на начало', 'шт'), I('end', 'Клиентов на конец', 'шт'), I('new', 'Новых за период', 'шт')],
    formula: '(На конец − Новые) / На начало × 100 %',
    about: 'Какая доля клиентов осталась с вами за период.',
    compute: v => (has(v.start, v.end, v.new) && v.start !== 0 ? (v.end - v.new) / v.start * 100 : null),
  },

  /* ---------- Соцсети и контент ---------- */
  {
    id: 'er', name: 'ER', full: 'Вовлечённость по подписчикам', group: 'social', unit: '%',
    aliases: ['engagement rate', 'вовлечённость', 'вовлеченность', 'ер'],
    inputs: [I('reactions', 'Реакции (лайки, комментарии, репосты, сохранения)', 'шт'), I('followers', 'Подписчики', 'шт')],
    formula: 'Реакции / Подписчики × 100 %',
    about: 'Насколько активно аудитория взаимодействует с контентом.',
    compute: v => pct(v.reactions, v.followers),
    assess: r => scale(r, 3, 1, {
      good: 'Высокая вовлечённость: контент попадает в интересы аудитории.',
      ok: 'Нормальная вовлечённость для большинства площадок.',
      bad: 'Низкая вовлечённость: проверьте качество аудитории и форматы.',
    }),
  },
  {
    id: 'err', name: 'ERR', full: 'Вовлечённость по охвату', group: 'social', unit: '%',
    aliases: ['engagement rate by reach', 'вовлечённость по охвату'],
    inputs: [I('reactions', 'Реакции', 'шт'), I('reach', 'Охват', 'шт')],
    formula: 'Реакции / Охват × 100 %',
    about: 'Вовлечённость тех, кто реально увидел публикацию.',
    compute: v => pct(v.reactions, v.reach),
  },
  {
    id: 'cpf', name: 'CPF', full: 'Цена подписчика', group: 'social', unit: '₽',
    aliases: ['cost per follower', 'цена подписчика'],
    inputs: [I('spend', 'Расход', '₽'), I('followers', 'Новые подписчики', 'шт')],
    formula: 'Расход / Новые подписчики',
    about: 'Сколько стоит привлечение одного подписчика.',
    compute: v => div(v.spend, v.followers),
  },
  {
    id: 'growth', name: 'Прирост аудитории', full: 'Темп роста подписчиков', group: 'social', unit: '%',
    aliases: ['growth rate', 'рост подписчиков'],
    inputs: [I('start', 'Подписчики на начало', 'шт'), I('end', 'Подписчики на конец', 'шт')],
    formula: '(Конец − Начало) / Начало × 100 %',
    about: 'На сколько процентов выросла аудитория за период.',
    compute: v => (has(v.start, v.end) && v.start !== 0 ? (v.end - v.start) / v.start * 100 : null),
  },

  /* ---------- Email ---------- */
  {
    id: 'open-rate', name: 'Open rate', full: 'Открываемость писем', group: 'email', unit: '%',
    aliases: ['открываемость', 'or'],
    inputs: [I('delivered', 'Доставлено', 'шт'), I('opened', 'Открыто', 'шт')],
    formula: 'Открыто / Доставлено × 100 %',
    about: 'Доля получателей, открывших письмо. Зависит от темы, отправителя и качества базы.',
    compute: v => pct(v.opened, v.delivered),
    assess: r => scale(r, 25, 15, {
      good: 'Хорошая открываемость.',
      ok: 'Средний уровень. Тестируйте темы и время отправки.',
      bad: 'Низкая открываемость: проверьте базу и попадание в спам.',
    }),
  },
  {
    id: 'email-ctr', name: 'CTR письма', full: 'Кликабельность рассылки', group: 'email', unit: '%',
    aliases: ['ctr email', 'клики в письме'],
    inputs: [I('delivered', 'Доставлено', 'шт'), I('clicks', 'Клики', 'шт')],
    formula: 'Клики / Доставлено × 100 %',
    about: 'Доля получателей, кликнувших по ссылке в письме.',
    compute: v => pct(v.clicks, v.delivered),
    assess: r => scale(r, 3, 1, {
      good: 'Хорошая кликабельность.',
      ok: 'Средний уровень.',
      bad: 'Низкая кликабельность: усиливайте оффер и CTA.',
    }),
  },
  {
    id: 'ctor', name: 'CTOR', full: 'Клики от открытий', group: 'email', unit: '%',
    aliases: ['click to open rate'],
    inputs: [I('opened', 'Открыто', 'шт'), I('clicks', 'Клики', 'шт')],
    formula: 'Клики / Открыто × 100 %',
    about: 'Насколько содержание письма мотивирует кликнуть тех, кто его открыл.',
    compute: v => pct(v.clicks, v.opened),
  },
  {
    id: 'unsub', name: 'Отписки', full: 'Доля отписок', group: 'email', unit: '%',
    aliases: ['unsubscribe rate', 'отписки'],
    inputs: [I('delivered', 'Доставлено', 'шт'), I('unsubscribed', 'Отписались', 'шт')],
    formula: 'Отписки / Доставлено × 100 %',
    about: 'Доля получателей, отписавшихся после письма.',
    compute: v => pct(v.unsubscribed, v.delivered),
    assess: r => (r <= 0.5 ? { level: 'good', text: 'Нормальный уровень отписок.' } : { level: 'bad', text: 'Много отписок: проверьте частоту и релевантность писем.' }),
  },

  /* ---------- Лояльность ---------- */
  {
    id: 'nps', name: 'NPS', full: 'Индекс потребительской лояльности', group: 'loyalty', unit: '',
    aliases: ['net promoter score', 'лояльность', 'нпс'],
    inputs: [I('promoters', 'Промоутеры (9–10)', 'шт'), I('detractors', 'Критики (0–6)', 'шт'), I('total', 'Всего ответов', 'шт')],
    formula: '(Промоутеры − Критики) / Всего × 100',
    about: 'Готовы ли клиенты рекомендовать компанию. Шкала от −100 до 100.',
    compute: v => (has(v.promoters, v.detractors, v.total) && v.total !== 0 ? (v.promoters - v.detractors) / v.total * 100 : null),
    assess: r => (r > 50 ? { level: 'good', text: 'Отличная лояльность.' } : r >= 0 ? { level: 'ok', text: 'Нормальный уровень. Разберите ответы критиков.' } : { level: 'bad', text: 'Критиков больше, чем промоутеров.' }),
  },
];

function roiAssess(r) {
  if (r > 0) return { level: 'good', text: 'Вложения окупаются и приносят прибыль.' };
  if (r === 0) return { level: 'ok', text: 'Вложения окупились в ноль.' };
  return { level: 'bad', text: 'Убыток: вложения не окупились.' };
}

export const metricById = id => METRICS.find(m => m.id === id);

export function searchMetrics(query) {
  const q = query.trim().toLowerCase();
  if (!q) return METRICS;
  return METRICS.filter(m => [m.name, m.full, m.id, ...m.aliases].some(s => s.toLowerCase().includes(q)));
}

/* ---------- ввод и вывод чисел ---------- */
export function parseNum(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\s ₽%]/g, '').replace(',', '.');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fmt(n, unit = '') {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  const s = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
  if (!unit) return s;
  if (unit === 'x') return `${s}×`;
  return `${s} ${unit}`;
}

/* ---------- калькулятор воронки ---------- */
export const FUNNEL_INPUTS = [
  I('budget', 'Бюджет', '₽'), I('cpm', 'CPM', '₽'), I('ctr', 'CTR', '%'),
  I('cr1', 'Конверсия в лид', '%'), I('cr2', 'Конверсия лида в продажу', '%'),
  I('aov', 'Средний чек', '₽'), I('margin', 'Маржинальность', '%'),
];
export const FUNNEL_BENCHMARKS = { ctr: 1, cr1: 3, cr2: 20 };
const STAGE_NAMES = { ctr: 'Кликабельность (CTR)', cr1: 'Конверсия в лид', cr2: 'Конверсия лида в продажу' };

export function computeFunnel(v) {
  const required = FUNNEL_INPUTS.map(i => i.key);
  if (!required.every(k => has(v[k]))) return null;
  if (v.cpm <= 0 || v.budget <= 0) return null;
  const impressions = v.budget / v.cpm * 1000;
  const clicks = impressions * v.ctr / 100;
  const leads = clicks * v.cr1 / 100;
  const sales = leads * v.cr2 / 100;
  const revenue = sales * v.aov;
  const profit = revenue * v.margin / 100 - v.budget;
  const ratio = k => v[k] / FUNNEL_BENCHMARKS[k];
  const weakest = Object.keys(FUNNEL_BENCHMARKS).reduce((a, b) => (ratio(b) < ratio(a) ? b : a));
  return {
    impressions, clicks, leads, sales, revenue, profit,
    cpc: clicks ? v.budget / clicks : null,
    cpl: leads ? v.budget / leads : null,
    cpa: sales ? v.budget / sales : null,
    romi: profit / v.budget * 100,
    drr: revenue ? v.budget / revenue * 100 : null,
    bottleneck: ratio(weakest) < 1 ? { key: weakest, name: STAGE_NAMES[weakest], value: v[weakest], benchmark: FUNNEL_BENCHMARKS[weakest] } : null,
  };
}
