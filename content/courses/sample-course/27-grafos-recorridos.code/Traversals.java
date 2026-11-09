public class Traversals {
    static void dfs(Graph g, int v, boolean[] marked, int[] prev) {
        marked[v] = true;
        for (int w : g.adj(v)) {
            if (!marked[w]) {
                prev[w] = v;
                dfs(g, w, marked, prev);
            }
        }
    }
}
