import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  extractUrls,
  type ChatConversation,
  type ChatGroupInfo,
  type DirectMessage,
  type DirectMessageReplyPreview,
  type MessageReactionSummary,
} from '@noteshare/shared';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { publish, isOnline } from '../lib/sse.js';
import { getActor, notifyDirectMessage, notifyGroupAdded, notifySharedWith } from '../lib/notifications.js';
import { noteSharedOut } from '../lib/contacts.js';
import { canReadMemo } from '../lib/access.js';
import { memoInclude, type FullMemo } from '../lib/serialize.js';
import { toWebp } from '../lib/image.js';
import { saveAudio } from '../lib/audio.js';
import { requireAuth } from '../middleware/auth.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

const MAX_AUDIO_DURATION_SEC = 600; // 10 minutes — a sane ceiling, not a real limit

// Same engine as note images: sharp → webp, capped at 15MB / 6 photos a msg.
// The "audio" field (voice messages) shares this instance too — same 15MB
// ceiling is nowhere near a real recording, this is just a sanity cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) =>
    cb(null, file.fieldname === 'audio' ? file.mimetype.startsWith('audio/') : file.mimetype.startsWith('image/')),
});

const pairKey = (a: string, b: string) => [a, b].sort().join(':');

const participantSelect = {
  select: { id: true, displayName: true, email: true, photoURL: true, lastSeenAt: true },
} as const;

function participantView(u: {
  id: string;
  displayName: string;
  email: string;
  photoURL: string;
  lastSeenAt: Date;
}) {
  return {
    id: u.id,
    name: u.displayName || u.email.split('@')[0],
    email: u.email,
    photoURL: u.photoURL || '',
    online: isOnline(u.id),
    lastSeenAt: u.lastSeenAt.toISOString(),
  };
}

type ConvRow = Prisma.ConversationGetPayload<{
  include: {
    participants: { include: { user: typeof participantSelect } };
    messages: {
      take: 1;
      orderBy: { createdAt: 'desc' };
      include: {
        memo: { select: { title: true } };
        sender: { select: { displayName: true; email: true } };
      };
    };
  };
}>;

function previewText(last: {
  body: string;
  memo: { title: string } | null;
  images: string[];
}): string {
  if (last.memo) return `📎 ${last.memo.title}`;
  if (last.body) return last.body;
  if (last.images.length > 1) return `📷 ${last.images.length} fotos`;
  if (last.images.length === 1) return '📷 Foto';
  return '';
}

function senderNameOf(u: { displayName: string; email: string }): string {
  return u.displayName || u.email.split('@')[0];
}

function groupView(
  row: {
    id: string;
    groupName: string | null;
    groupPhoto: string | null;
    ownerId: string | null;
    participants: { userId: string; isAdmin: boolean }[];
  },
  viewerId: string,
): ChatGroupInfo {
  return {
    id: row.id,
    name: row.groupName || 'Grupo',
    photoURL: row.groupPhoto || '',
    memberCount: row.participants.length,
    viewerIsAdmin: row.participants.some((p) => p.userId === viewerId && p.isAdmin),
    ownerId: row.ownerId,
  };
}

function serializeConversation(
  row: ConvRow,
  viewerId: string,
  unread: number,
): ChatConversation {
  const other = row.isGroup ? undefined : row.participants.find((p) => p.userId !== viewerId);
  const last = row.messages[0];
  return {
    id: row.id,
    isGroup: row.isGroup,
    other: row.isGroup
      ? null
      : other
        ? participantView(other.user)
        : { id: '', name: '(desconocido)', email: '', photoURL: '', online: false, lastSeenAt: new Date(0).toISOString() },
    group: row.isGroup ? groupView(row, viewerId) : null,
    lastMessage: last
      ? {
          body: previewText(last),
          createdAt: last.createdAt.toISOString(),
          mine: last.senderId === viewerId,
          ...(row.isGroup ? { senderName: senderNameOf(last.sender) } : {}),
        }
      : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unread,
  };
}

