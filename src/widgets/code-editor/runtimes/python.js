import { python } from '@codemirror/lang-python'

export const meta = {
  id: 'python',
  label: 'Python 3',
  fileName: 'main.py',
  codeMirrorLanguage: python(),
  defaultCode: `nums = [1, 2, 3, 4, 5]
print("sum =", sum(nums))
`,
  statsLabel: (stats) =>
    `pyodide ${stats.scriptMs}ms · init ${stats.initMs}ms`,
}

export function createWorker() {
  return new Worker(new URL('./python.worker.js', import.meta.url), {
    type: 'module',
  })
}
