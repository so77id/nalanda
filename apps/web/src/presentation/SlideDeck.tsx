import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { mdxChildrenOf } from './mdxChildren';
import { computeSlides } from './parser';
import { RotateNotice } from './RotateNotice';
import { usePortraitPhone } from './usePortraitPhone';

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen?.();
  }
}

interface Props {
  docId: string;
  title: string;
  /** Parser mode from the document frontmatter (auto | explicit). */
  configMode?: 'auto' | 'explicit';
  /** The document's rendered MDX children — injected via the MDX wrapper component. */
  children?: ReactNode;
}

/**
 * Full-viewport slide viewer (POC-style fixed overlay). The current slide is
 * derived from ?slide=N — the URL is the single source of truth, which is
 * also what session sync will drive in v0.3.
 */
export function SlideDeck({ docId, title, configMode = 'auto', children }: Props) {
  // Unconditional and first: mdxChildrenOf runs a useContext internally (see its docs).
  const siblings = mdxChildrenOf(children);
  const slides = useMemo(
    () => computeSlides(siblings, { title, mode: configMode }),
    [siblings, title, configMode],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const portraitPhone = usePortraitPhone();

  // Math.trunc: a crafted non-integer ?slide (e.g. 1.5) must not become a
  // fractional array index (white-screen crash — review finding, issue #64).
  const raw = Number(searchParams.get('slide') ?? '1');
  const requested = Number.isFinite(raw) ? Math.trunc(raw) : 1;
  const index = Math.min(Math.max(requested - 1, 0), slides.length - 1);
  const slide = slides[index]!;

  useEffect(() => {
    const go = (target: number) => {
      const next = Math.min(Math.max(target, 0), slides.length - 1);
      setSearchParams(
        (prev) => {
          prev.set('slide', String(next + 1));
          return prev;
        },
        { replace: true },
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowRight':
        case ' ':
          event.preventDefault();
          go(index + 1);
          break;
        case 'ArrowLeft':
          go(index - 1);
          break;
        case 'Home':
          go(0);
          break;
        case 'End':
          go(slides.length - 1);
          break;
        case 'Escape':
          void navigate(`/d/${docId}`);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [docId, index, navigate, setSearchParams, slides.length]);

  // Replaces the deck rather than covering it: no slide is painted, so nothing
  // of it is readable behind the panel or reachable from it. The reader's
  // position is safe because it lives in ?slide=N, not in this component.
  if (portraitPhone) return <RotateNotice />;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100">
      <div className="flex flex-1 items-center justify-center overflow-hidden px-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-4xl"
          >
            {slide.title ? (
              <h2 className="mb-10 text-5xl font-bold tracking-tight">{slide.title}</h2>
            ) : null}
            <div className="prose prose-invert prose-slate prose-xl max-w-none">
              {slide.content}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="flex items-center justify-between px-6 py-3 text-sm text-slate-500">
        <button
          type="button"
          aria-label="Pantalla completa"
          onClick={toggleFullscreen}
          className="rounded px-2 py-1 hover:bg-slate-800 hover:text-slate-200"
        >
          ⛶
        </button>
        <span>
          {index + 1} / {slides.length}
        </span>
      </footer>
    </div>
  );
}
