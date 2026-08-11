import type { RuntimeDescriptor } from '../contract';

export const pythonDescriptor: RuntimeDescriptor = {
  id: 'python',
  label: 'Python 3',
  fileName: 'main.py',
  defaultCode: `nums = [1, 2, 3, 4, 5]
print("sum =", sum(nums))
`,
  formatWarmStats: (detail) => `pyodide ${detail.scriptMs}ms · init ${detail.initMs}ms`,
};
