import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1),

  // Public origin of the web app (used for CORS + OAuth success redirect).
  WEB_ORIGIN: z.string().url(),
  // Public origin of this API (used to build absolute image URLs).
  API_PUBLIC_URL: z.string().url(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),

  UPLOADS_DIR: z.string().default('./uploads'),

  // Comma-separated list of admin emails (full read/write access to every note).
  ADMIN_EMAILS: z.string().default(''),

  // Brevo transactional email. Empty key (or sender) -> emails are logged, not sent.
  BREVO_API_KEY: z.string().default(''),
  BREVO_SENDER_EMAIL: z.string().default(''),
  BREVO_SENDER_NAME: z.string().default('Noteshare'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export const ADMIN_EMAILS = new Set(
  env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const isProd = env.NODE_ENV === 'production';
