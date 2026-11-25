import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const cookieName = 'costudio_researcher';
const durationSeconds = 8 * 60 * 60;
const maxFailures = 10;
const windowMs = 15 * 60 * 1000;
const failedLogins: number[] = [];

const hash = (value: string) => createHash('sha256').update(value).digest();

function signature(value: string) {
  const password = process.env.RESEARCHER_PASSWORD;
  if (!password) return null;
  const key = hash(`${process.env.SESSION_SECRET ?? ''}\u0000${password}`);
  return createHmac('sha256', key).update(value).digest('hex');
}

export async function researcherSignedIn() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return false;
  const [expiry, nonce, supplied, extra] = token.split('.');
  if (!expiry || !nonce || !supplied || extra !== undefined || !/^\d+$/.test(expiry)) return false;
  const expected = signature(`${expiry}.${nonce}`);
  return Boolean(expected && timingSafeEqual(hash(expected), hash(supplied)) && Number(expiry) > Date.now());
}

export async function signInResearcher(password: unknown, secure: boolean) {
  const expected = process.env.RESEARCHER_PASSWORD;
  if (!expected) return 'unconfigured';
  const now = Date.now();
  while (failedLogins.length && failedLogins[0] < now - windowMs) failedLogins.shift();
  if (failedLogins.length >= maxFailures) return 'limited';
  if (typeof password !== 'string' || password.length > 1024 || !timingSafeEqual(hash(expected), hash(password))) {
    failedLogins.push(now);
    return 'invalid';
  }
  const body = `${now + durationSeconds * 1000}.${randomBytes(24).toString('hex')}`;
  (await cookies()).set(cookieName, `${body}.${signature(body)}`, {
    httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: durationSeconds,
  });
  return 'ok';
}

export async function signOutResearcher() {
  (await cookies()).delete(cookieName);
}
