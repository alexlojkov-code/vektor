/* OpenAI-совместимый Chat Completions (поток SSE) через fetch, без SDK. Работает с Gemini
   (generativelanguage.googleapis.com/v1beta/openai, ключ GEMINI_API_KEY) и OpenAI (OPENAI_API_KEY).
   Модель выбирает пользователь из списка config.aiModels; остальные из списка — запасные.
   Как в Eatlas: если модель перегружена (429/5xx), недоступна ключу (404)
   или молчит в потоке — сразу пробуем следующую; занятые модели на время откладываем. */
import { AIError } from './provider.js';

const BUSY_MS = 3 * 60 * 1000;
const MISSING_MS = 60 * 60 * 1000;
const FIRST_EVENT_MS = 20000;  // нет первого кусочка ответа — модель считаем занятой
const IDLE_MS = 60000;         // пауза посреди ответа дольше минуты — обрыв
const isReasoning = model => /^(gpt-5|o\d|gemini-[3-9])/.test(model);

// Причина ошибки сервиса → что делать: перейти к следующей модели или сразу сообщить пользователю
function classify(status, err) {
  const code = err?.code || err?.type || '';
  const text = `${code} ${err?.message || ''}`;
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(text)) {
    return { fatal: new AIError('AI_AUTH', 502, 'Ошибка настройки AI на сервере') };
  }
  if (code === 'insufficient_quota' || /insufficient_quota|billing/i.test(text)) {
    return { fatal: new AIError('AI_QUOTA', 502, 'На балансе AI-сервиса закончились средства. Задачи и калькулятор работают.') };
  }
  // У Google лимиты считаются по каждой модели: исчерпан дневной или модель недоступна на тарифе — откладываем на час
  if (status === 404 || code === 'model_not_found' || /per day|limit: 0\b/i.test(text)) return { next: MISSING_MS };
  if (status === 429 || status >= 500) return { next: BUSY_MS };
  return { fatal: new AIError('AI_UNAVAILABLE', 502, `Ошибка AI-провайдера (${status})`) };
}

/* Разбор SSE: выдаёт JSON-события. Значение { timeout: true } — данных не было дольше waitMs().
   Последняя строка может прийти без перевода строки, поэтому остаток буфера разбираем и в конце. */
