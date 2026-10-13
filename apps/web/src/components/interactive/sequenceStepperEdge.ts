/**
 * The one piece of geometry the heap's layout and the tree's share (#321
 * review, ARQ-6): a segment between two nodes, trimmed so it starts and ends
 * on their rims instead of running through the values written inside them.
 * A leaf both layouts import, so neither has to import the other.
 */
export function rimToRim(
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
  r: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: from.cx + ux * r,
    y1: from.cy + uy * r,
    x2: to.cx - ux * r,
    y2: to.cy - uy * r,
  };
}
