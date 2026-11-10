import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Stack;

public class DepthFirstPaths {
    private final boolean[] marked;
    private final int[] prev;

    public DepthFirstPaths(Graph g, int s) {
        marked = new boolean[g.V()];
        prev = new int[g.V()];
        Arrays.fill(prev, -1);
        dfs(g, s);
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        for (int w : g.adj(v)) {
            if (!marked[w]) {
                prev[w] = v;
                dfs(g, w);
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
