public class Components {
    static void dfs(Graph g, int v, boolean[] visited,
                    int[] id, int count) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        id[v] = count;
        for (int w : g.adj(v)) {
            dfs(g, w, visited, id, count);
        }
    }

    static int components(Graph g, int[] id) {
        boolean[] visited = new boolean[g.V()];
        int count = 0;
        for (int v = 0; v < g.V(); v++) {
            if (!visited[v]) {
                dfs(g, v, visited, id, count);
                count++;
            }
        }
        return count;
    }
}
