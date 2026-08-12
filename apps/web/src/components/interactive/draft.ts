// Saving what the student wrote, because Java cannot be interrupted.
//
// A Java program runs on the page's main thread (ADR-0017), so an endless loop
// freezes the tab and nothing recovers it — the student closes it and loses
// whatever was in the editor. The freeze itself is accepted (issue #76); what is
// not acceptable is that it costs them their work. Saving immediately before a
// run turns "I lost half an hour" into "I lost a reload".

const PREFIX = 'nalanda:draft:';

/** djb2 — a short, stable id for a seed. Not a checksum; collisions are harmless. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * A key for one editor on one page.
 *
 * Seeded with the starting source rather than a position, so reordering a
 * document or adding a paragraph does not hand a student someone else's draft —
 * and so an author need not invent an id for every editor they write.
 */
export function draftKey(scope: string, seed: string): string {
  return `${PREFIX}${scope}:${hash(seed)}`;
}

// Storage throws when it is disabled or full (Safari private browsing is the
// common case). Losing a draft is bad; taking the page down over it is worse.

export function readDraft(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // ignored on purpose — see above
  }
}

export function clearDraft(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignored on purpose — see above
  }
}
