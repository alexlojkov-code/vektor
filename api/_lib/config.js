// Настройки из переменных окружения. На Vercel они задаются в проекте,
// локально scripts/dev.mjs подгружает их из .env.

const PROVIDERS = ['openai', 'anthropic', 'mock', 'none'];
const EFFORTS = ['low', 'medium', 'high'];

// Провайдер по умолчанию — по тому, какой ключ задан: достаточно добавить один ключ
function readProvider() {
  const fallback = process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
  const value = (process.env.AI_PROVIDER || fallback).trim().toLowerCase();
  if (!PROVIDERS.includes(value)) {
    console.warn(`AI_PROVIDER="${value}" не поддерживается, AI выключен. Допустимо: ${PROVIDERS.join(', ')}`);
    return 'none';
  }
  return value;
}

function readInt(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readEffort(fallback) {
  const value = (process.env.AI_EFFORT || fallback).trim().toLowerCase();
  return EFFORTS.includes(value) ? value : fallback;
}

const list = raw => String(raw || '').split(',').map(s => s.trim()).filter(Boolean);

const provider = readProvider();
const openai = provider === 'openai';

export const config = Object.freeze({
  aiProvider: provider,
  // Ключи хранятся только здесь и никогда не уходят клиенту и в логи.
  apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  openaiKey: (process.env.OPENAI_API_KEY || '').trim(),
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, ''),
  aiModel: (process.env.AI_MODEL || (openai ? 'gpt-5.4-mini' : 'claude-opus-5-5')).trim(),
  // Запасные модели OpenAI: если основная перегружена или недоступна ключу
  aiFallbackModels: process.env.AI_FALLBACK_MODELS !== undefined ? list(process.env.AI_FALLBACK_MODELS) : openai ? ['gpt-5.4-nano', 'gpt-5.4'] : [],
  aiEffort: readEffort(openai ? 'low' : 'medium'),
  aiMaxTokens: readInt('AI_MAX_TOKENS', openai ? 16000 : 64000),
  aiTimeoutMs: readInt('AI_TIMEOUT_MS', 120000),
  // Дневные лимиты запросов к AI (сутки по UTC), как в Eatlas
  aiDailyLimitUser: readInt('AI_DAILY_LIMIT_USER', 50),
  aiDailyLimitGuest: readInt('AI_DAILY_LIMIT_GUEST', 15),
  aiDailyLimitTotal: readInt('AI_DAILY_LIMIT_TOTAL', 1500),
});
