import Anthropic from '@anthropic-ai/sdk';
import { AIError } from './provider.js';

function mapError(err) {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError('AI_AUTH', 502, 'Ошибка настройки AI на сервере');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIError('AI_RATE_LIMIT', 429, 'AI перегружен, попробуйте через минуту');
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIError('AI_TIMEOUT', 504, 'AI не ответил вовремя, попробуйте ещё раз');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIError('AI_UNAVAILABLE', 502, 'Не удалось связаться с AI');
  }
  if (err instanceof Anthropic.APIError) {
    return new AIError('AI_UNAVAILABLE', 502, `Ошибка AI-провайдера (${err.status ?? 'нет статуса'})`);
  }
  return new AIError('AI_UNAVAILABLE', 502, 'Ошибка AI-провайдера');
}

export function createAnthropicProvider(config) {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: config.aiTimeoutMs, maxRetries: 1 });

  return {
    name: 'anthropic',
    enabled: true,
    model: config.aiModel,
    async *chat({ system, messages }, { signal }) {
      let stream;
      try {
        stream = client.beta.messages.stream({
          model: config.aiModel,
          max_tokens: config.aiMaxTokens,
          output_config: { effort: config.aiEffort },
          // При отказе классификатора запрос перезапускается на рекомендованной модели.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // Автоматическое кэширование префикса: системный промпт + история диалога.
          cache_control: { type: 'ephemeral' },
          system,
          messages,
        }, { signal });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'delta', text: event.delta.text };
          }
        }
        const final = await stream.finalMessage();
        const u = final.usage || {};
        console.log(`AI: ${final.model}, stop=${final.stop_reason}, in=${u.input_tokens}, cache_read=${u.cache_read_input_tokens ?? 0}, out=${u.output_tokens}`);
        if (final.stop_reason === 'refusal') {
          throw new AIError('AI_REFUSED', 422, 'AI не может помочь с этим запросом. Попробуйте переформулировать его.');
        }
        yield { type: 'done', stopReason: final.stop_reason };
      } catch (err) {
        if (signal?.aborted) return;
        throw mapError(err);
      }
    },
  };
}
