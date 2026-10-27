import { AIError } from './provider.js';

// Заглушка на случай, когда AI недоступен (нет ключа, выключен, нет SDK).
export function createDisabledProvider(reason) {
  return {
    name: 'none',
    enabled: false,
    reason,
    // eslint-disable-next-line require-yield
    async *chat() {
      throw new AIError('AI_DISABLED', 503, 'AI пока не подключён. Задачи и калькулятор работают.');
    },
  };
}
