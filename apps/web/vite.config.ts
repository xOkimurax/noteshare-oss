import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      // Comma-separated hostnames allowed by `vite preview` (e.g. your domain).
      allowedHosts: [
        'localhost',
        ...(process.env.PREVIEW_ALLOWED_HOSTS ?? '')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
      ],
    },
  };
});
