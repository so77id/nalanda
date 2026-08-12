/** What every title ends in, so a tab is recognisable as this site at a glance. */
export const BRAND = 'Nalanda';

/**
 * The document title for a path, most specific part first.
 *
 * Every route shipped the same `<title>Nalanda</title>`: ten open tabs were ten
 * identical tabs, browser history was a wall of one word, and a bookmark said
 * nothing about what it pointed at.
 *
 * It lives in the shell rather than in each page because titling the document is
 * the shell's job — a feature may not import `app/`, and the alternative was a
 * DOM-writing hook in `lib/`, which is for pure code (the same reason `draft.ts`
 * was moved out of it in #76).
 *
 * `docTitle` resolves a document id; it returns undefined for an id that is not
 * in the registry, which is a real case — `/d/<id>` serves documents the index
 * never lists.
 */
export function routeTitle(
  pathname: string,
  docTitle: (id: string) => string | undefined,
  familyName: (id: string) => string | undefined = () => undefined,
): string {
  const parts = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  if (parts.length === 0) return BRAND;

  if (parts[0] === 'd' && parts[1] !== undefined) {
    const title = docTitle(decodeURIComponent(parts[1]));
    // The `/present` suffix is deliberately not in the title: it is the same
    // document, and a reader hunting through tabs is looking for the document.
    return title === undefined ? BRAND : `${title} · ${BRAND}`;
  }

  if (parts[0] === 'catalog') {
    const rest = parts.slice(1);
    if (rest.length === 0) return `Catalog · ${BRAND}`;
    if (rest[0] === 'governance') return `Governance · Catalog · ${BRAND}`;
    // `/catalog/c/:name` is a component, `/catalog/:family` is a family. A
    // component's name IS its display name; a family's id is a route slug, and
    // a tab reading "interactivos" is a leaked implementation detail.
    if (rest[0] === 'c') {
      const name = rest[1];
      return name === undefined
        ? `Catalog · ${BRAND}`
        : `${decodeURIComponent(name)} · Catalog · ${BRAND}`;
    }
    const id = decodeURIComponent(rest[0]);
    return `${familyName(id) ?? id} · Catalog · ${BRAND}`;
  }

  return BRAND;
}
