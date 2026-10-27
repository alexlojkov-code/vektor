// Общий интерфейс AI-провайдера.
//
// interface AIProvider {
//   name: 'anthropic' | 'mock' | 'none';
//   enabled: boolean;
//   model?: string;
//   reason?: string;          // почему выключен
//   // Асинхронный генератор: { type: 'delta', text } … { type: 'done', stopReason }
//   chat(input: { system, messages, direction }, opts: { signal }): AsyncGenerator<ChatEvent>;
// }

import { config } from '../config.js';
import { createDisabledProvider } from './disabled.js';
import { createMockProvider } from './mock.js';

export class AIError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Провайдер создаётся один раз на экземпляр функции.
let _provider;
export const getProvider = () => (_provider ||= createProvider());

async function createProvider() {
  if (config.aiProvider === 'mock') return createMockProvider();
  if (config.aiProvider === 'none') return createDisabledProvider('выключен в AI_PROVIDER');
  if (!config.apiKey) return createDisabledProvider('ключ не задан');

  try {
    const { createAnthropicProvider } = await import('./anthropic.js');
    return createAnthropicProvider(config);
  } catch (e) {
    console.error('Не удалось загрузить Anthropic SDK:', e.message);
    return createDisabledProvider('SDK не установлен');
  }
}
