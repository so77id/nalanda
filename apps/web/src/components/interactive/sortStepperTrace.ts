/**
 * Pure per-algorithm traces for `<SortStepper>` (ADR-0065). Each function
 * takes an int array and emits a fine-grained frame list the widget replays
 * — one frame per compare / swap / insert / partition-scan step. Exported so
 * the tests can pin the shape without touching the DOM.
 *
 * Frame conventions the widget renders:
 * - `array` is the snapshot AFTER the step's effect (already swapped).
 * - `active` names the indices the algorithm is looking at this frame.
 * - `sortedPrefix` (insertion/selection) and `sortedSuffix` (bubble) mark
 *   the range the algorithm has proven ordered.
 * - `pivot` (quicksort) marks the pivot index in the CURRENT subarray.
 * - `subarray` is `[lo, hi]` inclusive — the range the current recursive
 *   call is working on; the frame greys everything outside it.
 * - `callNode` names the divide/combine tree chip the frame corresponds to;
 *   the widget passes it as `highlightNode` to `<DivideCombineTree>`.
 * - `callAnnotation` is the in-flight middle-row text for that chip.
 * - `carry` is the value held OUTSIDE the array (insertion sort's `v`,
 *   quicksort's pivot while parked at the end). The widget draws it as a
 *   floating chip above the bar at `carry.index`.
 */

export type SortAlgorithm = 'bubble' | 'selection' | 'insertion' | 'merge' | 'quick';

export type SortStepKind =
  | 'compare'
  | 'swap'
  | 'shift'
  | 'insert'
  | 'select-min'
  | 'enter'
  | 'partition-scan'
  | 'partition-done'
  | 'merge-take'
  | 'merge-done'
  | 'return'
  | 'done';

export interface SortStep {
  kind: SortStepKind;
  /** Array snapshot AFTER this step. */
  array: number[];
  /** 1-based lines to highlight in the code panel. */
  highlightLines: number[];
  /** Indices under the algorithm's attention this frame. */
  active: number[];
  /** For insertion/selection: `[0..sortedPrefix-1]` is proven sorted. */
  sortedPrefix?: number;
  /** For bubble: `[array.length - sortedSuffix .. array.length - 1]` is
   * proven sorted (bubble drives the largest to the end each pass). */
  sortedSuffix?: number;
  /** For quicksort: the pivot's index in the array snapshot. */
  pivot?: number;
  /** For merge/quick: the [lo, hi] range of the current recursive call. */
  subarray?: [number, number];
  /** For merge/quick: the label of the divide/combine tree chip this frame
   * corresponds to (matches DivideCombineTree recipe's chip.call). */
  callNode?: string;
  /** For merge/quick: middle-row annotation for the highlighted chip. */
  callAnnotation?: string;
  /** For merge/quick: the recursion stack at this frame, deepest last.
   * The last entry is the currently executing call (== `callNode`);
   * anything else is "waiting on children" (on the stack but not the
   * top). Used by `<DivideCombineTree>` to paint chips by state. */
  callStack?: string[];
  /** For merge/quick: chip labels that have already returned (are done).
   * The tree paints these in the "listo" style, with their return value
   * visible. */
  doneNodes?: string[];
  /** Array indices that have reached their FINAL sorted position. For
   * quicksort, this grows monotonically as sub-calls return (their
   * [lo..hi] is fully sorted once the call ends). For mergesort the same
   * rule applies — a returned call's range is a sorted subarray. The
   * widget paints these cells in green (`keep-soft`) so the reader sees
   * the sorted region grow as playback advances. */
  sortedIndices?: number[];
  /** For merge: the auxiliary rail (values placed so far, or null slots). */
  auxRail?: (number | null)[];
  /** A value held OUTSIDE the array: insertion sort's `v` while shifting.
   * The widget draws a floating chip above the bar at `index`. */
  carry?: { value: number; index: number; label: string };
  /** Human-readable description of what happened. */
  description: string;
}

export interface SortTrace {
  steps: SortStep[];
  sorted: number[];
}

