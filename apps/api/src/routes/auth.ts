import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
  signAccess,
  signRefresh,
  verifyRefresh,
} from '../lib/jwt.js';
import { buildAuthUrl, exchangeCode, upsertUserFromGoogle } from '../auth/google.js';
import { PAT_PREFIX, hashToken } from '../middleware/auth.js';

export const authRouter = Router();

const STATE_COOKIE = 'ns_oauth_state';

// Browser-extension login redirect targets. `launchWebAuthFlow` hands the
// final redirect back only to the extension that started it, so allowing the
// browser-owned redirect domains (and the extension schemes some builds use)
// is safe.
const EXT_REDIRECT_RE =
  /^(https:\/\/[a-z0-9-]+\.(chromiumapp\.org|extensions\.allizom\.org)\/|chrome-extension:\/\/[a-z]{32}\/|moz-extension:\/\/[0-9a-f-]{36}\/)/i;

function encodeState(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
function decodeState(state: string): Record<string, string> {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return {};
  }
}

authRouter.get(
  '/google',
  ah(async (req, res) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID) {
      throw new HttpError(500, 'Google OAuth is not configured');
    }
    const nonce = randomBytes(16).toString('hex');
    const ext = req.query.flow === 'ext';
    const redirect = String(req.query.redirect ?? '');

    if (ext) {
      console.log('[auth] ext login start, redirect =', redirect);
      if (!EXT_REDIRECT_RE.test(redirect)) {
        throw new HttpError(400, `bad extension redirect uri: ${redirect}`);
      }
    }

    res.cookie(STATE_COOKIE, nonce, {
      ...cookieOptions(10 * 60 * 1000),
      httpOnly: true,
    });
    res.redirect(
      buildAuthUrl(
        encodeState(ext ? { n: nonce, f: 'ext', r: redirect } : { n: nonce }),
      ),
    );
  }),
);

authRouter.get(
  '/google/callback',
  ah(async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!code || !state) throw new HttpError(400, 'invalid oauth state');

    const s = decodeState(state);
    const isExt = s.f === 'ext';
    if (isExt) console.log('[auth] ext callback, redirect back to', s.r);

    // The extension flow runs in a browser-controlled window that doesn't carry
    // our state cookie, so there we trust the (allowlisted) redirect target
    // instead; the web flow keeps the strict cookie check.
    if (isExt) {
      if (!s.r || !EXT_REDIRECT_RE.test(s.r)) {
        throw new HttpError(400, 'bad extension redirect uri');
      }
    } else if (!expected || s.n !== expected) {
      throw new HttpError(400, 'invalid oauth state');
    }

    const identity = await exchangeCode(code);
    if (!identity.emailVerified) {
      throw new HttpError(403, 'google email not verified');
    }
    const user = await upsertUserFromGoogle(identity);

    if (isExt) {
      // Hand the extension a long-lived personal access token (Bearer auth,
      // no cookies — sidesteps cross-site iframe cookie partitioning).
      const token = PAT_PREFIX + randomBytes(24).toString('base64url');
      await prisma.apiToken.create({
        data: {
          userId: user.id,
          name: 'Extensión del navegador',
          tokenHash: hashToken(token),
        },
      });
      res.redirect(`${s.r}#token=${encodeURIComponent(token)}`);
      return;
    }

    res.cookie(
      ACCESS_COOKIE,
      signAccess({ sub: user.id, email: user.email }),
      cookieOptions(ACCESS_MAX_AGE),
    );
    res.cookie(
      REFRESH_COOKIE,
      signRefresh(user.id),
      cookieOptions(REFRESH_MAX_AGE),
    );
    res.redirect(env.WEB_ORIGIN);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const user = await prisma.user.findUnique({ where: { id: viewer.id } });
    if (!user) throw new HttpError(401, 'unknown user');
    res.json(serializeUser(user));
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'no refresh token');
    let userId: string;
    try {
      userId = verifyRefresh(token).sub;
    } catch {
      throw new HttpError(401, 'invalid refresh token');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(401, 'unknown user');

    res.cookie(
      ACCESS_COOKIE,
      signAccess({ sub: user.id, email: user.email }),
      cookieOptions(ACCESS_MAX_AGE),
    );
    res.cookie(
      REFRESH_COOKIE,
      signRefresh(user.id),
      cookieOptions(REFRESH_MAX_AGE),
    );
    res.json(serializeUser(user));
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Development-only: sign in as any existing user by email, no Google round-trip.
// Never mounted in production.
if (env.NODE_ENV === 'development') {
  authRouter.post(
    '/dev-login',
    ah(async (req, res) => {
      const { email } = z
        .object({ email: z.string().email() })
        .parse(req.body ?? {});
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (!user) throw new HttpError(404, 'no such user');
      res.cookie(
        ACCESS_COOKIE,
        signAccess({ sub: user.id, email: user.email }),
        cookieOptions(ACCESS_MAX_AGE),
      );
      res.cookie(
        REFRESH_COOKIE,
        signRefresh(user.id),
        cookieOptions(REFRESH_MAX_AGE),
      );
      res.json(serializeUser(user));
    }),
  );
}
