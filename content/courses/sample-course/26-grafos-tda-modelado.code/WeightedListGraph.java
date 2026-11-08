import java.util.ArrayList;
import java.util.List;

public class WeightedListGraph
        implements WeightedGraph {
    private final List<List<Edge>> lists;
    private int E;

    public WeightedListGraph(int V) {
        lists = new ArrayList<>();
        for (int v = 0; v < V; v++) {
            lists.add(new ArrayList<>());
        }
    }

    public void addEdge(int v, int w, int weight) {
        lists.get(v).add(new Edge(v, w, weight));
        lists.get(w).add(new Edge(w, v, weight));
        E++;
    }

    public int V() { return lists.size(); }
    public int E() { return E; }
    public Iterable<Edge> adj(int v) {
        return lists.get(v);
    }

    public boolean hasEdge(int v, int w) {
        for (Edge e : lists.get(v)) {
            if (e.to == w) {
                return true;
            }
        }
        return false;
    }
}
