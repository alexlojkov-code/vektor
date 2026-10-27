// Демо-провайдер: без сети, шаблонный ответ по направлению, выдаётся потоком,
// чтобы интерфейс чата можно было проверить без ключа.

const TITLES = {
  general: 'Разбор задачи', strategy: 'Черновик стратегии', research: 'Аналитический разбор',
  brand: 'Основа платформы бренда', pr: 'План PR-кампании', content: 'Контент-план',
  smm: 'SMM-план', seo: 'SEO-план', performance: 'Медиаплан', email: 'Email-цепочка',
  influence: 'План работы с блогерами', event: 'Концепция мероприятия', product: 'План запуска',
  marketplace: 'План для маркетплейса', offline: 'Офлайн-кампания', partner: 'Партнёрская программа',
  hr: 'План по HR-бренду',
};

function answer(direction, question) {
  const topic = question.replace(/\s+/g, ' ').trim().slice(0, 90);
  return `> **Демо-режим.** Это шаблонный ответ без обращения к AI. Чтобы получать настоящие ответы, добавьте \`ANTHROPIC_API_KEY\` на сервере.

## ${TITLES[direction] || TITLES.general}

**Запрос:** ${topic}

### Допущения
- Бюджет и сроки не указаны — беру средний бюджет и горизонт 4 недели.
- Основная цель — рост заявок при сохранении окупаемости (ROMI > 0).

### Ключевые идеи
1. **Сфокусироваться на одном сегменте** с самой острой болью и проверить на нём оффер.
2. **Собрать воронку целиком**: от первого касания до повторной покупки, а не отдельные активности.
3. **Мерить каждое действие**: UTM-метки, цели в аналитике, еженедельный отчёт.

### План по неделям

| Неделя | Активность | Канал | KPI |
|---|---|---|---|
| 1 | Исследование ЦА и конкурентов | — | 10 интервью |
| 2 | Оффер и посадочная страница | Сайт | CR ≥ 3 % (оценка) |
| 3 | Тестовый запуск | Реклама, соцсети | CPL в пределах допустимого |
| 4 | Анализ и масштабирование | Все | ROMI > 0 |

## Следующие шаги
1. Провести 10 интервью с клиентами из приоритетного сегмента
2. Сформулировать оффер и 3 варианта заголовка
3. Собрать посадочную страницу с формой заявки
4. Настроить цели и UTM-метки в аналитике
5. Запустить тест с бюджетом 15 % от месячного
6. Подвести итоги теста и пересчитать ROMI в калькуляторе
`;
}

const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createMockProvider() {
  return {
    name: 'mock',
    enabled: true,
    model: 'демо-шаблон',
    async *chat({ messages, direction }, { signal }) {
      const last = messages[messages.length - 1]?.content || '';
      const text = answer(direction, typeof last === 'string' ? last : '');
      // Выдаём по 2–3 слова, как настоящий поток.
      const parts = text.match(/\S+\s*/g) || [];
      for (let i = 0; i < parts.length; i += 3) {
        if (signal?.aborted) return;
        await sleep(18, signal);
        yield { type: 'delta', text: parts.slice(i, i + 3).join('') };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}
