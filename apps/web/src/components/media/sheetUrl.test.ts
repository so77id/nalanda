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
