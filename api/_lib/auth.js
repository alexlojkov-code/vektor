/* Аккаунты: пароль (scrypt), сессия в httpOnly-cookie, код восстановления вместо письма на почту.
   Ключи в хранилище:
   user:email:<email> → id · user:<id> → профиль · sess:<sha256(токена)> → "<id>:<версия>" · data:<id> → данные */
import { scrypt, randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { problem } from './server.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'vk_session';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 дней
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const sha256 = s => createHash('sha256').update(s).digest('hex');

/* ---------- проверки ввода ---------- */
export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function passwordError(raw) {
  const p = String(raw || '');
  if (p.length < 8) return 'Пароль — минимум 8 символов';
  if (p.length > 200) return 'Пароль слишком длинный';
  return null;
}

/* ---------- пароли и коды восстановления ---------- */
export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifySecret(secret, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(String(secret).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}
// Код вида K7QM-2XRT-PB9W-HN4C: без похожих символов (0/O, 1/I/L)
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newRecoveryCode() {
  const bytes = randomBytes(16);
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
  return chars.match(/.{4}/g).join('-');
}
export const normalizeCode = raw => String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').match(/.{1,4}/g)?.join('-') || '';

/* ---------- пользователи ---------- */
export async function findUserByEmail(email) {
  const id = await db.get(`user:email:${email}`);
  return id ? getUser(id) : null;
}
export async function getUser(id) {
  const raw = await db.get(`user:${id}`);
  return raw ? JSON.parse(raw) : null;
}
export const saveUser = user => db.set(`user:${user.id}`, JSON.stringify(user));

export async function createUser(email, password) {
  const id = randomUUID();
  // NX: если почта уже занята параллельным запросом, второй аккаунт не создаётся
  if (!(await db.set(`user:email:${email}`, id, { nx: true }))) return null;
  const recoveryCode = newRecoveryCode();
  const user = {
    id, email, createdAt: new Date().toISOString(), sessionVersion: 1,
    password: await hashSecret(password),
    recovery: await hashSecret(recoveryCode),
  };
  await saveUser(user);
  return { user, recoveryCode };
}

/* ---------- сессии ---------- */
export async function startSession(req, res, user) {
  const token = randomBytes(32).toString('base64url');
  await db.set(`sess:${sha256(token)}`, `${user.id}:${user.sessionVersion}`, { ex: SESSION_TTL });
  setCookie(req, res, token, SESSION_TTL);
}
export async function endSession(req, res) {
  const token = readCookie(req);
  if (token) await db.del(`sess:${sha256(token)}`);
  setCookie(req, res, '', 0);
}
// Пользователь текущего запроса или null. Смена пароля повышает sessionVersion — старые сессии гаснут.
export async function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const value = await db.get(`sess:${sha256(token)}`);
  if (!value) return null;
  const [id, version] = value.split(':');
  const user = await getUser(id);
  return user && String(user.sessionVersion) === version ? user : null;
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setCookie(req, res, value, maxAge) {
  const host = String(req.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`);
}

/* ---------- общие проверки обработчиков ---------- */
export function requireDb(res) {
  if (db.enabled) return true;
  problem(res, 503, 'ACCOUNTS_DISABLED', 'Аккаунты пока не подключены на сервере');
  return false;
}
// Защита от перебора паролей и кодов за 15 минут: до 10 попыток на одну почту
// и до 30 с одного IP (за общим адресом офиса бывает несколько человек)
export async function tooManyAttempts(req, email) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const [byIp, byEmail] = await Promise.all([
    db.hit(`rl:auth:ip:${ip}`, 15 * 60),
    email ? db.hit(`rl:auth:email:${email}`, 15 * 60) : 0,
  ]);
  return byIp > 30 || byEmail > 10;
}