const convInclude = {
  participants: { include: { user: participantSelect } },
  messages: {
    take: 1,
    orderBy: { createdAt: 'desc' },
    include: {
      memo: { select: { title: true } },
      sender: { select: { displayName: true, email: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

async function unreadFor(conversationId: string, viewerId: string): Promise<number> {
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: viewerId } },
    select: { lastReadAt: true },
  });
  return prisma.directMessage.count({
    where: {
      conversationId,
      senderId: { not: viewerId },
      ...(p ? { createdAt: { gt: p.lastReadAt } } : {}),
    },
  });
}

// GET /  -> ChatConversation[]  (most recent first)
conversationsRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const rows = await prisma.conversation.findMany({
      where: { participants: { some: { userId: viewer.id } } },
      include: convInclude,
      orderBy: { lastMessageAt: 'desc' },
    });
    const out = await Promise.all(
      rows.map(async (r) =>
        serializeConversation(r, viewer.id, await unreadFor(r.id, viewer.id)),
      ),
    );
    res.json(out);
  }),
);

// POST /with  { email } | { userId }  -> ChatConversation (find or create)
conversationsRouter.post(
  '/with',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const body = z
      .union([
        z.object({ email: z.string().email() }),
        z.object({ userId: z.string().min(1) }),
      ])
      .parse(req.body);

    const other = await prisma.user.findUnique({
      where:
        'email' in body
          ? { email: body.email.trim().toLowerCase() }
          : { id: body.userId },
      select: { id: true },
    });
    if (!other) throw new HttpError(404, 'that person has no Noteshare account');
    if (other.id === viewer.id) throw new HttpError(400, 'cannot message yourself');

    const key = pairKey(viewer.id, other.id);
    let conv = await prisma.conversation.findUnique({
      where: { pairKey: key },
      include: convInclude,
    });
    if (!conv) {
      conv = await prisma.conversation.create({
        data: {
          pairKey: key,
          participants: {
            create: [{ userId: viewer.id }, { userId: other.id }],
          },
        },
        include: convInclude,
      });
    }
    res.json(
      serializeConversation(conv, viewer.id, await unreadFor(conv.id, viewer.id)),
    );
  }),
);

// POST /group  { name, memberEmails } -> ChatConversation (201)
// memberEmails are the OTHER members (not the creator) and must already have
// Noteshare accounts — at least 2 of them, so this always ends up ≥3 people.
conversationsRouter.post(
  '/group',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        memberEmails: z.array(z.string().email()).min(1),
      })
      .parse(req.body);

    const emails = [
      ...new Set(body.memberEmails.map((e) => e.trim().toLowerCase())),
    ].filter((e) => e !== viewer.email.toLowerCase());
    if (emails.length < 2) {
      throw new HttpError(400, 'a group needs at least 2 other members');
    }

    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    if (users.length !== emails.length) {
      const found = new Set(users.map((u) => u.email.toLowerCase()));
      const missing = emails.filter((e) => !found.has(e));
      throw new HttpError(404, `no account for: ${missing.join(', ')}`);
    }

    const conv = await prisma.conversation.create({
      data: {
        pairKey: randomUUID(),
        isGroup: true,
        groupName: body.name.trim(),
        ownerId: viewer.id,
        participants: {
          create: [
            { userId: viewer.id, isAdmin: true },
            ...users.map((u) => ({ userId: u.id })),
          ],
        },
      },
      include: convInclude,
    });

    publish(
      conv.participants.map((p) => p.userId),
      { type: 'dm', conversationId: conv.id },
    );

    const actor = await getActor(viewer);
    for (const u of users) {
      void notifyGroupAdded({
        conversationId: conv.id,
        groupName: conv.groupName || 'Grupo',
        recipientId: u.id,
        actorName: actor.name,
      });
    }

    res.status(201).json(serializeConversation(conv, viewer.id, 0));
  }),
);

async function loadParticipantConv(conversationId: string, viewerId: string) {
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: viewerId } },
  });
  if (!p) throw new HttpError(404, 'conversation not found');
  return p;
}

const messageInclude = {
  memo: { include: { collaborators: true } },
  sender: { select: { displayName: true, email: true } },
  // Only one level deep — a reply-to-a-reply still just quotes its own
  // immediate parent, matching what WhatsApp shows.
  replyTo: { include: { sender: { select: { displayName: true, email: true } } } },
  reactions: { select: { emoji: true, userId: true } },
} satisfies Prisma.DirectMessageInclude;

type MessageRow = Prisma.DirectMessageGetPayload<{ include: typeof messageInclude }>;

function replyPreviewOf(m: MessageRow['replyTo']): DirectMessageReplyPreview | null {
  if (!m) return null;
  const deleted = m.deletedAt !== null;
  let kind: DirectMessageReplyPreview['kind'] = 'text';
  if (m.memoId) kind = 'note';
  else if (m.isSticker) kind = 'sticker';
  else if (m.audioUrl) kind = 'audio';
  else if (m.images.length > 0) kind = 'image';
  return {
    id: m.id,
    senderName: senderNameOf(m.sender),
    body: deleted ? '' : m.body,
    kind,
    deleted,
  };
}