// ── bubble ────────────────────────────────────────────────────────────────
//
//   1  void bubble(int[] a) {
//   2      for (int i = a.length - 1; i > 0; i--) {
//   3          for (int j = 0; j < i; j++) {
//   4              if (a[j] > a[j+1]) {
//   5                  swap(a, j, j+1);
//   6              }
//   7          }
//   8      }
//   9  }

export function traceBubble(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];
  for (let i = a.length - 1; i > 0; i -= 1) {
    for (let j = 0; j < i; j += 1) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [4],
        active: [j, j + 1],
        sortedSuffix: a.length - 1 - i,
        description: `Comparar a[${j}]=${a[j]} con a[${j + 1}]=${a[j + 1]}.`,
      });
      if (a[j]! > a[j + 1]!) {
        const t = a[j]!;
        a[j] = a[j + 1]!;
        a[j + 1] = t;
        steps.push({
          kind: 'swap',
          array: [...a],
          highlightLines: [5],
          active: [j, j + 1],
          sortedSuffix: a.length - 1 - i,
          description: `Fuera de orden — intercambiar a[${j}] ↔ a[${j + 1}].`,
        });
      }
    }
  }
  steps.push({
    kind: 'done',
    array: [...a],
    highlightLines: [9],
    active: [],
    sortedSuffix: a.length,
    description: 'Arreglo ordenado.',
  });
  return { steps, sorted: a };
}

// ── selection ────────────────────────────────────────────────────────────
//
//   1  void selection(int[] a) {
//   2      for (int i = 0; i < a.length - 1; i++) {
//   3          int min = i;
//   4          for (int j = i + 1; j < a.length; j++) {
//   5              if (a[j] < a[min]) min = j;
//   6          }
//   7          swap(a, i, min);
//   8      }
//   9  }

export function traceSelection(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];
  for (let i = 0; i < a.length - 1; i += 1) {
    let min = i;
    steps.push({
      kind: 'select-min',
      array: [...a],
      highlightLines: [3],
      active: [i, min],
      sortedPrefix: i,
      description: `Buscar el mínimo desde índice ${i}. Candidato: a[${i}]=${a[i]}.`,
    });
    for (let j = i + 1; j < a.length; j += 1) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [5],
        active: [j, min],
        sortedPrefix: i,
        description: `Comparar a[${j}]=${a[j]} con el mínimo actual a[${min}]=${a[min]}.`,
      });
      if (a[j]! < a[min]!) {
        min = j;
        steps.push({
          kind: 'select-min',
          array: [...a],
          highlightLines: [5],
          active: [min],
          sortedPrefix: i,
          description: `Nuevo mínimo: a[${min}]=${a[min]}.`,
        });
      }
    }
    if (min !== i) {
      const t = a[i]!;
      a[i] = a[min]!;
      a[min] = t;
    }
    steps.push({
      kind: 'swap',
      array: [...a],
      highlightLines: [7],
      active: [i, min],
      sortedPrefix: i + 1,
      description:
        min === i
          ? `El mínimo ya estaba en la posición ${i} — no hace falta swap.`
          : `Colocar el mínimo en la posición ${i}: swap con a[${min}].`,
    });
  }
  steps.push({
    kind: 'done',
    array: [...a],
    highlightLines: [9],
    active: [],
    sortedPrefix: a.length,
    description: 'Arreglo ordenado.',
  });
  return { steps, sorted: a };
}

// ── insertion ────────────────────────────────────────────────────────────
//
//   1  void insertion(int[] a) {
//   2      for (int i = 1; i < a.length; i++) {
//   3          int v = a[i], j = i - 1;
//   4          while (j >= 0 && a[j] > v) {
//   5              a[j+1] = a[j];
//   6              j--;
//   7          }
//   8          a[j+1] = v;
//   9      }
//  10  }

export function traceInsertion(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];
  for (let i = 1; i < a.length; i += 1) {
    const v = a[i]!;
    let j = i - 1;
    // Lift `v` out of the array conceptually — the carry chip appears
    // above position i and stays visible while j decrements.
    steps.push({
      kind: 'select-min',
      array: [...a],
      highlightLines: [3],
      active: [i],
      sortedPrefix: i,
      carry: { value: v, index: i, label: 'v' },
      description: `Tomar v = a[${i}] = ${v} como la "carta" a insertar en el prefijo ordenado [0..${j}].`,
    });
    while (j >= 0 && a[j]! > v) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [4],
        active: [j],
        sortedPrefix: i,
        carry: { value: v, index: j + 1, label: 'v' },
        description: `a[${j}] = ${a[j]} > v = ${v} — hay que correr a[${j}] a la derecha.`,
      });
      a[j + 1] = a[j]!;
      steps.push({
        kind: 'shift',
        array: [...a],
        highlightLines: [5],
        active: [j, j + 1],
        sortedPrefix: i,
        carry: { value: v, index: j, label: 'v' },
        description: `Copiar a[${j}] en a[${j + 1}]. v = ${v} sigue en la carta.`,
      });
      j -= 1;
    }
    if (j >= 0) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [4],
        active: [j],
        sortedPrefix: i,
        carry: { value: v, index: j + 1, label: 'v' },
        description: `a[${j}] = ${a[j]} ≤ v = ${v} — la carta se detiene aquí.`,
      });
    }
    a[j + 1] = v;
    steps.push({
      kind: 'insert',
      array: [...a],
      highlightLines: [8],
      active: [j + 1],
      sortedPrefix: i + 1,
      description: `Insertar v = ${v} en a[${j + 1}]. Prefijo [0..${i}] ordenado.`,
    });
  }
  steps.push({
    kind: 'done',
    array: [...a],
    highlightLines: [10],
    active: [],
    sortedPrefix: a.length,
    description: 'Arreglo ordenado.',
  });
  return { steps, sorted: a };
}

// ── merge (top-down) ─────────────────────────────────────────────────────
//
//   1  void merge(int[] a, int lo, int hi) {
//   2      if (lo >= hi) return;
//   3      int mid = (lo + hi) / 2;
//   4      merge(a, lo, mid);
//   5      merge(a, mid + 1, hi);
//   6      mergeArrays(a, lo, mid, hi);
//   7  }
//   8
//   9  static void mergeArrays(int[] a, int lo, int mid, int hi) {
//  10      int[] aux = new int[hi - lo + 1];
//  11      for (int k = lo; k <= hi; k++) aux[k - lo] = a[k];
//  12      int i = 0, j = mid - lo + 1;
//  13      for (int k = lo; k <= hi; k++) {
//  14          if      (i > mid - lo)      a[k] = aux[j++];
//  15          else if (j > hi - lo)       a[k] = aux[i++];
//  16          else if (aux[i] <= aux[j])  a[k] = aux[i++];
//  17          else                        a[k] = aux[j++];
//  18      }
//  19  }

