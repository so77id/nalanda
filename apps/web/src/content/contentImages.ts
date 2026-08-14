import type { Image, Root } from 'mdast';
import { visit } from 'unist-util-visit';

// The constant only — this module is evaluated by Node when vite.config.ts
// loads the plugin list, and `lib/contentAssets` builds its map with
// `import.meta.glob`, which does not exist there.
// Extension-qualified: this file is also compiled under tsconfig.node
// (nodenext), because vite.config.ts imports the plugin list.
import { ASSET_PREFIX } from '../lib/assetPrefix.ts';

// Anything with a scheme (https:, data:), protocol-relative, or already rooted
// is the author addressing something that is not a file of theirs — left alone.
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

/** The MDX JSX nodes this walks; typed structurally so no extra dependency is named. */
interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}
interface JsxElement {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  attributes: JsxAttribute[];
}

/**
 * The document's own folder as a URL, so a relative asset path can be resolved
 * the way a browser would — including `../`, which string surgery gets wrong.
 */
function folderOf(documentPath: string): URL {
  return new URL(`file://${documentPath}`);
}

function assetKey(url: string, documentPath: string, contentRoot: URL): string | null {
  if (url === '' || NOT_RELATIVE.test(url)) return null;

  const resolved = new URL(url, folderOf(documentPath));
  // An asset outside content/ is not course material; leave it as authored and
  // let it fail visibly rather than inventing a key for it.
  if (!resolved.pathname.startsWith(contentRoot.pathname)) return null;

  return decodeURIComponent(resolved.pathname.slice(contentRoot.pathname.length));
}

/**
 * `content/` as a URL — this file sits four folders below it (apps/web/src/content).
 *
 * The module url goes through a variable deliberately: written literally,
 * `new URL('…', import.meta.url)` is a pattern Vite rewrites at transform time
 * into an *asset* url, and under Vitest this file's root came out as
 * `http://localhost:3000/@fs/…` — against which no document path ever matched,
 * so every image silently kept the path its author wrote.
 */
const moduleUrl = import.meta.url;
const CONTENT_ROOT = new URL('../../../../content/', moduleUrl);

/**
 * Remark plugin: rewrites relative image references — markdown `![](./x.svg)`
 * and the `src` of any JSX element — into `asset:` urls keyed on the path from
 * `content/`. Purely syntactic, like `remarkWikiLinks`: resolution against the
 * built asset map happens at render time (`lib/contentAssets`), so the plugin
 * needs no bundler and a test can drive it with a made-up tree.
 *
 * It exists because MDX compiles `![](./x.svg)` to a literal string attribute.
 * Vite transforms imports, not strings, so the authored path survives verbatim
 * into the document chunk, no asset is emitted, and the build stays green:
 * under `/nalanda/` the browser then resolves it against the document's route
 * and 404s. Measured on main before this plugin existed.
 */
export function remarkContentImages(options?: { contentRoot?: URL }) {
  const contentRoot = options?.contentRoot ?? CONTENT_ROOT;

  return (tree: Root, file: { path?: string }): void => {
    const documentPath = file.path;
    // Compiling a bare string (a test, a REPL) has no document to be relative
    // to; inventing one would produce a key that resolves nowhere.
    if (documentPath === undefined) return;

    visit(tree, (node) => {
      if (node.type === 'image') {
        const key = assetKey((node as Image).url, documentPath, contentRoot);
        if (key !== null) (node as Image).url = ASSET_PREFIX + key;
        return;
      }
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;

      for (const attribute of (node as unknown as JsxElement).attributes) {
        if (attribute.type !== 'mdxJsxAttribute' || attribute.name !== 'src') continue;
        if (typeof attribute.value !== 'string') continue;
        const key = assetKey(attribute.value, documentPath, contentRoot);
        if (key !== null) attribute.value = ASSET_PREFIX + key;
      }
    });
  };
}
