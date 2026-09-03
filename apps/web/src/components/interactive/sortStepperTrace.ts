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
  /** For merge: the auxiliary rail (values placed so far, or null slots). */
  auxRail?: (number | null)[];
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
    steps.push({
      kind: 'select-min',
      array: [...a],
      highlightLines: [3],
      active: [i],
      sortedPrefix: i,
      description: `Tomar v = a[${i}] = ${v} como la "carta" a insertar en el prefijo ordenado [0..${j}].`,
    });
    while (j >= 0 && a[j]! > v) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [4],
        active: [j, i],
        sortedPrefix: i,
        description: `a[${j}] = ${a[j]} > ${v} — hay que correr un lugar a la derecha.`,
      });
      a[j + 1] = a[j]!;
      steps.push({
        kind: 'shift',
        array: [...a],
        highlightLines: [5],
        active: [j, j + 1],
        sortedPrefix: i,
        description: `Copiar a[${j}] en a[${j + 1}].`,
      });
      j -= 1;
    }
    if (j >= 0) {
      steps.push({
        kind: 'compare',
        array: [...a],
        highlightLines: [4],
        active: [j, i],
        sortedPrefix: i,
        description: `a[${j}] = ${a[j]} ≤ ${v} — la carta se detiene aquí.`,
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

export function traceMerge(input: number[]): SortTrace {
  const a = [...input];
  const steps: SortStep[] = [];

  function callLabel(slice: number[]): string {
    return `mergesort([${slice.join(',')}])`;
  }

  function recurse(lo: number, hi: number): void {
    const call = callLabel(a.slice(lo, hi + 1));
    steps.push({
      kind: 'enter',
      array: [...a],
      highlightLines: [1],
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
    recurse(lo, mid);
    recurse(mid + 1, hi);
    // Merge in place using an aux buffer for [lo..hi].
    const aux = a.slice(lo, hi + 1);
    const rail: (number | null)[] = Array.from({ length: aux.length }, () => null);
    let i = 0;
    let j = mid - lo + 1;
    let k = 0;
    steps.push({
      kind: 'merge-take',
      array: [...a],
      highlightLines: [6],
      active: [],
      subarray: [lo, hi],
      callNode: call,
      callAnnotation: `combinando [${aux.slice(0, mid - lo + 1).join(',')}]+[${aux.slice(mid - lo + 1).join(',')}]`,
      auxRail: [...rail],
      description: `Combinar los dos subarreglos ya ordenados [${aux.slice(0, mid - lo + 1).join(',')}] y [${aux.slice(mid - lo + 1).join(',')}].`,
    });
    while (i <= mid - lo && j <= hi - lo) {
      const takeLeft = aux[i]! <= aux[j]!;
      const chosen = takeLeft ? aux[i]! : aux[j]!;
      rail[k] = chosen;
      a[lo + k] = chosen;
      steps.push({
        kind: 'merge-take',
        array: [...a],
        highlightLines: [6],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `combinando · aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
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
        highlightLines: [6],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `combinando · aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
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
        highlightLines: [6],
        active: [lo + k],
        subarray: [lo, hi],
        callNode: call,
        callAnnotation: `combinando · aux=[${rail.map((x) => (x === null ? '_' : x)).join(',')}]`,
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
  return { steps, sorted: a };
}

// ── quick (out-of-place, pivot = first element — matches DivideCombineTree
//    recipe so `highlightNode` lands on the same chip) ──────────────────
//
//   1  void quick(int[] a) {
//   2      if (a.length <= 1) return;
//   3      int p = a[0];
//   4      int[] left  = { x in a[1..] : x <  p };
//   5      int[] right = { x in a[1..] : x >= p };
//   6      quick(left);
//   7      quick(right);
//   8      a = concat(left, [p], right);
//   9  }

export function traceQuick(input: number[]): SortTrace {
  const steps: SortStep[] = [];

  function callLabel(slice: number[]): string {
    return `quicksort([${slice.join(',')}])`;
  }

  // Track where the SUBARRAY currently lives inside the visualization
  // array — we render on a full-length canvas with the slice occupying
  // [offset..offset+slice.length-1]. Elements outside the current subarray
  // stay in place; children write back to their offset on return.
  const canvas = [...input];

  function recurse(slice: number[], offset: number): number[] {
    const call = callLabel(slice);
    steps.push({
      kind: 'enter',
      array: [...canvas],
      highlightLines: [1],
      active: [],
      subarray: [offset, offset + slice.length - 1],
      callNode: call,
      description: `Llamar quicksort sobre [${slice.join(',')}] (índices ${offset}..${offset + slice.length - 1}).`,
    });
    if (slice.length <= 1) {
      steps.push({
        kind: 'return',
        array: [...canvas],
        highlightLines: [2],
        active: slice.length === 1 ? [offset] : [],
        subarray: [offset, offset + slice.length - 1],
        callNode: call,
        description: `Caso base: ${slice.length === 0 ? 'subarreglo vacío' : '1 elemento'} — ya está ordenado.`,
      });
      return slice;
    }
    const pivot = slice[0]!;
    steps.push({
      kind: 'select-min',
      array: [...canvas],
      highlightLines: [3],
      active: [offset],
      pivot: offset,
      subarray: [offset, offset + slice.length - 1],
      callNode: call,
      callAnnotation: `pivot = ${pivot}`,
      description: `Tomar el pivot p = a[${offset}] = ${pivot} (primer elemento del subarreglo).`,
    });
    const left: number[] = [];
    const right: number[] = [];
    for (let k = 1; k < slice.length; k += 1) {
      const x = slice[k]!;
      const goesLeft = x < pivot;
      if (goesLeft) left.push(x);
      else right.push(x);
      steps.push({
        kind: 'partition-scan',
        array: [...canvas],
        highlightLines: goesLeft ? [4] : [5],
        active: [offset + k],
        pivot: offset,
        subarray: [offset, offset + slice.length - 1],
        callNode: call,
        callAnnotation: `pivot = ${pivot} · < : [${left.join(',')}] · ≥ : [${right.join(',')}]`,
        description: `${x} ${goesLeft ? '<' : '≥'} ${pivot} — cae en la partición ${goesLeft ? 'izquierda' : 'derecha'}.`,
      });
    }
    // Materialise the partition on the canvas: left first, pivot in the
    // middle, right after. The reader sees the three zones separated by
    // the pivot on its final position.
    for (let k = 0; k < left.length; k += 1) canvas[offset + k] = left[k]!;
    canvas[offset + left.length] = pivot;
    for (let k = 0; k < right.length; k += 1) canvas[offset + left.length + 1 + k] = right[k]!;
    steps.push({
      kind: 'partition-done',
      array: [...canvas],
      highlightLines: [4, 5],
      active: [offset + left.length],
      pivot: offset + left.length,
      subarray: [offset, offset + slice.length - 1],
      callNode: call,
      description: `Partición terminada: [${left.join(',')}] | ${pivot} | [${right.join(',')}]. El pivot ya está en su lugar final.`,
    });
    const leftSorted = recurse(left, offset);
    const rightSorted = recurse(right, offset + left.length + 1);
    // Write the sorted subarrays back to the canvas (in case children
    // materialised different orderings on top of them).
    for (let k = 0; k < leftSorted.length; k += 1) canvas[offset + k] = leftSorted[k]!;
    canvas[offset + leftSorted.length] = pivot;
    for (let k = 0; k < rightSorted.length; k += 1)
      canvas[offset + leftSorted.length + 1 + k] = rightSorted[k]!;
    steps.push({
      kind: 'return',
      array: [...canvas],
      highlightLines: [8],
      active: [],
      subarray: [offset, offset + slice.length - 1],
      callNode: call,
      description: `Retornar del quicksort sobre índices ${offset}..${offset + slice.length - 1}.`,
    });
    return [...leftSorted, pivot, ...rightSorted];
  }

  const sorted = recurse([...input], 0);
  steps.push({
    kind: 'done',
    array: [...canvas],
    highlightLines: [],
    active: [],
    description: 'Arreglo ordenado.',
  });
  return { steps, sorted };
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
  merge: `void merge(int[] a, int lo, int hi) {
    if (lo >= hi) return;
    int mid = (lo + hi) / 2;
    merge(a, lo, mid);
    merge(a, mid + 1, hi);
    mergeArrays(a, lo, mid, hi);
}`,
  quick: `void quick(int[] a) {
    if (a.length <= 1) return;
    int p = a[0];
    int[] left  = { x in a[1..] : x <  p };
    int[] right = { x in a[1..] : x >= p };
    quick(left);
    quick(right);
    a = concat(left, [p], right);
}`,
};