// Grouped by emoji, most-recently-first-reacted emoji first (Object insertion
// order over the raw rows, which arrive in whatever order Prisma returned
// them — not sorted by count; the UI can re-sort by count if it wants to).
function reactionSummaryOf(
  rows: { emoji: string; userId: string }[],
  viewerId: string,
): MessageReactionSummary[] {
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (r.userId === viewerId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }));
}

type DeliveryStatus = 'sent' | 'delivered' | 'read';

// Status of a message I sent, from the OTHER participant's read/delivery
// cursors — mirrors WhatsApp's single/double-gray/double-blue ticks.
function messageStatus(
  createdAt: Date,
  other: { lastReadAt: Date; lastDeliveredAt: Date } | null,
): DeliveryStatus {
  if (!other) return 'sent';
  if (other.lastReadAt >= createdAt) return 'read';
  if (other.lastDeliveredAt >= createdAt) return 'delivered';
  return 'sent';
}

function serializeMessage(
  m: MessageRow,
  viewer: { id: string; email: string },
  other: { lastReadAt: Date; lastDeliveredAt: Date } | null,
  isGroup: boolean,
): DirectMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: senderNameOf(m.sender),
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderId === viewer.id,
    sharedNote: m.memo
      ? {
          id: m.memo.id,
          title: m.memo.title,
          type: m.memo.type,
          accessible: canReadMemo(m.memo, viewer),
        }
      : null,
    images: m.images,
    isSticker: m.isSticker,
    audioUrl: m.audioUrl,
    audioDurationSec: m.audioDurationSec,
    replyTo: replyPreviewOf(m.replyTo),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deleted: m.deletedAt !== null,
    // Per-member read receipts aren't implemented for groups (v1) — a
    // group message is always shown as merely "sent".
    status: isGroup ? 'sent' : messageStatus(m.createdAt, other),
    reactions: reactionSummaryOf(m.reactions, viewer.id),
  };
}

// GET /:id/messages?before=<iso>&limit=30  -> { items, hasMore }  (asc within page)
conversationsRouter.get(
  '/:id/messages',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const me = await loadParticipantConv(req.params.id, viewer.id);
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { isGroup: true },
    });
    if (!conv) throw new HttpError(404, 'conversation not found');
    const { before, limit } = z
      .object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);

    const rows = await prisma.directMessage.findMany({
      where: {
        conversationId: req.params.id,
        NOT: { deletedFor: { has: viewer.id } },
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();

    // Delivery/read tick tracking only exists for 1:1s — meaningless for a
    // group (whose cursor would you even compare against?), see serializeMessage.
    const otherRow = conv.isGroup
      ? null
      : await prisma.conversationParticipant.findFirst({
          where: { conversationId: req.params.id, userId: { not: viewer.id } },
          select: { userId: true, lastReadAt: true, lastDeliveredAt: true },
        });

    // Fetching implies delivery — bump my own cursor and tell the sender
    // their message ticks can advance, but only when there's actually
    // something new (otherwise two open tabs would refetch each other
    // forever).
    if (!conv.isGroup && rows.length && rows[0].createdAt > me.lastDeliveredAt) {
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: req.params.id, userId: viewer.id } },
        data: { lastDeliveredAt: new Date() },
      });
      if (otherRow) publish([otherRow.userId], { type: 'dm', conversationId: req.params.id });
    }

    res.json({
      items: page.map((m) => serializeMessage(m, viewer, otherRow, conv.isGroup)),
      hasMore,
    });
  }),
);

const IMAGES_PAGE_SIZE = 9;

