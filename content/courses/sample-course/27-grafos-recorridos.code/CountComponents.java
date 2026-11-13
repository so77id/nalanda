public class CountComponents {
    static void dfs(Graph g, int v, boolean[] visited) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        for (int w : g.adj(v)) {
            dfs(g, w, visited);
        }
    }

    static int count(Graph g) {
        boolean[] visited = new boolean[g.V()];
        int count = 0;
        for (int v = 0; v < g.V(); v++) {
            if (!visited[v]) {
                dfs(g, v, visited);
                count++;
            }
        }
        return count;
    }
}
