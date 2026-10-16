import { describe, expect, it } from 'vitest';

import { sheetEmbedUrl } from './sheetUrl';

// The course's own plan, whose share link is what a professor actually pastes.
const ID = '1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM';
const PREVIEW = `https://docs.google.com/spreadsheets/d/${ID}/preview`;

describe('sheetEmbedUrl', () => {
  it('turns the share link Google hands out into the embeddable one', () => {
    // This is the whole reason the function exists. `/edit` is not blocked —
    // Google sends no `frame-ancestors` — it is the EDITOR, and framed without
    // `allow-same-origin` its own requests fail: an author who pastes what the
    // Compartir button gave them would publish the grid behind a "Se ha
    // producido un error" dialog (verified 2026-08-16).
    expect(sheetEmbedUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(
      PREVIEW,
    );
  });

  it('leaves a preview url alone', () => {
    expect(sheetEmbedUrl(PREVIEW)).toBe(PREVIEW);
  });

  it('keeps the tab the author picked', () => {
    // A `gid` selects one sheet of several. Dropping it would silently publish
    // the first tab instead of the one in the link the author copied.
    expect(sheetEmbedUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1234567`)).toBe(
      `${PREVIEW}?gid=1234567`,
    );
  });

  it('ignores the whitespace a pasted link drags in', () => {
    expect(sheetEmbedUrl(`  ${PREVIEW}\n`)).toBe(PREVIEW);
  });

  it('accepts the url Google puts in the address bar for a second account', () => {
    // `/u/0/` is what a professor signed into more than one Google account
    // copies from the address bar — likelier than opening the Compartir dialog.
    expect(sheetEmbedUrl(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`)).toBe(PREVIEW);
  });

  it('refuses an id too short to be one', () => {
    expect(sheetEmbedUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull();
  });

  it('refuses a Google Doc, which is not a spreadsheet', () => {
    expect(sheetEmbedUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull();
  });

  it('refuses a url on another host', () => {
    // Impersonating the path is not enough: the host is what the sandbox and
    // this site's future CSP are written against.
    expect(sheetEmbedUrl(`https://evil.example/spreadsheets/d/${ID}/preview`)).toBeNull();
  });

  it('refuses plain http', () => {
    expect(sheetEmbedUrl(`http://docs.google.com/spreadsheets/d/${ID}/preview`)).toBeNull();
  });

  it('refuses a string that is not a url at all', () => {
    expect(sheetEmbedUrl('Plan de trabajo EDA')).toBeNull();
  });

  it('refuses an empty string', () => {
    expect(sheetEmbedUrl('')).toBeNull();
  });

  // The Publicar-en-la-web link (#336). A different document identifier from
  // the share link's id — a token Google mints when the sheet is published —
  // and the only form that honours `range`, which is how a grades sheet hides
  // its name and RUT columns without a second file.
  describe('the published form', () => {
    // Solemne 1's grades, published with one tab and columns D–Y only.
    const TOKEN =
      '2PACX-1vQ-I_Ov3y6AWPMDV6eEFP82VMDXZrL_zZBK9g80cxp0cvBcMy3J7Mc69txmQ-oUUc41aIdTziyXV41k';
    const PUBHTML = `https://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml`;

    it('frames it exactly as given, so the range it was published with survives', () => {
      // Verbatim, not rebuilt: `range` and `single` are the whole reason to use
      // this form, and a rewrite that dropped either would silently publish the
      // columns the author meant to hide.
      const filtered = `${PUBHTML}?gid=0&single=true&range=D1:Y27`;

      expect(sheetEmbedUrl(filtered)).toBe(filtered);
    });

    it('accepts it with no query at all', () => {
      expect(sheetEmbedUrl(PUBHTML)).toBe(PUBHTML);
    });

    it('ignores the whitespace a pasted link drags in', () => {
      expect(sheetEmbedUrl(`  ${PUBHTML}?gid=0\n`)).toBe(`${PUBHTML}?gid=0`);
    });

    it('refuses a token too short to be one', () => {
      expect(
        sheetEmbedUrl('https://docs.google.com/spreadsheets/d/e/2PACX-short/pubhtml'),
      ).toBeNull();
    });

    it('refuses it on another host', () => {
      // The url goes into the frame verbatim, so the host check is all that
      // stands between an author's typo and a third party's page.
      expect(sheetEmbedUrl(`https://evil.example/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
    });

    it('refuses plain http', () => {
      expect(sheetEmbedUrl(`http://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
    });

    it('refuses a path that carries on past pubhtml', () => {
      // Verbatim means the path must END at `pubhtml`: `/pubhtml/../../…` is a
      // docs.google.com url to somewhere else entirely once the browser
      // resolves it.
      expect(
        sheetEmbedUrl(`https://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml/../../document`),
      ).toBeNull();
    });

    it('refuses the other published outputs rather than framing a 404', () => {
      // `/d/e/<token>/pub?output=csv` is published too, but it is a download,
      // not a page. Before the published form had a branch of its own, the share
      // pattern took ANY `/d/e/…` url, captured the literal "e" as the id and
      // built `/spreadsheets/d/e/preview` — a 404 that frames Google's own "el
      // archivo que solicitaste no existe", with no authoring error and the whole
      // suite green (#146 review). Every `/d/e/` url that is not `/pubhtml` must
      // still be refused, not rewritten.
      expect(
        sheetEmbedUrl(`https://docs.google.com/spreadsheets/d/e/${TOKEN}/pub?output=csv`),
      ).toBeNull();
    });
  });
});
