// The generated program that photographs the heap, and the vocabulary it prints
// with. Kept apart from the component for the reason `harness.ts` gives: what
// runs in the browser is Java, and jsdom has none (ADR-0017), so both halves
// have to be testable without a JVM.

import { TRACE_CLASS, TRUNCATED, reservedDeclarations } from '../../runtime';

export { TRACE_CLASS };

/** Prefix of the lines the tracer prints for the component, not for the reader. */
export const TRACE_MARK = '[nalanda] T ';

/**
 * How many photographs one run may take.
 *
 * Java runs on the page's main thread (ADR-0017), and a `// foto` written inside
 * a loop would otherwise emit a state per iteration — thousands of lines through
 * a launcher whose own output budget is 48kB, for a diagram nobody can step
 * through anyway. Over the cap the tracer stops recording and says so, which is
 * an authoring mistake reported as one rather than a frozen tab.
 */
export const MAX_STEPS = 40;

/**
 * How many objects the drawing may contain, across the whole run.
 *
 * Reachability is transitive: photographing the head of a 500-node list would
 * otherwise draw all 500. The cap protects comprehension and main-thread time —
 * NOT legibility, which the scrollbar handles: boxes are drawn at natural size
 * and the panel scrolls (`MemoryPlayer`, `max-h-96`), so no number of them makes
 * any one box smaller.
 *
 * Twelve is where a linked list is still worth *following*: they stack in one
 * column at ~82px each, so twelve is already more than a screen, and past that
 * the reader is scrolling a picture instead of reading one. (An earlier cap of
 * 24 was argued from a layout that scaled to fit, which is the thing that got
 * removed — at 24 boxes it rendered 48px wide with 1px labels. That measurement
 * is history; this number is not derived from it.)
 *
 * #124 flows boxes into columns, which raises this honestly.
 */
export const MAX_OBJECTS = 12;

/**
 * How many elements or fields one box may list.
 *
 * `MAX_OBJECTS` bounds how many boxes are drawn but not how big one box is, and
 * the loop that fills it runs on the page's main thread (ADR-0017). A single
 * `// foto` on an `int[200000]` therefore ran 200 000 reflective reads and
 * prints: the launcher's byte budget stops the writing, never the looping —
 * `launcher.ts` records 60 000 println still not returning after 300s.
 */
export const MAX_ELEMENTS = 32;

/**
 * The tracer, compiled beside the snippet as the run's extra unit — the same
 * door `buildHarness` goes through.
 *
 * Three decisions are load-bearing here, and all three are what make the drawing
 * teach the right thing:
 *
 * 1. **`var` is overloaded per primitive type.** Overload resolution happens at
 *    compile time against the *static* type, so an `int` arrives as an `int` and
 *    can be drawn as a value in the box, while a `Punto` arrives as an `Object`
 *    and is drawn as an arrow. A single `Object` parameter would autobox the
 *    `int` and every primitive would become a heap object — erasing exactly the
 *    distinction document 2 §2 exists to teach.
 *
 * 2. **Identity, not equality.** Object ids come from `System.identityHashCode`
 *    through an `IdentityHashMap`, so two `String`s holding "hola" get two boxes
 *    and aliasing shows up as two names on one box. `equals` would merge them and
 *    the `==` lesson would draw its own counter-example.
 *
 * 3. **Ids are global, descriptions are per step.** The same object keeps its id
 *    across photographs so the reader can follow it, but its fields are re-read
 *    each time because that is the point of `b.x = 99`.
 *
 * Verified in Chromium on 2026-08-13 before any of this was written: reflection
 * works under CheerpJ — `getDeclaredFields` with `setAccessible(true)` reads
 * private fields by name, and cycles resolve by identity.
 */
