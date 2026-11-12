import java.util.Stack;

public class IterativeDepthFirstSearch {
    private final boolean[] marked;

    public IterativeDepthFirstSearch(Graph g, int s) {
        marked = new boolean[g.V()];
        dfs(g, s);
    }

    private void dfs(Graph g, int s) {
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (marked[v]) {
                continue;
            }
            marked[v] = true;
            for (int w : g.adj(v)) {
                if (!marked[w]) {
                    stack.push(w);
                }
            }
        }
    }

    public boolean marked(int v) {
        return marked[v];
    }
}