export async function* readSSE(body, waitMs) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parse = line => {
    const t = line.trim();
    if (!t.startsWith('data:')) return null;
    const data = t.slice(5).trim();
    if (data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
  };
  let buf = '';
  try {
    for (;;) {
      let timer;
      const timeout = new Promise(r => { timer = setTimeout(() => r('timeout'), waitMs()); });
      const step = await Promise.race([reader.read(), timeout]);
      clearTimeout(timer);
      if (step === 'timeout') { yield { timeout: true }; return; }
      if (step.done) break;
      buf += decoder.decode(step.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (ev) yield ev;
      }
    }
    const ev = parse(buf + decoder.decode());
    if (ev) yield ev;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function createCompatProvider(config) {
  const models = config.aiModels.map(m => m.id);
  const busyUntil = new Map(); // модель → время, до которого её пробуем последней (в памяти экземпляра)
  let effortRejected = false;  // сервис не знает reasoning_effort — больше не отправляем

  async function open(model, input, signal) {
    const payload = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      [config.tokenParam]: config.aiMaxTokens,
      messages: [{ role: 'system', content: input.system.map(b => b.text).join('\n\n') }, ...input.messages],
      ...(isReasoning(model) && !effortRejected && { reasoning_effort: config.aiEffort }),
    };
    // Таймаут — только на ожидание ответа сервера; сам поток может идти дольше (за паузами следит IDLE_MS)
    const timer = new AbortController();
    const t = setTimeout(() => timer.abort(new DOMException('Нет ответа', 'TimeoutError')), config.aiTimeoutMs);
    return fetch(`${config.compatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.compatKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, timer.signal]),
    }).finally(() => clearTimeout(t));
  }

  return {
    name: config.aiProvider,
    enabled: true,
    model: config.aiModel,
    models: config.aiModels,
    async *chat(input, { signal }) {
      const now = Date.now();
      // Сначала модель, выбранная пользователем, затем остальные; занятые — в конец
      const chosen = models.includes(input.model) ? input.model : models[0];
      const all = [chosen, ...models.filter(m => m !== chosen)];
      const order = [...all.filter(m => !(busyUntil.get(m) > now)), ...all.filter(m => busyUntil.get(m) > now)];
      let last = new AIError('AI_UNAVAILABLE', 502, 'Не удалось связаться с AI');

      for (const model of order) {
        let res;
        try {
          res = await open(model, input, signal);
          if (res.status === 400 && !effortRejected && isReasoning(model) && /reasoning_effort/i.test(await res.clone().text())) {
            effortRejected = true;
            res = await open(model, input, signal);
          }
        } catch (e) {
          if (signal?.aborted) return;
          if (e.name === 'TimeoutError') last = new AIError('AI_TIMEOUT', 504, 'AI не ответил вовремя, попробуйте ещё раз');
          busyUntil.set(model, Date.now() + BUSY_MS);
          continue;
        }

        if (!res.ok) {
          const err = await res.json().then(j => (Array.isArray(j) ? j[0] : j)?.error, () => null);
          console.warn(`${config.aiProvider} ${model}: ${res.status} ${err?.code || ''} ${(err?.message || '').slice(0, 160)}`);
          const verdict = classify(res.status, err);
          if (verdict.fatal) throw verdict.fatal;
          busyUntil.set(model, Date.now() + verdict.next);
          last = verdict.next === MISSING_MS
            ? new AIError('AI_MODEL', 502, 'Модель AI недоступна для ключа сервиса')
            : new AIError('AI_RATE_LIMIT', 429, 'AI перегружен, попробуйте через минуту');
          continue;
        }

        let yielded = false, finish = null, refusal = false, usage = null, served = model;
        try {
          for await (const ev of readSSE(res.body, () => (yielded ? IDLE_MS : FIRST_EVENT_MS))) {
            if (ev.timeout) {
              if (yielded) throw new AIError('AI_TIMEOUT', 504, 'Ответ AI оборвался, попробуйте ещё раз');
              console.warn(`${config.aiProvider} ${model}: нет ответа за ${FIRST_EVENT_MS} мс`);
              busyUntil.set(model, Date.now() + BUSY_MS);
              break;
            }
            if (ev.error) throw new AIError('AI_UNAVAILABLE', 502, 'Ошибка AI-провайдера во время ответа');
            if (ev.model) served = ev.model;
            if (ev.usage) usage = ev.usage;
            const choice = ev.choices?.[0];
            if (choice?.delta?.refusal) refusal = true;
            if (choice?.finish_reason) finish = choice.finish_reason;
            const text = choice?.delta?.content;
            if (text) { yielded = true; yield { type: 'delta', text }; }
          }
        } catch (e) {
          if (signal?.aborted) return;
          throw e instanceof AIError ? e : new AIError('AI_UNAVAILABLE', 502, 'Связь с AI прервалась');
        }
        if (signal?.aborted) return;
        if (!yielded && !finish && !refusal) continue; // модель промолчала — следующая

        console.log(`AI: ${served}, stop=${finish}, in=${usage?.prompt_tokens}, cached=${usage?.prompt_tokens_details?.cached_tokens ?? 0}, out=${usage?.completion_tokens}`);
        if (refusal || finish === 'content_filter') {
          throw new AIError('AI_REFUSED', 422, 'AI не может помочь с этим запросом. Попробуйте переформулировать его.');
        }
        // Поток закончился без причины завершения или по лимиту длины — клиент покажет, что ответ неполный
        const stopReason = finish === 'stop' ? 'end_turn' : finish === 'length' ? 'max_tokens' : 'incomplete';
        yield { type: 'done', stopReason };
        return;
      }
      throw last;
    },
  };
}
