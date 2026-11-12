import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;
import java.util.Stack;

public class MazeBreadthFirstPaths {
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    private final String[] grid;
    private final int cols;
    private final int[] dist;
    private final int[] prev;

    public MazeBreadthFirstPaths(String[] grid, int s) {
        this.grid = grid;
        cols = grid[0].length();
        dist = new int[grid.length * cols];
        prev = new int[grid.length * cols];
        Arrays.fill(dist, -1);
        Arrays.fill(prev, -1);
        bfs(s);
    }

    private boolean free(int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < cols
                && grid[r].charAt(c) == '.';
    }

    private void bfs(int s) {
        Queue<Integer> queue = new LinkedList<>();
        dist[s] = 0;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(r, c) && dist[w] < 0) {
                    dist[w] = dist[v] + 1;
                    prev[w] = v;
                    queue.add(w);
                }
            }
        }
    }

    public int distTo(int t) {
        return dist[t];
    }

    public List<Integer> pathTo(int t) {
        List<Integer> path = new ArrayList<>();
        if (dist[t] < 0) {
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
