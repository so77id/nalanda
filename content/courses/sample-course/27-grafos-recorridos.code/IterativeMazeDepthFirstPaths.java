import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Stack;

public class IterativeMazeDepthFirstPaths {
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    private final String[] grid;
    private final int cols;
    private final boolean[] marked;
    private final int[] prev;

    public IterativeMazeDepthFirstPaths(String[] grid, int s) {
        this.grid = grid;
        cols = grid[0].length();
        marked = new boolean[grid.length * cols];
        prev = new int[grid.length * cols];
        Arrays.fill(prev, -1);
        dfs(s);
    }

    private boolean free(int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < cols
                && grid[r].charAt(c) == '.';
    }

    private void dfs(int s) {
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (marked[v]) {
                continue;
            }
            marked[v] = true;
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(r, c) && !marked[w]) {
                    prev[w] = v;
                    stack.push(w);
                }
            }
        }
    }

    public boolean hasPathTo(int t) {
        return marked[t];
    }

    public List<Integer> pathTo(int t) {
        List<Integer> path = new ArrayList<>();
        if (!hasPathTo(t)) {
            return path;
        }
        Stack<Integer> back = new Stack<>();
        for (int x = t; x != -1; x = prev[x]) {
            back.push(x);
        }
        while (!back.empty()) {
            path.add(back.pop());
        }
        return path;
    }
}
