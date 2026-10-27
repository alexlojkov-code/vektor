/* POST /api/chat — ответ AI потоком NDJSON: start → delta… → done | error. */
import { route, problem, body, rateLimited } from './_lib/server.js';
import { getProvider, AIError } from './_lib/ai/provider.js';
import { DIRECTIONS, cleanBrand, buildSystemPrompt } from './_lib/prompts.js';

const MAX_MESSAGES = 40;
const MAX_MESSAGE = 8000;
const MAX_TOTAL = 60000;

function validate(input) {
  const { direction, messages } = input;
  if (!DIRECTIONS.includes(direction)) return 'Неизвестное направление';
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return 'Некорректная история диалога';
  let total = 0;
  for (const [i, m] of messages.entries()) {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) return 'Пустое сообщение';
    if (m.role !== (i % 2 === 0 ? 'user' : 'assistant')) return 'Роли сообщений должны чередоваться';
    if (m.content.length > MAX_MESSAGE) return `Сообщение длиннее ${MAX_MESSAGE} символов`;
    total += m.content.length;
  }
  if (messages[messages.length - 1].role !== 'user') return 'Последнее сообщение должно быть от пользователя';
  if (total > MAX_TOTAL) return 'История диалога слишком длинная';
  return null;
}

export default route(['POST'], async (req, res) => {
  if (rateLimited(req)) return problem(res, 429, 'RATE_LIMITED', 'Слишком много запросов, подождите минуту');

  const input = body(req);
  const error = validate(input);
  if (error) return problem(res, 400, 'BAD_INPUT', error);

  const provider = await getProvider();
  if (!provider.enabled) return problem(res, 503, 'AI_DISABLED', 'AI пока не подключён. Задачи и калькулятор работают.');

  const messages = input.messages.map(m => ({ role: m.role, content: m.content }));
  const system = buildSystemPrompt(input.direction, cleanBrand(input.brand));
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  const events = provider.chat({ system, messages, direction: input.direction }, { signal: controller.signal });
  const write = obj => res.write(JSON.stringify(obj) + '\n');
  let started = false;

  try {
    for await (const event of events) {
      if (!started) {
        // Заголовки отправляем только после первого события: ошибки до начала ответа приходят обычным JSON.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Accel-Buffering', 'no');
        write({ type: 'start', model: provider.model });
        started = true;
      }
      write(event);
    }
  } catch (err) {
    const e = err instanceof AIError ? err : new AIError('AI_UNAVAILABLE', 502, 'Не удалось связаться с AI');
    if (!(err instanceof AIError)) console.error(err);
    if (!started) return problem(res, e.status, e.code, e.message);
    write({ type: 'error', code: e.code, detail: e.message });
  }
  res.end();
});
