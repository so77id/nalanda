import java.util.Scanner;

public class PowerOutage {
    static void dfs(Graph g, int v, boolean[] visited) {
        if (visited[v]) {
            return;
        }
        visited[v] = true;
        for (int w : g.adj(v)) {
            dfs(g, w, visited);
        }
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListGraph(V);
        Graphs.readEdges(in, g);
        boolean[] visited = new boolean[V];
        dfs(g, 0, visited);
        for (int v = 1; v < V; v++) {
            if (!visited[v]) {
                System.out.println(v);
            }
        }
    }
}
