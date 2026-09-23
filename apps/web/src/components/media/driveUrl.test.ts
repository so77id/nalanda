import { describe, expect, it } from 'vitest';

import { drivePreviewUrl } from './driveUrl';

// Control 1's answer key, whose share link is what the professor actually pastes.
const ID = '1v3B7n1hAHUUXt1iUlAYTGvXVTXrmYlRT';
const PREVIEW = `https://drive.google.com/file/d/${ID}/preview`;

describe('drivePreviewUrl', () => {
  it('turns the share link Drive hands out into the embeddable one', () => {
    // `/view` is Drive's full page — header, "Acceder", its own toolbar — and
    // is not what a frame should hold. `/preview` is the bare viewer.
    expect(drivePreviewUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(PREVIEW);
  });

  it('accepts the share link without its query', () => {
    expect(drivePreviewUrl(`https://drive.google.com/file/d/${ID}/view`)).toBe(PREVIEW);
  });

  it('leaves a preview url alone', () => {
    expect(drivePreviewUrl(PREVIEW)).toBe(PREVIEW);
  });

  it('ignores the whitespace a pasted link drags in', () => {
    expect(drivePreviewUrl(`  ${PREVIEW}\n`)).toBe(PREVIEW);
  });

  it('accepts the url Drive puts in the address bar for a second account', () => {
    expect(drivePreviewUrl(`https://drive.google.com/file/u/1/d/${ID}/view`)).toBe(PREVIEW);
  });

  it('keeps the resource key an older file needs to open', () => {
    // Google's 2021 security update added `resourcekey` to the share links of
    // files that existed before it; without the key such a file answers with
    // the request-access page — inside the frame, with every test green.
    // UNVERIFIED against a keyed file (Control 1's has none): measure one
    // before relying on it, as sheetUrl.ts says of its `gid`.
    expect(
      drivePreviewUrl(
        `https://drive.google.com/file/d/${ID}/view?usp=sharing&resourcekey=0-abc_DEF-9`,
      ),
    ).toBe(`${PREVIEW}?resourcekey=0-abc_DEF-9`);
  });

  it('refuses a spreadsheet link, which is SheetEmbed’s to frame', () => {
    expect(
      drivePreviewUrl(
        'https://docs.google.com/spreadsheets/d/1ZwBL8me8tcJssHAsMglUoTSxssPxZG6QlfVNqkXiIKg/edit',
      ),
    ).toBeNull();
  });

  it('refuses a folder link, which is not a file', () => {
    expect(drivePreviewUrl(`https://drive.google.com/drive/folders/${ID}`)).toBeNull();
  });

  it('refuses an id too short to be one', () => {
    expect(drivePreviewUrl('https://drive.google.com/file/d/abc/view')).toBeNull();
  });

  it('refuses a url on another host', () => {
    // The host is the whole of what the sandbox grants `allow-same-origin` to.
    expect(drivePreviewUrl(`https://evil.example/file/d/${ID}/preview`)).toBeNull();
  });

  it('refuses a host that only begins like Drive', () => {
    expect(drivePreviewUrl(`https://drive.google.com.evil.example/file/d/${ID}/view`)).toBeNull();
  });

  it('refuses plain http', () => {
    expect(drivePreviewUrl(`http://drive.google.com/file/d/${ID}/view`)).toBeNull();
  });

  it('refuses a string that is not a url at all', () => {
    expect(drivePreviewUrl('Pauta del Control 1')).toBeNull();
  });

  it('refuses an empty string', () => {
    expect(drivePreviewUrl('')).toBeNull();
  });
});
