import { cpp } from '@codemirror/lang-cpp'

export const meta = {
  id: 'cpp',
  label: 'C++20',
  fileName: 'main.cpp',
  codeMirrorLanguage: cpp(),
  defaultCode: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {1, 2, 3, 4, 5};
    int sum = 0;
    for (int x : nums) sum += x;
    cout << "sum = " << sum << endl;
    return 0;
}
`,
  statsLabel: (stats) =>
    `pch ${stats.pchFetchMs}ms · cold compile ${stats.warmCompileMs}ms`,
}

export function createWorker() {
  return new Worker(new URL('./cpp.worker.js', import.meta.url), {
    type: 'module',
  })
}
