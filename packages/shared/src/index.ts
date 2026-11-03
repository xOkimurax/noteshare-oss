/**
 * Types shared between the Noteshare API (`@noteshare/api`) and web
 * (`@noteshare/web`). This is the wire contract of the REST API — the shape
 * of what `/api/*` endpoints accept and return.
 */

export type KanbanStatus = 'pending' | 'in-progress' | 'completed';
export type MemoType = 'note' | 'list';
export type CollaborationRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'blocked';

export interface Location {
  lat: number;
  lng: number;
  name: string;
}

export interface MemoImage {
  id: string;
  /** Path relative to the API origin, e.g. "/uploads/<uuid>.webp". */
  url: string;
  position: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/** How the memo relates to the user who requested it. */
export type MemoRole = 'owner' | 'collaborator' | 'shared' | 'public';

export interface Memo {
  id: string;
  title: string;
  content: string;
  type: MemoType;
  color: string;
  tags: string[];
  /** A Kanban column id — one of the defaults or a user-defined column. */
  kanbanStatus: string;
  kanbanTimeLogs: Record<string, number>;
  dueDate: string | null;
  location: Location | null;
  folderId: string | null;
  ownerId: string;
  images: MemoImage[];
  /** Resolved collaborator user ids plus invited-by-email addresses. */
  collaborators: string[];
  shareCode: string | null;
  shareName: string | null;
  allowAnyone: boolean;
  allowedEmails: string[];
  isPublic: boolean;
  publicSlug: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed by the API for the requesting user; absent on public reads. */
  role?: MemoRole;
}

export interface Folder {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

/** A Kanban column: `id` is stored on each memo's `kanbanStatus`. */
export interface KanbanColumn {
  id: string;
  label: string;
}

export interface UserProfile {
  id: string;
  email: string;
  /** Unique handle, lowercase [a-z0-9_]{3,20}. null until the user sets one. */
  username: string | null;
  displayName: string;
  photoURL: string;
  frequentCollaborators: string[];
  /** null → the client's translated default columns. */
  kanbanColumns: KanbanColumn[] | null;
  isAdmin: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  /** Only present in the response that creates the token. */
  token?: string;
}

export type ContactSource = 'manual' | 'shared-out' | 'shared-in' | 'joined';

/** An entry in the current user's private address book. */
export interface Contact {
  id: string;
  email: string;
  /** Display name: the contact's account name, else the owner's alias, else the email. */
  name: string;
  photoURL: string;
  alias: string | null;
  favorite: boolean;
  /** Whether this email currently belongs to a registered Noteshare user. */
  hasAccount: boolean;
  source: ContactSource;
  createdAt: string;
}

/** A registered user matching a nickname-prefix search, not yet a contact. */
export interface UserSearchResult {
  id: string;
  username: string;
  name: string;
  photoURL: string;
}

export interface CollaborationRequest {
  id: string;
  memoId: string;
  fromUserId: string | null;
  fromEmail: string;
  toEmail: string;
  status: CollaborationRequestStatus;
  createdAt: string;
}

// --- Request payloads -------------------------------------------------------

export interface MemoInput {
  title: string;
  content?: string;
  type?: MemoType;
  color?: string;
  tags?: string[];
  kanbanStatus?: string;
  dueDate?: string | null;
  location?: Location | null;
  folderId?: string | null;
}

export interface ShareInput {
  shareCode?: string | null;
  shareName?: string | null;
  allowAnyone?: boolean;
  allowedEmails?: string[];
  isPublic?: boolean;
  publicSlug?: string | null;
}

export type NotificationType =
  | 'memo.shared'
  | 'memo.updated'
  | 'memo.joined'
  | 'memo.comment'
  | 'dm.message'
  | 'system.announcement'
  | 'group.added';

export interface AppNotification {
  id: string;
  type: NotificationType;
  memoId: string | null;
  memoTitle: string;
  /** Set for 'dm.message' — the conversation to open. */
  conversationId: string | null;
  actorName: string;
  read: boolean;
  createdAt: string;
}

// --- Chat: note comments ---------------------------------------------------

export interface MemoComment {
  id: string;
  memoId: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** authorId === the requesting viewer. */
  mine: boolean;
}

// --- Chat: direct messages -----------------------------------------------

export interface ChatParticipant {
  id: string;
  name: string;
  email: string;
  photoURL: string;
  /** Has at least one live SSE connection right now. */
  online: boolean;
  /** Last time they connected/disconnected — ignored while `online`. */
  lastSeenAt: string;
}

/** Group metadata for a group conversation. */
export interface ChatGroupInfo {
  id: string;
  name: string;
  photoURL: string;
  memberCount: number;
  /** Whether the current viewer is an admin of this group. A group can have
   * any number of admins — promoting someone is additive, not a transfer. */
  viewerIsAdmin: boolean;
  /** The member who created the group — never demotable. Null is not
   * expected in practice (every group has a creator) but the field predates
   * this and was nullable, so it stays nullable rather than backfilling. */
  ownerId: string | null;
}

/** A group member row, as returned by GET /:id/members. */
export interface ChatGroupMember extends ChatParticipant {
  isAdmin: boolean;
}

export interface ChatConversation {
  id: string;
  isGroup: boolean;
  /** The other person in this 1:1 thread; null for a group. */
  other: ChatParticipant | null;
  /** Set for a group conversation; null for a 1:1. */
  group: ChatGroupInfo | null;
  lastMessage: {
    body: string;
    createdAt: string;
    mine: boolean;
    /** Sender's display name — only meaningful in a group preview. */
    senderName?: string;
  } | null;
  lastMessageAt: string;
  unread: number;
}

/** A note carried by a direct message (forwarded, or created-and-sent). */
export interface SharedNoteRef {
  id: string;
  title: string;
  type: MemoType;
  /** Whether the viewer currently has access to open it. */
  accessible: boolean;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read';

/** What a quoted/replied-to message shows in the reply line — a lightweight
 * snapshot taken at read time, not a live reference, so it still renders
 * something sensible if the original is later deleted-for-everyone. */
export interface DirectMessageReplyPreview {
  id: string;
  senderName: string;
  /** Empty when the quoted message has no text (a bare photo/sticker/audio). */
  body: string;
  kind: 'text' | 'image' | 'sticker' | 'audio' | 'note';
  deleted: boolean;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  /** Sender's display name — only rendered in group threads (self-evident in a 1:1). */
  senderName: string;
  body: string;
  createdAt: string;
  /** senderId === the requesting viewer. */
  mine: boolean;
  /** Set when this message is a shared note. */
  sharedNote: SharedNoteRef | null;
  /** Pasted/attached photos — API-relative "/uploads/…" paths. */
  images: string[];
  /** True when `images` holds a sticker (sent via the sticker tray) rather
   * than a pasted/attached photo — same upload path, different intent, so
   * the client can render/position things (e.g. the reaction popover) for
   * a sticker's tighter, non-cropped bubble differently from a regular photo. */
  isSticker: boolean;
  /** A voice message — API-relative "/uploads/…" path; null for every other
   * message kind. */
  audioUrl: string | null;
  /** Recorded client-side; only meaningful when audioUrl is set. */
  audioDurationSec: number | null;
  /** The message this one is replying to, if any (WhatsApp-style quote). */
  replyTo: DirectMessageReplyPreview | null;
  /** Set once the sender edits body/images after sending. */
  editedAt: string | null;
  /** "Deleted for everyone" — true means body/images/audio are already
   * cleared server-side; render the "this message was deleted" placeholder.
   * Distinct from "deleted for me", which the server just omits from the
   * viewer's list instead of flagging. */
  deleted: boolean;
  /** WhatsApp-style tick status, from the other participant's read/delivery cursors. */
  status: DeliveryStatus;
  /** One entry per distinct emoji used on this message, aggregated across
   * everyone who reacted with it. A user has at most one reaction per
   * message (reacting again with a different emoji replaces it, never
   * adds a second) — that's enforced server-side, not implied by this shape. */
  reactions: MessageReactionSummary[];
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  /** Whether the viewer is one of the people who reacted with this emoji. */
  mine: boolean;
}

/** Every photo and shared note ever exchanged in a conversation — for the
 * "contact info" panel's media/notes tabs, newest first. */
export interface ConversationMedia {
  /** One page of shared photos — see imagesPage/imagesPageSize/imagesTotal. */
  images: { url: string; createdAt: string }[];
  imagesTotal: number;
  imagesPage: number;
  imagesPageSize: number;
  /** Every shared note, unpaginated — the panel searches this client-side. */
  notes: { id: string; title: string; type: MemoType; accessible: boolean; createdAt: string }[];
  /** Every URL mentioned in a message body, unpaginated, newest first. */
  urls: { url: string; createdAt: string }[];
}

// Common TLDs — bare mentions like "app.example.com" or
// "google.com" should count too, not just "https://…". Kept to a curated list
// (rather than "any word.word") so file names like "informe.pdf" don't get
// swept up. Shared between the web app's message linkification and the API's
// "shared URLs" extraction so the two stay in agreement about what counts.
const URL_TLDS =
  '(?:com|net|org|io|dev|app|co|online|xyz|info|biz|edu|gov|mil|tv|me|ai|' +
  'us|uk|ca|de|fr|it|nl|se|no|dk|fi|pl|ru|cn|jp|kr|in|au|nz|' +
  'br|mx|ar|cl|py|uy|bo|pe|ve|ec|cr|pa|gt|hn|ni|sv|do|cu|es|pt|' +
  'ch|at|be|ie|gr|tr|il|sa|ae|eg|za|ng|ke|page|site|shop|store|tech|cloud|link)';

export const URL_REGEX = new RegExp(
  // The bare-domain branch requires a real boundary before it, so
  // "alguien@gmail.com" doesn't get split into "alguien@" + a link to
  // "gmail.com" (or "mail.com" once the regex backtracks into the word).
  `(https?://[^\\s]+|(?<![\\w@.])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+${URL_TLDS}\\b(?:/[^\\s]*)?)`,
  'gi',
);

/** Every URL mentioned in a chunk of text — same rules as the chat's own
 * link-detection, so "shared URLs" matches what actually renders as a link. */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  return text.match(URL_REGEX) ?? [];
}

// --- SSE stream events ------------------------------------------------------

export type StreamEvent =
  | { type: 'memo.changed'; id: string }
  | { type: 'memo.deleted'; id: string }
  | { type: 'folder.changed'; id: string }
  | { type: 'shared.changed'; id: string }
  | { type: 'notification' }
  | { type: 'memo.comment'; memoId: string }
  | { type: 'dm'; conversationId: string }
  | { type: 'presence'; userId: string }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean };
