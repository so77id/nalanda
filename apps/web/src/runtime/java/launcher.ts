/**
 * Rewrites `\uXXXX` into the character it names, as a Java compiler does.
 *
 * This is not decoration: JLS §3.3 makes the translation happen BEFORE lexing,
 * so a scanner reading the raw text is reading something the compiler never
 * sees. Verified against the pinned ECJ 3.21.0 and then in real CheerpJ: three
 * shapes compiled and hijacked the launcher while the guard reported nothing.
 * Writing the escapes as `\-u007b` etc. so this comment is about them rather
 * than made of them:
 *
 * - `// \-u000a class NalandaLauncher {}`, and the same with `\-u000d`: the
 *   escape IS the line terminator that ends the comment (JLS §3.4 counts LF, CR
 *   and CRLF), so what the stripper blanked is what the compiler compiles.
 * - `\-u0063lass NalandaLauncher {}`. The keyword itself is escaped.
 * - `\-u007b` in place of a class's opening brace. This one is stopped by the
 *   depth rule rather than by the decoder — `reservedDeclarations` keeps
 *   checking once the count goes negative, precisely because a hidden brace is
 *   what negative means. It is listed because it is what made the mismatch
 *   between our scanner and the compiler visible, and because it DID get
 *   through the first version of this fix, which tested `depth === 0`.
 *
 * Two rules from §3.3 that a naive four-hex-digit replace gets wrong, both
 * measured against that compiler:
 *
 * - **A run of `u` is legal**: `\-uuuu0063lass` compiles just as well.
 * - **Only an eligible backslash counts** — one preceded by an even number of
 *   backslashes, i.e. the last of an odd-length run. In `"\\-u0063"` the
 *   compiler prints `\-u0063` verbatim — the `\\` yields one backslash and
 *   `u0063` are then ordinary characters, not the letter `c`. Decoding it would
 *   corrupt the very string the program was printing.
 */
function decodeUnicodeEscapes(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '\\') {
      out += source[index];
      index += 1;
      continue;
    }

    let backslashes = 0;
    while (source[index + backslashes] === '\\') backslashes += 1;

    let markers = 0;
    while (source[index + backslashes + markers] === 'u') markers += 1;
    const at = index + backslashes + markers;
    const hex = source.slice(at, at + 4);

    if (backslashes % 2 === 1 && markers > 0 && /^[0-9a-fA-F]{4}$/.test(hex)) {
      // The escaped one is the LAST of the run; the pairs before it stay.
      out += '\\'.repeat(backslashes - 1) + String.fromCharCode(parseInt(hex, 16));
      index = at + 4;
      continue;
    }

    out += '\\'.repeat(backslashes);
    index += backslashes;
  }

  return out;
}

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
      // A LINE TERMINATOR ends it, and JLS §3.4 makes that LF, CR or CRLF —
      // `InputCharacter` is explicitly "not CR or LF". Stopping at LF alone left
      // everything after a lone CR inside the comment for us and outside it for
      // the compiler, which is a top-level declaration the guard cannot see:
      // measured, `// \-u000d class NalandaLauncher {}` and the same line with a
      // raw CR both hijacked the launcher. The raw form needs no escape at all —
      // a file with classic-Mac line endings is enough.
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1;
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
  // Decoded first, like `reservedDeclarations`: the two must read the same
  // program or the guard clears one file and the compiler is handed another.
  const code = stripNonCode(decodeUnicodeEscapes(source));

  const packageName = /\bpackage\s+([\w.]+)\s*;/.exec(code)?.[1];
  // `static` is deliberately absent: a top-level class can never be static, so
  // leaving it in let a nested `public static class` outrank the real public
  // class declared after it.
  //
  // `reservedDeclarations` below decides top-level by counting braces instead,
  // and the two must NOT be unified: this one has to stay class-only, because
  // the entry class is a `class` and never an interface or an enum.
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
 *
 * A third name was reserved between #116 and #209 for a widget that used a
 * platform class of that name; that widget was retired in #209 (the ADR
 * superseding 0028), so the reserved set is back to the launcher and the
 * harness — the two units the platform still ships.
 */
export const RESERVED_CLASSES = [LAUNCHER_CLASS, HARNESS_CLASS];

/**
 * The reserved names a compilation unit declares, in the order it declares them.
 *
 * Checking the ENTRY class was not enough, which is what this replaces: a unit
 * declaring `public class Solucion` and `class NalandaLauncher` beside it hands
 * `deriveEntryClass` the public one and compiles both, so the launcher was
 * overwritten by a program the guard had just cleared (#123).
 *
 * It reads what the COMPILER reads, in the compiler's own order: unicode escapes
 * are decoded first (JLS §3.3), then comments and literals are blanked. Skipping
 * the first step left three one-line bypasses, all of which compiled and
 * hijacked the launcher in real CheerpJ — see `decodeUnicodeEscapes`.
 *
 * `record` is in the keyword set although `SOURCE_LEVEL` is Java 8, where it is
 * not one. It costs a word here and would otherwise be the quiet way this guard
 * reopens the day that level is raised.
 *
 * Two things it deliberately does NOT flag:
 *
 * - **A nested declaration.** A member class compiles to
 *   `Solucion$NalandaLauncher.class` and overwrites no platform `.class`, so
 *   brace depth is tracked and only the top level counts. Everything at depth 0
 *   in a Java file is a package, an import or a type declaration, which is also
 *   why matching there cannot mistake a `Foo.class` literal for one.
 * - **A mention.** A comment explaining the rule, and a string holding
 *   `"class NalandaCheck {"`, are blank by the time the scan runs.
 *
 * And one thing it flags although nothing collides: a packaged declaration
 * (`package p; class NalandaLauncher {}`) compiles to `p/NalandaLauncher.class`
 * and cannot overwrite the default-package launcher. Refusing it is the older
 * guard's behaviour, kept deliberately — the names are reserved as names.
 */
export function reservedDeclarations(source: string): string[] {
  const code = stripNonCode(decodeUnicodeEscapes(source));
  const found: string[] = [];
  let depth = 0;

  for (const match of code.matchAll(/[{}]|\b(?:class|interface|enum|record)\s+(\w+)/g)) {
    if (match[0] === '{') depth += 1;
    else if (match[0] === '}') depth -= 1;
    // `<= 0`, not `=== 0`: a count that has gone negative means a brace was
    // hidden from us, and the safe reading of "I lost track" is to keep
    // checking rather than to wave everything after it through.
    else if (depth <= 0 && RESERVED_CLASSES.includes(match[1] ?? '')) found.push(match[1] ?? '');
  }

  return found;
}

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
