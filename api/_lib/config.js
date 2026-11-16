// Настройки из переменных окружения. На Vercel они задаются в проекте,
// локально scripts/dev.mjs подгружает их из .env.

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'mock', 'none'];
const EFFORTS = ['low', 'medium', 'high'];

// Провайдер по умолчанию — по тому, какой ключ задан: достаточно добавить один ключ
function readProvider() {
  const fallback = process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai'
    : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'gemini';
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
const gemini = provider === 'gemini';
const openai = provider === 'openai';
const compat = gemini || openai; // оба работают через OpenAI-совместимый Chat Completions

// Модели на выбор пользователю: первая — по умолчанию, остальные — запасные при перегрузке
const LABELS = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash — точнее',
  'gemini-3.6-flash': 'Gemini 3.6 Flash — баланс',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite — быстрее',
  'gpt-5.4-mini': 'GPT-5.4 mini', 'gpt-5.4-nano': 'GPT-5.4 nano', 'gpt-5.4': 'GPT-5.4',
};
const DEFAULT_MODELS = {
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  openai: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
  anthropic: ['claude-opus-5-5'],
};
const models = (() => {
  const base = DEFAULT_MODELS[provider] || [];
  const first = (process.env.AI_MODEL || base[0] || '').trim();
  const rest = process.env.AI_FALLBACK_MODELS !== undefined ? list(process.env.AI_FALLBACK_MODELS) : base.slice(1);
  return [first, ...rest.filter(m => m !== first)].filter(Boolean);
})();

export const config = Object.freeze({
  aiProvider: provider,
  // Ключи хранятся только здесь и никогда не уходят клиенту и в логи.
  apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  // Gemini и OpenAI: ключ и адрес OpenAI-совместимого API
  compatKey: ((gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) || '').trim(),
  compatBaseUrl: (gemini
    ? process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, ''),
  // Gemini принимает лимит ответа как max_tokens, OpenAI — max_completion_tokens
  tokenParam: gemini ? 'max_tokens' : 'max_completion_tokens',
  aiModel: models[0],
  aiModels: models.map(id => ({ id, label: LABELS[id] || id })),
  aiEffort: readEffort(compat ? 'low' : 'medium'),
  aiMaxTokens: readInt('AI_MAX_TOKENS', compat ? 16000 : 64000),
  // Ожидание ответа сервиса (до первых байтов). Для Gemini/OpenAI коротко, как в Eatlas: зависшую модель
  // лучше бросить и попробовать запасную, чем держать пользователя минутами
  aiTimeoutMs: readInt('AI_TIMEOUT_MS', compat ? 25000 : 120000),
  // Дневные лимиты запросов к AI (сутки по UTC), как в Eatlas
  aiDailyLimitUser: readInt('AI_DAILY_LIMIT_USER', 50),
  aiDailyLimitGuest: readInt('AI_DAILY_LIMIT_GUEST', 15),
  aiDailyLimitTotal: readInt('AI_DAILY_LIMIT_TOTAL', 1500),
});
