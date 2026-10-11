import { HEAP_BOX, HEAP_NODE_R, heapEdge, layoutHeap } from './sequenceStepperHeapLayout';
import { CELL_FILL, CELL_STROKE } from './sequenceStepperPaint';
import type { SequenceStep } from './sequenceStepperTrace';

// ── the heap: one array, two pictures (#304, ADR-0077) ────────────────────

/**
 * The heap recipe draws the SAME cells twice — as the complete binary tree
 * the array encodes, and as the array itself — and paints every cell the
 * same in both, so a swap the reader watches in the tree is visibly a swap of
 * two slots of the array. Stacked in the book, where the column is narrow;
 * side by side on a slide, where the width is there and the correspondence is
 * read across rather than down.
 *
 * The tree holds only the first `n` cells: a cell past `n` has left the heap
 * (the stale copy extractMax leaves behind), and the
 * tree losing its last leaf while the array keeps the value is exactly the
 * `n--` the listing just ran.
 */
export function HeapView({
  step,
  maxCells,
  maxSlots,
  sideBySide,
}: {
  step: SequenceStep;
  maxCells: number;
  maxSlots: number;
  sideBySide: boolean;
}) {
  const slots = step.capacity ?? step.cells.length + 1;
  const layout = layoutHeap(maxCells, slots, maxSlots);
  const n = step.heapSize ?? step.cells.length;
  const inHeap = step.cells.slice(0, n);
  const pointed = new Map<number, string[]>();
  for (const p of step.pointers) {
    if (p.index === null) continue;
    pointed.set(p.index + 1, [...(pointed.get(p.index + 1) ?? []), p.name]);
  }
  const outside = step.cells.slice(n);
  const summary = `Heap con n = ${n}: data[1..${n}] = ${inHeap.map((c) => c.value).join(', ') || 'vacío'}${
    outside.length > 0 ? `; fuera del heap: ${outside.map((c) => c.value).join(', ')}` : ''
  }. ${step.description}`;

  return (
    <div
      data-testid="heap-views"
      data-arrangement={sideBySide ? 'side-by-side' : 'stacked'}
      role="img"
      aria-label={summary}
      className={`flex items-center justify-center gap-4 p-3 ${sideBySide ? 'flex-row' : 'flex-col'}`}
      style={{ maxHeight: sideBySide ? 'min(42vh, 400px)' : undefined }}
    >
      <svg
        data-testid="heap-tree"
        viewBox={`0 0 ${layout.tree.width} ${layout.tree.height}`}
        className="h-auto"
        style={{
          width: sideBySide ? '48%' : '100%',
          maxWidth: `${layout.tree.width * 1.5}px`,
          maxHeight: sideBySide ? 'min(40vh, 380px)' : '20rem',
        }}
        aria-hidden
      >
        {inHeap.map((_, i) => {
          const k = i + 1;
          if (k === 1) return null;
          const e = heapEdge(layout, k);
          const parent = inHeap[Math.floor(k / 2) - 1]!;
          const hot = parent.state === 'swap' && inHeap[i]!.state === 'swap';
          return (
            <line
              key={`e${k}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={hot ? 'var(--color-accent)' : 'var(--color-rule-strong)'}
              strokeWidth={hot ? 2.8 : 1.2}
            />
          );
        })}
        {inHeap.map((cell, i) => {
          const node = layout.tree.nodes[i]!;
          const strong = cell.state !== 'idle' && cell.state !== 'stale';
          return (
            <g key={cell.id} data-k={i + 1} data-state={cell.state}>
              <circle
                cx={node.cx}
                cy={node.cy}
                r={HEAP_NODE_R}
                fill={CELL_FILL[cell.state]}
                stroke={CELL_STROKE[cell.state]}
                strokeWidth={cell.state === 'swap' ? 2.8 : strong ? 2.2 : 1.2}
              />
              <text
                x={node.cx}
                y={node.cy + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="600"
                fill="var(--color-ink)"
              >
                {cell.value}
              </text>
              {/* Under the node, centred: the one spot the two edges
                  leaving for the children do not cross. Beside the rim it
                  landed on the edge to the right child. */}
              <text
                x={node.cx}
                y={node.cy + HEAP_NODE_R + 11}
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-ink-faint)"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      <svg
        data-testid="heap-array"
        viewBox={`0 0 ${layout.array.width} ${layout.array.height}`}
        className="h-auto"
        style={{
          width: sideBySide ? '48%' : '100%',
          maxWidth: `${layout.array.width * 1.6}px`,
        }}
        aria-hidden
      >
        {layout.array.boxes.map((box) => {
          const cx = box.x + HEAP_BOX / 2;
          const cell = box.slot === 0 ? undefined : step.cells[box.slot - 1];
          const unused = box.slot === 0;
          const free = !unused && cell === undefined;
          const names = pointed.get(box.slot) ?? [];
          return (
            <g
              key={box.slot}
              data-slot={box.slot}
              data-state={cell?.state}
              data-unused={unused ? 'true' : undefined}
            >
              <rect
                x={box.x}
                y={box.y}
                width={HEAP_BOX}
                height={HEAP_BOX}
                rx={3}
                fill={cell === undefined ? 'var(--color-sunk)' : CELL_FILL[cell.state]}
                stroke={cell === undefined ? 'var(--color-rule)' : CELL_STROKE[cell.state]}
                strokeWidth={
                  cell?.state === 'swap' ? 2.8 : cell && cell.state !== 'idle' ? 2.2 : 1.2
                }
                strokeDasharray={unused || free || cell?.state === 'stale' ? '3 3' : undefined}
                opacity={cell?.state === 'stale' ? 0.55 : 1}
              />
              {cell === undefined ? null : (
                <text
                  x={cx}
                  y={box.y + HEAP_BOX / 2 + 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="600"
                  fill="var(--color-ink)"
                >
                  {cell.value}
                </text>
              )}
              <text
                x={cx}
                y={layout.array.railY}
                textAnchor="middle"
                fontSize="10"
                fill="var(--color-ink-faint)"
              >
                {box.slot}
              </text>
              {unused ? (
                <text
                  x={box.x}
                  y={layout.array.pointerY}
                  textAnchor="start"
                  fontSize="9"
                  fill="var(--color-ink-soft)"
                >
                  no se usa
                </text>
              ) : names.length > 0 ? (
                <text
                  x={cx}
                  y={layout.array.pointerY}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill="var(--color-focus)"
                >
                  ↑{names.join(',')}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
