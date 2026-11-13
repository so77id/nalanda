public class PrePost {
    static void dfs(Graph g, int v, boolean[] visited) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        System.out.println("llega " + v);
        for (int w : g.adj(v)) {
            dfs(g, w, visited);
        }
        System.out.println("sale " + v);
    }
}