export const TRACE_SOURCE = `import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;

public class ${TRACE_CLASS} {
    static final String MARK = "${TRACE_MARK}";

    static final IdentityHashMap<Object, Integer> IDS = new IdentityHashMap<Object, Integer>();
    static int siguienteId = 1;
    static int pasos = 0;
    static boolean desbordado = false;

    // Per step: what still has to be described, and what already was. Both are
    // identity-keyed — a cycle terminates because the node is the same object,
    // not because it looks like one.
    static List<Object> pendientes = new ArrayList<Object>();
    static IdentityHashMap<Object, Boolean> vistos = new IdentityHashMap<Object, Boolean>();
    static int objetos = 0;
    static boolean grabando = false;

    static int idDe(Object o) {
        Integer id = IDS.get(o);
        if (id == null) {
            id = Integer.valueOf(siguienteId++);
            IDS.put(o, id);
        }
        return id.intValue();
    }

    /** Newlines and backslashes would break the one-line-per-fact format. */
    static String esc(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\\\') out.append("\\\\\\\\");
            else if (c == '\\n') out.append("\\\\n");
            else if (c == '\\r') out.append("\\\\r");
            else out.append(c);
        }
        return out.toString();
    }

    public static void inicio(int linea, String marco) {
        if (pasos >= ${MAX_STEPS}) {
            if (!desbordado) {
                desbordado = true;
                System.out.println(MARK + "TOPE pasos");
            }
            grabando = false;
            return;
        }
        pasos++;
        grabando = true;
        pendientes.clear();
        vistos.clear();
        objetos = 0;
        System.out.println(MARK + "PASO " + linea + " " + marco);
    }

    public static void var(String n, int v)     { if (grabando) System.out.println(MARK + "VAR " + n + " int " + v); }
    public static void var(String n, long v)    { if (grabando) System.out.println(MARK + "VAR " + n + " long " + v); }
    public static void var(String n, double v)  { if (grabando) System.out.println(MARK + "VAR " + n + " double " + v); }
    public static void var(String n, boolean v) { if (grabando) System.out.println(MARK + "VAR " + n + " boolean " + v); }
    public static void var(String n, char v)    { if (grabando) System.out.println(MARK + "VAR " + n + " char " + esc(String.valueOf(v))); }

    public static void var(String n, Object v) {
        if (!grabando) return;
        if (v == null) {
            System.out.println(MARK + "VAR " + n + " null 0");
            return;
        }
        System.out.println(MARK + "VAR " + n + " ref " + idDe(v));
        encolar(v);
    }

    static void encolar(Object o) {
        if (o == null || vistos.containsKey(o)) return;
        vistos.put(o, Boolean.TRUE);
        pendientes.add(o);
    }

    /** Emits one field or array element, queueing whatever it points at. */
    static void valor(String prefijo, String nombre, Class<?> tipo, Object v) {
        if (v == null) {
            System.out.println(MARK + prefijo + " " + nombre + " null 0");
        } else if (tipo.isPrimitive()) {
            System.out.println(MARK + prefijo + " " + nombre + " " + tipo.getName() + " " + esc(String.valueOf(v)));
        } else {
            System.out.println(MARK + prefijo + " " + nombre + " ref " + idDe(v));
            encolar(v);
        }
    }

    static void describir(Object o) {
        int id = idDe(o);

        if (o instanceof String) {
            // Not its char[]: two boxes both reading "hola" is what makes
            // new String("hola") == new String("hola") visible instead of claimed.
            System.out.println(MARK + "STR " + id + " " + esc((String) o));
            return;
        }

        Class<?> c = o.getClass();
        if (c.isArray()) {
            int n = Array.getLength(o);
            System.out.println(MARK + "ARR " + id + " " + c.getComponentType().getName() + " " + n);
            // Bounded like everything else. Without this a single marker on an
            // int[200000] ran 200k Array.get + println on the page's MAIN thread
            // (ADR-0017): the launcher's byte budget stops the writes, not the
            // loop, and launcher.ts records 60k println still running after 300s.
            int mostrados = n < ${MAX_ELEMENTS} ? n : ${MAX_ELEMENTS};
            for (int i = 0; i < mostrados; i++) {
                valor("ELM " + id, String.valueOf(i), c.getComponentType(), Array.get(o, i));
            }
            if (mostrados < n) System.out.println(MARK + "TOPE objetos");
            return;
        }

        System.out.println(MARK + "OBJ " + id + " " + c.getName());
        Field[] fs = c.getDeclaredFields();
        int emitidos = 0;
        for (int i = 0; i < fs.length; i++) {
            if (emitidos >= ${MAX_ELEMENTS}) { System.out.println(MARK + "TOPE objetos"); break; }
            Field f = fs[i];
            // Statics belong to the class, not to this box: without this every
            // Integer would drag MIN_VALUE, MAX_VALUE and its cache in with it.
            if (Modifier.isStatic(f.getModifiers())) continue;
            emitidos++;
            try {
                f.setAccessible(true);
                valor("FLD " + id, f.getName(), f.getType(), f.get(o));
            } catch (Throwable e) {
                System.out.println(MARK + "FLD " + id + " " + f.getName() + " oculto 0");
            }
        }
    }

    public static void fin() {
        if (!grabando) return;
        while (!pendientes.isEmpty()) {
            if (objetos >= ${MAX_OBJECTS}) {
                System.out.println(MARK + "TOPE objetos");
                break;
            }
            objetos++;
            describir(pendientes.remove(0));
        }
        System.out.println(MARK + "FINPASO");
    }

    /** Closes a frame the author opened, so it stops being drawn. */
    public static void finMarco(String marco) {
        System.out.println(MARK + "FINMARCO " + marco);
    }
}
`;

