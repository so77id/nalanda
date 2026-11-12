import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Queue;

public class Bipartite {
    static boolean isBipartite(Graph g) {
        int[] dist = new int[g.V()];
        Arrays.fill(dist, -1);
        for (int s = 0; s < g.V(); s++) {
            if (dist[s] >= 0) {
                continue;
            }
            dist[s] = 0;
            Queue<Integer> queue = new ArrayDeque<>();
            queue.add(s);
            while (!queue.isEmpty()) {
                int v = queue.remove();
                for (int w : g.adj(v)) {
                    if (dist[w] < 0) {
                        dist[w] = dist[v] + 1;
                        queue.add(w);
                    } else if (dist[w] % 2 == dist[v] % 2) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
}
