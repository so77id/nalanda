import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import {
  BOX_H,
  BOX_W,
  LINK_W,
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
  /** The value to insert. Required by every `insert-*` but `insert-ordered`. */
  value?: number;
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
  if (values.length > MAX_VALUES) {
    return (
      <AuthoringError component="SequenceStepper">
        <code>values</code> trae {values.length} elementos. El dibujo se lee bien hasta {MAX_VALUES}{' '}
        elementos; con más, los nodos quedan ilegibles en la proyección.
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
  value?: number;
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
  const resetKey = [recipe, operation, valuesKey, value, index, target, tail].join('|');

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
          <StructureView step={step} recipe={recipe} />
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

function StructureView({ step, recipe }: { step: SequenceStep; recipe: SequenceRecipe }) {
  const isList = recipe.startsWith('linked-list');
  const slots = step.capacity ?? step.cells.length;
  const layout = layoutSequence(step.cells.length, recipe, slots);
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
        <marker id="seq-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-ink-soft)" />
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

      {isList ? <ListPicture step={step} layout={layout} recipe={recipe} /> : null}
      {!isList ? <ArrayPicture step={step} layout={layout} slots={slots} /> : null}
      <Pointers step={step} layout={layout} />
      {step.carry ? <Carry carry={step.carry} canvasW={canvasW} /> : null}
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
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  recipe: SequenceRecipe;
}) {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const last = layout.boxes.length - 1;

  return (
    <g>
      {layout.boxes.map((box, i) => {
        const cell = step.cells[i]!;
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
            {!isLast || !circular ? (
              <line
                x1={arrow.x1}
                y1={doubly ? box.y + box.h * 0.35 : arrow.y}
                x2={arrow.x2 - 3}
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
      {layout.boxes.length > 0 && !circular ? (
        <text
          x={linkArrow(layout, last).x2 + 2}
          y={layout.top + BOX_H / 2 + 4}
          fontSize="11"
          fill="var(--color-ink-faint)"
        >
          null
        </text>
      ) : null}
      {circular && layout.ringY !== null && layout.boxes.length > 0 ? (
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

function Pointers({ step, layout }: { step: SequenceStep; layout: SequenceLayout }) {
  // `head` and `tail` ride the top row; the walking pointers ride the row
  // below, so a walk that passes over `head` never hides it.
  const ROW = { head: 10, tail: 10, otros: 28 };
  return (
    <g>
      {step.pointers.map((pointer) => {
        const y = pointer.name === 'head' || pointer.name === 'tail' ? ROW.head : ROW.otros;
        const box = pointer.index === null ? null : layout.boxes[pointer.index];
        const walking = pointer.name !== 'head' && pointer.name !== 'tail';
        const colour = walking ? 'var(--color-focus)' : 'var(--color-accent)';
        // A pointer aimed past the end is drawn at the null marker.
        // A walking pointer standing on the same node as `head` or `tail` is
        // nudged sideways: the two labels ride different rows, but the fixed
        // pointer's ARROW runs straight through the walking one's label, and
        // the first frame of every walk starts exactly there.
        const collides =
          walking &&
          pointer.index !== null &&
          step.pointers.some(
            (other) =>
              (other.name === 'head' || other.name === 'tail') && other.index === pointer.index,
          );
        const nudge = collides ? 26 : 0;
        const x = (box ? box.centerX : layout.width - 12) + nudge;
        return (
          <g key={pointer.name}>
            <text
              x={x}
              y={y}
              // Anchored away from the collision rather than centred: a
              // centred label still grows back over the arrow it was nudged
              // clear of.
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

function Carry({ carry, canvasW }: { carry: NonNullable<SequenceStep['carry']>; canvasW: number }) {
  // The node that exists but is not linked yet — parked above the structure.
  // The box is sized to its LABEL, not to a node: "nuevo = 9" is wider than a
  // cell, and a box of one cell's width clipped the value against the panel
  // edge (found in the browser check, on the circular slide).
  const label = `${carry.label} = ${carry.value}`;
  const width = Math.max(BOX_W, label.length * 7.1 + 12);
  const x = Math.max(canvasW - width, 0);
  return (
    <g>
      <rect
        x={x}
        y={0}
        width={width}
        height={22}
        rx={3}
        fill="var(--color-mark-soft)"
        stroke="var(--color-mark)"
        strokeWidth={1.2}
        strokeDasharray="3 2"
      />
      <text
        x={x + width / 2}
        y={15}
        textAnchor="middle"
        fontSize="12"
        fontWeight="600"
        fill="var(--color-ink)"
      >
        {label}
      </text>
    </g>
  );
}

function describe(step: SequenceStep, recipe: SequenceRecipe): string {
  const contents = step.cells.map((c) => c.value).join(', ');
  const shape = recipe.startsWith('linked-list') ? 'La cadena' : 'El bloque';
  const body = step.cells.length === 0 ? 'está vacía.' : `contiene ${contents}.`;
  return `${shape} ${body} ${step.description}`;
}