// ── Reading the trace back ───────────────────────────────────────────────────

// #209 moved the shape types to `memoryVisual.ts` so `<MemoryVisual>` can
// consume the same drawing the trace machinery produces — from
// author-written state rather than from a JVM run. The names are re-exported
// here under their tracer-era aliases so nothing else in this module has to
// know: this file is deleted in #209 S4.
import type { MemoryFrame, MemoryObject, MemorySlot, MemoryValue } from './memoryModel';

export type TraceValue = MemoryValue;
export type Slot = MemorySlot;
export type HeapObject = MemoryObject;
export type Frame = MemoryFrame;

/**
 * Why a trace is not the whole run.
 *
 * Three different walls produce the same lie if they go unreported — a reader
 * told `paso N de N` about a run that took more. Measured in Chromium: the
 * object wall drew 24 of 30 nodes with no notice, and the byte wall announced
 * "paso 21 de 21" for a program that took 40 photographs. They are one signal
 * because they are one question: is this everything?
 */
export type TraceCap = 'pasos' | 'objetos' | 'salida';

/** One photograph: every open frame and every object known at that moment. */
export interface TraceStep {
  /** Line of the snippet that was marked. */
  line: number;
  /** The frame this photograph was taken in — the one that just changed. */
  frame: string;
  frames: Frame[];
  objects: HeapObject[];
  truncated: TraceCap | null;
}

/** What a run produced: the photographs, and whatever the program printed. */
export interface TraceReading {
  steps: TraceStep[];
  output: string;
  truncated: TraceCap | null;
}

/** Splits into at most `count` parts, the last one keeping every remaining space. */
function splitN(line: string, count: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (parts.length < count - 1) {
    const at = rest.indexOf(' ');
    if (at < 0) break;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  parts.push(rest);
  return parts;
}

/** Undoes the tracer's `esc`, in one scan so `\\n` stays a backslash and an n. */
function unescape(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if (next === 'n') {
        out += '\n';
        index += 2;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        index += 2;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        index += 2;
        continue;
      }
    }
    out += text[index];
    index += 1;
  }
  return out;
}

function valueOf(type: string, text: string): TraceValue {
  if (type === 'null') return { kind: 'null' };
  if (type === 'ref') return { kind: 'ref', id: Number(text) };
  return { kind: 'primitive', type, text: unescape(text) };
}

