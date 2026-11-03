import { OAuth2Client } from 'google-auth-library';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { defaultUsernameFor } from '../lib/username.js';

export const oauthClient = new OAuth2Client({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
});

const SCOPES = ['openid', 'email', 'profile'];

export function buildAuthUrl(state: string): string {
  return oauthClient.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export async function exchangeCode(code: string): Promise<GoogleIdentity> {
  const { tokens } = await oauthClient.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an id_token');
  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error('Google id_token missing sub/email');
  return {
    sub: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: Boolean(p.email_verified),
    name: p.name ?? '',
    picture: p.picture ?? '',
  };
}

/**
 * Look up (or create) the Noteshare user for a Google identity.
 *
 * Match order:
 *  1. googleSub — the durable key.
 *  2. email — covers users migrated from Firebase whose row was created with
 *     the old Firebase Auth `sub` (which equals the Google sub anyway) or with
 *     no sub; also self-heals if Google ever rotated something.
 * The row's googleSub / profile fields are refreshed on every login.
 */
export async function upsertUserFromGoogle(id: GoogleIdentity) {
  const bySub = await prisma.user.findUnique({ where: { googleSub: id.sub } });
  const existing =
    bySub ?? (await prisma.user.findUnique({ where: { email: id.email } }));

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        googleSub: id.sub,
        email: id.email,
        displayName: id.name || existing.displayName,
        photoURL: id.picture || existing.photoURL,
        // Self-heals any account that slipped through without one.
        ...(existing.username ? {} : { username: await defaultUsernameFor(id.email) }),
      },
    });
  }

  return prisma.user.create({
    data: {
      googleSub: id.sub,
      email: id.email,
      displayName: id.name,
      photoURL: id.picture,
      username: await defaultUsernameFor(id.email),
    },
  });
}
