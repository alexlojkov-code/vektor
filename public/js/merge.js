// Объединение данных двух устройств. Чистая функция без DOM — тестируется в Node (tests/merge.test.mjs).
// Чаты и задачи: по id, побеждает более свежий updatedAt; удалённое (deleted) не возвращается,
// если после удаления запись не менялась. Профиль бренда и настройки — трёхсторонне: base — версия
// последней синхронизации; что не менялось на одной стороне, берётся с другой. Без base — со стороны prefer.

const TOMBSTONE_DAYS = 90;

// Одинаковы ли данные (сравнение по JSON: порядок полей у снимков одинаковый)
export const sameData = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function mergeData(local, remote, prefer = 'local', base = null) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = {};
  for (const src of [remote.deleted, local.deleted]) {
    for (const [id, at] of Object.entries(src || {})) if (!deleted[id] || at > deleted[id]) deleted[id] = at;
  }
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
  for (const [id, at] of Object.entries(deleted)) if (at < cutoff) delete deleted[id];

  const pick = (a = [], b = []) => {
    const map = new Map();
    for (const item of [...a, ...b]) {
      const cur = map.get(item.id);
      if (!cur || (item.updatedAt || '') > (cur.updatedAt || '')) map.set(item.id, item);
    }
    return [...map.values()].filter(item => !deleted[item.id] || (item.updatedAt || '') > deleted[item.id]);
  };

  const main = prefer === 'remote' ? remote : local;
  const other = prefer === 'remote' ? local : remote;
  const changedOnlyThere = key => base && sameData(local[key], base[key]) && !sameData(remote[key], base[key]);
  const changedOnlyHere = key => base && sameData(remote[key], base[key]) && !sameData(local[key], base[key]);
  // Пустой профиль (новое устройство) не затирает заполненный
  const filled = b => Object.values(b || {}).some(Boolean);
  const brand = changedOnlyThere('brand') ? remote.brand : changedOnlyHere('brand') ? local.brand
    : filled(main.brand) || !filled(other.brand) ? main.brand : other.brand;
  const settings = changedOnlyThere('settings') ? remote.settings : changedOnlyHere('settings') ? local.settings
    : { ...other.settings, ...main.settings };
  return {
    brand: { ...brand },
    settings: { ...settings },
    chats: pick(local.chats, remote.chats).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    tasks: pick(local.tasks, remote.tasks),
    deleted,
  };
}