export function traceMerge(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];

  function callLabel(slice: number[]): string {
    return `mergesort([${slice.join(',')}])`;
  }

  // `fromLine` names the line in the code panel that triggered this
  // call. For recursive descents we highlight THAT line (the reader
  // sees the call site light up as we jump into a new frame) instead
  // of the function header — the header adds no pedagogical value once
  // the reader has read the function once. The initial (root) call has
  // no caller in the shown code, so we fall back to line 1.
  function recurse(lo: number, hi: number, fromLine?: number): void {
    const call = callLabel(a.slice(lo, hi + 1));
    steps.push({
      kind: 'enter',
      array: [...a],
      highlightLines: [fromLine ?? 1],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      description: `Llamar mergesort sobre [${a.slice(lo, hi + 1).join(',')}] (índices ${lo}..${hi}).`,
    });
    if (lo >= hi) {
      steps.push({
        kind: 'return',
        array: [...a],
        highlightLines: [2],
        active: lo === hi ? [lo] : [],
        subarray: [lo, hi],
        callNode: call,
        description: `Caso base: subarreglo de ${hi - lo + 1} elemento(s) — ya está ordenado.`,
      });
      return;
    }
    const mid = Math.floor((lo + hi) / 2);
    // Left child is called from line 4, right child from line 5 — see
    // CODE.merge below for the numbered listing.
    recurse(lo, mid, 4);
    recurse(mid + 1, hi, 5);
    // Merge in place using an aux buffer for [lo..hi] — matches the
    // Java code shown to the reader.
    //
    // The `rail` visualization has N slots (always the full-array
    // shape, so the reader sees the SAME 8-slot buffer at every frame)
    // BUT it fills from position 0 regardless of which sub-range is
    // being merged — matching the Java code which indexes aux from 0
    // (`aux[k - lo] = a[k]`) and reuses the same buffer positions
    // across merges. Values "stack from the left" up to the sub-range
    // size; the tail beyond that stays empty.
    const aux = a.slice(lo, hi + 1);
    const rail: (number | null)[] = Array.from({ length: a.length }, () => null);
    let i = 0;
    let j = mid - lo + 1;
    let k = 0;
    steps.push({
      kind: 'merge-take',
      array: [...a],
      highlightLines: [10, 11],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      callAnnotation: `combinando [${aux.slice(0, mid - lo + 1).join(',')}]+[${aux.slice(mid - lo + 1).join(',')}]`,
      auxRail: [...rail],
      description: `Copiar el subarreglo a un buffer auxiliar y combinar las dos mitades ya ordenadas.`,
    });
    while (i <= mid - lo && j <= hi - lo) {
      const takeLeft = aux[i]! <= aux[j]!;
      const chosen = takeLeft ? aux[i]! : aux[j]!;
      rail[k] = chosen;
      a[lo + k] = chosen;
      steps.push({
        kind: 'merge-take',
        array: [...a],
        highlightLines: takeLeft ? [16] : [17],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
        auxRail: [...rail],
        description: takeLeft
          ? `${aux[i]} ≤ ${aux[j]} — tomar del bloque izquierdo.`
          : `${aux[j]} < ${aux[i]} — tomar del bloque derecho.`,
      });
      if (takeLeft) i += 1;
      else j += 1;
      k += 1;
    }
    while (i <= mid - lo) {
      rail[k] = aux[i]!;
      a[lo + k] = aux[i]!;
      steps.push({
        kind: 'merge-take',
        array: [...a],
        highlightLines: [15],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
        auxRail: [...rail],
        description: `Bloque derecho agotado — copiar restos del izquierdo.`,
      });
      i += 1;
      k += 1;
    }
    while (j <= hi - lo) {
      rail[k] = aux[j]!;
      a[lo + k] = aux[j]!;
      steps.push({
        kind: 'merge-take',
        array: [...a],
        highlightLines: [14],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
        auxRail: [...rail],
        description: `Bloque izquierdo agotado — copiar restos del derecho.`,
      });
      j += 1;
      k += 1;
    }
    steps.push({
      kind: 'merge-done',
      array: [...a],
      highlightLines: [6],
      active: Array.from({ length: hi - lo + 1 }, (_, x) => lo + x),
      subarray: [lo, hi],
      callNode: call,
      description: `Merge completo — [${a.slice(lo, hi + 1).join(',')}].`,
    });
    steps.push({
      kind: 'return',
      array: [...a],
      highlightLines: [7],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      description: `Retornar del mergesort sobre índices ${lo}..${hi}.`,
    });
  }

  recurse(0, a.length - 1);
  steps.push({
    kind: 'done',
    array: [...a],
    highlightLines: [],
    active: [],
    description: 'Arreglo ordenado.',
  });
  return { steps: annotateCallStack(steps), sorted: a };
}

/**
 * Post-processes a `SortStep[]` from `traceMerge` / `traceQuick`, walking
 * `kind: 'enter'` / `kind: 'return'` markers to reconstruct the recursion
 * stack and the set of chips that have returned at each frame. Emitted as
 * `callStack` and `doneNodes` on every step, so `<DivideCombineTree>` can
 * paint each chip by state (pending / on-stack / active / done) as
 * playback advances.
 *
 * The rules are exactly what a single-threaded interpreter does:
 * - on `enter`: push the call onto the stack BEFORE snapshotting (the
 *   entering call is the active one during its `enter` frame);
 * - on `return`: snapshot first (the returning call still counts as
 *   executing during its `return` frame), then pop and mark as done;
 * - every other kind: snapshot with the stack as-is.
 */
