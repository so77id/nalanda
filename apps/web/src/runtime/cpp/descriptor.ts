import type { RuntimeDescriptor } from '../contract';

// Kept free of CodeMirror and compiler imports: descriptors are listed in the
// language picker and must stay cheap enough for the entry chunk.
export const cppDescriptor: RuntimeDescriptor = {
  id: 'cpp',
  label: 'C++20',
  fileName: 'main.cpp',
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
  formatWarmStats: (detail) =>
    `pch ${detail.pchFetchMs}ms · cold compile ${detail.warmCompileMs}ms`,
};
