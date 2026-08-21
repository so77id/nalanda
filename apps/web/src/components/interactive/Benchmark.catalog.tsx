import type { CatalogEntry } from '../../lib/catalogEntry';

// The lazy wrapper, not the component. Same rule as lazyCodeEditor /
// lazyPredictOutput / lazyMermaid: a static import here would pull CodeMirror
// AND the runtime seam into the chunk /catalog fetches, for a page whose
// examples the reader may never scroll to. Aliased to the plain name so the
// example snippets read as what a document actually writes.
import { LazyBenchmark as Benchmark } from './lazyBenchmark';

/** The three solutions to `suma(N)` from the Complejidad class (Peli 1, Act 3). */
const SUMA_DOBLE_CICLO = `import java.util.Scanner;

public class SumaDobleCiclo {
    static long suma(int n) {
        long s = 0;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= i; j++)
                s = s + 1;
        return s;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long t0 = System.nanoTime();
        long r = suma(n);
        long t1 = System.nanoTime();
        System.out.println("time_ns:" + (t1 - t0));
        System.out.println("result:" + r);
    }
}
`;

const SUMA_CICLO = `import java.util.Scanner;

public class SumaCiclo {
    static long suma(int n) {
        long s = 0;
        for (int i = 1; i <= n; i++) s = s + i;
        return s;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long t0 = System.nanoTime();
        long r = suma(n);
        long t1 = System.nanoTime();
        System.out.println("time_ns:" + (t1 - t0));
        System.out.println("result:" + r);
    }
}
`;

const SUMA_FORMULA = `import java.util.Scanner;

public class SumaFormula {
    static long suma(int n) {
        return (long) n * (n + 1) / 2;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long t0 = System.nanoTime();
        long r = suma(n);
        long t1 = System.nanoTime();
        System.out.println("time_ns:" + (t1 - t0));
        System.out.println("result:" + r);
    }
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const benchmarkCatalogEntry: CatalogEntry = {
  name: 'Benchmark',
  family: 'interactive',
  description:
    'A widget that runs several implementations of the same algorithm side by side and shows the timings the reader gets on their own machine (ADR-0044). The author writes each implementation as a self-contained Java source; the widget compiles them, runs a warmup then a handful of measured runs, and prints median / min / max per implementation. The pedagogical point is a single one — measuring an algorithm with a stopwatch does not compare algorithms, it compares laptops — and the widget makes it visible by producing different numbers on every reader.',
  whenToUse:
    'The opening act of the Complejidad class: three implementations of `suma(N)` — a double-loop version, a single-loop version, and the closed-form N(N+1)/2 — run once so the reader sees that their numbers, the professor\'s numbers and their neighbour\'s numbers all disagree. Also for any later class where "measure it and see" is the point (mergesort vs quicksort, linear vs binary search, fib recursive vs memoized). ' +
    'NOT for teaching HOW to count operations — that is `<ComplexityCounter>` (per-line OE annotations, no runtime). ' +
    'NOT for plotting curves of growth — that is `<MathPlot>`. ' +
    'The implementations must follow the wire protocol: read N from stdin, run their algorithm timed by `System.nanoTime()`, and print `time_ns:<ns>` on a line of its own. Anything else on stdout is ignored. Keep N presets bounded — a quadratic case at N = 10⁸ will happily freeze the tab (Java has no worker in this platform, ADR-0017), and the timeout is a courtesy, not a guarantee.',
  props: [
    {
      name: 'implementations',
      type: '{ name: string; code: string }[]',
      description:
        'Implementations to compare side by side. Each has a display name (shown as the code header and the result row) and its Java source. Required; the widget renders an authoring error if missing or empty.',
    },
    {
      name: 'inputs',
      type: 'number[]',
      description:
        'N presets the reader picks between. Defaults to [100, 10 000, 1 000 000, 10 000 000] — the range that shows all three orders diverging without frying the browser.',
    },
    {
      name: 'defaultInput',
      type: 'number',
      description:
        'Which preset is selected on first render. Falls back to the middle of `inputs`. Must be one of the values in `inputs`.',
    },
    {
      name: 'warmupRuns',
      type: 'number',
      description:
        'Warmup runs discarded per implementation to avoid JIT warmup skew in the median. Defaults to 2. Zero is legal but discouraged — the first CheerpJ run is measurably slower than the rest for reasons that have nothing to do with the algorithm.',
    },
    {
      name: 'measuredRuns',
      type: 'number',
      description:
        'Measured runs used to compute median / min / max per implementation. Defaults to 5. Odd numbers make the median unambiguous.',
    },
    {
      name: 'timeoutMs',
      type: 'number',
      description:
        'Hard cap per single execution (ms). Exceeded → the row is marked TIMEOUT and the next implementation continues. Defaults to 30 000. The Java run cannot be cancelled from JS (ADR-0017), so a timeout only frees the widget — the worker itself may keep grinding until the tab is reloaded.',
    },
    {
      name: 'language',
      type: 'RuntimeId',
      description:
        'Which runtime compiles and runs the code. Only Java validates today. Defaults to `"java"`.',
    },
  ],
  examples: [
    {
      title:
        "The Complejidad opener: three implementations of suma(N) — the reader sees their laptop's numbers disagree with the professor's",
      code: '<Benchmark implementations={[{ name: "sumaDobleCiclo", code: "..." }, { name: "sumaCiclo", code: "..." }, { name: "sumaFormula", code: "..." }]} />',
      render: () => (
        <Benchmark
          implementations={[
            { name: 'sumaDobleCiclo', code: SUMA_DOBLE_CICLO },
            { name: 'sumaCiclo', code: SUMA_CICLO },
            { name: 'sumaFormula', code: SUMA_FORMULA },
          ]}
          inputs={[100, 10_000, 100_000, 1_000_000]}
        />
      ),
    },
    {
      title: 'No implementations: the error is for the author, not the student',
      code: '<Benchmark />',
      render: () => <Benchmark />,
    },
  ],
};
