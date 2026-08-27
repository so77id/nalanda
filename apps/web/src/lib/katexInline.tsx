import katex from 'katex';

/**
 * The runtime KaTeX renderer for inline titles. Isolated in its own module
 * so `renderInlineTitle` can pull it through `React.lazy` — `katex` (~260 kB
 * before gzip) must NOT ride in the entry chunk of every page. The
 * architecture guard (`src/architecture.test.ts`) verifies that.
 *
 * Body-inline math (`$$...$$` in prose) is rendered at BUILD time by
 * rehype-katex, so this runtime path exists only for JSX attribute strings —
 * `<Slide title="...">` and any future component that receives a raw string.
 */
export default function KatexInline({ math }: { math: string }) {
  const html = katex.renderToString(math, {
    throwOnError: false,
    output: 'htmlAndMathml',
  });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
