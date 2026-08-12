// The generated program that checks a student's method, and the reading of what
// it printed. Kept apart from the component so both halves are testable without
// a JVM: what runs in the browser is Java, and jsdom has none (ADR-0017).

/** Entry class of the generated harness — must not collide with a student's own. */
export const HARNESS_CLASS = 'NalandaCheck';

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
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(boolean obtuvo, boolean esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(char obtuvo, char esperado) {
        report(obtuvo == esperado, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(Object obtuvo, Object esperado) {
        boolean ok = (obtuvo == null) ? (esperado == null) : obtuvo.equals(esperado);
        report(ok, String.valueOf(esperado), String.valueOf(obtuvo));
    }

    static void check(int[] obtuvo, int[] esperado) {
        report(Arrays.equals(obtuvo, esperado), Arrays.toString(esperado), Arrays.toString(obtuvo));
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
    if (!line.startsWith(MARK)) {
      rest.push(line);
      continue;
    }
    const body = line.slice(MARK.length);

    if (body.startsWith('ERROR')) {
      crash = body.slice(`ERROR${FIELD}`.length);
      continue;
    }
    if (body.startsWith('PASS ')) {
      cases.push({ n: Number(body.slice('PASS '.length)), ok: true });
      continue;
    }
    if (body.startsWith('FAIL ')) {
      // Only the first two separators are structural — a value may contain more.
      const [head, expected, ...actual] = body.slice('FAIL '.length).split(FIELD);
      cases.push({
        n: Number(head),
        ok: false,
        expected: expected ?? '',
        actual: actual.join(FIELD),
      });
    }
  }

  return { cases, output: rest.join('\n').trim(), crash };
}
