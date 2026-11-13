public class Preorder {
    static void preorder(Graph g, int v) {
        System.out.println(v);
        for (int w : g.adj(v)) {
            preorder(g, w);
        }
    }

    static void walk(Graph g, int v, int from) {
        System.out.println(v);
        for (int w : g.adj(v)) {
            if (w != from) {
                walk(g, w, v);
            }
        }
    }

    static void visit(Graph g, int v, boolean[] visited) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        System.out.println(v);
        for (int w : g.adj(v)) {
            visit(g, w, visited);
        }
    }
}
