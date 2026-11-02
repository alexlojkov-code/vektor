/* /api/sync — данные пользователя (профиль бренда, чаты, задачи, настройки) одним документом.
   GET → { rev, updatedAt, data | null }
   PUT { baseRev, data } → { rev, updatedAt } или 409 с актуальной версией: клиент объединяет и повторяет. */
import { route, send, problem, body, rateLimited } from './_lib/server.js';
import { db } from './_lib/db.js';
import { currentUser, requireDb } from './_lib/auth.js';

const MAX_BYTES = 4_000_000; // лимит тела запроса на Vercel — 4,5 МБ

export default route(['GET', 'PUT'], async (req, res) => {
  if (!requireDb(res)) return;
  if (rateLimited(req, { limit: 60 })) return problem(res, 429, 'TOO_MANY', 'Слишком частая синхронизация');
  const user = await currentUser(req);
  if (!user) return problem(res, 401, 'UNAUTHORIZED', 'Войдите в аккаунт');
  const key = `data:${user.id}`;

  if (req.method === 'GET') {
    const raw = await db.get(key);
    return send(res, 200, raw ? JSON.parse(raw) : { rev: 0, updatedAt: null, data: null });
  }

  const b = body(req);
  const baseRev = Number.isInteger(b.baseRev) && b.baseRev >= 0 ? b.baseRev : null;
  const d = b.data;
  if (baseRev === null || !d || typeof d !== 'object' || !Array.isArray(d.chats) || !Array.isArray(d.tasks)) {
    return problem(res, 400, 'INVALID_INPUT', 'Неверный формат данных');
  }
  const doc = {
    rev: baseRev + 1,
    updatedAt: new Date().toISOString(),
    data: { brand: d.brand || {}, chats: d.chats, tasks: d.tasks, settings: d.settings || {}, deleted: d.deleted || {} },
  };
  const value = JSON.stringify(doc);
  if (Buffer.byteLength(value) > MAX_BYTES) {
    return problem(res, 413, 'TOO_LARGE', 'Данных слишком много для синхронизации — удалите старые чаты');
  }
  const { ok, current } = await db.cas(key, baseRev, value);
  if (!ok) return send(res, 409, current ? JSON.parse(current) : { rev: 0, updatedAt: null, data: null });
  send(res, 200, { rev: doc.rev, updatedAt: doc.updatedAt });
});