/**
 * Turns what the tracer printed into the states the diagram draws.
 *
 * Two things it does that are not obvious from the format:
 *
 * A step carries **every open frame**, not only the one photographed. `swap`
 * records its own two variables and says nothing about `main`'s, so carrying the
 * caller forward is what lets the drawing show four variables and makes the swap
 * that does not work legible. A frame leaves only when the tracer says so.
 *
 * Objects accumulate the same way and are re-described in place, because an
 * object nobody re-photographed is still on screen — while `b.x = 99` has to
 * show up in the box the previous step already drew.
 */
export function readTrace(output: string): TraceReading {
  const steps: TraceStep[] = [];
  const printed: string[] = [];
  const frames = new Map<string, Frame>();
  const objects = new Map<number, HeapObject>();

  let current: { line: number; frame: string; truncated: TraceCap | null } | null = null;
  let truncated: TraceCap | null = null;

  const object = (id: number): HeapObject | undefined => objects.get(id);

  /**
   * Admits an object only while the DRAWN set is still small enough to read.
   *
   * `MAX_OBJECTS` is enforced inside the tracer per photograph, which bounds the
   * wrong thing: objects accumulate across steps, so a loop allocating one per
   * iteration passes every per-photograph check and still ends up drawing forty
   * boxes. Measured in Chromium at 1440px: forty boxes gave a 466×3296 viewBox
   * that rendered 48px wide, with the frame label 1px tall, and no cap fired.
   *
   * Refusing the object rather than dropping the step keeps every photograph
   * honest — what is drawn is true, there is merely less of it — and the refusal
   * is what the reader is told about.
   */
  const admit = (id: number): boolean => {
    if (objects.has(id) || objects.size < MAX_OBJECTS) return true;
    truncated = 'objetos';
    return false;
  };

  for (const line of output.split('\n')) {
    // Found anywhere, not only at position 0: a program that printed without a
    // trailing newline shares its line with the marker that followed, and
    // matching at the start only would drop that photograph (harness.ts §readRun).
    const at = line.indexOf(TRACE_MARK);
    if (at < 0) {
      // The launcher's own output budget (48kB) cuts the trace mid-flight, and
      // its sentinel is not one of ours — it starts `[nalanda] s`, so it lands
      // here rather than in the branches below. Measured: a 40-photograph run
      // arrived as 21 complete photographs and the player called it "paso 21 de
      // 21". The steps that survive are true; the count was the lie.
      if (line.includes(TRUNCATED)) truncated = 'salida';
      printed.push(line);
      continue;
    }
    if (at > 0) printed.push(line.slice(0, at));
    const body = line.slice(at + TRACE_MARK.length);

    if (body.startsWith('PASO ')) {
      const [, rawLine, frame] = splitN(body, 3);
      current = { line: Number(rawLine), frame: frame ?? '', truncated: null };
      // Re-photographing a frame replaces its variables but keeps its position,
      // so the caller stays left of the callee however often either is updated.
      frames.set(current.frame, { name: current.frame, variables: [] });
      continue;
    }

    if (body.startsWith('VAR ')) {
      const [, name, type, text] = splitN(body, 4);
      frames
        .get(current?.frame ?? '')
        ?.variables.push({ name: name ?? '', value: valueOf(type ?? '', text ?? '') });
      continue;
    }

    if (body.startsWith('OBJ ')) {
      const [, id, type] = splitN(body, 3);
      if (!admit(Number(id))) continue;
      objects.set(Number(id), { id: Number(id), kind: 'object', type: type ?? '', fields: [] });
      continue;
    }

    if (body.startsWith('STR ')) {
      const [, id, text] = splitN(body, 3);
      if (!admit(Number(id))) continue;
      objects.set(Number(id), {
        id: Number(id),
        kind: 'string',
        type: 'String',
        text: unescape(text ?? ''),
        fields: [],
      });
      continue;
    }

    if (body.startsWith('ARR ')) {
      const [, id, type] = splitN(body, 4);
      if (!admit(Number(id))) continue;
      objects.set(Number(id), { id: Number(id), kind: 'array', type: type ?? '', fields: [] });
      continue;
    }

    if (body.startsWith('FLD ') || body.startsWith('ELM ')) {
      const [, id, name, type, text] = splitN(body, 5);
      object(Number(id))?.fields.push({
        name: name ?? '',
        value: valueOf(type ?? '', text ?? ''),
      });
      continue;
    }

    if (body.startsWith('TOPE ')) {
      const [, which] = splitN(body, 2);
      const cap: TraceCap = which === 'pasos' ? 'pasos' : 'objetos';
      // Both go to the READING. `TOPE objetos` is printed inside `fin()`, so it
      // used to land on the step — where nothing read it, which made the amber
      // "máximo de objetos" panel dead code and left a 30-node list drawn as 24
      // with no notice. The step keeps its own copy for anyone rendering a
      // single photograph on its own.
      truncated = cap;
      if (current !== null) current.truncated = cap;
      continue;
    }

    if (body.startsWith('FINMARCO ')) {
      const [, frame] = splitN(body, 2);
      frames.delete(frame ?? '');
      continue;
    }

    if (body === 'FINPASO' && current !== null) {
      steps.push({
        line: current.line,
        frame: current.frame,
        truncated: current.truncated,
        // Copied, not referenced: both maps keep mutating for the next
        // photograph, and a step has to keep showing what it showed.
        frames: [...frames.values()].map((one) => ({
          name: one.name,
          variables: [...one.variables],
        })),
        objects: [...objects.values()].map((one) => ({ ...one, fields: [...one.fields] })),
      });
      current = null;
    }
  }

  return { steps, output: printed.join('\n').trim(), truncated };
}

