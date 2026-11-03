/* Дневные лимиты запросов к AI — как в Eatlas: вошедший пользователь, гость (по хэшу IP)
   и общий потолок сервиса, чтобы не выйти за бюджет. Сутки — по UTC. Неудачный запрос лимит не расходует.
   Счётчики — в Redis (общие для всех экземпляров функции); без Redis — в памяти экземпляра. */
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { currentUser } from './auth.js';

const memory = new Map(); // ключ → число (ключи с датой, старые дни отбрасываем)
const store = db.enabled ? db : {
  get: async key => memory.get(key) ?? null,
  async hit(key) {
    for (const k of memory.keys()) if (!k.endsWith(today())) memory.delete(k);
    const n = (memory.get(key) || 0) + 1;
    memory.set(key, n);
    return n;
  },
  decr: async key => { if (memory.has(key)) memory.set(key, memory.get(key) - 1); },
};

const today = () => new Date().toISOString().slice(0, 10);
const untilMidnight = () => {
  const d = new Date();
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d) / 1000) + 60;
};
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();

async function subjectOf(req) {
  const user = db.enabled ? await currentUser(req) : null;
  if (user) return { key: `ai:u:${user.id}:${today()}`, limit: config.aiDailyLimitUser, guest: false };
  const ip = createHash('sha256').update(`vektor-ai:${clientIp(req)}`).digest('hex').slice(0, 32);
  return { key: `ai:ip:${ip}:${today()}`, limit: config.aiDailyLimitGuest, guest: true };
}

// Сколько осталось сегодня — для /api/ai/status
export async function quotaStatus(req) {
  const s = await subjectOf(req);
  const used = Number(await store.get(s.key)) || 0;
  // guest — подсказка «войдите, чтобы лимит был больше»; без аккаунтов на сервере она не нужна
  return { limit: s.limit, used, remaining: Math.max(0, s.limit - used), guest: s.guest && db.enabled };
}

// Берёт один запрос из лимитов. { ok: true, remaining, refund } или { ok: false, code, detail }
export async function takeQuota(req) {
  const s = await subjectOf(req);
  const totalKey = `ai:total:${today()}`;
  const ttl = untilMidnight();
  if (await store.hit(totalKey, ttl) > config.aiDailyLimitTotal) {
    await store.decr(totalKey);
    return { ok: false, code: 'AI_LIMIT_TOTAL', detail: 'Дневной лимит AI-запросов сервиса исчерпан — возвращайтесь завтра. Задачи и калькулятор работают.' };
  }
  const used = await store.hit(s.key, ttl);
  if (used > s.limit) {
    await Promise.all([store.decr(s.key), store.decr(totalKey)]);
    return {
      ok: false, code: 'AI_LIMIT',
      detail: `На сегодня лимит ${s.limit} запросов к AI исчерпан.${s.guest && db.enabled ? ` Войдите в аккаунт — для него лимит ${config.aiDailyLimitUser} в день.` : ' Возвращайтесь завтра.'}`,
    };
  }
  let refunded = false;
  return {
    ok: true,
    remaining: Math.max(0, s.limit - used),
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await Promise.all([store.decr(s.key), store.decr(totalKey)]).catch(() => {});
    },
  };
}
