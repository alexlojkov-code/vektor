import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData } from '../public/js/merge.js';

const t = (id, updatedAt, extra = {}) => ({ id, updatedAt, title: id, ...extra });
const doc = (fields = {}) => ({ brand: {}, settings: {}, chats: [], tasks: [], deleted: {}, ...fields });

test('объединяет записи с обоих устройств, побеждает более свежая версия', () => {
  const local = doc({ tasks: [t('a', '2026-11-01T10:00:00Z', { title: 'A локально' }), t('b', '2026-11-01T10:00:00Z')] });
  const remote = doc({ tasks: [t('a', '2026-11-01T12:00:00Z', { title: 'A на сервере' }), t('c', '2026-11-01T09:00:00Z')] });
  const m = mergeData(local, remote);
  assert.deepEqual(m.tasks.map(x => x.id).sort(), ['a', 'b', 'c']);
  assert.equal(m.tasks.find(x => x.id === 'a').title, 'A на сервере');
});

test('удалённая на одном устройстве запись не возвращается с другого', () => {
  const local = doc({ chats: [], deleted: { x: '2026-11-01T12:00:00Z' } });
  const remote = doc({ chats: [t('x', '2026-11-01T11:00:00Z')] });
  assert.equal(mergeData(local, remote).chats.length, 0);
});

test('запись, изменённая после удаления, остаётся (восстановление)', () => {
  const local = doc({ tasks: [t('x', '2026-11-01T13:00:00Z')] });
  const remote = doc({ deleted: { x: '2026-11-01T12:00:00Z' } });
  assert.equal(mergeData(local, remote).tasks.length, 1);
});

test('чаты сортируются от свежих к старым', () => {
  const m = mergeData(doc({ chats: [t('old', '2026-10-01T00:00:00Z')] }), doc({ chats: [t('new', '2026-11-01T00:00:00Z')] }));
  assert.deepEqual(m.chats.map(c => c.id), ['new', 'old']);
});

test('профиль бренда берётся с предпочтительной стороны, пустой не затирает заполненный', () => {
  const local = doc({ brand: { name: '', product: '' } });
  const remote = doc({ brand: { name: 'Зерно', product: 'Кофе' } });
  assert.equal(mergeData(local, remote, 'local').brand.name, 'Зерно');
  const edited = doc({ brand: { name: 'Зерно 2', product: '' } });
  assert.equal(mergeData(edited, remote, 'local').brand.name, 'Зерно 2');
  assert.equal(mergeData(edited, remote, 'remote').brand.name, 'Зерно');
});

test('старые отметки об удалении (больше 90 дней) очищаются', () => {
  const m = mergeData(doc({ deleted: { old: '2020-01-01T00:00:00Z', fresh: new Date().toISOString() } }), doc());
  assert.deepEqual(Object.keys(m.deleted), ['fresh']);
});

test('профиль, изменённый только на другом устройстве, не затирается при конфликте', () => {
  const base = doc({ brand: { name: 'Зерно' }, settings: { theme: 'dark' } });
  const local = doc({ brand: { name: 'Зерно' }, settings: { theme: 'light' } }); // здесь сменили тему
  const remote = doc({ brand: { name: 'Зерно (с телефона)' }, settings: { theme: 'dark' } }); // там — профиль
  const m = mergeData(local, remote, 'local', base);
  assert.equal(m.brand.name, 'Зерно (с телефона)');
  assert.equal(m.settings.theme, 'light');
});
