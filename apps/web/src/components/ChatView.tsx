import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckSquare,
  CornerUpLeft,
  FileText,
  ImagePlus,
  Loader2,
  Maximize2,
  Mic,
  MessagesSquare,
  MoreVertical,
  Pause,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Smile,
  SmilePlus,
  Sticker,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import EmojiPicker, { Theme, Emoji, type EmojiClickData } from 'emoji-picker-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type {
  ChatConversation,
  ChatGroupInfo as GroupMeta,
  ChatParticipant,
  DeliveryStatus,
  DirectMessage,
  DirectMessageReplyPreview,
} from '@noteshare/shared';
import { api, assetUrl } from '../api';
import { qk } from '../query';
import { timeAgo, renderWithLinks } from '../utils';
import { useAuth } from '../auth';
import { useConversations, useContacts, useMessages, useMemos } from '../hooks/data';
import { isTyping, typingUserIds, useTypingVersion } from '../hooks/useTyping';
import { useBackable } from '../hooks/useBackable';
import { useIsDesktop } from '../hooks/useIsDesktop';
import MemoEditor from './MemoEditor';
import ImageEditor from './ImageEditor';
import ChatContactInfo from './ChatContactInfo';
import ChatGroupInfo from './ChatGroupInfo';
import ImageLightbox from './ImageLightbox';
import { describeUploadFailure } from '../lib/uploadDiagnostics';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A small first-party starter pack — see public/stickers/LICENSE.txt for
// provenance/attribution. `id` is the .webp filename under public/stickers/.
const STICKERS: { id: string; label: string }[] = [
  { id: 'thumbs-up', label: '👍' },
  { id: 'thumbs-down', label: '👎' },
  { id: 'heart', label: '❤️' },
  { id: 'joy', label: '😂' },
  { id: 'rofl', label: '🤣' },
  { id: 'heart-eyes', label: '😍' },
  { id: 'smiling-hearts', label: '🥰' },
  { id: 'crying', label: '😢' },
  { id: 'sobbing', label: '😭' },
  { id: 'open-mouth', label: '😮' },
  { id: 'scream', label: '😱' },
  { id: 'sunglasses', label: '😎' },
  { id: 'partying-face', label: '🥳' },
  { id: 'fire', label: '🔥' },
  { id: 'party-popper', label: '🎉' },
  { id: 'hundred', label: '💯' },
  { id: 'clap', label: '👏' },
  { id: 'pray', label: '🙏' },
  { id: 'raise-hands', label: '🙌' },
  { id: 'thinking', label: '🤔' },
  { id: 'sleeping', label: '😴' },
  { id: 'angry', label: '😡' },
  { id: 'star', label: '⭐' },
  { id: 'check', label: '✅' },
  { id: 'cross', label: '❌' },
  { id: 'rocket', label: '🚀' },
  { id: 'eyes', label: '👀' },
  { id: 'handshake', label: '🤝' },
];

// WhatsApp's default quick-react row — anything else goes through the "+"
// full picker (reuses the same emoji-picker-react component as the composer).
// `emoji` is the raw Unicode character — still what's sent to onReact(m, emoji)
// and compared against server-stored reactions, wire format unchanged.
// `unified` is the hex-codepoint key emoji-picker-react's own <Emoji> component
// needs to render the exact same image asset the full picker uses, instead of
// falling back to the OS/browser's native emoji font glyph.
const QUICK_REACTIONS: { emoji: string; unified: string }[] = [
  { emoji: '👍', unified: '1f44d' },
  { emoji: '❤️', unified: '2764-fe0f' },
  { emoji: '😂', unified: '1f602' },
  { emoji: '😮', unified: '1f62e' },
  { emoji: '😢', unified: '1f622' },
  { emoji: '🙏', unified: '1f64f' },
];

interface ChatViewProps {
  openConversationId?: string | null;
  onOpenSharedNote?: (memoId: string) => void;
}

function Avatar({
  name,
  photoURL,
  size = 'md',
  online,
}: {
  name?: string;
  photoURL?: string | null;
  size?: 'sm' | 'md';
  /** Renders a green dot in the corner when true; no badge when omitted. */
  online?: boolean;
}) {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const icon = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const dot = online && (
    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-stone-900" />
  );
  if (photoURL) {
    return (
      <span className="relative inline-block shrink-0">
        <img
          src={photoURL}
          alt={name || ''}
          className={cn(dim, 'rounded-full object-cover shrink-0')}
        />
        {dot}
      </span>
    );
  }
  return (
    <span className="relative inline-block shrink-0">
      <div
        className={cn(
          dim,
          'rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0',
        )}
      >
        <UserRound className={icon} />
      </div>
      {dot}
    </span>
  );
}

function GroupAvatar({
  photoURL,
  size = 'md',
}: {
  photoURL?: string | null;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const icon = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className={cn(dim, 'rounded-full object-cover shrink-0')}
      />
    );
  }
  return (
    <div
      className={cn(
        dim,
        'rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 flex items-center justify-center shrink-0',
      )}
    >
      <Users className={icon} />
    </div>
  );
}

function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-current inline-block"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

// WhatsApp-style ticks for my own sent messages: single check = sent, double
// gray = delivered, double blue = read. `onColor` is for a timestamp sitting
// on top of the emerald bubble background; `onLight` for one sitting below/
// outside it on the page background.
function MessageTicks({
  status,
  variant,
}: {
  status: DeliveryStatus;
  variant: 'onColor' | 'onLight';
}) {
  const color =
    status === 'read'
      ? variant === 'onColor'
        ? 'text-sky-300'
        : 'text-blue-500'
      : variant === 'onColor'
        ? 'text-emerald-100/80'
        : 'text-stone-400';
  return (
    <span className={cn('inline-flex shrink-0', color)}>
      {status === 'sent' ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <CheckCheck className="w-3.5 h-3.5" />
      )}
    </span>
  );
}

// Label for a reply target that has no text of its own — mirrors the icon
// choices the "shared photos/notes" previews elsewhere in this file already use.
function replyKindLabel(kind: DirectMessageReplyPreview['kind']): string {
  switch (kind) {
    case 'image':
      return '📷 Foto';
    case 'audio':
      return '🎤 Nota de voz';
    case 'sticker':
      return '😀 Sticker';
    case 'note':
      return '📎 Nota';
    default:
      return '';
  }
}

// Same idea as replyKindLabel, but for the composer banner, which only has a
// full DirectMessage to work with (no `kind` — the client never learns
// whether a bare image is a sticker or a real photo, see serializeMessage on
// the API side), so a sticker degrades to the generic photo label here.
function replyBannerSnippet(m: DirectMessage): string {
  if (m.body) return m.body;
  if (m.sharedNote) return `📎 ${m.sharedNote.title || 'Nota'}`;
  if (m.audioUrl) return '🎤 Nota de voz';
  if (m.images.length > 0) return '📷 Foto';
  return '';
}

// The small quoted block a reply renders inside its own bubble, above the
// message's own content — same left-border-accent treatment as the banner
// above the composer, per the reused "attached thing" visual pattern.
function ReplyQuote({
  reply,
  mine,
  onClick,
}: {
  reply: DirectMessageReplyPreview;
  mine: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'w-full max-w-full rounded-lg px-2.5 py-1.5 border-l-4 text-xs',
        onClick && 'cursor-pointer',
        mine
          ? 'bg-emerald-700/20 border-emerald-200 hover:bg-emerald-700/30'
          : 'bg-stone-200/70 dark:bg-stone-700/50 border-emerald-500 hover:bg-stone-300/70 dark:hover:bg-stone-700/70',
      )}
    >
      <p
        className={cn(
          'font-semibold truncate',
          mine ? 'text-emerald-50' : 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {reply.senderName}
      </p>
      {reply.deleted ? (
        <p className={cn('italic truncate', mine ? 'text-emerald-100/70' : 'text-stone-400 dark:text-stone-500')}>
          Mensaje eliminado
        </p>
      ) : (
        <p className={cn('truncate', mine ? 'text-emerald-50/90' : 'text-stone-600 dark:text-stone-300')}>
          {reply.body || replyKindLabel(reply.kind)}
        </p>
      )}
    </div>
  );
}

// "m:ss" — WhatsApp-style compact duration, used both by the bubble player
// and the composer's live recording timer.
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// Live waveform: pixel pitch of one bar (must match the w-1/gap-[3px]
// classes on the actual bar elements below) — used to compute, from the
// container's *measured* width, how many bars fit exactly edge-to-edge.
// A fixed bar *count* instead (as this used to be) is right for exactly one
// container width and either leaves empty space (too few bars for a wide
// desktop panel) or overflows (too many for a narrow mobile one); a fixed
// bar *width* stretched to fill instead (also tried) makes bars balloon
// wide with few samples and shrink to illegible slivers with many, on
// whatever width happens to be narrow. Measuring keeps the bars a
// consistent, legible size and still always spans the full container.
const WAVEFORM_BAR_PX = 4;
const WAVEFORM_GAP_PX = 3;
const WAVEFORM_SAMPLE_MS = 120;

// A voice message's bubble content: play/pause + elapsed/total time, backed
// by a plain <audio> element (kept off-screen — the button+label above it is
// the actual UI). audioDurationSec (captured client-side at record time) is
// used as the displayed total rather than audio.duration, since a browser-
// recorded webm's container often reports Infinity for duration until fully
// seeked (a known MediaRecorder/Chromium quirk) — sidestepping it entirely.
function VoiceMessageBubble({
  url,
  durationSec,
  mine,
}: {
  url: string;
  durationSec: number | null;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  const label = formatDuration(playing || currentTime > 0 ? currentTime : (durationSec ?? 0));

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 min-w-[168px]',
        mine
          ? 'bg-emerald-600 text-white rounded-br-md'
          : 'bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-bl-md',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        title={playing ? 'Pausar' : 'Reproducir'}
        className={cn(
          'shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors',
          mine ? 'bg-white/20 hover:bg-white/30' : 'bg-emerald-600 text-white hover:bg-emerald-700',
        )}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <Mic className={cn('w-4 h-4 shrink-0', mine ? 'text-white/70' : 'text-stone-400')} />
      <span className="text-xs tabular-nums">{label}</span>
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  );
}

