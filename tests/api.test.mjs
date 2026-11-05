// Аккаунты и синхронизация: обработчики API на хранилище в памяти.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PROVIDER = 'memory';
const account = (await import('../api/account.js')).default;
const sync = (await import('../api/sync.js')).default;

let ipSeq = 0;
async function call(handler, { method = 'POST', body, cookie, ip }) {
  const headers = { 'x-pilot': '1', host: 'localhost', 'x-forwarded-for': ip || `10.0.0.${++ipSeq}`, ...(cookie && { cookie }) };
  const res = {
    statusCode: 200, headers: {}, data: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk = '') { this.data += chunk; },
  };
  await handler({ method, headers, body }, res);
  return { status: res.statusCode, json: res.data ? JSON.parse(res.data) : null, cookie: res.headers['set-cookie']?.split(';')[0] };
}
const post = (body, opts = {}) => call(account, { body, ...opts });

test('пароль должен быть строкой, а не объектом', async () => {
  const r = await post({ action: 'register', email: 'obj@example.com', password: { a: 1, b: 'длинное значение' } });
  assert.equal(r.status, 400);
  assert.equal((await post({ action: 'login', email: 'obj@example.com', password: ['x'] })).status, 400);
});

test('неудачи входа блокируют почту после 10 попыток, успешный вход лимит не тратит', async () => {
  const email = 'lock@example.com', password = 'correct-horse-1';
  assert.equal((await post({ action: 'register', email, password })).status, 201);
  for (let i = 0; i < 15; i++) assert.equal((await post({ action: 'login', email, password })).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await post({ action: 'login', email, password: 'wrong-pass' })).status, 401);
  assert.equal((await post({ action: 'login', email, password })).status, 429);
});

test('синхронизация отклоняет небезопасные id и кривую структуру', async () => {
  const reg = await post({ action: 'register', email: 'sync@example.com', password: 'correct-horse-2' });
  const put = data => call(sync, { method: 'PUT', cookie: reg.cookie, body: { baseRev: 0, data } });
  assert.equal((await put({ chats: [{ id: '"><img src=x onerror=alert(1)>', messages: [] }], tasks: [] })).status, 400);
  assert.equal((await put({ chats: [{ id: 'c1', messages: [{ id: '<b>' }] }], tasks: [] })).status, 400);
  assert.equal((await put({ chats: [{ id: 'c1' }], tasks: [] })).status, 400);
  assert.equal((await put({ chats: [], tasks: 'нет' })).status, 400);
  assert.equal((await put({ chats: [{ id: 'c1', messages: [{ id: 'm-1' }] }], tasks: [{ id: 't_1' }] })).status, 200);
});

test('данные одного пользователя недоступны без его сессии', async () => {
  assert.equal((await call(sync, { method: 'GET' })).status, 401);
  assert.equal((await call(sync, { method: 'GET', cookie: 'vk_session=fake-token' })).status, 401);
});
