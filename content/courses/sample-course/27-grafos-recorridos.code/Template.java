public class Template {
    static void dfs(Graph g, int v, boolean[] visited) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        // lo que el problema hace al llegar a v
        for (int w : g.adj(v)) {
            dfs(g, w, visited);
        }
        // lo que el problema hace al salir de v
    }
}