function annotateCallStack(rawSteps: SortStep[]): SortStep[] {
  const stack: string[] = [];
  const done: string[] = [];
  const sorted = new Set<number>();
  return rawSteps.map((s) => {
    if (s.kind === 'enter' && s.callNode) {
      stack.push(s.callNode);
    }
    const annotated: SortStep = {
      ...s,
      callStack: [...stack],
      doneNodes: [...done],
      sortedIndices: [...sorted],
    };
    if (s.kind === 'return' && s.callNode) {
      // Pop after snapshotting — the return frame belongs to the still-
      // executing call.
      const idx = stack.lastIndexOf(s.callNode);
      if (idx >= 0) stack.splice(idx, 1);
      done.push(s.callNode);
      // Base case (single-element range) is trivially sorted — mark that
      // one index. Without this, a subarray that never runs a partition
      // (size 1) leaves its cell grey forever, and inputs like 2, 4, or
      // 8 elements always land some cells in size-1 base cases.
      if (s.subarray && s.subarray[0] === s.subarray[1]) {
        sorted.add(s.subarray[0]);
      }
    }
    // Quicksort: the pivot's final position is set at `partition-done`,
    // and once set it NEVER moves again (the recursion only touches the
    // left [lo..p-1] and right [p+1..hi] sub-ranges). Mark that index as
    // sorted here — it stays green from this frame onwards for the rest
    // of playback.
    if (s.kind === 'partition-done' && s.pivot !== undefined) {
      sorted.add(s.pivot);
    }
    return annotated;
  });
}

// ── quick (in-place Lomuto with pivot = a[lo] — matches DivideCombineTree
//    quicksort recipe so `highlightNode` lands on the same chip) ─────────
//
//   1  void quick(int[] a, int lo, int hi) {
//   2      if (lo >= hi) return;
//   3      int p = partition(a, lo, hi);
//   4      quick(a, lo, p - 1);
//   5      quick(a, p + 1, hi);
//   6  }
//   7
//   8  static int partition(int[] a, int lo, int hi) {
//   9      int pivot = a[lo];
//  10      swap(a, lo, hi);
//  11      int store = lo;
//  12      for (int j = lo; j < hi; j++) {
//  13          if (a[j] < pivot) { swap(a, store, j); store++; }
//  14      }
//  15      swap(a, store, hi);
//  16      return store;
//  17  }

/** Deterministic Lomuto partition used by BOTH the trace and the tree
 * recipe so the tree's chip labels match the stepper's subarrays exactly.
 * Returns the pivot's final index. Modifies `a` in place. */
export function lomutoPartition(a: number[], lo: number, hi: number): number {
  const pivot = a[lo]!;
  // Park the pivot at the end.
  [a[lo], a[hi]] = [a[hi]!, a[lo]!];
  let store = lo;
  for (let j = lo; j < hi; j += 1) {
    if (a[j]! < pivot) {
      [a[store], a[j]] = [a[j]!, a[store]!];
      store += 1;
    }
  }
  // Pivot to its final resting position.
  [a[store], a[hi]] = [a[hi]!, a[store]!];
  return store;
}

/** Pure subarray-snapshot builder for the divide/combine tree's quicksort
 * recipe. Runs the SAME Lomuto partition on a copy of the input; at each
 * recursive step, records the subarray input to the call. Exported so the
 * tree recipe can build labels that agree with the stepper trace. */
export function quicksortCallTree(input: number[]): {
  call: string;
  slice: number[];
  children: ReturnType<typeof quicksortCallTree>[];
} {
  const a = [...input];

  function build(
    lo: number,
    hi: number,
  ): { call: string; slice: number[]; children: ReturnType<typeof build>[] } {
    const slice = a.slice(lo, hi + 1);
    const call = quicksortCallLabel(slice, lo, hi);
    if (lo >= hi) return { call, slice, children: [] };
    const p = lomutoPartition(a, lo, hi);
    const left = build(lo, p - 1);
    const right = build(p + 1, hi);
    return { call, slice, children: [left, right] };
  }

  return build(0, a.length - 1);
}

