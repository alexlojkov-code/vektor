/* GET /api/ai/status — включён ли AI и сколько запросов осталось сегодня. Ключ никогда не возвращается. */
import { route, send } from '../_lib/server.js';
import { getProvider } from '../_lib/ai/provider.js';
import { quotaStatus } from '../_lib/quota.js';

export default route(['GET'], async (req, res) => {
  const provider = await getProvider();
  const quota = provider.enabled && provider.name !== 'mock' ? await quotaStatus(req) : null;
  send(res, 200, {
    enabled: provider.enabled,
    provider: provider.name,
    ...(provider.model && { model: provider.model }),
    ...(provider.reason && { reason: provider.reason }),
    ...(quota && { quota }),
  });
});
