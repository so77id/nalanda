import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import {
  BOX_H,
  BOX_W,
  LINK_W,
  LIST_GAP,
  layoutSequence,
  linkArrow,
  type SequenceLayout,
} from './sequenceStepperLayout';
import {
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceCell,
  type SequenceOperation,
  type SequenceRecipe,
  type SequenceStep,
  type SequenceTrace,
} from './sequenceStepperTrace';
import {
  ControlButton,
  LegendSwatch,
  NarrationStrip,
  StepperHeader,
  useStepPlayback,
  type StepSpeed,
} from './stepperShell';
import { useViewportBreakout } from '../useViewportBreakout';

export interface SequenceStepperProps {
  /** Which structure to draw. Selects both the picture and the listing. */
  eda?: SequenceRecipe | string;
  /** Which operation to animate over that structure. */
  operation?: SequenceOperation | string;
  /** The starting contents, in reading order. Six or fewer read best. */
  values?: number[];
  /**
   * The value to insert. Required by every `insert-*` but `insert-ordered`.
   * An ARRAY inserts each value in turn over the same chain, so a slide can
   * show the list growing instead of one insertion in isolation.
   */
  value?: number | number[];
  /** The position to act on. Required by `insert-at` and `remove-at`. */
  index?: number;
  /** The value looked for. Required by `search` and `insert-ordered`. */
  target?: number;
  /** Lists only: draw a `tail` pointer, and let the operations use it. */
  tail?: boolean;
  /** Playback default. Off unless the author asks (rule Peli 1/2). */
  autoplay?: boolean;
  /** `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms. */
  speed?: StepSpeed;
  /** Hide the code panel when the slide already carries the listing. */
  showCode?: boolean;
  /** Widget header override. */
  title?: string;
}

const RECIPE_LABEL: Record<SequenceRecipe, string> = {
  array: 'arreglo',
  'dynamic-array': 'arreglo dinámico',
  'linked-list-singly': 'lista simplemente enlazada',
  'linked-list-doubly': 'lista doblemente enlazada',
  'linked-list-circular': 'lista circular',
};

const OPERATION_LABEL: Record<SequenceOperation, string> = {
  'get-at': 'obtener una posición',
  'insert-first': 'insertar al principio',
  'insert-last': 'insertar al final',
  'insert-at': 'insertar en una posición',
  'insert-ordered': 'insertar en orden',
  'remove-first': 'eliminar el primero',
  'remove-last': 'eliminar el último',
  'remove-at': 'eliminar una posición',
  search: 'buscar',
};

/** The most elements the picture stays legible with, measured on a slide. */
const MAX_VALUES = 8;

/**
 * `<SequenceStepper>` — the axis widget of the linked-list class (ADR-0074).
 *
 * One widget, two props that pick what it shows: `eda` selects the structure
 * (array, dynamic array, or a singly / doubly / circular list) and `operation`
 * selects the animation. The surface never changes between combinations — code
 * panel, structure, narration, controls — so the reader learns one visual
 * vocabulary and reads every structure of the unit through it.
 *
 * The structure is one hand-written SVG whose every coordinate comes from
 * `sequenceStepperLayout`; the frames come from `sequenceStepperTrace`. Both
 * are pure and pinned by the suite, which leaves the browser only the paint.
 */
