// The typed state a `<MemoryVisual>` draws — variables in stack frames, boxes
// on the heap, and the references between them.
//
// Extracted from `trace.ts` in #209 as part of the reversal of ADR-0028: the
// component used to consume the OUTPUT of an execution trace, and it now
// consumes a state the author writes directly. The shape stays the same, so
// `memoryLayout.ts` (the algorithm that decides where every box goes) is
// unchanged; only the SOURCE of the state changed.
//
// Kept alongside `trace.ts` while both exist — `trace.ts` re-exports these
// names for the old `MemoryDiagram` player until #209's S4 deletes it — but
// this module is the SSOT for the shape the widget ships. When `trace.ts`
// goes, everything memory-related lives here.

/** What a variable, a field or an array element holds. */
export type MemoryValue =
  | { kind: 'primitive'; type: string; text: string }
  | { kind: 'ref'; id: number }
  | { kind: 'null' };

/** A named slot: a variable in a frame, a field of an object, an array index. */
export interface MemorySlot {
  name: string;
  value: MemoryValue;
}

/** A box on the heap side of the drawing. */
export interface MemoryObject {
  id: number;
  kind: 'object' | 'string' | 'array';
  /** Class name; for an array, its component type. */
  type: string;
  /** The text a String carries. Absent for everything else. */
  text?: string;
  /** Fields, or elements keyed by index. */
  fields: MemorySlot[];
}

/** One frame's local variables. */
export interface MemoryFrame {
  name: string;
  variables: MemorySlot[];
}

/**
 * One picture of the heap: every open frame and every object it references.
 *
 * The author writes one of these per `<Step>` in a `<StepShow>`. The tracer era
 * (`trace.ts`, deleted in #209 S4) accumulated the same shape as it read the
 * launcher's output; the drawing is unchanged. What changed is who is
 * responsible for it being true, and the answer used to be "the JVM" and is
 * now "the author who wrote the diagram beside the code".
 */
export interface MemoryState {
  frames: MemoryFrame[];
  objects: MemoryObject[];
}
