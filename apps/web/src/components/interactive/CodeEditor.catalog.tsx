import type { CatalogEntry } from '../../lib/catalogEntry';
import { ModeProvider } from '../../presentation';

// The wrapper, not the component: this entry is reachable from the shell's
// eager `catalogEntries`, so a static import would undo the lazy split and put
// CodeMirror back in the entry chunk. Aliased because the examples render what
// a document writes.
import { LazyCodeEditor as CodeEditor } from './lazyCodeEditor';

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const codeEditorCatalogEntry: CatalogEntry = {
  name: 'CodeEditor',
  family: 'interactive',
  description:
    'Source the student can read, edit and run, compiled and executed in their own browser (ADR-0001). Java, C++ and Python; output, compiler diagnostics, exit code and timings come back in place.',
  whenToUse:
    'Whenever a page shows code the reader should be able to try. Use a reading variant for code you only cite — a runnable editor that nobody runs still costs a chunk of CodeMirror, and a runnable one that IS run downloads a compiler. ' +
    "Java has a sharp edge worth knowing before you teach loops with it: it runs on the page's main thread (ADR-0017), so a student's `while (true)` freezes the tab and no timeout can recover it — they must close it. C++ and Python run in workers and are cut off cleanly. Prefer them for anything about termination, and never leave a runnable Java editor where an unattended student cannot recover. " +
    "The editor is saved to localStorage immediately before every run, so a frozen tab costs a reload rather than the reader's work — but only what was there at that run: edits made and never run are not saved. " +
    'Two Java editors on one page also share one JVM and one queue, so the second student waits behind the first — the footer says so while it waits. Runs are cut off at 60s (and 180s to even get started); neither is adjustable per instance today. ' +
    'Two Java class names are reserved by the platform, `NalandaLauncher` and `NalandaCheck`: a program declaring either is refused before it compiles, so never use them in an example. Java output is capped at 48KB, after which one `[nalanda] salida truncada` line appears — that bounds how far the console grows, and does NOT make a print-heavy program finish (ADR-0020 §6: 60 000 println had still not returned after 300s).',
  props: [
    {
      name: 'language',
      type: "'java' | 'cpp' | 'python'",
      description: 'Which runtime compiles and runs the snippet. Required.',
    },
    {
      name: 'variant',
      type: "'minimal' | 'snippet' | 'read' | 'exercise' | 'lab'",
      default: "'exercise'",
      description:
        'Chrome preset. minimal/snippet/read are inert (no compiler is ever loaded); exercise runs; lab adds stdin, the language picker and warms the runtime on mount.',
    },
    {
      name: 'defaultValue',
      type: 'string',
      description: "Starting source. Falls back to the runtime's own sample.",
    },
    {
      name: 'defaultStdin',
      type: 'string',
      default: "''",
      description: 'Initial content of the stdin panel, fed to the program as standard input.',
    },
    {
      name: 'editable / runnable / warmOnMount',
      type: 'boolean',
      description:
        'Capability toggles. Override whatever the variant sets — `<CodeEditor variant="lab" runnable={false}>` is a lab nobody can execute.',
    },
    {
      name: 'showLanguage / showFileName / showWarmStatus / showExpand',
      type: 'boolean',
      description:
        'Header chrome: language picker (only when editable), file name, warm chip, fullscreen button.',
    },
    {
      name: 'showLineNumbers / showFoldGutter / showCopy',
      type: 'boolean',
      description: 'Editor chrome: gutters and the copy-to-clipboard button.',
    },
    {
      name: 'showStdin / showDiagnostics / showOutput / showTimings / showExitCode',
      type: 'boolean',
      description: 'Panels below the source, and the footer readouts.',
    },
  ],
  examples: [
    {
      title: 'Reading a listing — inert, no runtime is ever loaded',
      code: '<CodeEditor language="java" variant="read" defaultValue={"…"} />',
      render: () => (
        <CodeEditor
          language="java"
          variant="read"
          defaultValue={'public class Nodo {\n    int valor;\n    Nodo siguiente;\n}\n'}
        />
      ),
    },
    {
      title: 'The default: edit it and run it (Ctrl/Cmd + Enter also runs)',
      code: '<CodeEditor language="java" />',
      render: () => <CodeEditor language="java" />,
    },
    {
      title: 'A lab with standard input — warmOnMount off so opening the catalog boots no JVM',
      code: '<CodeEditor language="python" variant="lab" warmOnMount={false} defaultStdin="3\\n" />',
      render: () => (
        <CodeEditor
          language="python"
          variant="lab"
          warmOnMount={false}
          defaultValue={'n = int(input())\nprint("n al cuadrado =", n * n)\n'}
          defaultStdin={'3\n'}
        />
      ),
    },
    {
      title: 'Presentation mode: taller, and the fullscreen button steps aside',
      code: '<ModeProvider mode="presentation">\n  <CodeEditor language="cpp" />\n</ModeProvider>',
      render: () => (
        <ModeProvider mode="presentation">
          <CodeEditor language="cpp" />
        </ModeProvider>
      ),
    },
  ],
};