export function SequenceStepper({
  eda,
  operation,
  values,
  value,
  index,
  target,
  tail = false,
  autoplay = false,
  speed = 'normal',
  showCode = true,
  title,
}: SequenceStepperProps) {
  if (eda === undefined || !RECIPES.includes(eda as SequenceRecipe)) {
    return (
      <AuthoringError component="SequenceStepper">
        {eda === undefined ? (
          <>
            falta la prop <code>eda</code>. Recetas: {RECIPES.join(', ')}.
          </>
        ) : (
          <>
            «{eda}» no es una receta conocida. Hoy son {RECIPES.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }
  if (operation === undefined || !OPERATIONS.includes(operation as SequenceOperation)) {
    return (
      <AuthoringError component="SequenceStepper">
        {operation === undefined ? (
          <>
            falta la prop <code>operation</code>. Operaciones: {OPERATIONS.join(', ')}.
          </>
        ) : (
          <>
            «{operation}» no es una operación conocida. Hoy son {OPERATIONS.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }
  const recipe = eda as SequenceRecipe;
  const op = operation as SequenceOperation;
  if (!isValidCombination(recipe, op)) {
    return (
      <AuthoringError component="SequenceStepper">
        «{OPERATION_LABEL[op]}» no está definida sobre «{RECIPE_LABEL[recipe]}»: esta clase presenta
        el orden como una variante de la lista, no del arreglo.
      </AuthoringError>
    );
  }
  if (values === undefined) {
    return (
      <AuthoringError component="SequenceStepper">
        falta la prop <code>values</code> con el contenido inicial.
      </AuthoringError>
    );
  }
  // The guard has to count what the chain will GROW to, not what it starts
  // at: `value={[9, 4, 6]}` over four nodes ends at seven.
  const inserted = op.startsWith('insert') && Array.isArray(value) ? value.length : 0;
  if (values.length + inserted > MAX_VALUES) {
    return (
      <AuthoringError component="SequenceStepper">
        la cadena llega a {values.length + inserted} elementos. El dibujo se lee bien hasta{' '}
        {MAX_VALUES}; con más, los nodos quedan ilegibles en la proyección.
      </AuthoringError>
    );
  }
  return (
    <Body
      recipe={recipe}
      operation={op}
      values={values}
      value={value}
      index={index}
      target={target}
      tail={tail}
      autoplay={autoplay}
      speed={speed}
      showCode={showCode}
      title={title}
    />
  );
}

interface BodyProps {
  recipe: SequenceRecipe;
  operation: SequenceOperation;
  values: number[];
  value?: number | number[];
  index?: number;
  target?: number;
  tail: boolean;
  autoplay: boolean;
  speed: StepSpeed;
  showCode: boolean;
  title?: string;
}

function Body({
  recipe,
  operation,
  values,
  value,
  index,
  target,
  tail,
  autoplay,
  speed,
  showCode,
  title,
}: BodyProps) {
  const mode = useMode();
  const isPresentation = mode === 'presentation';
  const outerRef = useRef<HTMLElement | null>(null);

  // MDX re-mints `values` on every parent re-render, so the memo and every
  // reset key hang off a primitive-derived string rather than the array's
  // identity (`add-a-content-component.md` §2, learned in #266).
  const valuesKey = values.join(',');
  const resetKey = [recipe, operation, valuesKey, String(value), index, target, tail].join('|');

  const built = useMemo((): { trace: SequenceTrace } | { error: string } => {
    try {
      return {
        trace: traceFor(recipe, operation, {
          values: valuesKey === '' ? [] : valuesKey.split(',').map(Number),
          value,
          index,
          target,
          tail,
        }),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [recipe, operation, valuesKey, value, index, target, tail]);

  const trace = 'trace' in built ? built.trace : null;
  const totalSteps = trace?.steps.length ?? 0;

  const playback = useStepPlayback({
    totalSteps,
    autoplay,
    speed,
    visibilityRef: outerRef,
    resetKey,
  });

  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: 0.75,
    deps: [resetKey],
  });

  if (trace === null) {
    return (
      <AuthoringError component="SequenceStepper">
        {'error' in built ? built.error : 'no se pudo construir la animación.'}
      </AuthoringError>
    );
  }

  const step = trace.steps[Math.min(playback.stepIndex, totalSteps - 1)]!;
  // The chip beside it already names the structure, so the heading names only
  // the operation — repeating the recipe pushed the step counter onto a second
  // line at 1440px.
  const heading = title ?? OPERATION_LABEL[operation];
  const atEnd = playback.stepIndex >= totalSteps - 1;

  return (
    <figure
      ref={outerRef}
      data-widget="sequence-stepper"
      data-recipe={recipe}
      data-operation={operation}
      data-mode={mode}
      data-step={playback.stepIndex}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <StepperHeader
        // "eda" is the course's own acronym, introduced and defined in the
        // opening act of 18-edd-listas-enlazadas.mdx (TDA = the contract, EDA
        // = the implementation). A class that mounts this widget without
        // having introduced it would be showing the reader an undefined
        // shorthand — the guide's §2 vocabulary note is where that gets said.
        kind={`eda · ${RECIPE_LABEL[recipe]}`}
        title={heading}
        stepIndex={playback.stepIndex}
        totalSteps={totalSteps}
      />

      {/*
        Stacked in BOTH modes, and the panels share a 1px rule rather than
        each carrying a border of its own — the shape `<StepShow>` uses, which
        is the widget the sibling class of this unit is built on. Two columns
        were wrong for the same reason recorded there: the structure is a
        horizontal chain, so halving its width halves the drawing, and the
        node labels land near the size where a projector loses them. Stacking
        gives the listing and the chain the full width each.
      */}
      <div className="flex flex-col gap-px bg-rule">
        {showCode ? (
          <div
            className={
              isPresentation ? 'bg-surface text-base [&_.cm-editor]:!text-base' : 'bg-surface'
            }
          >
            <CodeStepper code={trace.code} highlightLines={step.highlightLines} language="java" />
          </div>
        ) : null}
        <div
          className="flex items-center justify-center overflow-x-auto bg-surface p-3"
          style={{ maxHeight: isPresentation ? 'min(42vh, 400px)' : '24rem' }}
        >
          <StructureView
            step={step}
            recipe={recipe}
            maxCells={trace.maxCells}
            align={trace.align}
            hasCarry={trace.hasCarry}
          />
        </div>
      </div>

      <div aria-live="polite" data-testid="sequence-narration">
        <NarrationStrip text={step.description} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        <ControlButton
          onClick={playback.reset}
          disabled={playback.stepIndex === 0}
          label="Reiniciar"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton onClick={playback.rewind} disabled={playback.stepIndex === 0} label="Atrás">
          <SkipBack className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton
          onClick={playback.togglePlay}
          label={playback.isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {playback.isPlaying ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </ControlButton>
        <ControlButton onClick={playback.advance} disabled={atEnd} label="Adelante">
          <SkipForward className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>

        <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-3xs text-ink-faint">
          <LegendSwatch swatchClass="border-mark bg-mark-soft" label="nuevo" />
          <LegendSwatch swatchClass="border-focus bg-surface" label="bajo la mirada" />
          <LegendSwatch swatchClass="border-rule bg-sunk" label="libre" />
        </span>
      </div>
    </figure>
  );
}

// ── the picture ───────────────────────────────────────────────────────────

const CELL_FILL: Record<SequenceCell['state'], string> = {
  idle: 'var(--color-surface)',
  // `mark`, not `keep`: a node the operation just inserted is not a SUCCESS,
  // it is the thing to look at now. `keep` stays for the search hit, which
  // genuinely is one. ADR-0026 §Addendum — #288.
  new: 'var(--color-mark-soft)',
  active: 'var(--color-surface)',
  found: 'var(--color-keep-soft)',
  leaving: 'var(--color-sunk)',
};

const CELL_STROKE: Record<SequenceCell['state'], string> = {
  idle: 'var(--color-rule)',
  new: 'var(--color-mark)',
  active: 'var(--color-focus)',
  found: 'var(--color-keep)',
  leaving: 'var(--color-rule)',
};

/**
 * Colour is never the only signal (`design-system.md`): every state that is
 * painted also gets a word under the box, so a reader who cannot separate the
 * hues still reads what happened.
 */
const CELL_NOTE: Partial<Record<SequenceCell['state'], string>> = {
  new: 'nuevo',
  found: '✓ este',
  leaving: 'sale',
};

/**
 * The note sits UNDER its box and is left-aligned to it, never centred above
 * it: a pointer arrow lands on the box's centre from above, and a centred note
 * was drawn straight through by it ("nu|evo"). Left-aligning also keeps it
 * clear of the vertical leg of the circular recipe's closing arc, which rises
 * to the same centre from below.
 */
function CellNote({ cell, x, y }: { cell: SequenceCell; x: number; y: number }) {
  const note = CELL_NOTE[cell.state];
  if (note === undefined) return null;
  return (
    <text x={x} y={y} textAnchor="start" fontSize="9" fill="var(--color-ink-soft)">
      {note}
    </text>
  );
}

function StructureView({
  step,
  recipe,
  maxCells,
  align,
  hasCarry,
}: {
  step: SequenceStep;
  recipe: SequenceRecipe;
  maxCells: number;
  align: 'left' | 'right';
  hasCarry: boolean;
}) {
  const isList = recipe.startsWith('linked-list');
  const slots = step.capacity ?? step.cells.length;
  // Laid out for the WIDEST frame, so the drawing keeps one size from the
  // first frame to the last. `offset` is how far in the current cells start:
  // when the chain grows at the front, they sit flush right and the reserved
  // slot is exactly where the next node will land — so it lands without
  // moving anything already on screen.
  const layout = layoutSequence(maxCells, recipe, slots, hasCarry);
  const offset = align === 'right' ? maxCells - step.cells.length : 0;
  // Where the floating node sits — computed once and shared, because `head`
  // has to be able to point AT it and a second copy of this arithmetic is a
  // second chance to disagree with the drawing.
  // An operation that grows at the BACK names the slot itself, so the node
  // hovers over the place it is about to land; the rest keep the front slot
  // they have always used.
  const carrySlot = step.carry?.slot ?? Math.max(offset - 1, 0);
  const carryX =
    (layout.boxes[carrySlot]?.x ?? layout.lane) +
    (offset === 0 && step.carry?.slot === undefined ? 78 : 0);
  const carryTop = (layout.carryY ?? 0) + 18;
  // Where the chain's `null` terminator is drawn — and therefore where `head`
  // points when the chain is empty. Computed ONCE and shared with both, for
  // the same reason `carryX` is: two copies of this arithmetic are two
  // chances to disagree, and the disagreement paints as `head` striking
  // through a `null` it was supposed to reach.
  const lastLive = offset + step.cells.length - 1;
  const nullX =
    step.cells.length === 0
      ? (layout.boxes[offset]?.x ?? layout.width - BOX_W / 2) + 2
      : linkArrow(layout, lastLive).x1 + LIST_GAP + 2;
  const summary = describe(step, recipe);

  // A short structure can be narrower than the carry chip parked above it, so
  // the canvas takes the wider of the two — otherwise the chip is drawn
  // outside the viewBox and is clipped away.
  const canvasW = step.carry === undefined ? layout.width : Math.max(layout.width, 140);

  return (
    <svg
      viewBox={`0 0 ${canvasW} ${layout.height}`}
      className="h-auto w-full"
      // Capped rather than free: stacked full-width, the drawing scaled to
      // ~2.7x and the pointer band clipped its own labels against the panel
      // edge. The cap keeps the nodes at a size a projector reads without
      // letting a four-node chain fill a whole slide.
      style={{ maxWidth: `${canvasW * 1.7}px`, maxHeight: '100%' }}
      role="img"
      aria-label={summary}
      data-testid="sequence-structure"
    >
      <defs>
        <marker
          id="seq-arrow-head"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-accent)" />
        </marker>
        <marker id="seq-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-ink-soft)" />
        </marker>
        <marker
          id="seq-arrow-carry"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-mark)" />
        </marker>
        <marker
          id="seq-arrow-active"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-focus)" />
        </marker>
      </defs>

      {isList ? (
        <ListPicture
          step={step}
          layout={layout}
          recipe={recipe}
          offset={offset}
          carryX={carryX}
          carryTop={carryTop}
          lastLive={lastLive}
          nullX={nullX}
        />
      ) : null}
      {!isList ? <ArrayPicture step={step} layout={layout} slots={slots} /> : null}
      <Pointers
        step={step}
        layout={layout}
        offset={offset}
        carryX={carryX}
        carryTop={carryTop}
        nullX={nullX}
      />
      {step.carry ? (
        <Carry
          carry={step.carry}
          layout={layout}
          isList={isList}
          x={carryX}
          top={carryTop}
          offset={offset}
        />
      ) : null}
    </svg>
  );
}

function ArrayPicture({
  step,
  layout,
  slots,
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  slots: number;
}) {
  return (
    <g>
      {layout.boxes.map((box, i) => {
        // Read the BLOCK, not the live elements: a slot the algorithm just
        // vacated is empty and must draw empty, which is what makes a copy
        // visible as a move rather than as a colour change.
        const cell = step.slots?.[i] ?? undefined;
        const free = cell === null || cell === undefined;
        return (
          <g key={i}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={3}
              fill={free ? 'var(--color-sunk)' : CELL_FILL[cell.state]}
              stroke={free ? 'var(--color-rule)' : CELL_STROKE[cell.state]}
              strokeWidth={!free && (cell.state === 'active' || cell.state === 'found') ? 2.5 : 1.2}
              strokeDasharray={free ? '3 3' : undefined}
              opacity={!free && cell.state === 'leaving' ? 0.5 : 1}
            />
            {free ? null : (
              <text
                x={box.centerX}
                y={box.y + box.h / 2 + 5}
                textAnchor="middle"
                fontSize="15"
                fontWeight="600"
                fill="var(--color-ink)"
              >
                {cell.value}
              </text>
            )}
            <text
              x={box.centerX}
              y={box.y + box.h + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ink-faint)"
            >
              {i}
            </text>
            {free ? null : <CellNote cell={cell} x={box.x} y={box.y + box.h + 26} />}
          </g>
        );
      })}
      <text
        x={0}
        y={layout.footY + 10}
        fontSize="10"
        fill="var(--color-ink-faint)"
      >{`largo ${step.cells.length} · capacidad ${slots}`}</text>
    </g>
  );
}

function ListPicture({
  step,
  layout,
  recipe,
  offset,
  carryX,
  carryTop,
  lastLive,
  nullX,
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  recipe: SequenceRecipe;
  offset: number;
  carryX: number;
  carryTop: number;
  /**
   * The last slot HOLDING a node, not the last slot drawn. A chain that grows
   * at the back sits flush left inside a layout reserved for the widest
   * frame, so the two differ by every slot not filled yet — and the chain
   * ends at the end of the CHAIN, not at the end of the canvas.
   */
  lastLive: number;
  /** Where the `null` terminator is drawn. */
  nullX: number;
}) {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const last = lastLive;
  const tailToCarry = step.tailToCarry === true;

  return (
    <g>
      {layout.boxes.map((box, i) => {
        const cell = step.cells[i - offset];
        if (cell === undefined) return null;
        const arrow = linkArrow(layout, i);
        const isLast = i === last;
        const active = cell.state === 'active' || cell.state === 'found';
        return (
          <g key={cell.id} opacity={cell.state === 'leaving' ? 0.5 : 1}>
            {/* value half */}
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={3}
              fill={CELL_FILL[cell.state]}
              stroke={CELL_STROKE[cell.state]}
              strokeWidth={active ? 2.5 : 1.2}
            />
            {/* next field */}
            <rect
              x={box.linkX!}
              y={box.y}
              width={LINK_W}
              height={box.h}
              rx={3}
              fill="var(--color-sunk)"
              stroke={CELL_STROKE[cell.state]}
              strokeWidth={active ? 2.5 : 1.2}
            />
            <circle
              cx={box.linkX! + LINK_W / 2}
              cy={box.y + box.h / 2}
              r={2.5}
              fill="var(--color-ink-soft)"
            />
            <text
              x={box.x + box.w / 2}
              y={box.y + box.h / 2 + 5}
              textAnchor="middle"
              fontSize="15"
              fontWeight="600"
              fill="var(--color-ink)"
            >
              {cell.value}
            </text>
            <CellNote cell={cell} x={box.x} y={box.y + box.h + 14} />

            {/* next arrow — to the following node, or to the null marker */}
            {isLast && tailToCarry ? (
              // The assignment the frame is about: the last node's `next`
              // leaves the chain and climbs to the node waiting above the
              // slot it is about to occupy. Painted `mark`, like the node it
              // reaches, so the two read as one change.
              <path
                d={`M ${arrow.x1} ${arrow.y} L ${carryX - 14} ${arrow.y} L ${carryX - 14} ${
                  carryTop + BOX_H / 2
                } L ${carryX - 4} ${carryTop + BOX_H / 2}`}
                fill="none"
                style={{ stroke: 'var(--color-mark)' }}
                strokeWidth={2}
                markerEnd="url(#seq-arrow-carry)"
              />
            ) : !isLast || !circular ? (
              <line
                x1={arrow.x1}
                y1={doubly ? box.y + box.h * 0.35 : arrow.y}
                x2={(isLast ? arrow.x1 + LIST_GAP : arrow.x2) - 3}
                y2={doubly ? box.y + box.h * 0.35 : arrow.y}
                stroke={active ? 'var(--color-focus)' : 'var(--color-ink-soft)'}
                strokeWidth={active ? 2 : 1.2}
                markerEnd={active ? 'url(#seq-arrow-active)' : 'url(#seq-arrow)'}
              />
            ) : null}

            {/* prev arrow, doubly only — back to the previous node */}
            {doubly && i > 0 ? (
              <line
                x1={box.x - 3}
                y1={box.y + box.h * 0.72}
                x2={layout.boxes[i - 1]!.linkX! + LINK_W + 3}
                y2={box.y + box.h * 0.72}
                stroke="var(--color-ink-faint)"
                strokeWidth={1}
                markerEnd="url(#seq-arrow)"
              />
            ) : null}
          </g>
        );
      })}

      {/* the terminator: `null` for an open chain, a closing arc for a ring */}
      {/* The terminator is the CHAIN's `null`, so it is absent exactly when
          the chain has no `next` field showing one: while the last node's
          link is climbing to the floating node, and while an empty chain's
          `head` is doing the same. Left drawn, it is a `null` nothing points
          at. */}
      {!circular && !tailToCarry && !(step.cells.length === 0 && step.headToCarry === true) ? (
        <text
          x={nullX}
          y={layout.top + BOX_H / 2 + 4}
          fontSize="11"
          fill="var(--color-ink-faint)"
        >
          null
        </text>
      ) : null}
      {circular && layout.ringY !== null && step.cells.length > 0 ? (
        <>
          <path
            d={`M ${layout.boxes[last]!.linkX! + LINK_W / 2} ${layout.top + BOX_H}
                L ${layout.boxes[last]!.linkX! + LINK_W / 2} ${layout.ringY}
                L ${layout.boxes[0]!.centerX} ${layout.ringY}
                L ${layout.boxes[0]!.centerX} ${layout.top + BOX_H + 3}`}
            fill="none"
            stroke="var(--color-ink-soft)"
            strokeWidth={1.2}
            markerEnd="url(#seq-arrow)"
          />
          <text
            x={(layout.boxes[last]!.centerX + layout.boxes[0]!.centerX) / 2}
            y={layout.ringY - 4}
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-ink-faint)"
          >
            el último vuelve al primero
          </text>
        </>
      ) : null}
    </g>
  );
}

function Pointers({
  step,
  layout,
  offset,
  carryX,
  carryTop,
  nullX,
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  offset: number;
  carryX: number;
  carryTop: number;
  nullX: number;
}) {
  const headToCarry = step.headToCarry === true;
  return (
    <g>
      {step.pointers.map((pointer) => {
        const box = pointer.index === null ? null : layout.boxes[pointer.index + offset];
        const isHead = pointer.name === 'head';
        const walking = pointer.name !== 'head' && pointer.name !== 'tail';
        const colour = walking ? 'var(--color-focus)' : 'var(--color-accent)';

        // `head` points ACROSS from the lane on the left, never down from
        // above: the floating node arrives directly over the front slot —
        // where head points — so from above the two shared one column.
        if (isHead) {
          const y = layout.top + BOX_H / 2;
          // Three destinations, in the order the operation visits them: the
          // floating node while `head = fresh` has run and the node has not
          // moved yet; the first node of the chain; and — when the chain is
          // empty — the one `null` the structure already draws at its end,
          // rather than a second null of head's own.
          const toX = headToCarry ? carryX + BOX_W / 2 : box ? box.x - 4 : nullX - 6;
          return (
            <g key={pointer.name}>
              <text
                x={0}
                y={y + 4}
                fontSize="11"
                fontWeight="700"
                fill={colour}
                fontFamily="monospace"
              >
                head
              </text>
              {headToCarry ? (
                <path
                  d={`M 38 ${y} L ${carryX - 34} ${y} L ${carryX - 34} ${carryTop + BOX_H / 2} L ${carryX - 4} ${carryTop + BOX_H / 2}`}
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.6}
                  markerEnd="url(#seq-arrow-head)"
                />
              ) : (
                <line
                  x1={38}
                  y1={y}
                  x2={toX}
                  y2={y}
                  stroke={colour}
                  strokeWidth={1.6}
                  markerEnd="url(#seq-arrow-head)"
                />
              )}
              {/* No null of head's own: an empty chain still draws the one
                  terminator at its end, and head points AT that. Two nulls in
                  the same place is what it looked like before. */}
            </g>
          );
        }

        // A walking pointer standing on the same node as `tail` is nudged
        // sideways and anchored away, or the fixed pointer's arrow runs
        // through the walking one's label.
        const collides =
          walking &&
          pointer.index !== null &&
          step.pointers.some((other) => other.name === 'tail' && other.index === pointer.index);
        const nudge = collides ? 26 : 0;
        const y = pointer.name === 'tail' ? 10 : 28;
        const x = (box ? box.centerX : layout.width - 12) + nudge;
        return (
          <g key={pointer.name}>
            <text
              x={x}
              y={y}
              textAnchor={collides ? 'start' : 'middle'}
              fontSize="10"
              fontWeight="700"
              fill={colour}
              fontFamily="monospace"
            >
              {pointer.name}
            </text>
            <line
              x1={x}
              y1={y + 3}
              x2={x - nudge}
              y2={layout.top - 3}
              stroke={colour}
              strokeWidth={walking ? 1.8 : 1.2}
              markerEnd={walking ? 'url(#seq-arrow-active)' : 'url(#seq-arrow)'}
            />
          </g>
        );
      })}
    </g>
  );
}

function Carry({
  carry,
  layout,
  isList,
  x,
  top,
  offset,
}: {
  carry: NonNullable<SequenceStep['carry']>;
  layout: SequenceLayout;
  isList: boolean;
  /** Left edge and top of the floating node, computed by the caller. */
  x: number;
  top: number;
  /** How far into the reserved slots the live cells start. */
  offset: number;
}) {
  // The node that exists and is not in the chain yet, drawn as a NODE rather
  // than as a chip: it has a `next` field, that field is what the operation
  // assigns, and a chip cannot show an assignment. Painted `mark` — "look
  // here now" — because it is the only thing on screen that just changed.
  const y = top - 18;
  const target = carry.next === undefined ? undefined : carry.next;
  const linkX = x + BOX_W;
  return (
    <g>
      <text
        x={x}
        y={y + 12}
        fontSize="10"
        fontWeight="700"
        fontFamily="monospace"
        style={{ fill: 'var(--color-mark)' }}
      >
        {carry.label}
      </text>
      <rect
        x={x}
        y={y + 18}
        width={BOX_W}
        height={BOX_H}
        rx={3}
        fill="var(--color-mark-soft)"
        stroke="var(--color-mark)"
        strokeWidth={2.2}
      />
      {isList ? (
        <rect
          x={linkX}
          y={y + 18}
          width={LINK_W}
          height={BOX_H}
          rx={3}
          fill="var(--color-mark-soft)"
          stroke="var(--color-mark)"
          strokeWidth={2.2}
        />
      ) : null}
      <text
        x={x + BOX_W / 2}
        y={y + 18 + BOX_H / 2 + 5}
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="var(--color-ink)"
      >
        {carry.value}
      </text>
      {isList ? (
        <circle cx={linkX + LINK_W / 2} cy={y + 18 + BOX_H / 2} r={2.5} fill="var(--color-mark)" />
      ) : null}
      {/* The link, once assigned: down to the node it points at, or to a
          `null` written beside it. Absent entirely while unassigned, which is
          the state the first frame is about. */}
      {isList && target !== undefined ? (
        target === null ? (
          <text
            x={linkX + LINK_W + 8}
            y={y + 18 + BOX_H / 2 + 4}
            fontSize="11"
            fontFamily="monospace"
            style={{ fill: 'var(--color-mark)' }}
          >
            null
          </text>
        ) : (
          <path
            d={`M ${linkX + LINK_W / 2} ${y + 18 + BOX_H} L ${linkX + LINK_W / 2} ${layout.top - 16} L ${
              layout.boxes[target + offset]?.centerX ?? x
            } ${layout.top - 16} L ${layout.boxes[target + offset]?.centerX ?? x} ${layout.top - 3}`}
            fill="none"
            style={{ stroke: 'var(--color-mark)' }}
            strokeWidth={2}
            markerEnd="url(#seq-arrow-carry)"
          />
        )
      ) : null}
    </g>
  );
}

function describe(step: SequenceStep, recipe: SequenceRecipe): string {
  const contents = step.cells.map((c) => c.value).join(', ');
  const shape = recipe.startsWith('linked-list') ? 'La cadena' : 'El bloque';
  const body = step.cells.length === 0 ? 'está vacía.' : `contiene ${contents}.`;
  return `${shape} ${body} ${step.description}`;
}