// ── Instrumenting a snippet ──────────────────────────────────────────────────

/** A `// foto` the author wrote, resolved. */
export interface Marker {
  /** 1-based line of the ORIGINAL snippet, which is the one the reader sees. */
  line: number;
  frame: string;
  variables: string[];
}

/** A snippet rewritten to photograph itself, plus what was wrong with it. */
export interface Instrumented {
  code: string;
  markers: Marker[];
  errors: string[];
}

/** Java identifiers, which is all a marker may name. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * `// foto [marco:] a, b` and `// foto-fin marco`, with spacing forgiven.
 *
 * The `\b` is load-bearing and was missing. Without it any comment whose first
 * word merely STARTS with "foto" was treated as a marker — and this is a course
 * written in Spanish, where that is a common word. Measured: `// fotos: a, b`
 * was silently instrumented into a frame called `s`, and `// fotografía de la
 * memoria` refused the entire diagram with «grafía de la memoria» no es un
 * nombre de variable válido. `foto-fin` still matches, because `\b` sits
 * between `o` and `-`, and PHOTO_END is tested first anyway.
 */
const PHOTO = /\/\/\s*foto\b\s*(.*)$/;
const PHOTO_END = /\/\/\s*foto-fin\b\s+(\S+)\s*$/;

/**
 * Rewrites a `trace` fence so that running it reports its own state.
 *
 * **Every marker is replaced in place, never on a line of its own.** The reader
 * is shown the original source and the highlight uses the line number the tracer
 * reports, so an injected line would offset every number after it and point at
 * the wrong statement.
 *
 * What it does NOT do is check that the variables exist. That needs a Java
 * parser and a scope table; naming one that is not in scope is caught by the
 * compiler instead, and its message reaches the reader through the same
 * diagnostics panel as any other compile error.
 */
