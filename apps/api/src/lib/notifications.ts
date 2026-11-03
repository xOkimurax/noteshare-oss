/**
 * In-app + email notifications. All best-effort — a failure here must never
 * break the share/update that triggered it.
 *
 *  - memo.shared  : you were added to a note        -> in-app + email
 *  - memo.joined  : someone joined your shared note -> in-app + email (owner)
 *  - memo.updated : a shared note you can see changed
 *                   -> in-app (coalesced 15 min) + email (coalesced 60 min)
 */
import type { AppNotification, NotificationType } from '@noteshare/shared';
import { env } from '../env.js';
import { prisma } from './prisma.js';
import { publish, isOnline } from './sse.js';
import { emailLayout, sendEmail } from './mailer.js';
import type { FullMemo } from './serialize.js';
import type { Viewer } from './access.js';

interface Actor {
  id: string;
  name: string;
  email: string;
}

export async function getActor(viewer: Viewer): Promise<Actor> {
  const u = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { displayName: true },
  });
  return {
    id: viewer.id,
    name: u?.displayName || viewer.email.split('@')[0],
    email: viewer.email.toLowerCase(),
  };
}

export function serializeNotification(n: {
  id: string;
  type: string;
  memoId: string | null;
  memoTitle: string;
  conversationId: string | null;
  actorName: string;
  read: boolean;
  createdAt: Date;
}): AppNotification {
  return {
    id: n.id,
    type: n.type as NotificationType,
    memoId: n.memoId,
    memoTitle: n.memoTitle,
    conversationId: n.conversationId,
    actorName: n.actorName,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

const APP_URL = env.WEB_ORIGIN;

function copyFor(type: NotificationType, actorName: string, memoTitle: string) {
  const title = memoTitle || 'una nota';
  switch (type) {
    case 'memo.shared':
      return {
        subject: `${actorName} compartió "${title}" con vos`,
        heading: `${actorName} te compartió una nota`,
        body: `<strong>${actorName}</strong> compartió la nota <strong>"${title}"</strong> con vos en Noteshare.`,
      };
    case 'memo.joined':
      return {
        subject: `${actorName} se unió a "${title}"`,
        heading: `${actorName} se unió a tu nota compartida`,
        body: `<strong>${actorName}</strong> se unió a <strong>"${title}"</strong> con el código para compartir.`,
      };
    case 'memo.updated':
      return {
        subject: `${actorName} editó "${title}"`,
        heading: `Se actualizó una nota compartida`,
        body: `<strong>${actorName}</strong> editó la nota compartida <strong>"${title}"</strong>.`,
      };
    case 'memo.comment':
      return {
        subject: `${actorName} comentó en "${title}"`,
        heading: `Nuevo comentario en una nota compartida`,
        body: `<strong>${actorName}</strong> dejó un comentario en <strong>"${title}"</strong>.`,
      };
    case 'dm.message':
      return {
        subject: `${actorName} te escribió`,
        heading: `${actorName} te envió un mensaje`,
        body: `<strong>${actorName}</strong> te escribió por Noteshare.`,
      };
    case 'group.added':
      return {
        subject: `${actorName} te agregó a "${title}"`,
        heading: `Te agregaron a un grupo`,
        body: `<strong>${actorName}</strong> te agregó al grupo <strong>"${title}"</strong> en Noteshare.`,
      };
    case 'system.announcement':
      // Not currently wired to email/push (the /announce route writes the
      // Notification row directly) — case kept here only so this switch
      // stays exhaustive over NotificationType.
      return {
        subject: 'Novedades en Noteshare',
        heading: 'Novedades en Noteshare',
        body: memoTitle,
      };
  }
}

async function emailUser(
  userId: string,
  type: NotificationType,
  actorName: string,
  memoTitle: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  });
  if (!user?.email) return;
  const c = copyFor(type, actorName, memoTitle);
  await sendEmail({
    to: { email: user.email, name: user.displayName || undefined },
    subject: c.subject,
    html: emailLayout({
      heading: c.heading,
      body: c.body,
      ctaLabel: 'Abrir Noteshare',
      ctaUrl: APP_URL,
    }),
  });
}

