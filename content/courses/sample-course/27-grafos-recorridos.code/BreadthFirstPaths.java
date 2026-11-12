import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Queue;
import java.util.Stack;

public class BreadthFirstPaths {
    private final boolean[] marked;
    private final int[] dist;
    private final int[] prev;

    public BreadthFirstPaths(Graph g, int s) {
        marked = new boolean[g.V()];
        dist = new int[g.V()];
        prev = new int[g.V()];
        Arrays.fill(dist, -1);
        Arrays.fill(prev, -1);
        bfs(g, s);
    }

    private void bfs(Graph g, int s) {
        Queue<Integer> queue = new ArrayDeque<>();
        marked[s] = true;
        dist[s] = 0;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int w : g.adj(v)) {
                if (!marked[w]) {
                    marked[w] = true;
                    dist[w] = dist[v] + 1;
                    prev[w] = v;
                    queue.add(w);
                }
            }
        }
    }

    public boolean hasPathTo(int t) {
        return marked[t];
    }

    public int distTo(int t) {
        return dist[t];
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
