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
      // Twitch review wants readable JavaScript, and libraries not mixed into minified files (guidelines 2.5, 2.6).
      minify: false,
      rolldownOptions: {
        input: { panel: 'panel.html', config: 'config.html' },
        output: {
          // The chunk with React and the libraries both pages share gets a plain name; the others keep their module's.
          chunkFileNames: (chunk) =>
            chunk.moduleIds.some((id) => id.includes('/node_modules/react-dom/')) ? 'assets/vendor-[hash].js' : 'assets/[name]-[hash].js',
          assetFileNames: (asset) => (asset.names.some((name) => name.endsWith('.css')) ? 'assets/styles-[hash][extname]' : 'assets/[name]-[hash][extname]'),
        },
      },
    },
  };
});
