/* Общая серверная часть: ответы, ошибки, проверки, лимит частоты.
   Файлы в api/_lib не становятся отдельными функциями Vercel (префикс «_»). */

/* ---------- ответы (ошибки в духе RFC 9457) ---------- */
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
export function problem(res, status, code, detail, extra) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
  res.end(JSON.stringify({ type: 'about:blank', title: code, status, code, detail, ...extra }));
}

/* Обёртка обработчика: допустимые методы, защита от CSRF, перехват ошибок */
export function route(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        return problem(res, 405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается');
      }
      if (req.method !== 'GET' && !sameOrigin(req)) return problem(res, 403, 'FORBIDDEN', 'Запрос с чужого сайта отклонён');
      await fn(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) problem(res, 500, 'SERVER_ERROR', 'Ошибка сервера, попробуйте позже');
      else res.end();
    }
  };
}

/* Изменяющие запросы принимаются только со своего сайта и с заголовком x-pilot,
   который сторонний сайт не может добавить без CORS-разрешения. */
function sameOrigin(req) {
  if (req.headers['x-pilot'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

/* ---------- лимит частоты: скользящее окно в памяти экземпляра функции ---------- */
const hits = new Map();
export function rateLimited(req, { limit = 20, windowMs = 60_000 } = {}) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
  return recent.length > limit;
}