// The small "⋮" action menu + swipe-to-reply gesture for one message row.
// Pulled out of the main flatMap into its own component because the swipe
// gesture needs a live motion value + open/closed menu state per message —
// hooks can't be called a variable number of times inside a .map in the
// parent component, so each row needs to be its own component instance.
function MessageRow({
  m,
  isGroup,
  highlighted,
  onOpenSharedNote,
  onViewImages,
  onReply,
  onEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onJumpToReply,
  onReact,
}: {
  m: DirectMessage;
  isGroup: boolean;
  /** True for the ~1.5s after tapping a reply quote that points at this message. */
  highlighted: boolean;
  onOpenSharedNote?: (memoId: string) => void;
  onViewImages: (images: string[], index: number) => void;
  onReply: (m: DirectMessage) => void;
  onEdit: (m: DirectMessage) => void;
  onDeleteForMe: (m: DirectMessage) => void;
  onDeleteForEveryone: (m: DirectMessage) => void;
  onJumpToReply: (messageId: string) => void;
  /** Toggle rule (same for the quick-react row, an existing pill, or the
   * full picker) lives in the parent: same emoji you already reacted with
   * removes it, any other emoji sets/replaces it. */
  onReact: (m: DirectMessage, emoji: string) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  // Decided at the moment the "⋮" button is clicked (not while rendering the
  // menu) — by then the button's position in the viewport is known, so we can
  // tell whether the menu (~170px tall) fits below it before opening upward
  // becomes the only option that keeps it fully visible/clickable.
  const [openUpward, setOpenUpward] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [reactOpen, setReactOpen] = useState(false);
  const [reactOpenUpward, setReactOpenUpward] = useState(false);
  // Within the react popover: the quick-6 row, or the full emoji-picker
  // (opened via "+") — never both at once.
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const reactButtonRef = useRef<HTMLButtonElement>(null);
  // Positioning anchor for the react popover — the SmilePlus button itself on
  // desktop, but that button doesn't exist on mobile (see isDesktop gate
  // below), so the popover is anchored to this always-present wrapper
  // instead, driven by whichever trigger opened it (click or long-press).
  const reactAnchorRef = useRef<HTMLDivElement>(null);
  // On mobile there's no SmilePlus button (see isDesktop gate below) — the
  // popover only opens via long-press, WhatsApp-style, and per the user's own
  // request it should always appear centered BELOW the message on mobile,
  // for every message (not just stickers, where this started: a compact
  // sticker bubble's narrow width made the original CSS-anchored positioning
  // (reactAnchorRef, via left-0/right-0, still used on desktop) clip the
  // popover off-screen — but a short text bubble near the top of the thread
  // hit the exact same clipping for the same reason, just less often, so the
  // fix generalizes to every mobile message rather than staying sticker-only).
  // Measuring the real bubble box and positioning with `position:fixed`
  // (below) instead of trusting the CSS-class anchor is what makes this
  // reliable regardless of bubble width or where it sits in the viewport.
  const useMobileFixedPos = !isDesktop;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mobileFixedPos, setMobileFixedPos] = useState<{ left: number; top: number } | null>(null);
  const openReactPopover = (toggle: boolean) => {
    // Same boundary logic regardless of trigger — budget room for the
    // quick-6 row (the full picker, once opened, gets its own scroll so it
    // doesn't need the same headroom). Only matters on desktop's
    // CSS-anchored popover below — mobile always opens downward via the
    // measured fixed-position case, see useMobileFixedPos above.
    const REACT_BUDGET_PX = 60;
    const el = reactAnchorRef.current;
    let boundaryBottom = window.innerHeight;
    const scrollContainer = el?.closest('.custom-scrollbar');
    if (scrollContainer) {
      boundaryBottom = scrollContainer.getBoundingClientRect().bottom;
    }
    const rect = el?.getBoundingClientRect();
    const spaceBelow = rect ? boundaryBottom - rect.bottom : Infinity;
    setReactOpenUpward(spaceBelow < REACT_BUDGET_PX);
    setFullPickerOpen(false);
    // Recomputed by the layout effect below before the next paint, using the
    // freshly-mounted popover's real measured width — starting from null
    // avoids briefly showing a stale position left over from a previous open.
    if (useMobileFixedPos) setMobileFixedPos(null);
    // The desktop button toggles (click again to close); a long-press only
    // ever means "open" — there's no equivalent "press again to close"
    // gesture, closing happens via the existing tap-outside backdrop.
    if (toggle) setReactOpen((v) => !v);
    else setReactOpen(true);
  };
  // Measures the real on-screen boxes (bubble + just-mounted popover) at the
  // moment the sticker popover opens (or switches between the quick row and
  // the full picker, which are different widths), rather than trusting pure
  // CSS positioning — matching how this file already solves the analogous
  // "will the ⋮ menu fit below the button" problem via MENU_BUDGET_PX above.
  // useLayoutEffect (not useEffect) so the corrected position is committed
  // before the browser paints — no visible flash at the wrong spot.
  useLayoutEffect(() => {
    if (!reactOpen || !useMobileFixedPos) return;
    const bubbleEl = bubbleRef.current;
    const popoverEl = popoverRef.current;
    if (!bubbleEl || !popoverEl) return;
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const popoverWidth = popoverEl.getBoundingClientRect().width;
    const desiredLeft = bubbleRect.left + bubbleRect.width / 2 - popoverWidth / 2;
    const clampedLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - popoverWidth - 8));
    setMobileFixedPos({ left: clampedLeft, top: bubbleRect.bottom + 4 });
  }, [reactOpen, fullPickerOpen, useMobileFixedPos]);
  // Mobile long-press-to-react (WhatsApp-style), on your own messages and
  // received ones alike — the SmilePlus button is hidden on mobile entirely
  // (see isDesktop gate below), so this is the only way to react there.
  // Cancelled the instant the
  // gesture turns into the existing swipe-to-reply drag (via onDragStart, and
  // a movement-threshold fallback in case a touch produces few/no
  // intermediate pointermove events before onDragStart fires), so the two
  // gestures never both fire for the same press.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };
  const onRowPointerDown = (e: React.PointerEvent) => {
    if (isDesktop || m.deleted) return;
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      openReactPopover(false);
    }, LONG_PRESS_MS);
  };
  const onRowPointerMove = (e: React.PointerEvent) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD_PX) clearLongPress();
  };
  useEffect(() => clearLongPress, []);
  const x = useMotionValue(0);
  // Received messages swipe right to reply; your own (right-aligned) swipe
  // left instead — same gesture, mirrored to whichever side the bubble
  // isn't already pinned against.
  const replyIconOpacity = useTransform(x, m.mine ? [-48, 0] : [0, 48], m.mine ? [1, 0] : [0, 1]);
  // Edit only makes sense for a message with editable text of its own — a
  // plain-text message or a photo's caption. There's no client-visible flag
  // to tell a bare sticker/photo apart (see replyBannerSnippet above), but
  // neither ever has a body, so gating on a non-empty body already excludes
  // both along with audio/shared-notes (excluded explicitly).
  const canEdit = m.mine && !m.deleted && !m.sharedNote && !m.audioUrl && m.body.trim() !== '';
  // The emoji (if any) this viewer already reacted with on this message —
  // drives the highlighted state in the quick-react row below.
  const myReactionEmoji = m.reactions.find((r) => r.mine)?.emoji;

  return (
    <motion.div
      id={`msg-${m.id}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('relative flex flex-col', m.mine ? 'items-end' : 'items-start')}
      drag={m.deleted ? false : 'x'}
      style={{ x }}
      dragConstraints={m.mine ? { left: -64, right: 0 } : { left: 0, right: 64 }}
      dragElastic={0.15}
      // dragConstraints only clamps the range during the gesture — it does
      // not return the element to its start position on release.
      // dragSnapToOrigin does that independently of dragConstraints, giving
      // the WhatsApp "drag, release, snap back" behavior.
      dragSnapToOrigin
      onDragStart={clearLongPress}
      onDragEnd={(_e, info) => {
        if (m.deleted) return;
        if (m.mine ? info.offset.x < -48 : info.offset.x > 48) onReply(m);
      }}
      onPointerDown={onRowPointerDown}
      onPointerMove={onRowPointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
    >
      {!m.deleted && (
        <motion.span
          style={{ opacity: replyIconOpacity }}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none',
            m.mine ? '-right-6' : '-left-6',
          )}
        >
          <CornerUpLeft className="w-4 h-4" />
        </motion.span>
      )}
      {/* Sender label — a group thread has more than one possible "them", so
          name who sent it. */}
      {!m.mine && isGroup && (
        <span className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 px-3.5 mb-0.5">
          {m.senderName}
        </span>
      )}
      <div className={cn('group/msg flex w-full items-center gap-1', m.mine ? 'justify-end' : 'justify-start')}>
        <div className={cn('flex items-center gap-0.5 shrink-0', m.mine ? 'order-first' : 'order-last')}>
          {!m.deleted && (
            <div className="relative" ref={reactAnchorRef}>
              {/* Desktop only — on mobile this is hidden entirely in favor of
                  a long-press on a received message (see onRowPointerDown
                  above), matching the request to not just dim it but remove
                  it there. The wrapper div stays so the popover below still
                  has an anchor to position against either way. */}
              {isDesktop && (
                <button
                  ref={reactButtonRef}
                  type="button"
                  onClick={() => openReactPopover(true)}
                  title="Reaccionar"
                  className="p-1 rounded-full text-stone-400 opacity-0 group-hover/msg:opacity-100 hover:bg-stone-200/60 dark:hover:bg-stone-700/60 transition-opacity"
                >
                  <SmilePlus className="w-3.5 h-3.5" />
                </button>
              )}
              {reactOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => { setReactOpen(false); setFullPickerOpen(false); }}
                  />
                  <div
                    ref={popoverRef}
                    className={cn(
                      'z-20 bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-200 dark:border-stone-700 overflow-hidden',
                      // w-max (quick-row only — the full picker already has
                      // an explicit width above): without an explicit width,
                      // this popover's shrink-to-fit sizing collapses to a
                      // too-narrow box (verified via devtools measurement —
                      // a real, reproducible bug, not a hypothesis) once the
                      // quick row's emoji render as actual <img> elements
                      // (see the Emoji import above) rather than bare
                      // Unicode characters, clipping the last few reactions
                      // and the "+" button under overflow-hidden. w-max
                      // forces sizing to the row's real natural content
                      // width instead.
                      fullPickerOpen ? 'w-[300px] sm:w-[340px]' : 'p-1.5 w-max',
                      // Mobile: measured + position:fixed (see useLayoutEffect
                      // above), centered below the bubble, instead of the
                      // CSS-anchored scheme desktop still uses below — a
                      // narrow or edge-hugging bubble leaves the CSS anchor
                      // far less room than the popover needs, clipping it
                      // off-screen (verified live, originally for stickers,
                      // then generalized to every mobile message).
                      useMobileFixedPos
                        ? 'fixed'
                        : cn(
                            'absolute',
                            reactOpenUpward ? 'bottom-full mb-1' : 'top-full mt-1',
                            m.mine ? 'right-0' : 'left-0',
                          ),
                    )}
                    style={
                      useMobileFixedPos
                        ? {
                            left: mobileFixedPos?.left ?? 0,
                            top: mobileFixedPos?.top ?? 0,
                            // Hidden until the layout effect has measured the
                            // real popover width and computed a clamped
                            // position, so it never flashes at (0,0) first.
                            visibility: mobileFixedPos ? 'visible' : 'hidden',
                          }
                        : undefined
                    }
                  >
                    {fullPickerOpen ? (
                      <EmojiPicker
                        onEmojiClick={(data) => {
                          onReact(m, data.emoji);
                          setReactOpen(false);
                          setFullPickerOpen(false);
                        }}
                        theme={
                          document.documentElement.classList.contains('dark')
                            ? Theme.DARK
                            : Theme.LIGHT
                        }
                        width="100%"
                        height={320}
                        previewConfig={{ showPreview: false }}
                        searchPlaceholder={t('search') || 'Buscar...'}
                      />
                    ) : (
                      <div className="flex items-center gap-0.5">
                        {QUICK_REACTIONS.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => { onReact(m, r.emoji); setReactOpen(false); }}
                            className={cn(
                              // shrink-0: without it, the flex row's default
                              // flex-shrink:1 collapses the <Emoji>-rendered
                              // <img> to 0 width — a classic flexbox +
                              // percentage-max-width-image bug. The full
                              // <EmojiPicker> avoids this because it sets its
                              // own (non-percentage, calc()-based)
                              // --epr-emoji-fullsize CSS var on max-width; the
                              // standalone <Emoji> export used here doesn't,
                              // so it falls back to Tailwind's preflight
                              // `img { max-width: 100% }`, which is exactly
                              // the percentage that triggers the collapse.
                              'shrink-0 leading-none p-1.5 rounded-full border border-transparent transition-colors',
                              // Mark which emoji (if any) is already this
                              // viewer's own reaction — same emerald
                              // border/background the "mine" pill below the
                              // bubble already uses, so the visual language
                              // for "this one is yours" is consistent.
                              myReactionEmoji === r.emoji
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-600'
                                : 'hover:bg-stone-100 dark:hover:bg-stone-700',
                            )}
                          >
                            {/* Rendered via the picker library's own <Emoji>
                                component (keyed by unified codepoint) rather
                                than the bare Unicode character, so this row
                                uses the exact same image asset style as the
                                full picker below instead of the OS/browser's
                                native emoji font. */}
                            <Emoji unified={r.unified} size={24} />
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setFullPickerOpen(true)}
                          title="Más emojis"
                          className="p-1.5 rounded-full text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => {
                // ~4 items × ~36px + padding — budget enough room below the
                // button, otherwise flip the menu upward so it never renders
                // past the visible area. The boundary that matters is the
                // scrollable thread container's own bottom edge, not the
                // window's — the menu is an absolutely-positioned descendant
                // of that overflow-y-auto container, so it gets clipped there
                // even when the window itself still has room below it (e.g.
                // over the composer).
                const MENU_BUDGET_PX = 170;
                const btn = menuButtonRef.current;
                let boundaryBottom = window.innerHeight;
                const scrollContainer = btn?.closest('.custom-scrollbar');
                if (scrollContainer) {
                  boundaryBottom = scrollContainer.getBoundingClientRect().bottom;
                }
                const rect = btn?.getBoundingClientRect();
                const spaceBelow = rect ? boundaryBottom - rect.bottom : Infinity;
                setOpenUpward(spaceBelow < MENU_BUDGET_PX);
                setMenuOpen((v) => !v);
              }}
              title="Más opciones"
              className="p-1 rounded-full text-stone-400 opacity-60 md:opacity-0 md:group-hover/msg:opacity-100 hover:bg-stone-200/60 dark:hover:bg-stone-700/60 transition-opacity"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  className={cn(
                    'absolute z-20 w-44 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-200 dark:border-stone-700 py-1 overflow-hidden',
                    openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
                    m.mine ? 'right-0' : 'left-0',
                  )}
                >
                  {!m.deleted && (
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onReply(m); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      Responder
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onEdit(m); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDeleteForMe(m); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar para mí
                  </button>
                  {m.mine && !m.deleted && (
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onDeleteForEveryone(m); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar para todos
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div
          ref={bubbleRef}
          className={cn(
            'max-w-[78%] flex flex-col gap-1 rounded-2xl transition-colors duration-700',
            m.mine ? 'items-end' : 'items-start',
            // WhatsApp-style flash when jumped to via tapping a reply quote
            // that points here — a halo around the bubble rather than
            // restyling it, so it works the same across every bubble variant
            // (text/image/audio/deleted/...) without touching each one.
            highlighted && '-m-1.5 p-1.5 bg-amber-200/60 dark:bg-amber-400/20',
          )}
          // Double-click/double-tap anywhere on the message's own line replies
          // to it — the same action the swipe gesture and the menu's
          // "Responder" trigger. Not for an already-deleted message, matching
          // the menu already hiding "Responder" there.
          onDoubleClick={() => { if (!m.deleted) onReply(m); }}
        >
          {m.replyTo && !m.deleted && (
            <ReplyQuote reply={m.replyTo} mine={m.mine} onClick={() => onJumpToReply(m.replyTo!.id)} />
          )}
          {m.deleted ? (
            <>
              <span className="rounded-2xl px-3.5 py-2 text-sm italic bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500">
                Este mensaje fue eliminado
              </span>
              <span className="flex items-center gap-1 text-[10px] text-stone-400 px-1 whitespace-nowrap">
                {timeAgo(m.createdAt)}
                {m.mine && <MessageTicks status={m.status} variant="onLight" />}
              </span>
            </>
          ) : m.audioUrl ? (
            <>
              <VoiceMessageBubble url={assetUrl(m.audioUrl)} durationSec={m.audioDurationSec} mine={m.mine} />
              <span className="flex items-center gap-1 text-[10px] text-stone-400 px-1 whitespace-nowrap">
                {timeAgo(m.createdAt)}
                {m.mine && <MessageTicks status={m.status} variant="onLight" />}
              </span>
            </>
          ) : m.sharedNote ? (
            <>
              <button
                type="button"
                disabled={!m.sharedNote.accessible}
                onClick={() => m.sharedNote?.accessible && onOpenSharedNote?.(m.sharedNote.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left border transition-colors',
                  m.sharedNote.accessible
                    ? 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-emerald-400 dark:hover:border-emerald-500 cursor-pointer'
                    : 'bg-stone-100 dark:bg-stone-800/60 border-stone-200 dark:border-stone-700/60 opacity-70 cursor-default',
                )}
              >
                <span className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  {m.sharedNote.type === 'list' ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate dark:text-stone-100">
                    {m.sharedNote.title || t('note_unavailable')}
                  </span>
                  <span
                    className={cn(
                      'block text-xs truncate',
                      m.sharedNote.accessible
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-stone-400 dark:text-stone-500',
                    )}
                  >
                    {m.sharedNote.accessible ? `${t('open_in_shared')} ›` : t('note_no_access')}
                  </span>
                </span>
              </button>
              {m.body && (
                <span
                  className={cn(
                    'rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                    m.mine
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-bl-md',
                  )}
                >
                  {renderWithLinks(
                    m.body,
                    m.mine ? 'underline font-medium' : 'underline font-medium text-emerald-600 dark:text-emerald-400',
                  )}
                </span>
              )}
              <span className="flex items-center gap-1 text-[10px] text-stone-400 px-1 whitespace-nowrap">
                {timeAgo(m.createdAt)}
                {m.editedAt && <span>· editado</span>}
                {m.mine && <MessageTicks status={m.status} variant="onLight" />}
              </span>
            </>
          ) : m.images.length > 0 ? (
            <>
              {m.images.length > 1 ? (
                <div
                  className={cn(
                    'grid grid-cols-2 gap-1 overflow-hidden rounded-2xl',
                    // A concrete width, not w-full — see the single-image
                    // branch below for why a percentage width here is
                    // unsafe. The 70vw ceiling keeps it from overflowing
                    // on narrow phones.
                    'w-64 max-w-[70vw]',
                  )}
                >
                  {m.images.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative group cursor-zoom-in"
                      onClick={() => onViewImages(m.images, idx)}
                    >
                      <img
                        src={assetUrl(url)}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-32 object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Maximize2 className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // A single image/sticker: no crop box — size it at its own
                // aspect ratio (width:auto/height:auto on an <img> uses its
                // intrinsic dimensions directly, unlike a percentage width,
                // so there's no ambiguous ancestor to resolve against) capped
                // by a max so a huge photo or a wide sticker doesn't take over
                // the thread.
                <div
                  className="relative group cursor-zoom-in rounded-2xl overflow-hidden inline-block"
                  onClick={() => onViewImages(m.images, 0)}
                >
                  <img
                    src={assetUrl(m.images[0])}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="block w-auto h-auto max-w-[220px] max-h-[220px] object-contain"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </div>
                </div>
              )}
              {m.body && (
                <span
                  className={cn(
                    'rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                    m.mine
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-bl-md',
                  )}
                >
                  {renderWithLinks(
                    m.body,
                    m.mine ? 'underline font-medium' : 'underline font-medium text-emerald-600 dark:text-emerald-400',
                  )}
                </span>
              )}
              <span className="flex items-center gap-1 text-[10px] text-stone-400 px-1 whitespace-nowrap">
                {timeAgo(m.createdAt)}
                {m.editedAt && <span>· editado</span>}
                {m.mine && <MessageTicks status={m.status} variant="onLight" />}
              </span>
            </>
          ) : !m.body ? (
            // Note was sent then deleted, no caption — don't show an empty bubble.
            <>
              <span className="rounded-2xl px-3.5 py-2 text-sm italic bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500">
                {t('note_unavailable')}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-stone-400 px-1 whitespace-nowrap">
                {timeAgo(m.createdAt)}
                {m.mine && <MessageTicks status={m.status} variant="onLight" />}
              </span>
            </>
          ) : (
            <div
              className={cn(
                'w-full rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                m.mine
                  ? 'bg-emerald-600 text-white rounded-br-md'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-bl-md',
              )}
            >
              <span>
                {renderWithLinks(
                  m.body,
                  m.mine ? 'underline font-medium' : 'underline font-medium text-emerald-600 dark:text-emerald-400',
                )}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1 text-[10px] mt-1 whitespace-nowrap',
                  m.mine ? 'text-emerald-100/80 justify-end' : 'text-stone-400',
                )}
              >
                {timeAgo(m.createdAt)}
                {m.editedAt && <span>· editado</span>}
                {m.mine && <MessageTicks status={m.status} variant="onColor" />}
              </span>
            </div>
          )}
          {!m.deleted && m.reactions.length > 0 && (
            <div className={cn('flex flex-wrap gap-1', m.mine ? 'justify-end' : 'justify-start')}>
              {m.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  // Tapping any visible pill is itself a quick way to react
                  // (or un-react, if it's already yours) — same toggle rule
                  // the quick-react row and full picker use.
                  onClick={() => onReact(m, r.emoji)}
                  className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border leading-none transition-colors',
                    r.mine
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-500',
                  )}
                >
                  <span>{r.emoji}</span>
                  {r.count > 1 && <span className="font-semibold">{r.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function ChatView({ openConversationId, onOpenSharedNote }: ChatViewProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { conversations, loading } = useConversations();
  const { memos } = useMemos();
  const typingVersion = useTypingVersion(); // re-render this component whenever any typing signal changes
  // Auto-focusing a text field pops the mobile keyboard up uninvited — fine
  // (expected, even) on desktop, but jarring on a phone where opening a
  // thread or a panel should just show it, not immediately demand typing.
  // Every automatic (non-click-driven) focus-the-input mechanism in this
  // file is gated on this.
  const isDesktop = useIsDesktop();

  const [activeId, setActiveId] = useState<string | null>(openConversationId ?? null);
  // Per-row "⋮" menu on the conversation list — a home for row-level actions
  // (delete today, mute/mark-unread/etc. later) without redesigning the row.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  // Leaving a group or deleting a 1:1 both go through the same irreversible
  // deleteConversation() call, so both are confirmed the same way — set by
  // the row menu action, not called directly.
  const [confirmDeleteConv, setConfirmDeleteConv] = useState<{ id: string; isGroup: boolean } | null>(null);
  useBackable(!!confirmDeleteConv, () => setConfirmDeleteConv(null));
  const deleteConversation = async (id: string) => {
    setConfirmDeleteConv(null);
    setDeletingConvId(id);
    try {
      await api.deleteConversation(id);
      if (activeId === id) setActiveId(null);
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch {
      /* ignore — the row stays, the menu can be reopened to retry */
    } finally {
      setDeletingConvId(null);
    }
  };
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Reply and edit share the same "banner above the composer" slot — only
  // one is ever active, matching WhatsApp (setting one clears the other).
  const [replyTarget, setReplyTarget] = useState<DirectMessage | null>(null);
  const [editingTarget, setEditingTarget] = useState<DirectMessage | null>(null);
  const startReply = (m: DirectMessage) => {
    setEditingTarget(null);
    setReplyTarget(m);
  };
  const startEdit = (m: DirectMessage) => {
    setReplyTarget(null);
    setEditingTarget(m);
    setBody(m.body);
  };
  const cancelReply = () => setReplyTarget(null);
  const cancelEdit = () => {
    setEditingTarget(null);
    setBody('');
  };
  // WhatsApp-style "jump to the quoted message": scroll it into view and
  // flash it briefly. Silently a no-op if it isn't currently rendered (e.g.
  // it's further back than what's been paged in) — not worth the complexity
  // of auto-loading older pages just to reach it.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedMessageId(messageId);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedMessageId(null), 1500);
  };
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);
  const deleteMessageForMe = async (m: DirectMessage) => {
    if (!activeId) return;
    try {
      await api.deleteMessage(activeId, m.id, 'me');
      await refetch();
    } catch {
      /* ignore — the menu can be reopened to retry */
    }
  };
  const deleteMessageForEveryone = async (m: DirectMessage) => {
    if (!activeId) return;
    try {
      await api.deleteMessage(activeId, m.id, 'everyone');
      await refetch();
    } catch {
      /* ignore — the menu can be reopened to retry */
    }
  };
  // Same toggle rule everywhere a reaction can be picked from (quick-6 row,
  // full picker, or tapping an existing pill): the SAME emoji you already
  // reacted with removes it, any other emoji sets/replaces it — the backend
  // upsert handles the "replace" half, this just decides remove vs. set.
  const reactToMessage = async (m: DirectMessage, emoji: string) => {
    if (!activeId) return;
    try {
      const alreadyMine = m.reactions.some((r) => r.emoji === emoji && r.mine);
      if (alreadyMine) {
        await api.removeReaction(activeId, m.id);
      } else {
        await api.setReaction(activeId, m.id, emoji);
      }
      await refetch();
    } catch (err) {
      // Was a bare `catch {}` — a failed reaction was completely invisible
      // (no toast, no retry cue), which is indistinguishable from "the app
      // silently ignored my tap". Logging at minimum makes a real failure
      // observable instead of masquerading as a no-op.
      console.error('Error setting/removing reaction:', err);
    }
  };
  const lastTypingSentRef = useRef(0);
  const TYPING_SEND_INTERVAL_MS = 2500;

  const notifyTyping = (typing: boolean) => {
    if (!activeId) return;
    const now = Date.now();
    if (typing && now - lastTypingSentRef.current < TYPING_SEND_INTERVAL_MS) return;
    lastTypingSentRef.current = typing ? now : 0;
    api.setTyping(activeId, typing).catch(() => {});
  };

  // Pasted/dropped/picked photos waiting to go out with the next message.
  const [pendingImages, setPendingImages] = useState<{ file: File; url: string }[]>([]);
  // `pending` marks a lightbox session opened from the not-yet-sent
  // attachment strip (as opposed to an already-sent message's images) —
  // only then does the lightbox offer an edit button.
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; pending?: boolean } | null>(null);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { contacts } = useContacts();

  // "New group" — an in-place panel (same convention as contact/group info)
  // that replaces the thread pane while picking members + a name.
  const [chatsMenuOpen, setChatsMenuOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const groupCandidates = useMemo(
    () => contacts.filter((c) => c.hasAccount),
    [contacts],
  );

  const openNewGroup = () => {
    setGroupName('');
    setGroupMembers(new Set());
    setGroupError(null);
    setInfoOpen(false);
    setActiveId(null);
    setNewGroupOpen(true);
  };
  const closeNewGroup = () => setNewGroupOpen(false);

  // "Start a conversation" — same in-place-panel convention as "New group",
  // but a single-select live-filtered contact search instead of a
  // name+multi-select form, since picking someone starts the chat right away.
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [startingDm, setStartingDm] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const dmCandidates = useMemo(() => {
    const q = dmSearch.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!c.hasAccount) return false;
      if (!q) return true;
      return (c.alias || c.name).toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });
  }, [contacts, dmSearch]);
  const openNewDm = () => {
    setDmSearch('');
    setDmError(null);
    setInfoOpen(false);
    setActiveId(null);
    setNewDmOpen(true);
  };
  const closeNewDm = () => setNewDmOpen(false);
  const startDm = async (email: string) => {
    if (startingDm) return;
    setStartingDm(true);
    setDmError(null);
    try {
      const conv = await api.openConversation({ email });
      qc.invalidateQueries({ queryKey: qk.conversations });
      setNewDmOpen(false);
      setActiveId(conv.id);
    } catch {
      setDmError('No se pudo iniciar la conversación.');
    } finally {
      setStartingDm(false);
    }
  };
  const toggleGroupMember = (email: string) => {
    setGroupMembers((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };
  const submitCreateGroup = async () => {
    const name = groupName.trim();
    if (!name || groupMembers.size < 2 || creatingGroup) return;
    setCreatingGroup(true);
    setGroupError(null);
    try {
      const conv = await api.createGroup(name, [...groupMembers]);
      qc.invalidateQueries({ queryKey: qk.conversations });
      setNewGroupOpen(false);
      setActiveId(conv.id);
    } catch (err) {
      setGroupError(
        err instanceof Error ? err.message : 'No se pudo crear el grupo.',
      );
    } finally {
      setCreatingGroup(false);
    }
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addImages = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setPendingImages((prev) => [
      ...prev,
      ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  };
  const removePendingImage = (i: number) => {
    setPendingImages((prev) => {
      const target = prev[i];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, idx) => idx !== i);
    });
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      addImages(imgs);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    const imgs = Array.from(e.dataTransfer?.files ?? []);
    if (imgs.length) {
      e.preventDefault();
      addImages(imgs);
    }
  };

  // --- voice messages: tap the mic to start a recording session ----------
  // State machine: idle -> recording <-> paused -> (sent | cancelled),
  // always back to idle. Recording is now a persistent session (not tied to
  // holding the button down) so it can be paused/resumed; the composer swaps
  // into a dedicated panel with its own Pause/Resume, discard and Send
  // controls for the whole idle/recording/paused lifecycle.
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [waveformSamples, setWaveformSamples] = useState<number[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  // Shifted forward by however long each pause lasted, so
  // `Date.now() - recordingStartRef.current` always yields elapsed
  // *recording* time, excluding time spent paused.
  const recordingStartRef = useRef(0);
  const pauseStartRef = useRef(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set right before recorder.stop() so its (async) onstop handler knows
  // whether to discard the take or actually send it.
  const recordingCancelledRef = useRef(false);
  // Live waveform: a small Web Audio graph (source -> analyser, never wired
  // onward to the destination, or the user would hear their own mic echoed
  // back) sampled on an interval while actively recording.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const waveformIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveformBoxRef = useRef<HTMLDivElement>(null);
  // A ref, not state — read inside the sampling interval's closure (where a
  // stale state value would otherwise get captured) and doesn't need to
  // trigger a re-render on its own when it changes.
  const waveformMaxBarsRef = useRef(20);

  // Measure the bars container right as a recording starts (or resumes) —
  // useLayoutEffect so it reads the just-committed DOM before the browser
  // paints, rather than a stale size from before this panel existed.
  useLayoutEffect(() => {
    if (recordingState === 'idle') return;
    const el = waveformBoxRef.current;
    if (!el) return;
    const pitch = WAVEFORM_BAR_PX + WAVEFORM_GAP_PX;
    const width = el.clientWidth;
    if (width > 0) {
      waveformMaxBarsRef.current = Math.max(4, Math.floor((width + WAVEFORM_GAP_PX) / pitch));
    }
  }, [recordingState]);

  const releaseMicStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };
  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };
  const startRecordingTimer = () => {
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartRef.current) / 1000));
    }, 200);
  };

  const stopWaveformSampling = () => {
    if (waveformIntervalRef.current) {
      clearInterval(waveformIntervalRef.current);
      waveformIntervalRef.current = null;
    }
  };
  const startWaveformSampling = () => {
    stopWaveformSampling();
    waveformIntervalRef.current = setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      // Time-domain samples (the actual waveform), not frequency bins — the
      // previous version averaged getByteFrequencyData across the WHOLE
      // spectrum (0-~22kHz), and most of that range is silent for a human
      // voice, which diluted the average enough that normal speech barely
      // moved it no matter how loud someone talked. RMS of the waveform's
      // deviation from its center (128) is the standard, loudness-based
      // technique for a simple level meter and reacts directly to volume.
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = data.length > 0 ? Math.sqrt(sumSquares / data.length) : 0;
      // Normal speech RMS rarely goes much above ~0.2-0.3 even close to the
      // mic — scale it up (clipping at 1) so the bars actually swing across
      // their visible range instead of hugging the floor.
      const level = Math.min(1, rms * 4);
      setWaveformSamples((prev) => {
        const next = [...prev, level];
        const max = waveformMaxBarsRef.current;
        return next.length > max ? next.slice(next.length - max) : next;
      });
    }, WAVEFORM_SAMPLE_MS);
  };
  // Tears down the Web Audio graph — an AudioContext left open is as real a
  // leak as a hot mic stream. Safe to call repeatedly/when nothing was set up.
  const cleanupAudioAnalysis = () => {
    stopWaveformSampling();
    try {
      audioSourceRef.current?.disconnect();
    } catch {
      // already disconnected
    }
    try {
      analyserRef.current?.disconnect();
    } catch {
      // already disconnected
    }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    audioSourceRef.current = null;
  };

  const sendVoiceMessage = async (blob: Blob, durationSec: number) => {
    if (!activeId) return;
    setSending(true);
    setSendError(null);
    setDividerDismissed(true);
    notifyTyping(false);
    try {
      await api.sendMessage(activeId, '', undefined, false, replyTarget?.id, { blob, durationSec });
      setReplyTarget(null);
      await refetch();
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (err) {
      console.error('Error sending voice message:', err);
      setSendError(await describeUploadFailure(err));
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (editingTarget || recordingState !== 'idle' || sending) return;
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      recordingCancelledRef.current = false;
      setWaveformSamples([]);

      // Live waveform: source -> analyser only, never connected onward to
      // audioContext.destination (that would echo the mic back to the user).
      const audioContext = new AudioContext();
      if (audioContext.state === 'suspended') void audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      analyserRef.current = analyser;

      // Explicit low bitrate — opus at 32kbps is already well above what
      // speech needs, and keeps the recorded file (and so the upload, and so
      // how fast the message actually goes out) small. Without this,
      // Chrome's default for an audio-only recording is ~128kbps, 4x the
      // size for no audible difference on a voice note. Prefer opus in
      // whichever container the browser supports; MediaRecorder falls back
      // to its own default codec if the browser doesn't like the mimeType.
      const preferredMimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, {
        ...(preferredMimeType ? { mimeType: preferredMimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const cancelled = recordingCancelledRef.current;
        const elapsedSec = (Date.now() - recordingStartRef.current) / 1000;
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        releaseMicStream();
        stopRecordingTimer();
        cleanupAudioAnalysis();
        mediaRecorderRef.current = null;
        setRecordingState('idle');
        setRecordingSeconds(0);
        setWaveformSamples([]);
        // A near-instant tap-and-release produces a useless sub-second blip —
        // drop it silently rather than sending an empty-sounding "message".
        if (!cancelled && chunks.length > 0 && elapsedSec >= 0.3) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          void sendVoiceMessage(blob, elapsedSec);
        }
      };
      recordingStartRef.current = Date.now();
      recorder.start();
      setRecordingState('recording');
      setRecordingSeconds(0);
      startRecordingTimer();
      startWaveformSampling();
    } catch (err) {
      console.error('Error starting voice recording:', err);
      setRecordingError('No se pudo acceder al micrófono.');
      releaseMicStream();
      cleanupAudioAnalysis();
    }
  };

  // cancel=true discards the take instead of sending it (see recorder.onstop
  // above). Safe to call repeatedly/from multiple listeners — a no-op once
  // the recorder is already inactive (MediaRecorder.stop() flips `state` to
  // "inactive" synchronously, before the async onstop callback runs).
  const stopRecording = (cancel: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recordingCancelledRef.current = cancel;
    recorder.stop();
  };

  // Pause/resume a persistent recording session — MediaRecorder has native
  // support for both, no manual chunk buffering needed. recordingStartRef is
  // shifted forward by the paused span on resume, so the displayed/final
  // duration excludes time spent paused; the waveform sampling interval is
  // stopped/restarted alongside so the bar history simply stops growing
  // while paused, then keeps appending (not resetting) on resume.
  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    pauseStartRef.current = Date.now();
    stopRecordingTimer();
    stopWaveformSampling();
    setRecordingState('paused');
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    recordingStartRef.current += Date.now() - pauseStartRef.current;
    setRecordingState('recording');
    startRecordingTimer();
    startWaveformSampling();
  };

  // Component teardown or a conversation switch mid-recording shouldn't
  // leave the mic hot — discard whatever was captured and release the stream
  // (and the waveform's AudioContext) — the real safety net now that a
  // recording session is no longer tied to a held-down pointer.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        recordingCancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      releaseMicStream();
      stopRecordingTimer();
      cleanupAudioAnalysis();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Drag-over feedback for the whole thread panel (not just the composer) —
  // a counter because dragenter/dragleave fire on every child crossed.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const onThreadDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragActive(true);
  };
  const onThreadDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onThreadDrop = (e: React.DragEvent) => {
    dragDepth.current = 0;
    setDragActive(false);
    handleDrop(e);
  };

  // Note-sharing UI: attach popover, note-picker overlay, inline note editor.
  const [attachOpen, setAttachOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // Id of the note the inline editor created; sent to the thread when the
  // editor closes, not on its autosave (a half-typed note shouldn't fly out).
  const createdNoteRef = useRef<string | null>(null);

  // Emoji + sticker popover, anchored next to the attach button like it.
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState<'emoji' | 'stickers'>('emoji');
  const [sendingSticker, setSendingSticker] = useState(false);

  // Mobile/browser back button steps back through chat instead of leaving
  // the app — innermost-first: new-group panel and the note-picker are
  // fullscreen overlays reachable from the thread; info panel nests inside
  // an open thread; the thread itself nests inside the conversation list.
  useBackable(newGroupOpen, () => setNewGroupOpen(false));
  useBackable(newDmOpen, () => setNewDmOpen(false));
  useBackable(pickerOpen, () => { setPickerOpen(false); setNoteSearch(''); });
  useBackable(infoOpen, () => {
    setInfoOpen(false);
    // Closing the info panel reveals the thread again, but it doesn't touch
    // newestMessageId/activeId, so the scroll-to-bottom effect above never
    // fires for this transition — pin it back to the bottom ourselves, after
    // the panel's close re-render has happened.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  });
  useBackable(editingImageIndex !== null, () => setEditingImageIndex(null));
  useBackable(replyTarget !== null || editingTarget !== null, () => {
    if (editingTarget) cancelEdit();
    else cancelReply();
  });
  useBackable(activeId !== null, () => setActiveId(null));

  // Insert at the cursor rather than just appending, so picking an emoji
  // mid-sentence doesn't jumble what's already typed.
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((b) => b + text);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => {
      // Desktop only — refocusing after picking an emoji pops the mobile
      // keyboard back up right when the user was just tapping an emoji.
      // Still position the selection either way, so a manual tap into the
      // textarea on mobile lands the cursor right after the inserted emoji.
      if (isDesktop) el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onEmojiPick = (data: EmojiClickData) => {
    insertAtCursor(data.emoji);
    // Picking an emoji reads to the other person the same as typing does.
    notifyTyping(true);
  };

  // Stickers send as an actual image message straight away, reusing the
  // same upload pipeline pasted/picked photos already go through.
  const sendSticker = async (id: string) => {
    if (!activeId || sendingSticker) return;
    setEmojiOpen(false);
    setSendingSticker(true);
    setSendError(null);
    setDividerDismissed(true);
    try {
      const res = await fetch(`/stickers/${id}.webp`);
      const blob = await res.blob();
      const file = new File([blob], `${id}.webp`, { type: 'image/webp' });
      await api.sendMessage(activeId, '', [file], true);
      await refetch();
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (err) {
      console.error('Error sending sticker:', err);
      setSendError(await describeUploadFailure(err));
    } finally {
      setSendingSticker(false);
    }
  };

  // Locally-prepended older pages (react-query only holds the newest page).
  const [older, setOlder] = useState<DirectMessage[]>([]);
  const [moreOlder, setMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const { items, hasMore, loading: msgsLoading, refetch } = useMessages(activeId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const keepScrollRef = useRef(false);
  // How many unread messages this thread had the moment it was opened —
  // captured before markConversationRead (below) zeroes it out server-side.
  // Purely for the "unread messages" divider below; doesn't affect scrolling
  // (that always jumps straight to the bottom, same as with none unread).
  const unreadAtOpenRef = useRef(0);
  const [dividerDismissed, setDividerDismissed] = useState(false);

  // Deep-link: open the conversation the bell / contacts view asked for.
  useEffect(() => {
    if (openConversationId) setActiveId(openConversationId);
  }, [openConversationId]);

  // Reset the local older-pages buffer whenever the active thread changes.
  useEffect(() => {
    setOlder([]);
    setMoreOlder(true);
    setBody('');
    setSendError(null);
    setReplyTarget(null);
    setEditingTarget(null);
    setAttachOpen(false);
    setPickerOpen(false);
    setEmojiOpen(false);
    setInfoOpen(false);
    lastTypingSentRef.current = 0;
    setDividerDismissed(false);
    unreadAtOpenRef.current = conversations.find((c) => c.id === activeId)?.unread ?? 0;
    // Read directly off the list rather than the activeConv memo (declared
    // later in this component) — intentionally NOT reactive to `conversations`
    // changing, only to a fresh activeId, since unread hits 0 the instant
    // markConversationRead's effect below runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Drop the cursor straight into the composer when a thread opens — the
  // textarea only mounts once activeId is set, so wait a tick for it.
  // Desktop only (see isDesktop above) — on mobile this popped the keyboard
  // the instant you opened a chat just to read it.
  useEffect(() => {
    if (!activeId || !isDesktop) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // isDesktop deliberately excluded — this should only decide whether to
    // focus at the moment a thread opens, not yank focus into the textarea
    // if the viewport crosses the breakpoint while one is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const activeConv: ChatConversation | undefined = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );

  const messages = useMemo(() => {
    const seen = new Set<string>();
    return [...older, ...items].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [older, items]);

  // Used instead of messages.length/items.length to detect "a new message
  // arrived" below: useMessages caps its query at the last 30, so once a
  // thread has more than that, sending (or receiving) another message drops
  // the oldest and adds the new one — the count never changes, so a
  // length-keyed effect would silently stop firing past that point.
  const newestMessageId = messages[messages.length - 1]?.id;

  // Mark the thread read on open and whenever new messages land while it's open.
  useEffect(() => {
    if (!activeId) return;
    api.markConversationRead(activeId).catch(() => {});
    // Patch the cache immediately rather than only invalidating — otherwise
    // a quick leave-and-reopen of this same thread can read back the old
    // (still-unread) count before the background refetch lands, making the
    // "unread messages" divider reappear even though it was just read.
    qc.setQueryData<ChatConversation[]>(qk.conversations, (old) =>
      old?.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)) ?? old,
    );
    qc.invalidateQueries({ queryKey: qk.conversations });
  }, [activeId, newestMessageId, qc]);

  // Which message (if any) the "unread messages" divider goes above — the
  // first one that was unread when this thread was opened. Cleared once the
  // viewer replies (see send()) or the next time they open this thread
  // (unreadAtOpenRef is 0 by then, since opening it just marked it read).
  // Declared before the scroll effect below, which reads it in its own
  // dependency array (evaluated eagerly at render time, unlike the effect
  // body itself) — referencing a later const there would be a genuine
  // temporal-dead-zone error, not just a lint nit.
  const unreadDividerMessageId = useMemo(() => {
    if (dividerDismissed || unreadAtOpenRef.current <= 0) return null;
    const boundaryIndex = Math.max(0, messages.length - unreadAtOpenRef.current);
    return messages[boundaryIndex]?.id ?? null;
    // unreadAtOpenRef is a ref (not reactive) by design — it only changes
    // together with activeId, which is already what invalidates `messages`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, dividerDismissed]);

  // Keep the thread pinned to the newest message, unless we just prepended.
  // Opening a thread with unread messages lands on the divider instead (see
  // inside); everything else — nothing unread, or a new arrival while
  // already caught up — still pins to the very bottom. Keyed on
  // newestMessageId rather than a count for the same reason as the
  // mark-as-read effect above.
  useEffect(() => {
    if (keepScrollRef.current) {
      keepScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    let cancelled = false;

    const settle = async () => {
      // Wait for images already in the DOM (stickers/photos) to finish
      // loading first — they have no reserved size until they decode, so
      // jumping before that lets their eventual height shift the bottom out
      // from under the scroll position right after we set it.
      const imgs = Array.from(el.querySelectorAll('img'));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              }),
        ),
      );
      if (cancelled) return;
      // Opening a thread that has unread messages: land right where they
      // start (the divider) instead of at the very bottom, so there's no
      // need to scroll back up to find where to start reading. Anything
      // else — nothing unread, or a new message arriving while already
      // caught up — still pins to the very bottom as before.
      const divider = unreadDividerMessageId ? document.getElementById('unread-divider') : null;
      if (divider) {
        divider.scrollIntoView({ block: 'center' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [newestMessageId, activeId, unreadDividerMessageId]);

  // Which name to show next to "escribiendo…" in a group's header — a 1:1
  // thread never needs this (there's only one other person it could be).
  // The SSE typing event only carries a userId, not a name, so resolve it
  // from the most recent message we have from them; if they haven't sent
  // one yet in what's currently loaded, fall back to a generic label rather
  // than show nothing.
  const groupTypingName = useMemo(() => {
    const ids = typingUserIds(activeId).filter((id) => id !== user?.id);
    if (ids.length === 0) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === ids[0]) return messages[i].senderName;
    }
    return 'Alguien';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages, user?.id, typingVersion]);

  const showLoadOlder = older.length > 0 ? moreOlder : hasMore;

  const loadOlder = async () => {
    if (!activeId || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await api.listMessages(activeId, {
        before: messages[0].createdAt,
        limit: 30,
      });
      keepScrollRef.current = true;
      setOlder((prev) => [...res.items, ...prev]);
      setMoreOlder(res.hasMore);
      // Preserve the reading position after older messages are inserted above.
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight - prevHeight;
      });
    } catch {
      /* ignore — the button stays available for a retry */
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const text = body.trim();

    if (editingTarget) {
      if (!text || sending) return;
      setSending(true);
      setSendError(null);
      try {
        await api.editMessage(editingTarget.conversationId, editingTarget.id, text);
        setBody('');
        setEditingTarget(null);
        await refetch();
      } catch {
        /* ignore — the draft stays so the user can retry */
      } finally {
        setSending(false);
      }
      return;
    }

    if ((!text && pendingImages.length === 0) || !activeId || sending) return;
    const hadImages = pendingImages.length > 0;
    setSending(true);
    setSendError(null);
    setDividerDismissed(true);
    notifyTyping(false);
    try {
      await api.sendMessage(
        activeId,
        text,
        pendingImages.length ? pendingImages.map((p) => p.file) : undefined,
        false,
        replyTarget?.id,
      );
      setBody('');
      pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
      setPendingImages([]);
      setReplyTarget(null);
      await refetch();
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (err) {
      // Keep the draft so the user can retry. Only diagnose image-upload
      // failures — a plain text send failing is a different class of thing.
      if (hadImages) {
        console.error('Error sending image message:', err);
        setSendError(await describeUploadFailure(err));
      }
    } finally {
      setSending(false);
    }
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // --- sending notes through the chat ---
  const ownedNotes = useMemo(
    () => memos.filter((m) => m.ownerId === user?.id || m.role === 'owner'),
    [memos, user?.id],
  );

  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    if (!q) return ownedNotes;
    return ownedNotes.filter(
      (m) => m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q),
    );
  }, [ownedNotes, noteSearch]);

  const afterAttach = () => {
    void refetch();
    qc.invalidateQueries({ queryKey: qk.conversations });
  };

  const sendExistingNote = async (memoId: string) => {
    if (!activeId || attaching) return;
    setAttaching(true);
    setDividerDismissed(true);
    try {
      await api.sendNote(activeId, memoId);
      setPickerOpen(false);
      setNoteSearch('');
      afterAttach();
    } catch {
      /* ignore — the picker stays open for a retry */
    } finally {
      setAttaching(false);
    }
  };

  const openNoteEditor = () => {
    createdNoteRef.current = null;
    setEditorOpen(true);
  };

  // On close: if the editor persisted a note, send it into the thread now.
  const closeNoteEditor = () => {
    const memoId = createdNoteRef.current;
    createdNoteRef.current = null;
    setEditorOpen(false);
    if (memoId && activeId) {
      setDividerDismissed(true);
      void api.sendNote(activeId, memoId).then(afterAttach).catch(() => {});
    }
  };

  const other: ChatParticipant | null = activeConv?.other ?? null;
  const group: GroupMeta | null = activeConv?.group ?? null;
  const viewerIsGroupAdmin = !!group?.viewerIsAdmin;

  // Leaving/being removed from a group: drop back to the conversation list.
  const handleLeftGroup = () => {
    setInfoOpen(false);
    setActiveId(null);
    qc.invalidateQueries({ queryKey: qk.conversations });
  };

  // WhatsApp-style composer button: a mic when there's nothing else to send,
  // the real send button as soon as there's text or a pending attachment.
  // Editing always shows the send button — recording a voice note while
  // mid-edit doesn't make sense (an edit always ends with non-empty text).
  const isMicMode = !editingTarget && !body.trim() && pendingImages.length === 0;

  return (
    // Full-bleed: cancel the content area's padding so the chat sits flush
    // with its container (edge-to-edge on mobile, full width on desktop).
    <div className="h-full flex flex-col -m-4 md:-m-6">
      <header className="shrink-0 px-4 md:px-6 py-3 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <h1 className="text-xl md:text-2xl font-bold dark:text-white flex items-center gap-2.5">
          <MessagesSquare className="w-6 h-6 text-emerald-600" />
          {t('chat')}
        </h1>
      </header>

      <div className="flex-1 min-h-0 flex md:gap-4 md:p-6">
        {/* Conversation list */}
        <aside
          className={cn(
            'w-full md:w-80 md:shrink-0 flex flex-col border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden md:rounded-3xl md:border',
            (activeId || newGroupOpen || newDmOpen) && 'hidden md:flex',
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800 shrink-0">
            <h2 className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Chats
            </h2>
            <div className="relative">
              <button
                type="button"
                onClick={() => setChatsMenuOpen((v) => !v)}
                title="Más opciones"
                className="p-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {chatsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setChatsMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-200 dark:border-stone-700 py-1 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => { setChatsMenuOpen(false); openNewGroup(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                    >
                      <Users className="w-4 h-4" />
                      Crear grupo
                    </button>
                    <button
                      type="button"
                      onClick={() => { setChatsMenuOpen(false); openNewDm(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                    >
                      <Search className="w-4 h-4" />
                      Iniciar conversación
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
              </div>
            )}

            {!loading && conversations.length === 0 && (
              <div className="text-center py-16 px-6 text-stone-400 dark:text-stone-500">
                <MessagesSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{t('no_conversations')}</p>
              </div>
            )}

            {conversations.map((c) => {
              const typingHere = isTyping(c.id);
              const namePrefix =
                c.isGroup && c.lastMessage?.senderName && !c.lastMessage.mine
                  ? `${c.lastMessage.senderName}: `
                  : '';
              const preview = c.lastMessage
                ? (c.lastMessage.mine ? t('you_prefix') : namePrefix) + c.lastMessage.body
                : t('start_conversation');
              return (
                <div
                  key={c.id}
                  className={cn(
                    'relative w-full flex items-center gap-1 pr-2 border-b border-stone-100 dark:border-stone-800/60 transition-colors',
                    c.id === activeId
                      ? 'bg-emerald-50 dark:bg-emerald-900/20'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800/40',
                  )}
                >
                  <button
                    onClick={() => { setNewGroupOpen(false); setActiveId(c.id); }}
                    className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left"
                  >
                    {c.isGroup ? (
                      <GroupAvatar photoURL={c.group?.photoURL ? assetUrl(c.group.photoURL) : ''} size="sm" />
                    ) : (
                      <Avatar name={c.other?.name} photoURL={c.other?.photoURL ? assetUrl(c.other.photoURL) : ''} size="sm" online={c.other?.online} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate dark:text-stone-100">
                          {c.isGroup ? c.group?.name : c.other?.name}
                        </p>
                        <span className="text-[10px] text-stone-400 shrink-0">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'text-xs truncate flex items-center gap-1',
                            typingHere
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : c.unread > 0
                                ? 'text-stone-700 dark:text-stone-200 font-medium'
                                : 'text-stone-400 dark:text-stone-500',
                          )}
                        >
                          {typingHere ? (
                            <>
                              {t('typing')}
                              <TypingDots />
                            </>
                          ) : (
                            preview
                          )}
                        </p>
                        {c.unread > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {c.unread > 9 ? '9+' : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRowMenuId((v) => (v === c.id ? null : c.id));
                      }}
                      disabled={deletingConvId === c.id}
                      title="Más opciones"
                      className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-700/60 transition-colors disabled:opacity-50"
                    >
                      {deletingConvId === c.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <MoreVertical className="w-4 h-4" />
                      )}
                    </button>
                    {rowMenuId === c.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setRowMenuId(null)}
                        />
                        <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-200 dark:border-stone-700 py-1 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuId(null);
                              setConfirmDeleteConv({ id: c.id, isGroup: c.isGroup });
                            }}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            {c.isGroup ? 'Salir del grupo' : 'Eliminar chat'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Active thread */}
        <section
          className={cn(
            'relative flex-1 min-w-0 flex-col border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden md:rounded-3xl md:border',
            activeId || newGroupOpen || newDmOpen ? 'flex' : 'hidden md:flex',
          )}
          onDragEnter={onThreadDragEnter}
          onDragLeave={onThreadDragLeave}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onThreadDrop}
        >
          {dragActive && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-emerald-600/10 dark:bg-emerald-500/10 border-4 border-dashed border-emerald-500 pointer-events-none">
              <div className="bg-white dark:bg-stone-900 px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                <ImagePlus className="w-5 h-5" />
                {t('drop_image_here') || 'Soltá la imagen acá'}
              </div>
            </div>
          )}
          {newDmOpen ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
                <button
                  onClick={closeNewDm}
                  className="p-1.5 -ml-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  title={t('back') || 'Volver'}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h3 className="font-bold dark:text-white">Nueva conversación</h3>
              </div>
              <div className="p-4 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus={isDesktop}
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    placeholder="Buscar un contacto..."
                    className="w-full pl-9 pr-3 py-2.5 bg-stone-100 dark:bg-stone-800 border-transparent rounded-2xl focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                  />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-1">
                {dmError && <p className="text-xs text-red-500 mb-2">{dmError}</p>}
                {dmCandidates.length === 0 ? (
                  <p className="text-sm text-stone-400 italic py-2">
                    {dmSearch.trim()
                      ? 'Ningún contacto coincide con esa búsqueda.'
                      : 'Ningún contacto tuyo tiene cuenta en Noteshare todavía.'}
                  </p>
                ) : (
                  dmCandidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={startingDm}
                      onClick={() => void startDm(c.email)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors disabled:opacity-50"
                    >
                      <Avatar name={c.name} photoURL={c.photoURL ? assetUrl(c.photoURL) : ''} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate dark:text-stone-200">
                          {c.alias || c.name}
                        </span>
                        <span className="block text-xs text-stone-400 truncate">{c.email}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : newGroupOpen ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
                <button
                  onClick={closeNewGroup}
                  className="p-1.5 -ml-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  title={t('back') || 'Volver'}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h3 className="font-bold dark:text-white">Nuevo grupo</h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Nombre del grupo"
                  className="w-full px-3.5 py-2.5 bg-stone-100 dark:bg-stone-800 border-transparent rounded-2xl focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">
                    Miembros ({groupMembers.size} seleccionados, mínimo 2)
                  </p>
                  {groupCandidates.length === 0 ? (
                    <p className="text-sm text-stone-400 italic py-2">
                      Ningún contacto tuyo tiene cuenta en Noteshare todavía.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {groupCandidates.map((c) => {
                        const checked = groupMembers.has(c.email);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleGroupMember(c.email)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors',
                              checked
                                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                                : 'hover:bg-stone-50 dark:hover:bg-stone-800/60',
                            )}
                          >
                            <Avatar name={c.name} photoURL={c.photoURL ? assetUrl(c.photoURL) : ''} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium truncate dark:text-stone-200">
                                {c.alias || c.name}
                              </span>
                              <span className="block text-xs text-stone-400 truncate">{c.email}</span>
                            </span>
                            <span
                              className={cn(
                                'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0',
                                checked
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'border-stone-300 dark:border-stone-600',
                              )}
                            >
                              {checked && <Check className="w-3.5 h-3.5" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {groupError && (
                  <p className="text-xs text-red-500">{groupError}</p>
                )}
              </div>
              <div className="border-t border-stone-200 dark:border-stone-800 p-3 shrink-0">
                <button
                  type="button"
                  onClick={() => void submitCreateGroup()}
                  disabled={creatingGroup || !groupName.trim() || groupMembers.size < 2}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
                >
                  {creatingGroup && <Loader2 className="w-4 h-4 animate-spin" />}
                  Crear grupo
                </button>
              </div>
            </>
          ) : !activeId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-stone-400 dark:text-stone-500 p-6">
              <MessagesSquare className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">{t('no_conversations')}</p>
            </div>
          ) : infoOpen && (other || group) ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
                <button
                  onClick={() => setInfoOpen(false)}
                  className="p-1.5 -ml-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  title={t('back') || 'Volver'}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h3 className="font-bold dark:text-white">
                  {group
                    ? 'Info del grupo'
                    : t('contact_info', { defaultValue: 'Info del contacto' })}
                </h3>
              </div>
              {group ? (
                <ChatGroupInfo
                  group={group}
                  conversationId={activeId}
                  viewerId={user?.id ?? ''}
                  viewerIsAdmin={viewerIsGroupAdmin}
                  onLeft={handleLeftGroup}
                  onOpenSharedNote={onOpenSharedNote}
                  onViewImage={(images, index) => setLightbox({ images, index })}
                />
              ) : (
                other && (
                  <ChatContactInfo
                    other={other}
                    conversationId={activeId}
                    onOpenSharedNote={onOpenSharedNote}
                    onViewImage={(images, index) => setLightbox({ images, index })}
                  />
                )
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
                <button
                  onClick={() => setActiveId(null)}
                  className="md:hidden p-1.5 -ml-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  title={t('chat')}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => (other || group) && setInfoOpen(true)}
                  disabled={!other && !group}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl px-1 -mx-1 py-1 hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors"
                  title={
                    group
                      ? 'Info del grupo'
                      : t('contact_info', { defaultValue: 'Info del contacto' })
                  }
                >
                  {group ? (
                    <GroupAvatar photoURL={group.photoURL ? assetUrl(group.photoURL) : ''} size="sm" />
                  ) : (
                    <Avatar name={other?.name} photoURL={other?.photoURL ? assetUrl(other.photoURL) : ''} size="sm" online={other?.online} />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate dark:text-stone-100">
                      {group?.name ?? other?.name ?? t('chat')}
                    </p>
                    {group ? (
                      <p className="text-xs truncate flex items-center gap-1 text-stone-400">
                        {groupTypingName ? (
                          <>
                            {groupTypingName} está escribiendo
                            <TypingDots />
                          </>
                        ) : (
                          `${group.memberCount} miembros`
                        )}
                      </p>
                    ) : (
                      other && (
                        <p
                          className={cn(
                            'text-xs truncate flex items-center gap-1',
                            other.online || isTyping(activeId)
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-stone-400',
                          )}
                        >
                          {isTyping(activeId) ? (
                            <>
                              {t('typing')}
                              <TypingDots />
                            </>
                          ) : other.online ? (
                            t('online_now')
                          ) : (
                            t('last_seen', { time: timeAgo(other.lastSeenAt) })
                          )}
                        </p>
                      )
                    )}
                  </div>
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 py-4 space-y-2"
              >
                {showLoadOlder && messages.length > 0 && (
                  <div className="flex justify-center pb-2">
                    <button
                      onClick={loadOlder}
                      disabled={loadingOlder}
                      className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      {loadingOlder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t('load_older_messages')}
                    </button>
                  </div>
                )}

                {msgsLoading && messages.length === 0 && (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                  </div>
                )}

                {!msgsLoading && messages.length === 0 && (
                  <div className="h-full flex items-center justify-center text-center text-sm text-stone-400 dark:text-stone-500">
                    {t('no_messages_yet')}
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {messages.flatMap((m) => [
                    m.id === unreadDividerMessageId ? (
                      <div
                        key={`unread-divider-${m.id}`}
                        id="unread-divider"
                        className="flex items-center gap-3 py-1"
                      >
                        <div className="flex-1 h-px bg-emerald-200 dark:bg-emerald-800" />
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                          {t('unread_messages', { defaultValue: 'Mensajes no leídos' })}
                        </span>
                        <div className="flex-1 h-px bg-emerald-200 dark:bg-emerald-800" />
                      </div>
                    ) : null,
                    <MessageRow
                      key={m.id}
                      m={m}
                      isGroup={!!activeConv?.isGroup}
                      highlighted={highlightedMessageId === m.id}
                      onOpenSharedNote={onOpenSharedNote}
                      onViewImages={(images, index) => setLightbox({ images: images.map(assetUrl), index })}
                      onReply={startReply}
                      onEdit={startEdit}
                      onDeleteForMe={(msg) => void deleteMessageForMe(msg)}
                      onDeleteForEveryone={(msg) => void deleteMessageForEveryone(msg)}
                      onJumpToReply={jumpToMessage}
                      onReact={(msg, emoji) => void reactToMessage(msg, emoji)}
                    />,
                  ])}
                </AnimatePresence>
              </div>

              <div className="border-t border-stone-200 dark:border-stone-800 p-3 shrink-0">
                {editingTarget ? (
                  <div className="flex items-center gap-2 mb-2 pl-3 pr-2 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 border-l-4 border-emerald-500">
                    <Pencil className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        Editando mensaje
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                        {editingTarget.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="shrink-0 p-1 rounded-full text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : replyTarget ? (
                  <div className="flex items-center gap-2 mb-2 pl-3 pr-2 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 border-l-4 border-emerald-500">
                    <CornerUpLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                        {replyTarget.senderName}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                        {replyBannerSnippet(replyTarget)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={cancelReply}
                      className="shrink-0 p-1 rounded-full text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : null}
                {pendingImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingImages.map((p, i) => (
                      <div
                        key={p.url}
                        className="relative w-16 h-16 shrink-0 cursor-zoom-in group"
                        onClick={() =>
                          setLightbox({ images: pendingImages.map((pi) => pi.url), index: i, pending: true })
                        }
                      >
                        <img
                          src={p.url}
                          alt=""
                          className="w-16 h-16 object-cover rounded-xl border border-stone-200 dark:border-stone-700"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                          <Maximize2 className="w-4 h-4 text-white" />
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingImageIndex(i);
                          }}
                          title="Editar imagen"
                          className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-stone-900/80 hover:bg-emerald-600 text-white flex items-center justify-center shadow"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removePendingImage(i);
                          }}
                          title={t('remove') || 'Quitar'}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-900/80 hover:bg-red-600 text-white flex items-center justify-center shadow"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {sendError && (
                  <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="flex-1">{sendError}</p>
                    <button
                      type="button"
                      onClick={() => setSendError(null)}
                      className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {recordingError && (
                  <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="flex-1">{recordingError}</p>
                    <button
                      type="button"
                      onClick={() => setRecordingError(null)}
                      className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  {recordingState !== 'idle' ? (
                    // Grid, not flex, for this row — the waveform column is
                    // pinned to minmax(0,1fr): a hard "shrink to your share,
                    // never past it, clip whatever doesn't fit" rule that
                    // doesn't depend on the browser correctly resolving a
                    // flex item's automatic min-width (the flex+min-w-0
                    // version of this kept getting reported as still
                    // pushing the buttons off-screen on real mobile
                    // browsers — minmax(0,1fr) is the standard, more
                    // reliably cross-browser fix for exactly this).
                    <div className="flex-1 grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 h-11 pl-3.5 pr-1.5 rounded-2xl bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        {recordingState === 'recording' && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        )}
                        <span
                          className={cn(
                            'relative inline-flex rounded-full h-2.5 w-2.5',
                            recordingState === 'recording' ? 'bg-red-500' : 'bg-red-300 dark:bg-red-800',
                          )}
                        />
                      </span>
                      <span className="text-sm font-medium tabular-nums text-stone-600 dark:text-stone-300 shrink-0">
                        {formatDuration(recordingSeconds)}
                      </span>
                      {/* This column's grid track is minmax(0,1fr) (see the
                          grid on the row above) — it can never grow past its
                          share of the row no matter how many bars pile up.
                          The bars themselves stay a fixed, legible pixel
                          width (see WAVEFORM_BAR_PX/GAP_PX and the
                          useLayoutEffect measuring this div) — how MANY of
                          them fit is computed from this container's actual
                          width instead, so it fills exactly edge-to-edge on
                          any screen size without the bars themselves ever
                          ballooning wide (few samples) or shrinking to
                          illegible slivers (many samples, narrow screen). */}
                      <div ref={waveformBoxRef} className="flex items-end justify-end gap-[3px] h-8 overflow-hidden">
                        {waveformSamples.length === 0 ? (
                          <span className="text-xs text-stone-400 truncate">
                            {recordingState === 'paused' ? 'Pausado' : 'Grabando…'}
                          </span>
                        ) : (
                          waveformSamples.map((level, i) => (
                            <div
                              key={i}
                              className="w-1 rounded-full bg-emerald-500 shrink-0"
                              style={{ height: `${Math.max(15, Math.round(level * 100))}%` }}
                            />
                          ))
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => (recordingState === 'paused' ? resumeRecording() : pauseRecording())}
                        title={recordingState === 'paused' ? 'Reanudar' : 'Pausar'}
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                      >
                        {recordingState === 'paused' ? (
                          <Play className="w-4 h-4 ml-0.5" />
                        ) : (
                          <Pause className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => stopRecording(true)}
                        title="Descartar"
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => stopRecording(false)}
                        title="Enviar"
                        className="btn-primary shrink-0 w-8 h-8 rounded-full flex items-center justify-center p-0"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                  <div className="relative shrink-0">
                    {attachOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setAttachOpen(false)}
                        />
                        <div className="absolute bottom-12 left-0 z-20 w-60 bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-200 dark:border-stone-700 py-1.5 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => { setAttachOpen(false); setPickerOpen(true); }}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                          >
                            <FileText className="w-4 h-4 text-stone-400" />
                            {t('send_existing_note')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAttachOpen(false); openNoteEditor(); }}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                          >
                            <Send className="w-4 h-4 text-stone-400" />
                            {t('create_and_send_note')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAttachOpen(false); imageInputRef.current?.click(); }}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                          >
                            <ImagePlus className="w-4 h-4 text-stone-400" />
                            {t('send_image') || 'Enviar imagen'}
                          </button>
                        </div>
                      </>
                    )}
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        if (e.target.files) addImages(Array.from(e.target.files));
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setAttachOpen((v) => !v)}
                      title={t('attach_note')}
                      className="flex items-center justify-center w-11 h-11 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="relative shrink-0">
                    {emojiOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setEmojiOpen(false)}
                        />
                        <div className="absolute bottom-12 left-0 z-20 w-[300px] sm:w-[340px] bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-200 dark:border-stone-700 overflow-hidden">
                          <div className="flex border-b border-stone-200 dark:border-stone-700">
                            <button
                              type="button"
                              onClick={() => setEmojiTab('emoji')}
                              className={cn(
                                'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors',
                                emojiTab === 'emoji'
                                  ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600 dark:border-emerald-400 -mb-px'
                                  : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300',
                              )}
                            >
                              <Smile className="w-4 h-4" />
                              {t('emoji') || 'Emoji'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEmojiTab('stickers')}
                              className={cn(
                                'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors',
                                emojiTab === 'stickers'
                                  ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600 dark:border-emerald-400 -mb-px'
                                  : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300',
                              )}
                            >
                              <Sticker className="w-4 h-4" />
                              {t('stickers') || 'Stickers'}
                            </button>
                          </div>

                          {emojiTab === 'emoji' ? (
                            <EmojiPicker
                              onEmojiClick={onEmojiPick}
                              theme={
                                document.documentElement.classList.contains('dark')
                                  ? Theme.DARK
                                  : Theme.LIGHT
                              }
                              width="100%"
                              height={320}
                              previewConfig={{ showPreview: false }}
                              searchPlaceholder={t('search') || 'Buscar...'}
                            />
                          ) : (
                            <div className="grid grid-cols-4 gap-1.5 p-3 max-h-[320px] overflow-y-auto">
                              {STICKERS.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  disabled={sendingSticker}
                                  title={s.label}
                                  onClick={() => void sendSticker(s.id)}
                                  className="aspect-square rounded-xl p-1.5 hover:bg-stone-100 dark:hover:bg-stone-700/60 transition-colors disabled:opacity-50"
                                >
                                  <img
                                    src={`/stickers/${s.id}.webp`}
                                    alt={s.label}
                                    className="w-full h-full object-contain"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setEmojiOpen((v) => !v)}
                      title={t('emoji') || 'Emoji'}
                      className="flex items-center justify-center w-11 h-11 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                    >
                      {sendingSticker ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Smile className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBody(v);
                      notifyTyping(v.trim().length > 0);
                    }}
                    onKeyDown={onComposerKey}
                    onPaste={handlePaste}
                    rows={1}
                    placeholder={t('message_placeholder')}
                    className="flex-1 resize-none max-h-32 px-3.5 py-2.5 bg-stone-100 dark:bg-stone-800 border-transparent rounded-2xl focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                  />
                    </>
                  )}
                  {recordingState === 'idle' && (
                    <button
                      type="button"
                      onClick={isMicMode ? () => void startRecording() : () => void send()}
                      disabled={!isMicMode && (sending || (!body.trim() && pendingImages.length === 0))}
                      title={isMicMode ? 'Grabar nota de voz' : t('send_message')}
                      className="btn-primary flex items-center justify-center w-11 h-11 rounded-2xl shrink-0 p-0 select-none"
                    >
                      {sending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isMicMode ? (
                        <Mic className="w-4 h-4" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Confirm leaving a group / deleting a 1:1 chat — both irreversible */}
      <AnimatePresence>
        {confirmDeleteConv && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirmDeleteConv(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto text-red-600">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold dark:text-white">
                  {confirmDeleteConv.isGroup ? 'Salir del grupo' : 'Eliminar chat'}
                </h3>
                <p className="text-stone-500 dark:text-stone-400 text-sm">
                  {confirmDeleteConv.isGroup
                    ? '¿Estás seguro de que querés salir de este grupo?'
                    : '¿Estás seguro de que querés eliminar este chat?'}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteConv(null)}
                  className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void deleteConversation(confirmDeleteConv.id)}
                  disabled={deletingConvId === confirmDeleteConv.id}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-600/10 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deletingConvId === confirmDeleteConv.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : confirmDeleteConv.isGroup ? (
                    'Salir del grupo'
                  ) : (
                    'Eliminar chat'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fullscreen lightbox for chat photos */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((v) => (v ? { ...v, index } : v))}
          onClose={() => setLightbox(null)}
          onEdit={
            lightbox.pending
              ? () => {
                  const idx = lightbox.index;
                  setLightbox(null);
                  setEditingImageIndex(idx);
                }
              : undefined
          }
        />
      )}

      {/* Draw/crop editor for a pending (not-yet-sent) photo */}
      {editingImageIndex !== null && pendingImages[editingImageIndex] && (
        <ImageEditor
          file={pendingImages[editingImageIndex].file}
          onCancel={() => setEditingImageIndex(null)}
          onConfirm={(edited) => {
            setPendingImages((prev) => {
              const idx = editingImageIndex;
              if (idx === null || !prev[idx]) return prev;
              const next = [...prev];
              URL.revokeObjectURL(next[idx].url);
              next[idx] = { file: edited, url: URL.createObjectURL(edited) };
              return next;
            });
            setEditingImageIndex(null);
          }}
        />
      )}

      {/* Note picker: send one of my own notes */}
      <AnimatePresence>
        {pickerOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => { setPickerOpen(false); setNoteSearch(''); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-stone-900 w-full sm:max-w-md h-[80dvh] sm:h-auto sm:max-h-[75vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800 shrink-0">
                <h3 className="font-bold dark:text-white">{t('pick_a_note')}</h3>
                <button
                  onClick={() => { setPickerOpen(false); setNoteSearch(''); }}
                  className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-all"
                >
                  <X className="w-5 h-5 text-stone-500" />
                </button>
              </div>

              <div className="p-3 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus={isDesktop}
                    value={noteSearch}
                    onChange={(e) => setNoteSearch(e.target.value)}
                    placeholder={t('search') || 'Buscar...'}
                    className="w-full pl-9 pr-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1">
                {filteredNotes.length === 0 && (
                  <p className="text-sm text-stone-400 dark:text-stone-500 italic text-center py-10">
                    {t('no_notes_to_send')}
                  </p>
                )}
                {filteredNotes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={attaching}
                    onClick={() => void sendExistingNote(m.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors disabled:opacity-50"
                  >
                    <span className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                      {m.type === 'list' ? <CheckSquare className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate dark:text-stone-200">{m.title}</span>
                      {m.content && (
                        <span className="block text-xs text-stone-400 dark:text-stone-500 truncate">{m.content}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create a new note, then send it into this thread when the editor closes */}
      {editorOpen && (
        <MemoEditor
          onClose={closeNoteEditor}
          onSaved={(memoId) => { createdNoteRef.current = memoId; }}
        />
      )}
    </div>
  );
}
