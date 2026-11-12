import java.util.Stack;

class Solution {
    static final int[] DR8 = {-1, -1, -1, 0, 0, 1, 1, 1};
    static final int[] DC8 = {-1, 0, 1, -1, 1, -1, 0, 1};

    static boolean land(String[] map, int r, int c) {
        return r >= 0 && r < map.length
                && c >= 0 && c < map[0].length()
                && map[r].charAt(c) == '#';
    }

    static int islands(String[] map) {
        int cols = map[0].length();
        boolean[] marked = new boolean[map.length * cols];
        int count = 0;
        for (int s = 0; s < map.length * cols; s++) {
            if (land(map, s / cols, s % cols) && !marked[s]) {
                count++;
                explore(map, s, marked);
            }
        }
        return count;
    }

    static void explore(String[] map, int s, boolean[] marked) {
        int cols = map[0].length();
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (marked[v]) {
                continue;
            }
            marked[v] = true;
            for (int k = 0; k < 8; k++) {
                int r = v / cols + DR8[k];
                int c = v % cols + DC8[k];
                if (land(map, r, c) && !marked[r * cols + c]) {
                    stack.push(r * cols + c);
                }
            }
        }
    }
}
