import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

public class Topological {
    private final List<Integer> order = new ArrayList<>();
    private final boolean complete;

    public Topological(Graph g) {
        int[] inDegree = Graphs.inDegrees(g);
        Queue<Integer> sources = new LinkedList<>();
        for (int v = 0; v < g.V(); v++) {
            if (inDegree[v] == 0) {
                sources.add(v);
            }
        }
        while (!sources.isEmpty()) {
            int v = sources.remove();
            order.add(v);
            for (int w : g.adj(v)) {
                inDegree[w]--;
                if (inDegree[w] == 0) {
                    sources.add(w);
                }
            }
        }
        complete = order.size() == g.V();
    }

    public boolean hasOrder() {
        return complete;
    }

    public List<Integer> order() {
        return order;
    }
}
