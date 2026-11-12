import java.util.ArrayDeque;
import java.util.Queue;

public class BreadthFirstSearch {
    private final boolean[] marked;

    public BreadthFirstSearch(Graph g, int s) {
        marked = new boolean[g.V()];
        bfs(g, s);
    }

    private void bfs(Graph g, int s) {
        Queue<Integer> queue = new ArrayDeque<>();
        marked[s] = true;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int w : g.adj(v)) {
                if (!marked[w]) {
                    marked[w] = true;
                    queue.add(w);
                }
            }
        }
    }

    public boolean marked(int v) {
        return marked[v];
    }
}