// GET /:id/media?imagesPage=1  -> { images, imagesTotal, imagesPage,
// imagesPageSize, notes, urls } — every photo (paginated, 9 per page), shared
// note, and mentioned URL (both unpaginated — the panel searches/scrolls
// those client-side) ever exchanged in this thread, newest first. Backs the
// "contact info" / group info panels — a dedicated scan rather than relying
// on however much of the paginated message history the client happens to
// have loaded. Works the same for a group or a 1:1 (loadParticipantConv only
// checks membership, not conversation type).
conversationsRouter.get(
  '/:id/media',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { imagesPage } = z
      .object({ imagesPage: z.coerce.number().int().min(1).default(1) })
      .parse(req.query);

    const [imageRows, noteRows, urlRows] = await Promise.all([
      prisma.directMessage.findMany({
        where: { conversationId: req.params.id, images: { isEmpty: false }, isSticker: false },
        select: { images: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.directMessage.findMany({
        where: { conversationId: req.params.id, memoId: { not: null } },
        include: messageInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.directMessage.findMany({
        where: { conversationId: req.params.id, body: { not: '' } },
        select: { body: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const allImages: { url: string; createdAt: string }[] = [];
    for (const m of imageRows) {
      const createdAt = m.createdAt.toISOString();
      for (const url of m.images) allImages.push({ url, createdAt });
    }
    const start = (imagesPage - 1) * IMAGES_PAGE_SIZE;
    const images = allImages.slice(start, start + IMAGES_PAGE_SIZE);

    const notes = noteRows
      .filter((m): m is typeof m & { memo: NonNullable<typeof m.memo> } => m.memo != null)
      .map((m) => ({
        id: m.memo.id,
        title: m.memo.title,
        type: m.memo.type,
        accessible: canReadMemo(m.memo, viewer),
        createdAt: m.createdAt.toISOString(),
      }));

    const urls: { url: string; createdAt: string }[] = [];
    for (const m of urlRows) {
      const createdAt = m.createdAt.toISOString();
      for (const url of extractUrls(m.body)) urls.push({ url, createdAt });
    }

    res.json({
      images,
      imagesTotal: allImages.length,
      imagesPage,
      imagesPageSize: IMAGES_PAGE_SIZE,
      notes,
      urls,
    });
  }),
);

// POST /:id/messages  { body?, memoId? } + optional multipart "images" (201)
// A `memoId` turns the message into a shared note: the sender must own the
// note, and it is shared with the recipient (added to allowedEmails) at send.
// `multer` only touches multipart requests — a plain JSON body (the text-only
// / send-a-note path) sails through untouched.
conversationsRouter.post(
  '/:id/messages',
  upload.fields([{ name: 'images', maxCount: 6 }, { name: 'audio', maxCount: 1 }]),
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const input = z
      .object({
        body: z.string().trim().max(4000).optional(),
        memoId: z.string().min(1).optional(),
        replyToId: z.string().min(1).optional(),
        // Comes through multipart as a string — coerce and clamp so a
        // runaway/garbage client value can't land in the DB.
        audioDurationSec: z.coerce.number().int().positive().max(MAX_AUDIO_DURATION_SEC).optional(),
        // Comes through multipart as the string "true", not a real boolean —
        // z.coerce.boolean() would misparse "false" as truthy (non-empty
        // string), so match the literal instead.
        isSticker: z
          .literal('true')
          .optional()
          .transform((v) => v === 'true'),
      })
      .parse(req.body);

    const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
    const files = filesByField?.images ?? [];
    const audioFile = filesByField?.audio?.[0];
    if (!input.body && !input.memoId && files.length === 0 && !audioFile) {
      throw new HttpError(400, 'a message needs text, a note, an image, or a voice message');
    }
    const images = await Promise.all(files.map((f) => toWebp(f.buffer)));
    const imageUrls = images.map((i) => i.url);
    const audio = audioFile ? await saveAudio(audioFile.buffer, audioFile.mimetype) : null;

    // A stale/racy reply target (e.g. the quoted message got deleted between
    // load and send) shouldn't hard-fail the send — just drop it.
    let replyToId: string | null = null;
    if (input.replyToId) {
      const target = await prisma.directMessage.findFirst({
        where: { id: input.replyToId, conversationId: req.params.id },
        select: { id: true },
      });
      if (target) replyToId = target.id;
    }

    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: { include: { user: { select: { id: true, email: true } } } } },
    });
    if (!conv) throw new HttpError(404, 'conversation not found');
    const recipients = conv.participants
      .map((p) => p.user)
      .filter((u) => u.id !== viewer.id);
    // 1:1 delivery ticks compare against this one other participant; a group
    // has none (see serializeMessage).
    const soleRecipient = conv.isGroup ? undefined : recipients[0];

    // Sending a note: verify ownership, then make sure every recipient can see it.
    if (input.memoId) {
      const memo = await prisma.memo.findUnique({
        where: { id: input.memoId },
        include: memoInclude,
      });
      if (!memo) throw new HttpError(404, 'note not found');
      if (memo.ownerId !== viewer.id) {
        throw new HttpError(403, 'you can only send notes you own');
      }
      const newEmails = recipients
        .map((r) => r.email.toLowerCase())
        .filter((e) => !memo.allowedEmails.some((a) => a.toLowerCase() === e));
      if (newEmails.length) {
        const allowedEmails = [...memo.allowedEmails, ...newEmails];
        const updated = await prisma.memo.update({
          where: { id: memo.id },
          data: { allowedEmails, updatedAt: new Date() },
          include: memoInclude,
        });
        const actor = await getActor(viewer);
        void notifySharedWith(updated as FullMemo, newEmails, actor);
        void noteSharedOut(viewer.id, newEmails);
      }
      if (recipients.length) {
        publish(
          [memo.ownerId, ...recipients.map((r) => r.id)],
          { type: 'shared.changed', id: memo.id },
        );
      }
    }

    const msg = await prisma.directMessage.create({
      data: {
        conversationId: req.params.id,
        senderId: viewer.id,
        body: input.body ?? '',
        memoId: input.memoId ?? null,
        images: imageUrls,
        isSticker: input.isSticker,
        replyToId,
        audioUrl: audio?.url ?? null,
        audioDurationSec: audio ? (input.audioDurationSec ?? null) : null,
      },
      include: messageInclude,
    });
    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { lastMessageAt: new Date() },
    });

    // Sender has read their own message.
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: req.params.id, userId: viewer.id } },
      data: { lastReadAt: new Date() },
    });

    // A connected recipient's client will pick this message up over SSE right
    // away — count that as "delivered" (double gray tick) without waiting for
    // them to open this specific thread. 1:1 only — groups have no delivery tick.
    if (soleRecipient && isOnline(soleRecipient.id)) {
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: req.params.id, userId: soleRecipient.id } },
        data: { lastDeliveredAt: new Date() },
      });
    }

    publish(
      conv.participants.map((p) => p.userId),
      { type: 'dm', conversationId: req.params.id },
    );

    if (recipients.length) {
      const actor = await getActor(viewer);
      for (const r of recipients) {
        void notifyDirectMessage({
          conversationId: req.params.id,
          recipientId: r.id,
          senderId: viewer.id,
          senderName: actor.name,
        });
      }
    }

    res.status(201).json(serializeMessage(msg, viewer, null, conv.isGroup));
  }),
);

