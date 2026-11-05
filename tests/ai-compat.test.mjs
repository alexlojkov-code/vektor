// OpenAI-совместимый провайдер (Gemini, OpenAI) на подставном сервере: поток, выбор и перебор моделей,
// ошибки ключа и баланса. Плюс дневные лимиты.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.AI_DAILY_LIMIT_GUEST = '2';
process.env.AI_DAILY_LIMIT_TOTAL = '3';
const { createCompatProvider, readSSE } = await import('../api/_lib/ai/compat.js');
const { takeQuota, quotaStatus } = await import('../api/_lib/quota.js');

// Поведение подставного сервера по имени модели
const seen = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push({ model: body.model, effort: body.reasoning_effort, auth: req.headers.authorization, system: body.messages[0], maxTokens: body.max_tokens, maxCompletion: body.max_completion_tokens });
    const fail = (status, code, message = code) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code, message } })); };
    if (body.model === 'busy') return fail(429, 'rate_limit_exceeded');
    if (body.model === 'missing') return fail(404, 'model_not_found');
    if (body.model === 'badkey') return fail(401, 'invalid_api_key');
    // Gemini: неверный ключ — 400 и ошибка массивом
    if (body.model === 'gemini-badkey') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }])); }
    if (body.model === 'gemini-free0') return fail(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for metric generate_content_free_tier_requests, limit: 0');
    if (body.model === 'broke') return fail(429, 'insufficient_quota', 'You exceeded your current quota');
    if (body.model === 'gpt-5-noeffort' && body.reasoning_effort) return fail(400, 'unsupported_parameter', 'Unsupported parameter: reasoning_effort');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // Как обрывал ответ Google: последний кусок без перевода строки, в нём конец текста и причина завершения
    if (body.model === 'no-newline') {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'начало ' } }] })}\n\n`);
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'и конец' }, finish_reason: 'stop' }] })}`);
    }
    if (body.model === 'cut-off') {
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'обрыв на полу' } }] })}\n\n`);
    }
    const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    send({ model: body.model, choices: [{ delta: { role: 'assistant', content: '' } }] });
    send({ model: body.model, choices: [{ delta: { content: 'Привет, ' } }] });
    send({ model: body.model, choices: [{ delta: { content: 'маркетолог!' }, finish_reason: null }] });
    send({ model: body.model, choices: [{ delta: {}, finish_reason: body.model === 'refuse' ? 'content_filter' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    res.end('data: [DONE]\n\n');
  });
});
let base;
before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());

const provider = (aiModel, fallbacks = [], extra = {}) => createCompatProvider({
  aiProvider: 'openai', compatKey: 'test-key', compatBaseUrl: base, tokenParam: 'max_completion_tokens',
  aiModel, aiModels: [aiModel, ...fallbacks].map(id => ({ id, label: id })),
  aiMaxTokens: 1000, aiTimeoutMs: 5000, aiEffort: 'low', ...extra,
});
const gemini = (models, extra) => provider(models[0], models.slice(1), { aiProvider: 'gemini', tokenParam: 'max_tokens', ...extra });
async function run(p, model) {
  let text = '', done = null;
  for await (const ev of p.chat({ system: [{ text: 'Ты — Вектор' }, { text: 'Направление' }], messages: [{ role: 'user', content: 'Привет' }], model }, { signal: new AbortController().signal })) {
    if (ev.type === 'delta') text += ev.text;
    if (ev.type === 'done') done = ev.stopReason;
  }
  return { text, done };
}

test('поток собирается в ответ, ключ и системный промпт уходят на сервер', async () => {
  seen.length = 0;
  assert.deepEqual(await run(provider('gpt-5.4-mini')), { text: 'Привет, маркетолог!', done: 'end_turn' });
  assert.equal(seen[0].auth, 'Bearer test-key');
  assert.deepEqual(seen[0].system, { role: 'system', content: 'Ты — Вектор\n\nНаправление' });
  assert.equal(seen[0].effort, 'low');
});

test('перегруженная и недоступная модели пропускаются', async () => {
  seen.length = 0;
  const r = await run(provider('busy', ['missing', 'gpt-5.4-nano']));
  assert.equal(r.text, 'Привет, маркетолог!');
  assert.deepEqual(seen.map(s => s.model), ['busy', 'missing', 'gpt-5.4-nano']);
});

test('неверный ключ и пустой баланс — сразу понятная ошибка, без перебора', async () => {
  await assert.rejects(run(provider('badkey', ['gpt-5.4-nano'])), { code: 'AI_AUTH' });
  await assert.rejects(run(provider('broke', ['gpt-5.4-nano'])), { code: 'AI_QUOTA' });
});

test('сервис без reasoning_effort — повтор без параметра', async () => {
  seen.length = 0;
  assert.equal((await run(provider('gpt-5-noeffort'))).text, 'Привет, маркетолог!');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].effort, undefined);
});

test('отказ модели — код AI_REFUSED', async () => {
  await assert.rejects(run(provider('refuse')), { code: 'AI_REFUSED' });
});

test('дневные лимиты: гость, общий потолок, возврат неудачного запроса', async () => {
  const req = ip => ({ headers: { 'x-forwarded-for': ip } });
  const a = await takeQuota(req('1.1.1.1'));
  assert.equal(a.ok, true);
  assert.equal(a.remaining, 1);
  await a.refund(); // неудачный запрос не засчитан
  await a.refund(); // повторный возврат ничего не меняет
  assert.equal((await quotaStatus(req('1.1.1.1'))).remaining, 2);
  assert.equal((await takeQuota(req('1.1.1.1'))).ok, true);
  assert.equal((await takeQuota(req('1.1.1.1'))).ok, true);
  const third = await takeQuota(req('1.1.1.1'));
  assert.equal(third.code, 'AI_LIMIT');
  assert.equal((await takeQuota(req('2.2.2.2'))).ok, true); // другой гость — свой лимит
  assert.equal((await takeQuota(req('3.3.3.3'))).code, 'AI_LIMIT_TOTAL'); // общий потолок 3 исчерпан
});

test('Gemini: выбранная пользователем модель идёт первой, лимит ответа — max_tokens', async () => {
  seen.length = 0;
  const p = gemini(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
  assert.equal((await run(p, 'gemini-3.6-flash')).text, 'Привет, маркетолог!');
  assert.equal(seen[0].model, 'gemini-3.6-flash');
  assert.equal(seen[0].maxTokens, 1000);
  assert.equal(seen[0].maxCompletion, undefined);
  assert.equal(seen[0].effort, 'low');
  seen.length = 0;
  await run(p, 'gpt-hack'); // модели нет в списке — берётся модель по умолчанию
  assert.equal(seen[0].model, 'gemini-3.8-flash');
});

test('Gemini: неверный ключ (ошибка массивом) — AI_AUTH; модель без бесплатного лимита пропускается', async () => {
  await assert.rejects(run(gemini(['gemini-badkey', 'gemini-3.6-flash'])), { code: 'AI_AUTH' });
  seen.length = 0;
  assert.equal((await run(gemini(['gemini-free0', 'gemini-3.6-flash']))).text, 'Привет, маркетолог!');
  assert.deepEqual(seen.map(x => x.model), ['gemini-free0', 'gemini-3.6-flash']);
});

test('последний кусок ответа без перевода строки не теряется', async () => {
  assert.deepEqual(await run(provider('no-newline')), { text: 'начало и конец', done: 'end_turn' });
});

test('поток без причины завершения помечается как неполный', async () => {
  assert.deepEqual(await run(provider('cut-off')), { text: 'обрыв на полу', done: 'incomplete' });
});

test('readSSE: русский текст, разрезанный между кусками потока, собирается целиком', async () => {
  const bytes = new TextEncoder().encode('data: {"t":"Привет"}\n\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 13)); c.enqueue(bytes.slice(13)); c.close(); } });
  const out = [];
  for await (const ev of readSSE(body, () => 1000)) out.push(ev);
  assert.deepEqual(out, [{ t: 'Привет' }]);
});