export function instrument(source: string): Instrumented {
  const markers: Marker[] = [];
  const errors: string[] = [];

  // Not the guard — the same answer, given at authoring time so a bad fence is
  // an authoring error instead of a diagnostics panel twelve seconds after
  // someone presses Ejecutar. Calling the runtime's helper rather than
  // restating the rule is what keeps the two answers identical (#123); its
  // edges are documented on `reservedDeclarations`.
  //
  // One of those edges is narrower here than it looks. A nested reserved class
  // overwrites no `.class`, which is why the helper allows it — but `NalandaTrace`
  // is the one name whose calls this function INJECTS into the author's own
  // class, where a member type of that simple name captures them and the
  // diagram draws whatever it printed. Compiled and run with the pinned ECJ
  // while reviewing #123. It stays allowed: the fence is repo-authored content,
  // so this is a foot-gun for the author writing it, not a door for anyone else.
  const reserved = reservedDeclarations(source)[0];
  if (reserved !== undefined) {
    errors.push(`${reserved} es un nombre reservado por la plataforma: usa otro.`);
  }

  const lines = source.split('\n').map((line, index) => {
    const number = index + 1;

    const closing = PHOTO_END.exec(line);
    if (closing) {
      const frame = closing[1]!;
      if (!IDENTIFIER.test(frame)) {
        errors.push(`línea ${number}: «${frame}» no es un nombre de marco válido.`);
        return line;
      }
      // A function replacer, never a string: `$` is a substitution pattern in a
      // replacement string, and Java identifiers may contain `$`.
      return line.replace(PHOTO_END, () => `${TRACE_CLASS}.finMarco("${frame}");`).trimEnd();
    }

    const photo = PHOTO.exec(line);
    if (!photo) return line;

    // `foto-fin` already returned, so anything left starting with `-` is a typo
    // of it rather than a frame called `-fin`.
    const rest = photo[1]!.trim();
    const colon = rest.indexOf(':');
    const frame = colon < 0 ? 'main' : rest.slice(0, colon).trim();
    const names = (colon < 0 ? rest : rest.slice(colon + 1))
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '');

    if (!IDENTIFIER.test(frame)) {
      errors.push(`línea ${number}: «${frame}» no es un nombre de marco válido.`);
      return line;
    }
    if (names.length === 0) {
      errors.push(`línea ${number}: marca «// foto» sin variables que fotografiar.`);
      return line;
    }
    const bad = names.find((one) => !IDENTIFIER.test(one));
    if (bad !== undefined) {
      errors.push(`línea ${number}: «${bad}» no es un nombre de variable válido.`);
      return line;
    }

    markers.push({ line: number, frame, variables: names });

    const calls = [
      `${TRACE_CLASS}.inicio(${number}, "${frame}");`,
      ...names.map((one) => `${TRACE_CLASS}.var("${one}", ${one});`),
      `${TRACE_CLASS}.fin();`,
    ].join(' ');

    // A function replacer, never a string. `IDENTIFIER` allows `$` because Java
    // does, and as a replacement string `$1`/`$&`/`$$` are substitution
    // patterns: `// foto a$1` emitted `NalandaTrace.var("aa$1", aa$1)`, which
    // usually fails to compile and, where a variable of the mangled name
    // exists, quietly photographs the wrong one.
    return line.replace(PHOTO, () => calls).trimEnd();
  });

  if (markers.length === 0 && errors.length === 0) {
    errors.push('ninguna línea marcada con «// foto»: el diagrama no tendría nada que dibujar.');
  }

  return { code: lines.join('\n'), markers, errors };
}

/** The fence label a memory diagram is authored with. */
export const TRACE_FENCE = 'trace';

/**
 * The snippet as the reader should see it: markers removed, line numbers kept.
 *
 * The marker is scaffolding the lesson does not include — a student writing this
 * program would not write `// foto a, b`. The LINE stays even when the comment
 * was all it held, because the tracer reports line numbers against the original
 * and removing a line would shift every highlight after it.
 */
export function stripMarkers(source: string): string {
  // The fence's own trailing newline goes first. `fencesByMeta` keeps it, unlike
  // `fenceOf` which strips it and documents why, and the player numbers every
  // element of `split`— so every real fence rendered one phantom numbered blank
  // line under the listing.
  return source
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const stripped = line.replace(PHOTO_END, '').replace(PHOTO, '');
      return stripped === line ? line : stripped.trimEnd();
    })
    .join('\n');
}