// PATCH /:id/messages/:messageId  { body }  -> DirectMessage — sender-only,
// can't edit a message already deleted-for-everyone, and (per WhatsApp) can't
// edit down to empty — that's what delete is for.
conversationsRouter.patch(
  '/:id/messages/:messageId',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(4000) })
      .parse(req.body);

    const m = await prisma.directMessage.findUnique({
      where: { id: req.params.messageId },
    });
    if (!m || m.conversationId !== req.params.id) {
      throw new HttpError(404, 'message not found');
    }
    if (m.senderId !== viewer.id) throw new HttpError(403, 'you can only edit your own messages');
    if (m.deletedAt !== null) throw new HttpError(400, 'cannot edit a deleted message');

    const updated = await prisma.directMessage.update({
      where: { id: m.id },
      data: { body, editedAt: new Date() },
      include: messageInclude,
    });

    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { isGroup: true, participants: { select: { userId: true } } },
    });
    publish(
      conv.participants.map((p) => p.userId),
      { type: 'dm', conversationId: req.params.id },
    );

    res.json(serializeMessage(updated, viewer, null, conv.isGroup));
  }),
);

// DELETE /:id/messages/:messageId  { scope: 'me' | 'everyone' }
//  - 'everyone': sender-only, actually clears the content (not just a flag —
//    belt-and-suspenders against a future serializer bug leaking it) and
//    broadcasts the placeholder to every participant.
//  - 'me': any participant, only affects the caller's own view — the server
//    just remembers to omit it from their GET /messages from now on.
conversationsRouter.delete(
  '/:id/messages/:messageId',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { scope } = z.object({ scope: z.enum(['me', 'everyone']) }).parse(req.body);

    const m = await prisma.directMessage.findUnique({
      where: { id: req.params.messageId },
    });
    if (!m || m.conversationId !== req.params.id) {
      throw new HttpError(404, 'message not found');
    }

    if (scope === 'everyone') {
      if (m.senderId !== viewer.id) {
        throw new HttpError(403, 'you can only delete your own messages for everyone');
      }
      const updated = await prisma.directMessage.update({
        where: { id: m.id },
        data: { deletedAt: new Date(), body: '', images: [], audioUrl: null, audioDurationSec: null },
        include: messageInclude,
      });
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { isGroup: true, participants: { select: { userId: true } } },
      });
      publish(
        conv.participants.map((p) => p.userId),
        { type: 'dm', conversationId: req.params.id },
      );
      res.json(serializeMessage(updated, viewer, null, conv.isGroup));
      return;
    }

    if (!m.deletedFor.includes(viewer.id)) {
      await prisma.directMessage.update({
        where: { id: m.id },
        data: { deletedFor: { push: viewer.id } },
      });
    }
    // Only the caller's own view changes — publish to just them so their
    // other open tabs/devices drop it live too, matching this app's existing
    // multi-device consistency elsewhere.
    publish([viewer.id], { type: 'dm', conversationId: req.params.id });
    res.json({ ok: true });
  }),
);

