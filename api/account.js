/* /api/account — аккаунт и сессия.
   GET → { enabled, user: { email } | null }
   POST { action: register | login | logout | reset | delete, ... } */
import { route, send, problem, body } from './_lib/server.js';
import { db } from './_lib/db.js';
import {
  normalizeEmail, passwordError, hashSecret, verifySecret, newRecoveryCode, normalizeCode,
  findUserByEmail, createUser, saveUser, startSession, endSession, currentUser, requireDb, tooManyAttempts,
} from './_lib/auth.js';

// Хэш-заглушка: проверка пароля несуществующего аккаунта занимает столько же времени
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const publicUser = user => ({ email: user.email, createdAt: user.createdAt });

const ACTIONS = {
  async register(req, res, b) {
    const email = normalizeEmail(b.email);
    if (!email) return problem(res, 400, 'INVALID_INPUT', 'Проверьте адрес почты');
    const err = passwordError(b.password);
    if (err) return problem(res, 400, 'INVALID_INPUT', err);
    if (await tooManyAttempts(req, email)) return problem(res, 429, 'TOO_MANY', 'Слишком много попыток, подождите 15 минут');
    const created = await createUser(email, String(b.password));
    if (!created) return problem(res, 409, 'EMAIL_TAKEN', 'Аккаунт с этой почтой уже есть — войдите');
    await startSession(req, res, created.user);
    send(res, 201, { user: publicUser(created.user), recoveryCode: created.recoveryCode });
  },

  async login(req, res, b) {
    const email = normalizeEmail(b.email);
    if (!email || !b.password) return problem(res, 400, 'INVALID_INPUT', 'Введите почту и пароль');
    if (await tooManyAttempts(req, email)) return problem(res, 429, 'TOO_MANY', 'Слишком много попыток, подождите 15 минут');
    const user = await findUserByEmail(email);
    const ok = await verifySecret(String(b.password), user?.password || DUMMY);
    if (!user || !ok) return problem(res, 401, 'BAD_CREDENTIALS', 'Неверная почта или пароль');
    await startSession(req, res, user);
    send(res, 200, { user: publicUser(user) });
  },

  async logout(req, res) {
    await endSession(req, res);
    send(res, 200, { ok: true });
  },

  // Новый пароль по коду восстановления; старые сессии на всех устройствах завершаются
  async reset(req, res, b) {
    const email = normalizeEmail(b.email);
    const code = normalizeCode(b.recoveryCode);
    if (!email || code.length < 19) return problem(res, 400, 'INVALID_INPUT', 'Введите почту и код восстановления');
    const err = passwordError(b.password);
    if (err) return problem(res, 400, 'INVALID_INPUT', err);
    if (await tooManyAttempts(req, email)) return problem(res, 429, 'TOO_MANY', 'Слишком много попыток, подождите 15 минут');
    const user = await findUserByEmail(email);
    const ok = await verifySecret(code, user?.recovery || DUMMY);
    if (!user || !ok) return problem(res, 401, 'BAD_CREDENTIALS', 'Неверная почта или код восстановления');
    const recoveryCode = newRecoveryCode();
    user.password = await hashSecret(String(b.password));
    user.recovery = await hashSecret(recoveryCode);
    user.sessionVersion = (user.sessionVersion || 1) + 1;
    await saveUser(user);
    await startSession(req, res, user);
    send(res, 200, { user: publicUser(user), recoveryCode });
  },

  async delete(req, res, b) {
    const user = await currentUser(req);
    if (!user) return problem(res, 401, 'UNAUTHORIZED', 'Войдите в аккаунт');
    if (await tooManyAttempts(req, user.email)) return problem(res, 429, 'TOO_MANY', 'Слишком много попыток, подождите 15 минут');
    if (!(await verifySecret(String(b.password || ''), user.password))) return problem(res, 401, 'BAD_CREDENTIALS', 'Неверный пароль');
    await endSession(req, res);
    await db.del(`user:${user.id}`, `user:email:${user.email}`, `data:${user.id}`);
    send(res, 200, { ok: true });
  },
};

export default route(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    if (!db.enabled) return send(res, 200, { enabled: false, user: null, reason: db.reason });
    const user = await currentUser(req);
    return send(res, 200, { enabled: true, user: user ? publicUser(user) : null });
  }
  if (!requireDb(res)) return;
  const b = body(req);
  const action = ACTIONS[b.action];
  if (!action || !Object.hasOwn(ACTIONS, b.action)) return problem(res, 400, 'INVALID_INPUT', 'Неизвестное действие');
  await action(req, res, b);
});
