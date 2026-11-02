/* Хранилище аккаунтов и данных: Upstash Redis через REST (подключается в Vercel → Storage)
   или память процесса для локальной разработки (DB_PROVIDER=memory). Без настроек аккаунты выключены. */

const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const wanted = (process.env.DB_PROVIDER || '').trim().toLowerCase();

// Запись с проверкой версии одним атомарным шагом: чужие изменения не затираются
const CAS = `local cur = redis.call('GET', KEYS[1])
local rev = 0
if cur then rev = tonumber(cjson.decode(cur).rev) or 0 end
if rev ~= tonumber(ARGV[1]) then return {0, cur or false} end
redis.call('SET', KEYS[1], ARGV[2])
return {1, false}`;

function redisStore() {
  async function cmd(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(`Redis: ${json.error || res.status}`);
    return json.result;
  }
  return {
    enabled: true,
    name: 'redis',
    get: key => cmd('GET', key),
    set: (key, value, { ex, nx } = {}) => cmd('SET', key, value, ...(ex ? ['EX', ex] : []), ...(nx ? ['NX'] : [])).then(r => r === 'OK'),
    del: (...keys) => cmd('DEL', ...keys),
    async hit(key, ttl) {
      const n = await cmd('INCR', key);
      if (n === 1) await cmd('EXPIRE', key, ttl);
      return n;
    },
    async cas(key, baseRev, value) {
      const [ok, cur] = await cmd('EVAL', CAS, 1, key, baseRev, value);
      return { ok: ok === 1, current: cur || null };
    },
  };
}

function memoryStore() {
  const map = new Map(); // key → { value, until }
  const read = key => {
    const e = map.get(key);
    if (e && e.until && e.until < Date.now()) { map.delete(key); return null; }
    return e ? e.value : null;
  };
  const write = (key, value, ex) => map.set(key, { value: String(value), until: ex ? Date.now() + ex * 1000 : 0 });
  return {
    enabled: true,
    name: 'memory',
    get: async key => read(key),
    async set(key, value, { ex, nx } = {}) {
      if (nx && read(key) !== null) return false;
      write(key, value, ex);
      return true;
    },
    del: async (...keys) => keys.forEach(k => map.delete(k)),
    async hit(key, ttl) {
      if (read(key) === null) { write(key, 1, ttl); return 1; }
      const e = map.get(key);
      e.value = String(Number(e.value) + 1);
      return Number(e.value);
    },
    async cas(key, baseRev, value) {
      const cur = read(key);
      const rev = cur ? JSON.parse(cur).rev || 0 : 0;
      if (rev !== baseRev) return { ok: false, current: cur };
      write(key, value);
      return { ok: true, current: null };
    },
  };
}

function disabledStore(reason) {
  return { enabled: false, name: 'none', reason };
}

export const db = url && token && wanted !== 'memory' && wanted !== 'none'
  ? redisStore()
  : wanted === 'memory'
    ? memoryStore()
    : disabledStore(wanted === 'none' ? 'выключено настройкой DB_PROVIDER' : 'хранилище не подключено');
