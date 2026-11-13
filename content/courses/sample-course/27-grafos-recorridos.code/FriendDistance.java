import java.util.Arrays;
import java.util.LinkedList;
import java.util.Queue;
import java.util.Scanner;

public class FriendDistance {
    static int[] bfs(Graph g, int s) {
        boolean[] visited = new boolean[g.V()];
        // nuevo: dist, no prev; −1 si no se llega
        int[] dist = new int[g.V()];
        Arrays.fill(dist, -1);
        Queue<Integer> queue = new LinkedList<>();
        visited[s] = true;
        dist[s] = 0;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int w : g.adj(v)) {
                if (!visited[w]) {
                    visited[w] = true;
                    // nuevo: un salto más que v
                    dist[w] = dist[v] + 1;
                    queue.add(w);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListGraph(V);
        Graphs.readEdges(in, g);
        int s = in.nextInt();
        int[] dist = bfs(g, s);
        for (int v = 0; v < V; v++) {
            System.out.println(v + ": " + dist[v]);
        }
    }
}
