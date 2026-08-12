import { describe, expect, it } from 'vitest';

import { fencesByMeta } from './codeFences';

/** What the MDX pipeline hands a component for ```` ```java <meta> ````. */
function fence(meta: string | undefined, code: string) {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

describe('fencesByMeta', () => {
  it('collects each fence under its meta', () => {
    const found = fencesByMeta([fence('starter', 'class A {}'), fence('test', 'check(1);')]);
    expect(found).toEqual({ starter: 'class A {}', test: 'check(1);' });
  });

  it('finds fences nested below other elements', () => {
    const found = fencesByMeta(
      <div>
        <p>prosa</p>
        <section>{fence('starter', 'class A {}')}</section>
      </div>,
    );
    expect(found).toEqual({ starter: 'class A {}' });
  });

  it('ignores fences with no meta', () => {
    expect(fencesByMeta([fence(undefined, 'class A {}')])).toEqual({});
  });

  it('ignores prose', () => {
    expect(fencesByMeta(<p>solo texto</p>)).toEqual({});
  });

  it('keeps the first when a meta is repeated', () => {
    const found = fencesByMeta([fence('test', 'primero'), fence('test', 'segundo')]);
    expect(found).toEqual({ test: 'primero' });
  });

  it('returns nothing for empty children', () => {
    expect(fencesByMeta(null)).toEqual({});
    expect(fencesByMeta(undefined)).toEqual({});
  });
});
