import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

// `summary` is in the list because a <details> disclosure IS tabbable, and the
// browser's own tab order is what the trap has to match. Matching the selector
// is not enough on its own — see `focusables()`.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The elements Tab will actually visit, in order. The visibility filter is the
 * load-bearing half: `querySelectorAll` happily returns links inside a
 * COLLAPSED <details>, which a browser skips and `focus()` silently refuses.
 * Taking those as the trap's first/last means Tab from the last *visible*
 * control matches nothing, nothing is prevented, and focus leaves the modal —
 * observed in Chromium landing on the toggle behind the drawer.
 *
 * The fallback is not a formality. jsdom has no layout, so `checkVisibility` is
 * undefined and `offsetParent` is null for EVERYTHING there: filtering on
 * `offsetParent` emptied the list, the trap degenerated to "prevent every Tab",
 * and the suite's trap cases passed without proving anything. The closed
 * `<details>` is the one hidden-ness jsdom can still be asked about.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (typeof element.checkVisibility === 'function') return element.checkVisibility();
    const group = element.closest('details');
    return !group || group.open || element.tagName === 'SUMMARY';
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
}

/**
 * The sidebar as an overlay, for widths that cannot afford a column. Modal
 * while open: focus enters it, Tab cannot leave it, Escape and the backdrop
 * close it, and focus returns to whatever opened it.
 */
export function Drawer({ open, onClose, label, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  // The effect below must run ONCE per open, so it cannot depend on `onClose`:
  // callers pass an inline arrow, a new identity every render, and re-running
  // meant cleanup refocused the opener and setup refocused the panel — the
  // reader was thrown out of the filter field they were typing in the moment
  // anything re-rendered the page (observed when the lazy document landed).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    if (!node) return;

    // Captured before focus moves, so closing puts it back on the toggle
    // without the toggle having to hand us a ref.
    const opener = document.activeElement as HTMLElement | null;
    (focusables(node)[0] ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const reachable = focusables(node);
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scrollLock;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    // No breakpoint here: a modal overlay does not get to know at which width
    // its page stops needing it. The page owns that, in one place — and when it
    // owned it here too, the two disagreed and 768–1535px got neither.
    <div className="fixed inset-0 z-40">
      <div
        data-testid="drawer-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-slate-800 bg-slate-950 p-4"
      >
        <button
          type="button"
          onClick={() => close.current()}
          aria-label="Cerrar"
          className="mb-3 self-end rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          <X size={16} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}