// PUT /:id/messages/:messageId/reaction  { emoji }  -> DirectMessage
// Upserts the viewer's reaction on this message — reacting again with a
// different emoji SWAPS it (the compound unique key makes this a natural
// upsert), never adds a second row. Trusts the client on `emoji` being a
// real single-grapheme emoji; not worth validating server-side.
conversationsRouter.put(
  '/:id/messages/:messageId/reaction',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { emoji } = z.object({ emoji: z.string().min(1) }).parse(req.body);

    const m = await prisma.directMessage.findUnique({
      where: { id: req.params.messageId },
    });
    if (!m || m.conversationId !== req.params.id) {
      throw new HttpError(404, 'message not found');
    }
    if (m.deletedAt !== null) throw new HttpError(400, 'cannot react to a deleted message');

    await prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId: m.id, userId: viewer.id } },
      create: { messageId: m.id, userId: viewer.id, emoji },
      update: { emoji },
    });

    const updated = await prisma.directMessage.findUniqueOrThrow({
      where: { id: m.id },
      include: messageInclude,
    });
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { isGroup: true, participants: { select: { userId: true } } },
    });
    publish(
      conv.participants.map((p) => p.userId),
      { type: 'dm', conversationId: req.params.id },
    );
    res.json(serializeMessage(updated, viewer, null, conv.isGroup));
  }),
);

// DELETE /:id/messages/:messageId/reaction  -> DirectMessage
// Removes the viewer's reaction, if any — idempotent, no error when they
// didn't have one (matches the 'me'-scope delete's redundant-case handling
// above).
conversationsRouter.delete(
  '/:id/messages/:messageId/reaction',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);

    const m = await prisma.directMessage.findUnique({
      where: { id: req.params.messageId },
    });
    if (!m || m.conversationId !== req.params.id) {
      throw new HttpError(404, 'message not found');
    }

    await prisma.messageReaction.deleteMany({
      where: { messageId: m.id, userId: viewer.id },
    });

    const updated = await prisma.directMessage.findUniqueOrThrow({
      where: { id: m.id },
      include: messageInclude,
    });
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { isGroup: true, participants: { select: { userId: true } } },
    });
    publish(
      conv.participants.map((p) => p.userId),
      { type: 'dm', conversationId: req.params.id },
    );
    res.json(serializeMessage(updated, viewer, null, conv.isGroup));
  }),
);

// POST /:id/read  -> mark read up to now
conversationsRouter.post(
  '/:id/read',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: req.params.id, userId: viewer.id } },
      data: { lastReadAt: new Date() },
    });
    // Reading the thread also clears any pending "new message" bell
    // notifications for it — Notification is a separate table from this
    // conversation's own unread counter, so without this the bell kept
    // showing messages the user was already actively reading.
    const { count: clearedNotifications } = await prisma.notification.updateMany({
      where: { userId: viewer.id, conversationId: req.params.id, type: 'dm.message', read: false },
      data: { read: true },
    });
    if (clearedNotifications > 0) publish([viewer.id], { type: 'notification' });
    const others = await prisma.conversationParticipant.findMany({
      where: { conversationId: req.params.id, userId: { not: viewer.id } },
      select: { userId: true },
    });
    if (others.length) {
      publish(others.map((o) => o.userId), { type: 'dm', conversationId: req.params.id });
    }
    res.json({ ok: true });
  }),
);

