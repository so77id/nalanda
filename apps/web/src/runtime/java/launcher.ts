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
 * Runs the student's program with a real stdin behind it.
 *
 * A console program under CheerpJ gets neither input nor EOF on `System.in`, so
 * anything reading a `Scanner` hangs forever (measured: no return after 30s).
 * Pointing `System.in` at a file we write per run fixes that without touching
 * the student's code. Taking the entry class as an argument keeps this source
 * constant, so it is compiled once during warm-up and reused for every run.
 */
export const LAUNCHER_SOURCE = `import java.io.FileInputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;

public class ${LAUNCHER_CLASS} {
    public static void main(String[] args) throws Exception {
        System.setIn(new FileInputStream("/str/stdin.txt"));
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
