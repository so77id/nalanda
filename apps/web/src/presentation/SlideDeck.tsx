import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode, TouchEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { mdxChildrenOf } from './mdxChildren';
import { computeSlides } from './parser';
import { fitScale } from './fit';
import { startsInsideHorizontalScroller, swipeDirection } from './swipe';
import type { Point } from './swipe';
import { RotateNotice } from './RotateNotice';
import { usePortraitPhone } from './usePortraitPhone';

// Exiting is guarded everywhere it happens: exitFullscreen() REJECTS when
// nothing is fullscreen, and `void` attaches no catch, so an unguarded call is
// an unhandled rejection on every ordinary exit (measured in Chromium, #103
// review). Three call sites had drifted into three spellings of this.
function leaveFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen?.();
}

// The browser owns this state and changes it behind our back — Escape, the
// browser's own chrome, the portrait rule. useSyncExternalStore re-reads after
// subscribing, which is the shape frontend-code-style.md §State fixes for a
// browser store.
function subscribeToFullscreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

function isFullscreen(): boolean {
  return document.fullscreenElement != null;
}

/**
 * Whether this browser can put a web page in fullscreen at all. On iOS none
 * can (ADR-0023 — the same fact that ruled out an orientation lock), so the
 * control would be a button that answers nothing. Read at render: a browser
 * does not grow the API mid-session, so there is no store to subscribe to.
 */
function canGoFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function';
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    leaveFullscreen();
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
  const fullscreen = useSyncExternalStore(subscribeToFullscreen, isFullscreen);

  // Math.trunc: a crafted non-integer ?slide (e.g. 1.5) must not become a
  // fractional array index (white-screen crash — review finding, issue #64).
  const raw = Number(searchParams.get('slide') ?? '1');
  const requested = Number.isFinite(raw) ? Math.trunc(raw) : 1;

  // ?section=<slug> is the deep-link form the book publishes on every h2
  // (`content/mdxHeading.tsx` #256). It wins over ?slide when both come in
  // together: an unknown slug falls back to slide 1 with the same tolerance
  // as an out-of-range ?slide — never a white screen. The URL is then
  // rewritten to the canonical `?slide=<N>` form in the effect below so the
  // history holds ONE shape (ADR-0013) and a bookmark of the resolved URL
  // still resolves after slides are renumbered.
  //
  // One clamp on purpose: `findIndex` returns -1 for an unknown slug and the
  // clamp resolves it to slide 1, matching the ?slide out-of-range tolerance
  // in the same expression.
  const rawSection = searchParams.get('section');
  const preferred =
    rawSection !== null ? slides.findIndex((s) => s.slug === rawSection) : requested - 1;
  const index = Math.min(Math.max(preferred, 0), slides.length - 1);
  const slide = slides[index]!;

  useEffect(() => {
    if (rawSection === null) return;
    setSearchParams(
      (prev) => {
        prev.delete('section');
        prev.set('slide', String(index + 1));
        return prev;
      },
      { replace: true },
    );
  }, [index, rawSection, setSearchParams]);

  // Out of the keydown effect and shared, so the keyboard and the finger reach
  // the same clamping and the same ?slide contract (ADR-0013) — two paths to
  // "go to slide N" is two places for the URL to stop being the truth.
  const go = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 0), slides.length - 1);
      setSearchParams(
        (prev) => {
          prev.set('slide', String(next + 1));
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams, slides.length],
  );

  // The one way out, used by Escape and by the footer control. Absolute, not
  // history.back(): a reader who opened /present from a link has nothing behind
  // them (ADR-0023). Fullscreen goes with it, because the control that exits
  // fullscreen lives in the deck being left.
  //
  // If the current slide has a slug (S1), append `#<slug>` so the book takes
  // the reader back to the h2 they were watching — `mdxHeading.tsx` already
  // renders `id={slug}` with `scroll-mt-8`, so the browser handles the scroll
  // on its own. Without a slug (cover, SectionBreak) the URL stays fragment-
  // less, preserving the pre-#256 behaviour for those two cases.
  const leave = useCallback(() => {
    leaveFullscreen();
    const target = slide.slug ? `/d/${docId}#${slide.slug}` : `/d/${docId}`;
    void navigate(target);
  }, [docId, navigate, slide.slug]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The panel replaces the deck's markup, not this window-level listener:
      // hooks run above the early return, so behind the panel every slide key
      // still moved ?slide with nothing painted — measured in Chromium at
      // 390x844, two ArrowRight took ?slide=2 to 3 and rotating landed on the
      // wrong slide (#91 review). Escape is deliberately still live: it is the
      // way out of a modal, and the panel is one.
      if (portraitPhone && event.key !== 'Escape') return;
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
          leave();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, index, leave, portraitPhone, slides.length]);

  // The gesture the phone has instead of arrow keys. A single finger only:
  // a second one means a pinch, and zooming is not navigating.
  const touchStart = useRef<Point | null>(null);
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    if (!touch || startsInsideHorizontalScroller(event.target, event.currentTarget)) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  // The system can take a gesture away mid-drag (a notification, an edge
  // swipe). Without this the start point survived and the NEXT touchend acted
  // on coordinates the reader never finished — pre-existing from #99.
  const onTouchCancel = () => {
    touchStart.current = null;
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const direction = swipeDirection(start, { x: touch.clientX, y: touch.clientY });
    if (direction) go(index + (direction === 'next' ? 1 : -1));
  };

  // A slide is authored at one size and shown at whatever size the device has.
  // Rather than reflowing it — which changes where every line breaks, so the
  // slide the author built is not the slide the reader sees — it is laid out at
  // its design size and scaled down to fit. Measured with offsetWidth/Height,
  // which ignore the transform we are about to apply and so stay the natural
  // size on every pass.
  // Callback refs in STATE, not useRef, so the effect below can depend on the
  // identity of the nodes it measures. Keyed on [index] instead, it missed the
  // two ways this deck actually gets a new content node (#99 review, both
  // measured in Chromium): rotating out of the rotate panel mounts the whole
  // deck without changing the index, so nothing was ever measured and the slide
  // overflowed its stage 3:1; and `AnimatePresence mode="wait"` mounts the
  // incoming slide AFTER the index changed, so the effect measured the
  // outgoing node and every slide from the second on kept a stale scale.
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!stageNode || !contentNode) return;
    const measure = () =>
      setScale(
        fitScale(
          { width: stageNode.clientWidth, height: stageNode.clientHeight },
          { width: contentNode.offsetWidth, height: contentNode.offsetHeight },
        ),
      );
    measure();
    // Rotation, the browser chrome appearing, a font finishing loading: all of
    // them change the stage without changing the slide.
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(stageNode);
    observer.observe(contentNode);
    return () => observer.disconnect();
  }, [stageNode, contentNode]);

  // Fullscreen belongs to the deck, and the deck is about to be gone: the ⛶
  // button is the only control that exits it, so leaving it on would strand the
  // panel inside a fullscreen page with no way back out of it.
  useEffect(() => {
    if (portraitPhone) leaveFullscreen();
  }, [portraitPhone]);

  // Replaces the deck rather than covering it: no slide is painted, so nothing
  // of it is readable behind the panel or reachable from it. The reader's
  // position is safe because it lives in ?slide=N, not in this component.
  if (portraitPhone) return <RotateNotice docId={docId} />;

  return (
    <div className="fixed inset-0 h-[100dvh] z-40 flex flex-col bg-deck-ground text-ink">
      <div
        ref={setStageNode}
        data-testid="slide-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        className="flex flex-1 items-center justify-center overflow-hidden px-16"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            ref={setContentNode}
            style={{ transform: `scale(${scale})` }}
            className="w-full max-w-4xl"
          >
            {slide.title ? (
              // `text-accent-pop` per #225 / ADR-0026 addendum: the deck was
              // unified with the book's `bg-ground`, giving accent-pop ≥3:1
              // contrast on slide titles so the deck exception is retired.
              // `mt-8` kept from #218: gives long-titled slides breathing
              // room above so a two-line title doesn't hug the top edge.
              <h2 className="text-accent-pop mt-8 mb-10 text-5xl font-bold tracking-tight">
                {slide.title}
              </h2>
            ) : null}
            <div className="prose prose-xl max-w-none">{slide.content}</div>
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="flex items-center justify-between px-[max(1.5rem,env(safe-area-inset-left))] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pr-[max(1.5rem,env(safe-area-inset-right))] text-sm text-ink-faint">
        <div className="flex items-center gap-2">
          {canGoFullscreen() ? (
            <button
              type="button"
              aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              onClick={toggleFullscreen}
              className="rounded p-2 hover:bg-sunk hover:text-ink-soft"
            >
              ⛶
            </button>
          ) : null}
          {/* Escape does this too, and says so nowhere on screen — which is the
              whole reason this exists. A phone has no Escape at all. */}
          <button
            type="button"
            aria-label="Salir de la presentación"
            onClick={leave}
            className="rounded p-2 hover:bg-sunk hover:text-ink-soft"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <span>
          {index + 1} / {slides.length}
        </span>
      </footer>
    </div>
  );
}
