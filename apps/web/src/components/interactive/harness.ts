// The generated program that checks a student's method, and the reading of what
// it printed. Kept apart from the component so both halves are testable without
// a JVM: what runs in the browser is Java, and jsdom has none (ADR-0017).

// Named by the runtime, which refuses a student class that would collide with it
// (RESERVED_CLASSES in runtime/java/launcher.ts). Re-exported so callers of this
// module do not have to know that.
import { HARNESS_CLASS } from '../../runtime';

export { HARNESS_CLASS };

// The two fence labels an exercise is authored with. Constants because the same
// two strings are otherwise retyped in the component, the catalog, the tests,
// the guide and every document — and a typo in any of them is silent.
/** Seeds the editor. */
export const STARTER_FENCE = 'starter';
/** Becomes the body of the generated harness. */
export const TEST_FENCE = 'test';

/** Prefix of the lines the harness prints for the component, not for the student. */
const MARK = '[nalanda] ';
const FIELD = ' :: ';

/**
 * Wraps an author's `check(...)` calls into a compilable program.
 *
 * The student's class is compiled beside this one and called from it, so what is
 * verified is the *method* rather than what the student printed — nobody fails
 * an exercise for formatting their output differently.
 */
export function buildHarness(cases: string): string {
  return `import java.util.Arrays;

public class ${HARNESS_CLASS} {
    static int caso = 0;

    static void report(boolean ok, String esperado, String obtuvo) {
        caso++;
        if (ok) {
            System.out.println("${MARK}PASS " + caso);
        } else {
            System.out.println("${MARK}FAIL " + caso + "${FIELD}" + esperado + "${FIELD}" + obtuvo);
        }
    }

    static void check(int obtuvo, int esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(long obtuvo, long esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(double obtuvo, double esperado) {
        // Never ==: 0.1 + 0.2 is not 0.3, and an exercise that prints
        // "esperaba 0.3, obtuvo 0.3" is the component lying about a verdict.
        boolean ok = Math.abs(obtuvo - esperado) < 1e-9
                || (Double.isNaN(obtuvo) && Double.isNaN(esperado));
        report(ok, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(boolean obtuvo, boolean esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(char obtuvo, char esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(Object obtuvo, Object esperado) {
        // Arrays inherit Object.equals, which compares identity, so a correct
        // answer returning one would always have failed. Routed to
        // Arrays.deepEquals, which handles both arrays and everything else.
        boolean ok = (obtuvo == null || esperado == null)
                ? (obtuvo == esperado)
                : Arrays.deepEquals(new Object[] { obtuvo }, new Object[] { esperado });
        report(ok, describe(esperado), describe(obtuvo));
    }

    static void check(int[] obtuvo, int[] esperado) {
        report(Arrays.equals(obtuvo, esperado), Arrays.toString(esperado), Arrays.toString(obtuvo));
    }

    static void check(long[] obtuvo, long[] esperado) {
        report(Arrays.equals(obtuvo, esperado), Arrays.toString(esperado), Arrays.toString(obtuvo));
    }

    static void check(char[] obtuvo, char[] esperado) {
        report(Arrays.equals(obtuvo, esperado), Arrays.toString(esperado), Arrays.toString(obtuvo));
    }

    static void check(boolean[] obtuvo, boolean[] esperado) {
        report(Arrays.equals(obtuvo, esperado), Arrays.toString(esperado), Arrays.toString(obtuvo));
    }

    /** Prints an array as its contents rather than as its identity hash. */
    static String describe(Object value) {
        if (value instanceof Object[]) return Arrays.deepToString((Object[]) value);
        if (value instanceof int[]) return Arrays.toString((int[]) value);
        if (value instanceof long[]) return Arrays.toString((long[]) value);
        if (value instanceof double[]) return Arrays.toString((double[]) value);
        if (value instanceof char[]) return Arrays.toString((char[]) value);
        if (value instanceof boolean[]) return Arrays.toString((boolean[]) value);
        return String.valueOf(value);
    }

    public static void main(String[] args) {
        try {
${cases
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : `            ${line}`))
  .join('\n')}
        } catch (Throwable e) {
            // A method that blows up on case 3 must not erase cases 1 and 2:
            // those verdicts are already printed.
            System.out.println("${MARK}ERROR${FIELD}" + e);
        }
    }
}
`;
}

/** One case, as the harness reported it. */
export interface CaseResult {
  n: number;
  ok: boolean;
  expected?: string;
  actual?: string;
}

/** What a run produced: the verdicts, anything the student printed, and a crash. */
export interface RunReading {
  cases: CaseResult[];
  output: string;
  crash: string | null;
}

/**
 * Separates the harness's verdicts from whatever the student printed themselves,
 * which stays visible: a `System.out.println` added to debug is how people debug.
 */
export function readRun(output: string): RunReading {
  const cases: CaseResult[] = [];
  const rest: string[] = [];
  let crash: string | null = null;

  for (const line of output.split('\n')) {
    // Found anywhere, not only at the start: the harness prints its verdicts
    // with println, so a student who printed without a trailing newline shares
    // a line with the verdict that followed. Matching only at position 0 threw
    // that verdict away — and a swallowed FAIL reads on screen as a pass.
    const at = line.indexOf(MARK);
    if (at < 0) {
      rest.push(line);
      continue;
    }
    if (at > 0) rest.push(line.slice(0, at));
    const body = line.slice(at + MARK.length);

    if (body.startsWith('ERROR')) {
      crash = body.slice(`ERROR${FIELD}`.length) || 'sin detalle';
      continue;
    }
    if (body.startsWith('PASS ')) {
      const n = Number(body.slice('PASS '.length));
      if (Number.isFinite(n)) cases.push({ n, ok: true });
      continue;
    }
    if (body.startsWith('FAIL ')) {
      // Only the first two separators are structural — a value may contain more.
      const [head, expected, ...actual] = body.slice('FAIL '.length).split(FIELD);
      const n = Number(head);
      // A non-numeric case number is a forgery or a corrupted line; either way
      // it would render as "caso NaN" and collide with every other one as a key.
      if (Number.isFinite(n)) {
        cases.push({ n, ok: false, expected: expected ?? '', actual: actual.join(FIELD) });
      }
    }
  }

  return { cases, output: rest.join('\n').trim(), crash };
}