// POST /:id/typing  { typing?: boolean }  -> fire-and-forget SSE ping to the
// other participant(s). No DB write — this is transient, never persisted.
conversationsRouter.post(
  '/:id/typing',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { typing } = z.object({ typing: z.boolean().optional() }).parse(req.body ?? {});
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { participants: { select: { userId: true } } },
    });
    if (!conv) throw new HttpError(404, 'conversation not found');
    const others = conv.participants.map((p) => p.userId).filter((id) => id !== viewer.id);
    publish(others, {
      type: 'typing',
      conversationId: req.params.id,
      userId: viewer.id,
      typing: typing ?? true,
    });
    res.json({ ok: true });
  }),
);

// --- group membership ---------------------------------------------------

async function loadGroup(conversationId: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: convInclude,
  });
  if (!conv) throw new HttpError(404, 'conversation not found');
  if (!conv.isGroup) throw new HttpError(400, 'not a group conversation');
  return conv;
}

// GET /:id/members  -> ChatGroupMember[]  (backs the group info panel)
conversationsRouter.get(
  '/:id/members',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const rows = await prisma.conversationParticipant.findMany({
      where: { conversationId: req.params.id },
      include: { user: participantSelect },
    });
    res.json(rows.map((r) => ({ ...participantView(r.user), isAdmin: r.isAdmin })));
  }),
);

// POST /:id/members  { emails }  -> ChatConversation — any admin, adds
// registered users not already in the group.
conversationsRouter.post(
  '/:id/members',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const conv = await loadGroup(req.params.id);
    if (!conv.participants.some((p) => p.userId === viewer.id && p.isAdmin)) {
      throw new HttpError(403, 'only a group admin can add members');
    }
    const { emails } = z
      .object({ emails: z.array(z.string().email()).min(1) })
      .parse(req.body);

    const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
    const users = await prisma.user.findMany({
      where: { email: { in: normalized } },
      select: { id: true },
    });
    if (!users.length) throw new HttpError(404, 'no matching accounts');

    const existingIds = new Set(conv.participants.map((p) => p.userId));
    const toAdd = users.filter((u) => !existingIds.has(u.id));
    if (toAdd.length) {
      await prisma.conversationParticipant.createMany({
        data: toAdd.map((u) => ({ conversationId: conv.id, userId: u.id })),
        skipDuplicates: true,
      });
    }

    const updated = await prisma.conversation.findUniqueOrThrow({
      where: { id: conv.id },
      include: convInclude,
    });
    publish(
      updated.participants.map((p) => p.userId),
      { type: 'dm', conversationId: conv.id },
    );
    if (toAdd.length) {
      const actor = await getActor(viewer);
      for (const u of toAdd) {
        void notifyGroupAdded({
          conversationId: conv.id,
          groupName: conv.groupName || 'Grupo',
          recipientId: u.id,
          actorName: actor.name,
        });
      }
    }
    res.json(serializeConversation(updated, viewer.id, await unreadFor(conv.id, viewer.id)));
  }),
);

// Removes `userId`'s participant row from a conversation, then:
//  - if that was the last participant, deletes the conversation outright
//    (messages/participants cascade per the schema);
//  - else if that emptied out a group's admins, hands admin to a random
//    survivor (a group can have N admins, so this only fires when the one
//    who left was the last one standing).
// Shared by the group-only member-removal route and the generic "leave/
// delete this conversation for me" route below, so 1:1 and group deletion
// go through exactly one code path.
async function leaveConversation(
  conversationId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true },
  });
  if (!conv) return { removed: false };

  const deleted = await prisma.conversationParticipant.deleteMany({
    where: { conversationId, userId },
  });
  if (deleted.count === 0) return { removed: false };

  const remaining = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true, isAdmin: true },
  });

  if (remaining.length === 0) {
    await prisma.conversation.delete({ where: { id: conversationId } });
    return { removed: true };
  }

  if (conv.isGroup && !remaining.some((p) => p.isAdmin)) {
    const next = remaining[Math.floor(Math.random() * remaining.length)];
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: next.userId } },
      data: { isAdmin: true },
    });
  }

  publish(
    [...remaining.map((p) => p.userId), userId],
    { type: 'dm', conversationId },
  );
  return { removed: true };
}

// DELETE /:id/members/:userId  -> { ok: true } — group only. Any admin can
// remove anyone; anyone can remove themselves (leave the group).
conversationsRouter.delete(
  '/:id/members/:userId',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const conv = await loadGroup(req.params.id);
    await loadParticipantConv(req.params.id, viewer.id);
    const target = req.params.userId;
    const isSelf = target === viewer.id;
    const viewerIsAdmin = conv.participants.some((p) => p.userId === viewer.id && p.isAdmin);
    if (!isSelf && !viewerIsAdmin) {
      throw new HttpError(403, 'only a group admin can remove other members');
    }

    const { removed } = await leaveConversation(conv.id, target);
    if (!removed) throw new HttpError(404, 'member not found');
    res.json({ ok: true });
  }),
);

