/// <reference types="vitest/config" />
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';

import { spaFallback } from './src/app/spaFallback.ts';
import { contentIntegrity } from './src/content/contentIntegrity.ts';
import { remarkWikiLinks } from './src/content/wikiLinks.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));
// Course material lives at the repo root (Material domain, outside apps/) — ADR-0002.
const contentDir = path.resolve(appDir, '../../content');

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Project Pages serve under /<repo>/ (issue #66). Dev keeps the root so local
  // URLs stay short; the router derives its basename from BASE_URL. Keyed on
  // `command` rather than NODE_ENV, which depends on when the config is evaluated.
  base: command === 'build' ? '/nalanda/' : '/',
  plugins: [
    contentIntegrity(contentDir),
    spaFallback(),
    // MDX must transform before the React plugin sees the file.
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [
          remarkFrontmatter,
          [remarkMdxFrontmatter, { name: 'frontmatter' }],
          remarkWikiLinks,
        ],
        providerImportSource: '@mdx-js/react',
      }),
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@content': contentDir },
    // content/ sits outside the app root, so its compiled imports (react/jsx-runtime,
    // @mdx-js/react) must resolve from this app's node_modules, not from content/'s ancestors.
    dedupe: ['react', 'react-dom', '@mdx-js/react'],
  },
  server: {
    // fs.allow replaces Vite's default allowlist, so the app dir must be re-included.
    fs: { allow: [appDir, contentDir] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
}));
