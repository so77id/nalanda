import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fenceOf, fencesByMeta, withoutFences } from './codeFences';

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

  it('ignores data-meta on something that is not a code fence', () => {
    expect(fencesByMeta(<div data-meta="starter">no soy código</div>)).toEqual({});
  });

  it('does not let an empty fence claim the label', () => {
    // An empty starter reads to Exercise as a missing one, so it would show the
    // author-error banner instead of the exercise.
    expect(fencesByMeta([fence('starter', ''), fence('starter', 'class A {}')])).toEqual({
      starter: 'class A {}',
    });
  });
});

describe('withoutFences', () => {
  const text = (nodes: ReturnType<typeof withoutFences>) =>
    render(<div>{nodes}</div>).container.textContent;

  it('keeps the prose and drops the fence', () => {
    expect(text(withoutFences([<p key="p">enunciado</p>, fence('starter', 'class A {}')]))).toBe(
      'enunciado',
    );
  });

  it('keeps prose that shares a wrapper with a fence', () => {
    // Filtering whole top-level children took the surrounding prose with the
    // fence — and exercise 4 already puts a blockquote beside its fences.
    const nodes = withoutFences(
      <blockquote>
        <p>aviso importante</p>
        {fence('test', 'check(1);')}
      </blockquote>,
    );
    expect(text(nodes)).toBe('aviso importante');
  });

  it('keeps a list item whose sibling is a fence', () => {
    const nodes = withoutFences(
      <ul>
        <li>uno</li>
        <li>
          dos
          {fence('starter', 'class A {}')}
        </li>
      </ul>,
    );
    expect(text(nodes)).toBe('unodos');
  });

  it('leaves an unlabelled code block alone', () => {
    expect(text(withoutFences([fence(undefined, 'ejemplo citado')]))).toBe('ejemplo citado');
  });

  it('flattens a fragment instead of dropping it whole', () => {
    const nodes = withoutFences(
      <>
        <p>enunciado</p>
        {fence('starter', 'class A {}')}
      </>,
    );
    expect(text(nodes)).toBe('enunciado');
  });
});

describe('fenceOf', () => {
  it('reads the language and the source of a fenced block', () => {
    // Exactly what the MDX pipeline hands `pre`: one intrinsic `code` child
    // carrying `language-*`, and the source with its trailing newline.
    const read = fenceOf(<code className="language-java">{'class A {}\n'}</code>);

    expect(read).toEqual({ language: 'java', source: 'class A {}' });
  });

  it('keeps blank lines inside the source, trimming only the fence break', () => {
    const read = fenceOf(<code className="language-cpp">{'int a;\n\nint b;\n'}</code>);

    expect(read?.source).toBe('int a;\n\nint b;');
  });

  it('keeps a blank line at the END of the listing too', () => {
    // The case above cannot tell `replace(/\n$/,'')` from `trimEnd()` — a blank
    // line in the MIDDLE survives both. Only a listing that ends in one
    // separates them, and the comment on fenceOf promises the author's blank
    // lines survive. A test named for a promise it does not check is the exact
    // shape testing-strategy.md warns about.
    expect(fenceOf(<code className="language-cpp">{'int a;\n\n'}</code>)?.source).toBe('int a;\n');
  });

  it('does not mistake a class that merely contains the prefix', () => {
    // Kills the unanchored regex: `notlanguage-java` is not a language tag.
    expect(fenceOf(<code className="notlanguage-java">{'x\n'}</code>)?.language).toBeNull();
  });

  it('has no language for a fence written without one', () => {
    // The two ASCII diagrams in 06-java-desde-cpp.mdx are exactly this shape.
    expect(fenceOf(<code>{'programa.cpp -> [g++] -> programa\n'}</code>)?.language).toBeNull();
  });

  it('has no language when the class names something else', () => {
    expect(fenceOf(<code className="highlight">{'x\n'}</code>)?.language).toBeNull();
  });

  it('reads the language even beside other classes', () => {
    expect(fenceOf(<code className="foo language-python bar">{'x\n'}</code>)?.language).toBe(
      'python',
    );
  });

  it('is not a fence when the child is not a code element', () => {
    // `pre` can hold hand-written markup; only a real fence is a fence.
    expect(fenceOf(<span className="language-java">{'x'}</span>)).toBeNull();
  });

  it('is not a fence when there is no single child to read', () => {
    expect(fenceOf(undefined)).toBeNull();
    expect(fenceOf([<code key="a">{'x'}</code>, <code key="b">{'y'}</code>])).toBeNull();
  });
});
