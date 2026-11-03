import { mkdirSync } from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from './env.js';
import { HttpError } from './lib/http.js';
import { heartbeatAll } from './lib/sse.js';
import { optionalAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { memosRouter } from './routes/memos.js';
import { foldersRouter } from './routes/folders.js';
import { usersRouter } from './routes/users.js';
import { sharedRouter } from './routes/shared.js';
import { publicRouter } from './routes/public.js';
import { tokensRouter } from './routes/tokens.js';
import { streamRouter } from './routes/stream.js';
import { notificationsRouter } from './routes/notifications.js';
import { contactsRouter } from './routes/contacts.js';
import { commentsRouter } from './routes/comments.js';
import { conversationsRouter } from './routes/conversations.js';
import { kanbanRouter } from './routes/kanban.js';

mkdirSync(env.UPLOADS_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    // The web app (cookie auth) plus browser extensions (Bearer-PAT auth, no
    // cookies — a rogue extension still needs a valid token).
    origin: (origin, cb) => {
      const ok =
        !origin ||
        origin === env.WEB_ORIGIN ||
        /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin);
      cb(null, ok);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(optionalAuth);

// Static images. Long cache — filenames are content-addressed uuids.
app.use(
  '/uploads',
  express.static(env.UPLOADS_DIR, {
    immutable: true,
    maxAge: '365d',
    fallthrough: false,
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/memos', memosRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/users', usersRouter);
app.use('/api/shared', sharedRouter);
app.use('/api/public', publicRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/stream', streamRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/kanban', kanbanRouter);

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: 'validation', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(env.PORT, () => {
  console.log(`noteshare api listening on :${env.PORT} (${env.NODE_ENV})`);
});

const heartbeat = setInterval(heartbeatAll, 25_000);
heartbeat.unref();

function shutdown() {
  clearInterval(heartbeat);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
