import { fileURLToPath } from 'node:url';

import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev` — plain http for working in a regular browser (Twitch is imitated).
// `npm run dev:twitch` — https://localhost:8080, the Testing Base URI set in the Twitch console.
export default defineConfig(({ mode }) => {
  const isTwitchMode = mode === 'twitch';

  return {
    base: './', // Twitch CDN serves the build from a versioned subpath
    plugins: [react(), tailwindcss(), isTwitchMode && basicSsl()],
    // Only the shared Worker code is served from outside extension/ (never worker/.dev.vars with its secrets).
    server: { port: isTwitchMode ? 8080 : 5173, strictPort: true, fs: { allow: ['.', '../worker/src'], deny: ['**/.dev.vars'] } },
    resolve: {
      alias: {
        '@app': '/src/app',
        '@assets': '/src/assets',
        '@domains': '/src/domains',
        '@pages': '/src/pages',
        '@shared': '/src/shared',
      '@worker': fileURLToPath(new URL('../worker/src', import.meta.url)), // shared types, snapshot and JWT code
      },
    },
    // Tests read styles.css as text (the default theme there must match PRESETS.fox); other CSS stays empty in tests.
    test: { css: { include: [/app\/styles\.css/] } },
    build: {
      rolldownOptions: { input: { panel: 'panel.html', config: 'config.html' } },
    },
  };
});
