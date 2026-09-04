import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Break a widget out of the presentation Slide's prose max-width and re-anchor
 * it to a fraction of the viewport, staying centred. Extracted from
 * `<SortStepper>` (ADR-0065): any widget that needs to breathe in presentation
 * mode can reach for this instead of duplicating the CSS-scale + margin dance.
 *
 * Why it needs JavaScript: the presentation `<Slide>` wraps every child in a
 * chain of centred / padded / overflow-hidden containers AND applies a
 * `transform: scale(<fit>)` to fit the slide's authored size into the viewport.
 * The pure-CSS trick (`left-1/2 -translate-x-1/2 w-screen`) does NOT escape
 * this — it lands the widget at the parent's centred position with the
 * parent's width. Instead, this hook measures the widget's natural
 * left-in-viewport AFTER first paint, then sets `width` and negative
 * `marginLeft` on the outer element so its post-scale footprint lands at
 * `<fraction> * viewport` centred.
 *
 * Only active when `enabled` is true — typically `useMode() === 'presentation'`
 * decides at the call site. Book mode leaves the widget alone (its normal
 * flex/max-width flow is right for reading).
 *
 * @param ref     Outer element to resize / reposition. Must be a block-level
 *                element whose `style.width` and `style.marginLeft` can be
 *                written without breaking its own layout.
 * @param options
 *   - `fraction`: how much of the viewport width the widget should occupy
 *     after the transform:scale is applied. `1` = full viewport, `0.75` = 75%
 *     centred. Default `1`.
 *   - `enabled`: whether to run at all. Default `true`.
 *   - `deps`: values the hook should re-run for (e.g. an input array whose
 *     shape changes the widget's natural width). Concatenated into the
 *     effect's dependency array.
 */
export function useViewportBreakout(
  ref: RefObject<HTMLElement | null>,
  options: {
    fraction?: number;
    enabled?: boolean;
    deps?: readonly unknown[];
  } = {},
): void {
  const { fraction = 1, enabled = true, deps = [] } = options;
  const lastAppliedRef = useRef<{ scale: number; vw: number } | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const readScale = (): number => {
      let s = 1;
      let host: HTMLElement | null = el.parentElement;
      while (host && host !== document.body) {
        const t = window.getComputedStyle(host).transform;
        if (t && t !== 'none') {
          const m = t.match(/matrix\(([^,]+),/);
          const parsed = m ? parseFloat(m[1]!) : NaN;
          if (Number.isFinite(parsed) && parsed > 0) {
            s = parsed;
            break;
          }
        }
        host = host.parentElement;
      }
      return s;
    };

    const update = () => {
      // Short-circuit: the framer-motion `<motion.div>` ancestor rewrites its
      // inline `style` on every RAF of a slide's opacity transition, and
      // MutationObserver fires each time. Skipping when neither the ancestor
      // scale nor the viewport width has actually changed cuts ~24·N forced
      // layouts per slide swap to zero for the transition frames.
      const currentScale = readScale();
      const currentVw = document.documentElement.clientWidth;
      const last = lastAppliedRef.current;
      if (last !== null && last.scale === currentScale && last.vw === currentVw) return;

      // Reset first so measurements reflect the natural flow position.
      el.style.width = '';
      el.style.marginLeft = '';
      const scale = currentScale;
      // The widget's rect uses ANCESTOR-SCALED coordinates; the natural
      // (pre-scale) x-in-parent is `rect.left / scale` when scale is uniform.
      // Size the widget so that AFTER scaling it takes `fraction` of the
      // viewport, then shift it so its centre lines up with the viewport
      // centre.
      const vw = currentVw;
      const displayedWidth = vw * fraction;
      const authored = Math.round(displayedWidth / scale);
      el.style.width = `${authored}px`;
      const rect = el.getBoundingClientRect();
      const targetLeft = (vw - displayedWidth) / 2;
      const shiftAuthored = Math.round((rect.left - targetLeft) / scale);
      el.style.marginLeft = `-${shiftAuthored}px`;
      lastAppliedRef.current = { scale: currentScale, vw: currentVw };
    };

    // Run on next frame — the parent's transform may not have been
    // applied yet on the very first layout pass right after mount, so
    // schedule a few more updates spaced out over ~200 ms so the
    // ancestor's fit-scale transform has time to settle. Without this
    // the widget rendered at scale=1 on first paint and only re-sized
    // when the reader hit refresh; noticed on the Merge and Partition
    // slides where the ancestor is the presentation stage.
    const raf1 = window.requestAnimationFrame(update);
    // Nested rAF: track the inner id in a ref-like local so cleanup can
    // cancel it after the outer has already fired. Without this the inner
    // frame runs against a potentially-unmounted element.
    let raf2Inner: number | null = null;
    const raf2 = window.requestAnimationFrame(() => {
      raf2Inner = window.requestAnimationFrame(update);
    });
    const timers = [window.setTimeout(update, 50), window.setTimeout(update, 200)];
    window.addEventListener('resize', update);
    const parent = el.parentElement;
    let observer: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(update);
      observer.observe(parent);
    }
    // Also watch the ancestor whose inline transform carries the fit-
    // scale — a MutationObserver on its `style` catches the case where
    // the scale changes after the ResizeObserver has already fired
    // (which happens because the parent element's LAYOUT size does not
    // change when its child gets a `transform: scale(...)`).
    let scaleAncestorMO: MutationObserver | null = null;
    if (typeof MutationObserver === 'function') {
      let scaleHost: HTMLElement | null = el.parentElement;
      while (scaleHost && scaleHost !== document.body) {
        const t = window.getComputedStyle(scaleHost).transform;
        if (t && t !== 'none') break;
        scaleHost = scaleHost.parentElement;
      }
      if (scaleHost) {
        scaleAncestorMO = new MutationObserver(update);
        scaleAncestorMO.observe(scaleHost, { attributes: true, attributeFilter: ['style'] });
      }
    }
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (raf2Inner !== null) window.cancelAnimationFrame(raf2Inner);
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', update);
      if (observer) observer.disconnect();
      if (scaleAncestorMO) scaleAncestorMO.disconnect();
      el.style.width = '';
      el.style.marginLeft = '';
      lastAppliedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, enabled, fraction, ...deps]);
}
