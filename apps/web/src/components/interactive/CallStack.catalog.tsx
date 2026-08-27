import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyCallStack as CallStack } from './lazyCallStack';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const callStackCatalogEntry: CatalogEntry = {
  name: 'CallStack',
  family: 'interactive',
  description:
    'A widget that makes the JVM call stack visible during a recursive execution (ADR-0049, v2 redesign). Three-column layout: code panel on the left (40%), current-context frame in the center (30%, dashed accent border), stack of paused frames on the right (30%, solid borders). Each frame shows its label plus its local variables with values (or `?` for pending). A footer legend describes each event in Spanish ("invocando factorial(2)", "return 6"). Playback is manual by default with Play / Pause / Step forward / Step back / Reset controls. The `broken` recipe demonstrates StackOverflowError.',
  whenToUse:
    'When the class teaches the memory of recursion — how a recursive call is executed by the runtime. Use it to show the stack growing during a linear or non-linear recursion (recipes `factorial`, `sum`, `fib`, `hanoi`) and to demonstrate StackOverflowError (recipe `broken` or any recipe with `maxDepth` set low). ' +
    'NOT for showing the TREE of a recursion — that is `<RecursionTree>`. ' +
    'NOT for measuring performance — that is `<Benchmark>`.',
  props: [
    {
      name: 'recipe',
      type: '"factorial" | "sum" | "fib" | "hanoi" | "broken"',
      description:
        'The recursive pattern to trace. `factorial` and `sum` are linear (one recursive call per step). `fib` is non-linear (two calls). `hanoi` takes n as arg, uses fixed towers A, C, B internally. `broken` never terminates and forces StackOverflowError at depth 8 by default.',
    },
    {
      name: 'arg',
      type: 'number',
      description:
        'Root argument for the recursion. Non-negative integer. For `hanoi`, this is the number of disks.',
    },
    {
      name: 'maxDepth',
      type: 'number',
      description:
        'Simulated stack size limit. `0` (default) means unlimited except by the internal trace-length cap. A positive value triggers StackOverflowError when a push would exceed it. Use to force the error on a normally-terminating recipe (e.g. `factorial` with `maxDepth={5}` and `arg={20}`).',
    },
    {
      name: 'code',
      type: 'string',
      description:
        "Source code shown in the left panel. Defaults to the recipe's own reference implementation. Override only if you want to show a different presentation of the same algorithm.",
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language for the code editor. Defaults to `"java"`.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional heading shown in the widget header alongside the "call stack" chip.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description:
        'If true, playback starts immediately. Default false: paused at frame 0 so the reader (or the professor in class) drives the walk manually.',
    },
    {
      name: 'speed',
      type: 'number',
      description:
        'Playback speed multiplier (0.5, 1, 2). Default 1. Ignored when autoplay is not active.',
    },
  ],
  examples: [
    {
      title: 'factorial(5) — linear recursion, stack grows to 6 frames then unwinds',
      code: '<CallStack recipe="factorial" arg={5} />',
      render: () => <CallStack recipe="factorial" arg={5} />,
    },
    {
      title: 'fib(4) — non-linear recursion, stack grows in a tree-shaped pattern',
      code: '<CallStack recipe="fib" arg={4} />',
      render: () => <CallStack recipe="fib" arg={4} />,
    },
    {
      title: 'broken(3) — recursion without a base case, StackOverflowError at depth 8',
      code: '<CallStack recipe="broken" arg={3} />',
      render: () => <CallStack recipe="broken" arg={3} />,
    },
    {
      title:
        'factorial(20) capped at maxDepth=5 — StackOverflowError even with a well-formed recursion',
      code: '<CallStack recipe="factorial" arg={20} maxDepth={5} />',
      render: () => <CallStack recipe="factorial" arg={20} maxDepth={5} />,
    },
    {
      title: 'hanoi(3) — non-linear recursion, all frames have distinct arguments',
      code: '<CallStack recipe="hanoi" arg={3} />',
      render: () => <CallStack recipe="hanoi" arg={3} />,
    },
    {
      title: 'Missing recipe: the error is for the author, not the student',
      code: '<CallStack />',
      render: () => <CallStack />,
    },
  ],
};
