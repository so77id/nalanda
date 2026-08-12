/**
 * Blanks comments and literals so class detection reads code, not prose.
 *
 * A single left-to-right scan, not a chain of replaces: whichever of `//` and
 * `"` comes first wins, which is the only way to get both `"http://x"` (a URL,
 * not a comment) and `// don't` (an apostrophe, not a char literal) right.
 */
function stripNonCode(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const pair = source.slice(index, index + 2);

    if (pair === '//') {
      while (index < source.length && source[index] !== '\n') index += 1;
      out += ' ';
      continue;
    }
    if (pair === '/*') {
      index += 2;
      while (index < source.length && source.slice(index, index + 2) !== '*/') index += 1;
      index += 2;
      out += ' ';
      continue;
    }

    const character = source[index];
    if (character === '"' || character === "'") {
      index += 1;
      while (index < source.length && source[index] !== character) {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      out += '""';
      continue;
    }

    out += character;
    index += 1;
  }

  return out;
}

/**
 * The fully-qualified class whose `main` the launcher should invoke: the public
 * class if there is one, otherwise the first declared. Package-qualified,
 * because that is how `Class.forName` wants it.
 */
export function deriveEntryClass(source: string): string {
  const code = stripNonCode(source);

  const packageName = /\bpackage\s+([\w.]+)\s*;/.exec(code)?.[1];
  // `static` is deliberately absent: a top-level class can never be static, so
  // leaving it in let a nested `public static class` outrank the real public
  // class declared after it.
  const modifiers = '(?:final|abstract|strictfp)\\s+';
  const publicClass = new RegExp(`\\bpublic\\s+(?:${modifiers})*class\\s+(\\w+)`).exec(code)?.[1];
  const anyClass = new RegExp(`\\b(?:${modifiers})*class\\s+(\\w+)`).exec(code)?.[1];

  const simpleName = publicClass ?? anyClass;
  if (!simpleName) {
    throw new Error('no class declaration found in the source');
  }
  return packageName ? `${packageName}.${simpleName}` : simpleName;
}

/** ECJ requires a compilation unit to be named after the public type it declares. */
export function sourceFileName(entryClass: string): string {
  return `${entryClass.split('.').pop() ?? entryClass}.java`;
}

export const LAUNCHER_CLASS = 'NalandaLauncher';

/**
 * How much a program may print before the launcher stops relaying it.
 *
 * This bounds how far the console element can grow; it does NOT make a
 * print-heavy program finish. Measured in Chromium after the cap landed, a loop
 * of 60 000 println still had not returned after 300s — the cost is the JVM
 * executing the loop under WebAssembly, not the writes the cap removes
 * (ADR-0020 §6). 48KB is roughly 4k lines, inside the range measured as
 * survivable and far above anything a teaching example prints on purpose.
 */
const OUTPUT_BUDGET_BYTES = 48 * 1024;

/** Printed once, in place of everything past the budget. */
export const TRUNCATED = '[nalanda] salida truncada: el programa imprimió demasiado';

/**
 * Entry class of the exercise harness (`components/interactive/harness.ts`).
 *
 * Declared here, with the launcher's own name, because the reserved set has to
 * be enforced by the runtime and `runtime → components` is not an allowed edge.
 */
export const HARNESS_CLASS = 'NalandaCheck';

/**
 * Class names a student's program may not use.
 *
 * Both units compile into one shared output directory, so a student class named
 * after a platform one overwrites its `.class`. Verified before this guard
 * existed: a unit declaring `public class NalandaLauncher` replaced the launcher
 * compiled at warm-up, and since that compile is memoised every editor on the
 * page then ran the student's `main` — exercises nobody had touched reported a
 * full pass.
 */
export const RESERVED_CLASSES = [LAUNCHER_CLASS, HARNESS_CLASS];

/**
 * Runs the student's program with a real stdin behind it.
 *
 * A console program under CheerpJ gets neither input nor EOF on `System.in`, so
 * anything reading a `Scanner` hangs forever (measured: no return after 30s).
 * Pointing `System.in` at a file we write per run fixes that without touching
 * the student's code. Taking the entry class as an argument keeps this source
 * constant, so it is compiled once during warm-up and reused for every run.
 */
export const LAUNCHER_SOURCE = `import java.io.FileInputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;

public class ${LAUNCHER_CLASS} {

    /**
     * Stops writing after a budget and says so once.
     *
     * A program that prints tens of thousands of lines kills the tab even when
     * it terminates correctly: measured, 10k lines stall the main thread for
     * ~1.2s and 20k crash the renderer. That is not the non-termination hazard
     * ADR-0020 accepted, and the reader has no way to see it coming — changing
     * the stdin panel from 10 to 100000 is enough.
     */
    static final class Capped extends FilterOutputStream {
        private final int budget;
        private int written = 0;
        private boolean announced = false;

        Capped(OutputStream out, int budget) {
            super(out);
            this.budget = budget;
        }

        private void announce() throws IOException {
            if (announced) return;
            announced = true;
            byte[] note = "\\n${TRUNCATED}\\n".getBytes("UTF-8");
            out.write(note, 0, note.length);
            out.flush();
        }

        @Override
        public void write(int b) throws IOException {
            if (written < budget) {
                written++;
                out.write(b);
                return;
            }
            announce();
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            // In bulk, never byte by byte: FilterOutputStream's inherited
            // implementation delegates each byte to write(int), which would turn
            // the whole budget into tens of thousands of writes through CheerpJ.
            int room = budget - written;
            if (room > 0) {
                int take = Math.min(room, len);
                written += take;
                out.write(b, off, take);
                if (take == len) return;
            }
            announce();
        }
    }

    public static void main(String[] args) throws Exception {
        System.setIn(new FileInputStream("/str/stdin.txt"));
        // Wraps whatever CheerpJ installed rather than opening a new stream, so
        // the output still reaches the console element the platform reads back.
        System.setOut(new PrintStream(new Capped(System.out, ${OUTPUT_BUDGET_BYTES}), true));
        Method entry = Class.forName(args[0]).getMethod("main", String[].class);
        try {
            entry.invoke(null, (Object) new String[0]);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            cause.setStackTrace(studentFrames(cause.getStackTrace()));
            cause.printStackTrace();
            System.out.flush();
            System.exit(1);
        }
        System.out.flush();
    }

    /** Drops the reflection plumbing below the student's own frames. */
    private static StackTraceElement[] studentFrames(StackTraceElement[] frames) {
        for (int i = 0; i < frames.length; i++) {
            String name = frames[i].getClassName();
            if (name.startsWith("sun.reflect")
                    || name.startsWith("jdk.internal.reflect")
                    || name.equals("java.lang.reflect.Method")
                    || name.equals("${LAUNCHER_CLASS}")) {
                return Arrays.copyOf(frames, i);
            }
        }
        return frames;
    }
}
`;
