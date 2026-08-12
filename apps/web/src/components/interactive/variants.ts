// Feature-toggle props are part of the component contract (ADR-0010 §6): a
// component exposes what it can do, and the document decides how much of it to
// switch on. Variants are the shorthand for the combinations that recur.

export interface EditorFlags {
  editable: boolean;
  runnable: boolean;
  /** Start booting the runtime as the editor appears, not at the first Run. */
  warmOnMount: boolean;
  showLanguage: boolean;
  showFileName: boolean;
  showWarmStatus: boolean;
  showExpand: boolean;
  showLineNumbers: boolean;
  showFoldGutter: boolean;
  showCopy: boolean;
  showStdin: boolean;
  showDiagnostics: boolean;
  showOutput: boolean;
  showTimings: boolean;
  showExitCode: boolean;
}

export type EditorVariant = 'minimal' | 'snippet' | 'read' | 'exercise' | 'lab';

export const FLAG_NAMES = [
  'editable',
  'runnable',
  'warmOnMount',
  'showLanguage',
  'showFileName',
  'showWarmStatus',
  'showExpand',
  'showLineNumbers',
  'showFoldGutter',
  'showCopy',
  'showStdin',
  'showDiagnostics',
  'showOutput',
  'showTimings',
  'showExitCode',
] as const satisfies readonly (keyof EditorFlags)[];

const PRESETS: Record<EditorVariant, Partial<EditorFlags>> = {
  /** Just the code. For a figure where the chrome would be noise. */
  minimal: {},
  /** Quotable code: numbered, copyable, not runnable. */
  snippet: { showFileName: true, showLineNumbers: true, showCopy: true },
  /** Reading a listing in place — the book's default for illustrative code. */
  read: { showFileName: true, showLineNumbers: true },
  /** The default: edit it, run it, see what it printed. */
  exercise: {
    editable: true,
    runnable: true,
    showFileName: true,
    showWarmStatus: true,
    showLineNumbers: true,
    showExpand: true,
    showDiagnostics: true,
    showOutput: true,
    showTimings: true,
    showExitCode: true,
  },
  /** Everything on: for a class working through a problem with real input. */
  lab: {
    editable: true,
    runnable: true,
    warmOnMount: true,
    showLanguage: true,
    showFileName: true,
    showWarmStatus: true,
    showExpand: true,
    showLineNumbers: true,
    showFoldGutter: true,
    showCopy: true,
    showStdin: true,
    showDiagnostics: true,
    showOutput: true,
    showTimings: true,
    showExitCode: true,
  },
};

/** Resolves a variant plus explicit overrides into a complete set of flags. */
export function resolveFlags(
  variant: EditorVariant,
  overrides: Partial<EditorFlags> = {},
): EditorFlags {
  const preset = PRESETS[variant];
  const flags = {} as EditorFlags;
  for (const name of FLAG_NAMES) {
    flags[name] = overrides[name] ?? preset[name] ?? false;
  }
  return flags;
}
