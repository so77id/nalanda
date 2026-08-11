import type { RuntimeDescriptor } from '../contract';

export const javaDescriptor: RuntimeDescriptor = {
  id: 'java',
  label: 'Java 8',
  fileName: 'Main.java',
  defaultCode: `public class Main {
    public static void main(String[] args) {
        int[] nums = {1, 2, 3, 4, 5};
        int sum = 0;
        for (int x : nums) sum += x;
        System.out.println("sum = " + sum);
    }
}
`,
  formatWarmStats: (detail) => `jvm ${detail.readyMs}ms`,
};
