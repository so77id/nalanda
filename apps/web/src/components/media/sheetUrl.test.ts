import { describe, expect, it } from 'vitest';

import { sheetPreviewUrl } from './sheetUrl';

// The course's own plan, whose share link is what a professor actually pastes.
const ID = '1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM';
const PREVIEW = `https://docs.google.com/spreadsheets/d/${ID}/preview`;

describe('sheetPreviewUrl', () => {
  it('turns the share link Google hands out into the embeddable one', () => {
    // This is the whole reason the function exists. `/edit` is refused by
    // Google's own `frame-ancestors` (verified in a real iframe, 2026-08-16):
    // an author who pastes what the Compartir button gave them would otherwise
    // publish a blank rectangle and never see the console violation.
    expect(sheetPreviewUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(
      PREVIEW,
    );
  });

  it('leaves a preview url alone', () => {
    expect(sheetPreviewUrl(PREVIEW)).toBe(PREVIEW);
  });

  it('keeps the tab the author picked', () => {
    // A `gid` selects one sheet of several. Dropping it would silently publish
    // the first tab instead of the one in the link the author copied.
    expect(sheetPreviewUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1234567`)).toBe(
      `${PREVIEW}?gid=1234567`,
    );
  });

  it('ignores the whitespace a pasted link drags in', () => {
    expect(sheetPreviewUrl(`  ${PREVIEW}\n`)).toBe(PREVIEW);
  });

  it('accepts the url Google puts in the address bar for a second account', () => {
    // `/u/0/` is what a professor signed into more than one Google account
    // copies from the address bar — likelier than opening the Compartir dialog.
    expect(sheetPreviewUrl(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`)).toBe(PREVIEW);
  });

  it('refuses the Publicar-en-la-web link rather than framing a 404', () => {
    // The published form is `/d/e/<token>/pubhtml`. It IS a docs.google.com
    // spreadsheet url, so the naive pattern accepted it, captured the literal
    // "e" as the id and built `/spreadsheets/d/e/preview` — a 404 that frames
    // Google's own "el archivo que solicitaste no existe", with no authoring
    // error and the whole suite green. Exactly the silent failure this module
    // exists to prevent (#146 review).
    expect(
      sheetPreviewUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vQx9Zk3example/pubhtml'),
    ).toBeNull();
  });

  it('refuses an id too short to be one', () => {
    expect(sheetPreviewUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull();
  });

  it('refuses a Google Doc, which is not a spreadsheet', () => {
    expect(sheetPreviewUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull();
  });

  it('refuses a url on another host', () => {
    // Impersonating the path is not enough: the host is what the sandbox and
    // this site's future CSP are written against.
    expect(sheetPreviewUrl(`https://evil.example/spreadsheets/d/${ID}/preview`)).toBeNull();
  });

  it('refuses plain http', () => {
    expect(sheetPreviewUrl(`http://docs.google.com/spreadsheets/d/${ID}/preview`)).toBeNull();
  });

  it('refuses a string that is not a url at all', () => {
    expect(sheetPreviewUrl('Plan de trabajo EDA')).toBeNull();
  });

  it('refuses an empty string', () => {
    expect(sheetPreviewUrl('')).toBeNull();
  });
});