/**
 * Canonical label for a quicksort recursion node. Includes `lo..hi` as a
 * disambiguating suffix — without it, empty sub-ranges all collapsed to
 * `quicksort([])` and the state-tracking tree lit up multiple chips at
 * once. Shared by the tree recipe (`DivideCombineTree` §RECIPES.quicksort)
 * and by `traceQuick` so both agree on chip identity.
 */
export function quicksortCallLabel(slice: number[], lo: number, hi: number): string {
  return `quicksort([${slice.join(',')}] · ${lo}..${hi})`;
}

export function traceQuick(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];

  function callLabel(slice: number[], lo: number, hi: number): string {
    return quicksortCallLabel(slice, lo, hi);
  }

  // `fromLine` names the line in the code panel that triggered this
  // call. Recursive descents highlight the call site (line 4 for the
  // left half, line 5 for the right) — same pedagogical choice as
  // traceMerge. The root call has no caller in the shown code, so we
  // fall back to line 1.
  function recurse(lo: number, hi: number, fromLine?: number): void {
    // Snapshot BEFORE partition — the chip label matches the tree recipe.
    const call = callLabel(a.slice(lo, hi + 1), lo, hi);
    steps.push({
      kind: 'enter',
      array: [...a],
      highlightLines: [fromLine ?? 1],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      description: `Llamar quicksort sobre a[${lo}..${hi}] = [${a.slice(lo, hi + 1).join(',')}].`,
    });
    if (lo >= hi) {
      steps.push({
        kind: 'return',
        array: [...a],
        highlightLines: [2],
        active: lo === hi ? [lo] : [],
        subarray: [lo, hi],
        callNode: call,
        description: `Caso base: ${lo > hi ? 'rango vacío' : '1 elemento'} — ya está ordenado.`,
      });
      return;
    }

    // ── Partition (Lomuto, pivot = a[lo]) ────────────────────────────────
    const pivot = a[lo]!;
    steps.push({
      kind: 'select-min',
      array: [...a],
      highlightLines: [9],
      active: [lo],
      pivot: lo,
      subarray: [lo, hi],
      callNode: call,
      callAnnotation: `pivot = ${pivot}`,
      description: `Elegir el pivot p = a[${lo}] = ${pivot}.`,
    });
    // Swap pivot to the end (parked). Now the pivot lives at index `hi`.
    [a[lo], a[hi]] = [a[hi]!, a[lo]!];
    steps.push({
      kind: 'swap',
      array: [...a],
      highlightLines: [10],
      active: [lo, hi],
      pivot: hi,
      subarray: [lo, hi],
      callNode: call,
      callAnnotation: `pivot = ${pivot} (aparcado en el borde)`,
      description: `Aparcar el pivot al final del rango: swap a[${lo}] ↔ a[${hi}].`,
    });
    let store = lo;
    for (let j = lo; j < hi; j += 1) {
      const smaller = a[j]! < pivot;
      steps.push({
        kind: 'partition-scan',
        array: [...a],
        highlightLines: [12],
        active: [j],
        pivot: hi,
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `pivot = ${pivot} · store = ${store} · < : ${store - lo}, ≥ : ${j - store}`,
        description: `Comparar a[${j}] = ${a[j]} con pivot = ${pivot}.`,
      });
      if (smaller) {
        if (store !== j) {
          [a[store], a[j]] = [a[j]!, a[store]!];
          steps.push({
            kind: 'swap',
            array: [...a],
            highlightLines: [13],
            active: [store, j],
            pivot: hi,
            subarray: [lo, hi],
            callNode: call,
            callAnnotation: `pivot = ${pivot} · store = ${store + 1}`,
            description: `${a[store]} < ${pivot} — swap a[${store}] ↔ a[${j}] y store++.`,
          });
        } else {
          steps.push({
            kind: 'partition-scan',
            array: [...a],
            highlightLines: [13],
            active: [store],
            pivot: hi,
            subarray: [lo, hi],
            callNode: call,
            callAnnotation: `pivot = ${pivot} · store = ${store + 1}`,
            description: `${a[j]} < ${pivot} — ya está en su lugar, store++.`,
          });
        }
        store += 1;
      }
    }
    // Move the pivot from `hi` to its final position `store`.
    [a[store], a[hi]] = [a[hi]!, a[store]!];
    steps.push({
      kind: 'partition-done',
      array: [...a],
      highlightLines: [15],
      active: [store, hi],
      pivot: store,
      subarray: [lo, hi],
      callNode: call,
      description: `Devolver el pivot a su lugar: swap a[${store}] ↔ a[${hi}]. Pivot p = ${pivot} ya está en su posición final ${store}.`,
    });

    // ── Recurse ──────────────────────────────────────────────────────────
    // Left child is called from line 4, right child from line 5 —
    // see CODE.quick below for the numbered listing.
    recurse(lo, store - 1, 4);
    recurse(store + 1, hi, 5);
    steps.push({
      kind: 'return',
      array: [...a],
      highlightLines: [6],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      description: `Retornar del quicksort sobre a[${lo}..${hi}].`,
    });
  }

  recurse(0, a.length - 1);
  steps.push({
    kind: 'done',
    array: [...a],
    highlightLines: [],
    active: [],
    description: 'Arreglo ordenado.',
  });
  return { steps: annotateCallStack(steps), sorted: a };
}