// POST /:id/admins/:userId  -> ChatConversation — any current admin can
// promote another member. Additive: a group can have any number of admins,
// so this never revokes the promoter's own admin status.
conversationsRouter.post(
  '/:id/admins/:userId',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const conv = await loadGroup(req.params.id);
    if (!conv.participants.some((p) => p.userId === viewer.id && p.isAdmin)) {
      throw new HttpError(403, 'only a group admin can promote members');
    }
    const target = conv.participants.find((p) => p.userId === req.params.userId);
    if (!target) throw new HttpError(400, 'that user is not a member of this group');

    if (!target.isAdmin) {
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: conv.id, userId: target.userId } },
        data: { isAdmin: true },
      });
    }

    const updated = await prisma.conversation.findUniqueOrThrow({
      where: { id: conv.id },
      include: convInclude,
    });
    publish(
      updated.participants.map((p) => p.userId),
      { type: 'dm', conversationId: conv.id },
    );
    res.json(serializeConversation(updated, viewer.id, await unreadFor(conv.id, viewer.id)));
  }),
);

// DELETE /:id/admins/:userId  -> ChatConversation — any current admin can
// demote another admin, except the group's creator (ownerId), who can never
// be demoted. No-ops (like promote) if the target isn't currently an admin.
conversationsRouter.delete(
  '/:id/admins/:userId',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const conv = await loadGroup(req.params.id);
    if (!conv.participants.some((p) => p.userId === viewer.id && p.isAdmin)) {
      throw new HttpError(403, 'only a group admin can demote members');
    }
    const target = conv.participants.find((p) => p.userId === req.params.userId);
    if (!target) throw new HttpError(400, 'that user is not a member of this group');
    if (target.userId === conv.ownerId) {
      throw new HttpError(403, 'the group creator cannot be demoted');
    }
    // No self-service demotion, even for a non-creator admin. The only way
    // to stop being admin is to leave the group and have another admin
    // re-add you — which starts you over as a plain member, since a fresh
    // ConversationParticipant row always defaults isAdmin to false.
    if (target.userId === viewer.id) {
      throw new HttpError(403, 'you cannot remove your own admin status');
    }

    if (target.isAdmin) {
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: conv.id, userId: target.userId } },
        data: { isAdmin: false },
      });
    }

    const updated = await prisma.conversation.findUniqueOrThrow({
      where: { id: conv.id },
      include: convInclude,
    });
    publish(
      updated.participants.map((p) => p.userId),
      { type: 'dm', conversationId: conv.id },
    );
    res.json(serializeConversation(updated, viewer.id, await unreadFor(conv.id, viewer.id)));
  }),
);

// PATCH /:id/photo  multipart "photo" (single image) -> ChatConversation —
// group admin only, updates the group's photo. Any member can still view it
// full-screen from the group info panel; only setting/changing it is gated.
conversationsRouter.patch(
  '/:id/photo',
  upload.single('photo'),
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const conv = await loadGroup(req.params.id);
    if (!conv.participants.some((p) => p.userId === viewer.id && p.isAdmin)) {
      throw new HttpError(403, 'only a group admin can change the group photo');
    }
    if (!req.file) throw new HttpError(400, 'photo file required');
    const img = await toWebp(req.file.buffer);

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { groupPhoto: img.url },
      include: convInclude,
    });
    publish(
      updated.participants.map((p) => p.userId),
      { type: 'dm', conversationId: conv.id },
    );
    res.json(serializeConversation(updated, viewer.id, await unreadFor(conv.id, viewer.id)));
  }),
);

// DELETE /:id  -> { ok: true } — the caller leaves/deletes this conversation
// for themself. Works for both a 1:1 (disappears from your list; deleted
// outright once BOTH sides have done this, or immediately if the other side
// already left) and a group (identical to leaving it via the members route —
// see leaveConversation).
conversationsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadParticipantConv(req.params.id, viewer.id);
    const { removed } = await leaveConversation(req.params.id, viewer.id);
    if (!removed) throw new HttpError(404, 'conversation not found');
    res.json({ ok: true });
  }),
);
