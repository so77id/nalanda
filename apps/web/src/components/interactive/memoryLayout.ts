// Where every box and arrow of one photograph goes, and how to say the same
// thing in words.
//
// Pure arithmetic on purpose: jsdom lays nothing out and reports every box as
// 0×0, so a layout that measured the DOM could only be tested by faking the
// measurements — and a test whose fakes decide the answer pins whatever its
// author assumed (testing-strategy.md §Conventions, worked case #103). Computing
// the geometry here means the suite can check it and the browser only has to
// confirm it looks right.

import type { HeapObject, Slot, TraceStep, TraceValue } from './trace';

const VAR_WIDTH = 148;
const VAR_HEIGHT = 26;
const FRAME_TITLE = 22;
const FRAME_GAP = 14;
const FRAME_PADDING = 8;
const OBJ_WIDTH = 190;
const OBJ_TITLE = 24;
const ROW_HEIGHT = 22;
const OBJ_GAP = 14;
const COLUMN_GAP = 96;
const MARGIN = 8;
/** Room to the right of the heap column for heap-to-heap arrows to swing through. */
const FIELD_DETOUR = 46;

/** A variable box in the left column. */
export interface VariableBox {
  /** Unique within the drawing: `<frame>.<name>`. */
  id: string;
  frame: string;
  name: string;
  /** What is written inside: a primitive's value, `null`, or nothing for a reference. */
  text: string | null;
  /** Object it points at, or null when it holds a value or nothing. */
  target: number | null;
  isNull: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line inside an object box: a field, or an array element. */
export interface ObjectRow {
  name: string;
  text: string | null;
  target: number | null;
  isNull: boolean;
}

/** A heap box in the right column. */
export interface ObjectBox {
  id: number;
  title: string;
  rows: ObjectRow[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A frame's outline, drawn around its variables. */
export interface FrameBox {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One reference, drawn from the box that holds it to the box it points at. */
export interface Arrow {
  /** `<frame>.<name>` for a variable, `obj<id>.<field>` for a field. */
  fromId: string;
  toId: number;
  /**
   * True when it leaves a field rather than a variable.
   *
   * Heap-to-heap references are routed around the right side instead of through
   * the gap between the columns. Drawn the same way as the variable arrows, a
   * linked list's `siguiente` crossed back over the lane and buried the arrows
   * that carry the lesson — which are the ones from a name to a box.
   */
  fromField: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  frames: FrameBox[];
  variables: VariableBox[];
  objects: ObjectBox[];
  arrows: Arrow[];
  width: number;
  height: number;
}

/** `java.lang.Integer` → `Integer`: the package is noise a student never types. */
function simpleName(type: string): string {
  return type.split('.').pop() ?? type;
}

function titleOf(object: HeapObject): string {
  if (object.kind === 'string') return 'String';
  if (object.kind === 'array') return `${simpleName(object.type)}[${object.fields.length}]`;
  return simpleName(object.type);
}

function textOf(value: TraceValue): string | null {
  if (value.kind === 'null') return 'null';
  if (value.kind === 'primitive') return value.text;
  return null;
}

function rowOf(slot: Slot): ObjectRow {
  return {
    name: slot.name,
    text: textOf(slot.value),
    target: slot.value.kind === 'ref' ? slot.value.id : null,
    isNull: slot.value.kind === 'null',
  };
}

/**
 * Places one photograph: frames stacked down the left, heap boxes down the
 * right, arrows between them.
 *
 * Objects keep the order the tracer described them in, which is
 * breadth-first from the variables — so what a variable points at lands near
 * the top, and what only a field reaches lands below it.
 */
export function layoutStep(step: TraceStep): Layout {
  const frames: FrameBox[] = [];
  const variables: VariableBox[] = [];

  let y = MARGIN;
  for (const frame of step.frames) {
    const height = FRAME_TITLE + frame.variables.length * VAR_HEIGHT + FRAME_PADDING;
    frames.push({ name: frame.name, x: MARGIN, y, width: VAR_WIDTH + FRAME_PADDING * 2, height });

    frame.variables.forEach((variable, index) => {
      variables.push({
        id: `${frame.name}.${variable.name}`,
        frame: frame.name,
        name: variable.name,
        text: textOf(variable.value),
        target: variable.value.kind === 'ref' ? variable.value.id : null,
        isNull: variable.value.kind === 'null',
        x: MARGIN + FRAME_PADDING,
        y: y + FRAME_TITLE + index * VAR_HEIGHT,
        width: VAR_WIDTH,
        height: VAR_HEIGHT,
      });
    });

    y += height + FRAME_GAP;
  }
  const leftHeight = y;

  const heapX = MARGIN + VAR_WIDTH + FRAME_PADDING * 2 + COLUMN_GAP;
  const objects: ObjectBox[] = [];
  let objectY = MARGIN;
  for (const object of step.objects) {
    const rows = object.kind === 'string' ? [] : object.fields.map(rowOf);
    // A String shows its text instead of its char[]: two boxes both reading
    // "hola" is what makes `new String("hola") == new String("hola")` visible.
    const shown: ObjectRow[] =
      object.kind === 'string'
        ? [{ name: '', text: `"${object.text ?? ''}"`, target: null, isNull: false }]
        : rows;

    const height = OBJ_TITLE + Math.max(shown.length, 1) * ROW_HEIGHT;
    objects.push({
      id: object.id,
      title: titleOf(object),
      rows: shown,
      x: heapX,
      y: objectY,
      width: OBJ_WIDTH,
      height,
    });
    objectY += height + OBJ_GAP;
  }

  const boxOf = (id: number) => objects.find((one) => one.id === id);
  const arrows: Arrow[] = [];

  for (const variable of variables) {
    const target = variable.target === null ? undefined : boxOf(variable.target);
    if (target === undefined) continue;
    arrows.push({
      fromId: variable.id,
      toId: target.id,
      fromField: false,
      x1: variable.x + variable.width,
      y1: variable.y + variable.height / 2,
      x2: target.x,
      y2: target.y + OBJ_TITLE / 2,
    });
  }

  for (const object of objects) {
    object.rows.forEach((row, index) => {
      const target = row.target === null ? undefined : boxOf(row.target);
      if (target === undefined) return;
      arrows.push({
        fromId: `obj${object.id}.${row.name}`,
        toId: target.id,
        fromField: true,
        x1: object.x + object.width,
        y1: object.y + OBJ_TITLE + index * ROW_HEIGHT + ROW_HEIGHT / 2,
        // Arrives on the right edge, not the left: routed around the outside so
        // it never crosses the lane the variable arrows live in.
        x2: target.x + target.width,
        y2: target.y + OBJ_TITLE / 2,
      });
    });
  }

  // The outside route needs room, and it only exists when something uses it.
  const detour = arrows.some((one) => one.fromField) ? FIELD_DETOUR : 0;

  return {
    frames,
    variables,
    objects,
    arrows,
    width: heapX + OBJ_WIDTH + detour + MARGIN,
    height: Math.max(leftHeight, objectY) + MARGIN,
  };
}

/**
 * The same picture as a sentence, for a reader who is not looking at it.
 *
 * In Spanish because the page is served `lang="es"` and an English accessible
 * name is announced with Spanish phonemes — the same defect `lang` was set to
 * avoid (root CLAUDE.md §Language).
 */
export function describeStep(step: TraceStep): string {
  const parts: string[] = [];

  for (const frame of step.frames) {
    const said: string[] = [];
    // Group by target first: "a y b apuntan al mismo objeto" is the sentence
    // that carries the lesson, and one line per variable would bury it.
    const byTarget = new Map<number, string[]>();

    for (const variable of frame.variables) {
      if (variable.value.kind === 'ref') {
        const names = byTarget.get(variable.value.id) ?? [];
        names.push(variable.name);
        byTarget.set(variable.value.id, names);
      } else if (variable.value.kind === 'null') {
        said.push(`${variable.name} no apunta a ningún objeto`);
      } else {
        said.push(`${variable.name} vale ${variable.value.text}`);
      }
    }

    for (const [id, names] of byTarget) {
      const box = step.objects.find((one) => one.id === id);
      const what = box === undefined ? 'un objeto' : `un ${titleOf(box)}`;
      said.push(
        names.length > 1
          ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]} apuntan al mismo objeto, ${what}`
          : `${names[0]} apunta a ${what}`,
      );
    }

    parts.push(`En ${frame.name}: ${said.length === 0 ? 'sin variables' : said.join('; ')}.`);
  }

  if (parts.length === 0) return 'Todavía no hay nada que mostrar.';

  /*
   * Aliasing ACROSS frames, said explicitly.
   *
   * Grouping per frame alone described the swap as "a apunta a un Punto; b
   * apunta a un Punto. En intercambia: p apunta a un Punto; q apunta a un
   * Punto" — four references to indistinguishable objects. A reader who cannot
   * see the arrows had no way to tell that `q` and `a` are the same box, which
   * is the entire lesson of that example. Measured in Chromium at S7.
   */
  if (step.frames.length > 1) {
    const holders = new Map<number, string[]>();
    for (const frame of step.frames) {
      for (const variable of frame.variables) {
        if (variable.value.kind !== 'ref') continue;
        const names = holders.get(variable.value.id) ?? [];
        names.push(`${frame.name}.${variable.name}`);
        holders.set(variable.value.id, names);
      }
    }

    const shared = [...holders.values()]
      .filter((names) => new Set(names.map((one) => one.split('.')[0])).size > 1)
      .map((names) => names.join(' y '));

    if (shared.length > 0) {
      parts.push(`Apuntan al mismo objeto: ${shared.join('; ')}.`);
    }
  }

  return parts.join(' ');
}
