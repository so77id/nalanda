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

  it('refuses the id-based published link rather than dropping its range', () => {
    // `/d/<id>/pubhtml` is how Google published before the `/d/e/` token. The
    // share pattern took it, and the rewrite to `/preview` silently dropped
    // `range` and `single`: the frame showed the whole sheet the author had
    // narrowed (#336 review).
    expect(
      sheetEmbedUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/pubhtml?gid=0&single=true&range=D1:Y27`,
      ),
    ).toBeNull();
    expect(sheetEmbedUrl(`https://docs.google.com/spreadsheets/u/0/d/${ID}/pubhtml`)).toBeNull();
  });

  // The Publicar-en-la-web link (#336). A different document identifier from
  // the share link's id — a token Google mints when the sheet is published —
  // and the only form that honours `range` and `single`. Both choose what the
  // frame SHOWS; neither hides anything, since the whole published tab is one
  // edited query away (ADR-0087).
  describe('the published form', () => {
    // Synthetic, of the length Google mints: these cases pin the pattern, not a
    // live sheet, and a real token here would outlive the data it opens.
    const TOKEN = `2PACX-1vT${'a1B2-c3D4_'.repeat(8)}`;
    const PUBHTML = `https://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml`;

    it('carries its query across whole, so the view the author chose survives', () => {
      // Not parsed: `range` and `single` are the reason to use this form, and a
      // rewrite that dropped either would frame columns or tabs the author left
      // out of the view.
      const filtered = `${PUBHTML}?gid=0&single=true&range=D1:Y27`;

      expect(sheetEmbedUrl(filtered)).toBe(filtered);
    });

    it('accepts it with no query at all', () => {
      expect(sheetEmbedUrl(PUBHTML)).toBe(PUBHTML);
    });

    it('accepts a fragment right after pubhtml', () => {
      expect(sheetEmbedUrl(`${PUBHTML}#gid=0`)).toBe(`${PUBHTML}#gid=0`);
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
      // The rebuild keeps the frame on docs.google.com whatever the pattern
      // takes; the host check is what keeps a foreign link an authoring error
      // instead of quietly rewriting it into a published page the author never
      // named.
      expect(sheetEmbedUrl(`https://evil.example/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
    });

    it('refuses it wrapped in another url', () => {
      // A link copied out of Gmail or a Doc comes wrapped in Google's redirector.
      // It contains the whole published url, so only the anchor at the start of
      // the pattern refuses it — the case above cannot tell an anchored pattern
      // from an unanchored one (#336 review).
      expect(
        sheetEmbedUrl(
          `https://www.google.com/url?q=https://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml`,
        ),
      ).toBeNull();
    });

    it('refuses a host that only looks like docs.google.com', () => {
      // Pins both escaped dots, one case each: unescaped, `.` matches any
      // character.
      expect(sheetEmbedUrl(`https://docsxgoogle.com/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
      expect(sheetEmbedUrl(`https://docs.googlexcom/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
    });

    it('refuses plain http', () => {
      expect(sheetEmbedUrl(`http://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml`)).toBeNull();
    });

    it('refuses a path that carries on past pubhtml', () => {
      // The path must END at `pubhtml`: a url that runs on is an authoring
      // error, not one quietly cut back to `/pubhtml` by the rebuild.
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
