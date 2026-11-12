import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Queue;
import java.util.Stack;

class Solution {
    // Bit 0 is the ferryman, bit 1 the wolf, bit 2 the goat and bit 3 the
    // cabbage; a bit in 1 means it is on the far bank.
    static final int FERRYMAN = 1;
    static final int WOLF = 2;
    static final int GOAT = 4;
    static final int CABBAGE = 8;

    static boolean side(int state, int who) {
        return (state & who) != 0;
    }

    static boolean safe(int state) {
        boolean alone = side(state, GOAT) != side(state, FERRYMAN);
        boolean wolf = side(state, WOLF) == side(state, GOAT);
        boolean cabbage = side(state, CABBAGE) == side(state, GOAT);
        return !(alone && (wolf || cabbage));
    }

    static List<Integer> moves(int state) {
        List<Integer> result = new ArrayList<>();
        for (int who : new int[] {0, WOLF, GOAT, CABBAGE}) {
            if (who == 0 || side(state, who) == side(state, FERRYMAN)) {
                int next = state ^ FERRYMAN ^ who;
                if (safe(next)) {
                    result.add(next);
                }
            }
        }
        return result;
    }

    static List<Integer> crossings() {
        int[] prev = new int[16];
        Arrays.fill(prev, -1);
        boolean[] marked = new boolean[16];
        Queue<Integer> queue = new ArrayDeque<>();
        marked[0] = true;
        queue.add(0);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int w : moves(v)) {
                if (!marked[w]) {
                    marked[w] = true;
                    prev[w] = v;
                    queue.add(w);
                }
            }
        }
        Stack<Integer> back = new Stack<>();
        for (int x = 15; x != -1; x = prev[x]) {
            back.push(x);
        }
        List<Integer> path = new ArrayList<>();
        while (!back.empty()) {
            path.add(back.pop());
        }
        return path;
    }
}