async function push(
  userId: string,
  type: NotificationType,
  memo: { id: string; title: string },
  actor: Actor,
  { email }: { email: boolean },
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type,
      memoId: memo.id,
      memoTitle: memo.title,
      actorId: actor.id,
      actorName: actor.name,
    },
  });
  publish([userId], { type: 'notification' });
  if (email) await emailUser(userId, type, actor.name, memo.title);
}

/**
 * User ids with access to a memo: owner + resolved collaborators + accounts
 * whose email is in allowedEmails (invited but maybe not "joined" yet).
 */
export async function accessUserIds(memo: FullMemo): Promise<string[]> {
  const ids = new Set<string>([memo.ownerId]);
  for (const c of memo.collaborators) if (c.userId) ids.add(c.userId);
  if (memo.allowedEmails.length) {
    const invited = await prisma.user.findMany({
      where: { email: { in: memo.allowedEmails.map((e) => e.toLowerCase()) } },
      select: { id: true },
    });
    for (const u of invited) ids.add(u.id);
  }
  return [...ids];
}

export async function notifySharedWith(
  memo: FullMemo,
  newEmails: string[],
  actor: Actor,
): Promise<void> {
  const emails = [
    ...new Set(newEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ].filter((e) => e !== actor.email);
  if (!emails.length) return;

  try {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    for (const email of emails) {
      const userId = idByEmail.get(email);
      if (userId) {
        // has an account -> in-app notification, plus email if they're away
        await push(userId, 'memo.shared', memo, actor, { email: !isOnline(userId) });
      } else {
        // no account yet -> email invite only (they'll see the note once they
        // log in, resolved via allowedEmails)
        const c = copyFor('memo.shared', actor.name, memo.title);
        await sendEmail({
          to: { email },
          subject: c.subject,
          html: emailLayout({
            heading: c.heading,
            body:
              c.body +
              ' Iniciá sesión con Google usando este mismo correo para verla.',
            ctaLabel: 'Abrir Noteshare',
            ctaUrl: APP_URL,
          }),
        });
      }
    }
  } catch (e) {
    console.error('notifySharedWith failed', e);
  }
}

export async function notifyJoined(memo: FullMemo, actor: Actor): Promise<void> {
  try {
    if (memo.ownerId === actor.id) return;
    await push(memo.ownerId, 'memo.joined', memo, actor, {
      email: !isOnline(memo.ownerId),
    });
  } catch (e) {
    console.error('notifyJoined failed', e);
  }
}

/**
 * Per-recipient, coalesced memo-scoped notification: refresh an existing
 * unread one from the last 15 min instead of stacking a new row, and only
 * email if nothing of this type went out for the same memo in the last hour.
 * Shared by "memo.updated" and "memo.comment".
 */
async function coalescedMemoNotify(
  recipients: string[],
  type: NotificationType,
  memo: { id: string; title: string },
  actor: Actor,
): Promise<void> {
  const inAppSince = new Date(Date.now() - 15 * 60 * 1000);
  const emailSince = new Date(Date.now() - 60 * 60 * 1000);

  for (const userId of recipients) {
    const [recentInApp, recentAny] = await Promise.all([
      prisma.notification.findFirst({
        where: { userId, memoId: memo.id, type, read: false, createdAt: { gte: inAppSince } },
      }),
      prisma.notification.findFirst({
        where: { userId, memoId: memo.id, type, createdAt: { gte: emailSince } },
      }),
    ]);

    if (recentInApp) {
      await prisma.notification.update({
        where: { id: recentInApp.id },
        data: {
          createdAt: new Date(),
          actorId: actor.id,
          actorName: actor.name,
          memoTitle: memo.title,
        },
      });
    } else {
      await prisma.notification.create({
        data: {
          userId,
          type,
          memoId: memo.id,
          memoTitle: memo.title,
          actorId: actor.id,
          actorName: actor.name,
        },
      });
    }
    publish([userId], { type: 'notification' });

    // Skip the email when the recipient is in the app — they already see the
    // in-app notification. Saves the daily email quota.
    if (!recentAny && !isOnline(userId)) {
      await emailUser(userId, type, actor.name, memo.title);
    }
  }
}

export async function notifyMemoUpdated(memo: FullMemo, actor: Actor): Promise<void> {
  try {
    const isShared =
      memo.collaborators.length > 0 || memo.allowedEmails.length > 0;
    if (!isShared) return;

    const recipients = (await accessUserIds(memo)).filter((id) => id !== actor.id);
    if (!recipients.length) return;

    await coalescedMemoNotify(recipients, 'memo.updated', memo, actor);
  } catch (e) {
    console.error('notifyMemoUpdated failed', e);
  }
}

/** A new comment landed on a shared note — notify everyone else with access. */
export async function notifyNewComment(memo: FullMemo, actor: Actor): Promise<void> {
  try {
    const recipients = (await accessUserIds(memo)).filter((id) => id !== actor.id);
    if (!recipients.length) return;
    await coalescedMemoNotify(recipients, 'memo.comment', memo, actor);
  } catch (e) {
    console.error('notifyNewComment failed', e);
  }
}

/**
 * A direct message was sent — notify the recipient. Coalesces the in-app row
 * per conversation (15 min) and throttles email to once an hour per
 * conversation.
 */
export async function notifyDirectMessage(opts: {
  conversationId: string;
  recipientId: string;
  senderId: string;
  senderName: string;
}): Promise<void> {
  try {
    const { conversationId, recipientId, senderId, senderName } = opts;
    if (recipientId === senderId) return;

    const inAppSince = new Date(Date.now() - 15 * 60 * 1000);
    const emailSince = new Date(Date.now() - 60 * 60 * 1000);

    const [recentInApp, recentAny] = await Promise.all([
      prisma.notification.findFirst({
        where: {
          userId: recipientId,
          conversationId,
          type: 'dm.message',
          read: false,
          createdAt: { gte: inAppSince },
        },
      }),
      prisma.notification.findFirst({
        where: {
          userId: recipientId,
          conversationId,
          type: 'dm.message',
          createdAt: { gte: emailSince },
        },
      }),
    ]);

    if (recentInApp) {
      await prisma.notification.update({
        where: { id: recentInApp.id },
        data: { createdAt: new Date(), actorId: senderId, actorName: senderName },
      });
    } else {
      await prisma.notification.create({
        data: {
          userId: recipientId,
          type: 'dm.message',
          conversationId,
          actorId: senderId,
          actorName: senderName,
        },
      });
    }
    publish([recipientId], { type: 'notification' });

    // Only email if they're not currently in the app.
    if (!recentAny && !isOnline(recipientId)) {
      await emailUser(recipientId, 'dm.message', senderName, '');
    }
  } catch (e) {
    console.error('notifyDirectMessage failed', e);
  }
}

/** You were added to a group (on creation, or later by an admin) — in-app +
 * email, same "skip email if currently online" rule as everything else. A
 * one-off event per addition, so no coalescing window like dm.message has. */
export async function notifyGroupAdded(opts: {
  conversationId: string;
  groupName: string;
  recipientId: string;
  actorName: string;
}): Promise<void> {
  try {
    const { conversationId, groupName, recipientId, actorName } = opts;
    await prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'group.added',
        conversationId,
        memoTitle: groupName,
        actorName,
      },
    });
    publish([recipientId], { type: 'notification' });
    if (!isOnline(recipientId)) {
      await emailUser(recipientId, 'group.added', actorName, groupName);
    }
  } catch (e) {
    console.error('notifyGroupAdded failed', e);
  }
}
