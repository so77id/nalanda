// The typed state a `<MemoryVisual>` draws — variables in stack frames, boxes
// on the heap, and the references between them.
//
// This is the SSOT for the shape the widget ships. Introduced in #209 as
// part of the reversal of ADR-0028: the state used to come from an
// execution trace (a Java compile + JVM per diagram); it now comes from a
// prop the author writes directly. The shape stayed the same, so
// `memoryLayout.ts` (the algorithm that decides where every box goes) is
// unchanged; only the SOURCE of the state changed.

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
 * The author writes one of these per `<Step>` in a `<StepShow>`. The tracer
 * era (retired in #209) accumulated the same shape as it read the launcher's
 * output; the drawing is unchanged. What changed is who is responsible for it
 * being true, and the answer used to be "the JVM" and is now "the author who
 * wrote the diagram beside the code".
 */
export interface MemoryState {
  frames: MemoryFrame[];
  objects: MemoryObject[];
}