/** Dispatcher used by the widget. */
export function traceFor(algorithm: SortAlgorithm, values: number[]): SortTrace {
  switch (algorithm) {
    case 'bubble':
      return traceBubble(values);
    case 'selection':
      return traceSelection(values);
    case 'insertion':
      return traceInsertion(values);
    case 'merge':
      return traceMerge(values);
    case 'quick':
      return traceQuick(values);
  }
}

/** The Java source shown in the code panel per algorithm. Comments in the
 * trace functions above cite the line numbers back to these snippets. */
export const CODE: Record<SortAlgorithm, string> = {
  bubble: `void bubble(int[] a) {
    for (int i = a.length - 1; i > 0; i--) {
        for (int j = 0; j < i; j++) {
            if (a[j] > a[j+1]) {
                swap(a, j, j+1);
            }
        }
    }
}`,
  selection: `void selection(int[] a) {
    for (int i = 0; i < a.length - 1; i++) {
        int min = i;
        for (int j = i + 1; j < a.length; j++) {
            if (a[j] < a[min]) min = j;
        }
        swap(a, i, min);
    }
}`,
  insertion: `void insertion(int[] a) {
    for (int i = 1; i < a.length; i++) {
        int v = a[i], j = i - 1;
        while (j >= 0 && a[j] > v) {
            a[j+1] = a[j];
            j--;
        }
        a[j+1] = v;
    }
}`,
  merge: `static void mergesort(int[] a, int lo, int hi) {
    if (lo >= hi) return;
    int mid = (lo + hi) / 2;
    mergesort(a, lo, mid);
    mergesort(a, mid + 1, hi);
    merge(a, lo, mid, hi);
}

static void merge(int[] a, int lo, int mid, int hi) {
    int[] aux = new int[hi - lo + 1];
    for (int k = lo; k <= hi; k++) aux[k - lo] = a[k];
    int i = 0, j = mid - lo + 1;
    for (int k = lo; k <= hi; k++) {
        if      (i > mid - lo)      a[k] = aux[j++];
        else if (j > hi - lo)       a[k] = aux[i++];
        else if (aux[i] <= aux[j])  a[k] = aux[i++];
        else                        a[k] = aux[j++];
    }
}`,
  quick: `static void quicksort(int[] a, int lo, int hi) {
    if (lo >= hi) return;
    int p = partition(a, lo, hi);
    quicksort(a, lo, p - 1);
    quicksort(a, p + 1, hi);
}

static int partition(int[] a, int lo, int hi) {
    int pivot = a[lo];
    swap(a, lo, hi);
    int store = lo;
    for (int j = lo; j < hi; j++) {
        if (a[j] < pivot) { swap(a, store, j); store++; }
    }
    swap(a, store, hi);
    return store;
}`,
};
