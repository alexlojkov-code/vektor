// Настройки из переменных окружения. На Vercel они задаются в проекте,
// локально scripts/dev.mjs подгружает их из .env.

const PROVIDERS = ['anthropic', 'mock', 'none'];
const EFFORTS = ['low', 'medium', 'high'];

function readProvider() {
  const value = (process.env.AI_PROVIDER || 'anthropic').trim().toLowerCase();
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

function readEffort() {
  const value = (process.env.AI_EFFORT || 'medium').trim().toLowerCase();
  return EFFORTS.includes(value) ? value : 'medium';
}

export const config = Object.freeze({
  aiProvider: readProvider(),
  // Ключ хранится только здесь и никогда не уходит клиенту и в логи.
  apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  aiModel: (process.env.AI_MODEL || 'claude-opus-5-5').trim(),
  aiEffort: readEffort(),
  aiMaxTokens: readInt('AI_MAX_TOKENS', 64000),
  aiTimeoutMs: readInt('AI_TIMEOUT_MS', 120000),
});
