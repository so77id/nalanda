/// <reference types="vitest/config" />
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { spaFallback } from './src/app/spaFallback.ts';
import { contentIntegrity } from './src/content/contentIntegrity.ts';
import { questionBank } from './src/content/questionBank.ts';
import { remarkPlugins } from './src/content/mdxPlugins.ts';
import { rehypePlugins } from './src/content/rehypePlugins.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));
// Course material lives at the repo root (Material domain, outside apps/) — ADR-0002.
const contentDir = path.resolve(appDir, '../../content');

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  // Project Pages serve under /<repo>/ (issue #66); the router derives its
  // basename from BASE_URL. Preview must use the deployed base too — it serves
  // the built dist, whose asset URLs already carry the prefix — while dev keeps
  // the root so local URLs stay short.
  base: command === 'build' || isPreview ? '/nalanda/' : '/',
  build: {
    // Never inline an asset into the stylesheet. Vite's default inlines anything
    // under 4096 bytes, and exactly one asset in this app qualifies: KaTeX's
    // `Size3-Regular.woff2` at 3,624 bytes. Being in the CSS made it
    // unconditional — every page in the site downloaded a font for large
    // delimiters, whether or not it had a formula, at 4,343 bytes gzip: **52% of
    // the whole cost of shipping mathematics** (#118 review, ADR-0027 §3).
    //
    // Zero rather than a smaller threshold because the tradeoff inlining buys —
    // one fewer request — is worthless for a font the page usually does not
    // need, and this app has no other asset near the limit.
    assetsInlineLimit: 0,
  },
  plugins: [
    contentIntegrity(contentDir),
    questionBank(contentDir),
    spaFallback(),
    // MDX must transform before the React plugin sees the file.
    {
      enforce: 'pre',
      // Both lists live in src/content/ so the suite can compile MDX through the
      // same ones the build uses, instead of scraping this file for plugin
      // names. Math needs one from each tree: remark to parse `$$…$$`, rehype to
      // render it.
      ...mdx({ remarkPlugins, rehypePlugins, providerImportSource: '@mdx-js/react' }),
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
