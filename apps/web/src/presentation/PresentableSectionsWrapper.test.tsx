import { render } from '@testing-library/react';
import { Fragment, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { Slide, SectionBreak } from '../components';
import { contentMdxComponents } from '../content';
import { usePresentableSections } from '../lib/presentableSections';

import { PresentableSectionsWrapper } from './PresentableSectionsWrapper';

const H2 = contentMdxComponents.h2;

/**
 * Probe that reports the value the surrounding wrapper publishes. Used as a
 * child of `PresentableSectionsWrapper` so the test observes the context as
 * an ordinary consumer would (which is how `mdxHeading` will read it in S5).
 * Outside a wrapper it reports the default (`docId: null`, empty set), which
 * is the same silence `mdxHeading` will fall back to inside `/catalog`.
 */
function Probe({ onValue }: { onValue: (v: ReturnType<typeof usePresentableSections>) => void }) {
  onValue(usePresentableSections());
  return null;
}

/**
 * `mdxChildrenOf` (which the wrapper runs internally) expects the compiled-
 * MDX shape: ONE opaque element from a function component that returns a
 * Fragment of siblings. This helper mimics that shape so the test drives the
 * same path a real document does.
 */
function CompiledMdxLike({ siblings }: { siblings: ReactNode }) {
  return <Fragment>{siblings}</Fragment>;
}

/**
 * Renders `siblings` inside the wrapper (auto mode unless overridden) and
 * reports the context value it publishes. The `Probe` is rendered as a
 * sibling of the compiled-MDX children — inside the wrapper subtree — so it
 * sees the context an ordinary MDX consumer would. `noWrapper` mounts the
 * probe outside any wrapper, to observe the default silence.
 */
function capture(options: {
  siblings?: ReactNode[];
  configMode?: 'auto' | 'explicit';
  title?: string;
  docId?: string;
  noWrapper?: boolean;
}) {
  const captured: { value?: ReturnType<typeof usePresentableSections> } = {};
  const probe = <Probe key="__probe" onValue={(v) => (captured.value = v)} />;
  if (options.noWrapper) {
    render(probe);
  } else {
    // The probe rides INSIDE the compiled-MDX Fragment so `Children.only` in
    // the wrapper still sees one child (the outer opaque element), while the
    // probe itself lands as a sibling of the real slide markers and can read
    // the context the provider publishes for that subtree.
    const siblings = [...(options.siblings ?? []), probe];
    render(
      <PresentableSectionsWrapper
        docId={options.docId ?? 'mi-doc'}
        title={options.title ?? 'Mi documento'}
        configMode={options.configMode}
      >
        <CompiledMdxLike siblings={siblings} />
      </PresentableSectionsWrapper>,
    );
  }
  return captured.value!;
}

describe('PresentableSectionsWrapper', () => {
  it('publishes the slugs of every auto-mode h2 slide in the document', () => {
    const value = capture({
      siblings: [
        <H2 key="1">La idea</H2>,
        <p key="2">x</p>,
        <H2 key="3">Costo</H2>,
        <p key="4">y</p>,
      ],
    });
    expect(value.docId).toBe('mi-doc');
    expect([...value.presentableSlugs].sort()).toEqual(['costo', 'la-idea']);
  });

  it('in explicit mode publishes only slugs of marked <Slide> titles', () => {
    // The loose h2 ("Ejercicios" in java-tipos-y-flujo, or "Ignorada" here)
    // is book-only in explicit mode and must not be presentable — the whole
    // point of `explicit` is that loose prose is not slide material.
    const value = capture({
      configMode: 'explicit',
      siblings: [
        <H2 key="1">Ignorada como corte</H2>,
        <Slide key="2" title="Tipos primitivos">
          <p>a</p>
        </Slide>,
        <p key="3">solo-libro</p>,
        <SectionBreak key="4" />,
        <p key="5">post-break</p>,
      ],
    });
    expect([...value.presentableSlugs].sort()).toEqual(['tipos-primitivos']);
  });

  it('never publishes the cover slug or a SectionBreak group', () => {
    // Both hazards in one shot: the cover title matches the doc title (its
    // slug would be `doc-largo` if present), and the post-break group is
    // anonymous by design (ADR-0010). Neither should appear.
    const value = capture({
      title: 'Doc largo',
      siblings: [<SectionBreak key="1" />, <p key="2">post-break</p>],
    });
    expect(value.presentableSlugs.size).toBe(0);
  });

  it('is silent outside any wrapper: docId null, empty set', () => {
    // The catalog surface never mounts the wrapper — `mdxHeading` uses this
    // exact absence to fall back to no "Presentar sección" button.
    const value = capture({ noWrapper: true });
    expect(value.docId).toBeNull();
    expect(value.presentableSlugs.size).toBe(0);
  });
});
