import jwt from 'jsonwebtoken';
import { env } from '../env.js';

// Access token lives an hour (like Firebase's ID token) so an idle tab has a
// wide margin before it needs a refresh; the client also refreshes it
// proactively every few minutes. Refresh token is long-lived and rolls on
// every use.
const ACCESS_TTL = '60m';
const REFRESH_TTL = '60d';

export interface AccessClaims {
  sub: string; // user id
  email: string;
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

export function verifyAccess(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
}

export function verifyRefresh(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}

// Cookie names + options shared by the auth routes and middleware.
export const ACCESS_COOKIE = 'ns_access';
export const REFRESH_COOKIE = 'ns_refresh';

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export const ACCESS_MAX_AGE = 60 * 60 * 1000;
export const REFRESH_MAX_AGE = 60 * 24 * 60 * 60 * 1000;
