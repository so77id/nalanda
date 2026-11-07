import java.util.ArrayList;
import java.util.List;

public class AdjListDigraph implements Graph {
    private final List<List<Integer>> lists;
    private int E;

    public AdjListDigraph(int V) {
        lists = new ArrayList<>();
        for (int v = 0; v < V; v++) {
            lists.add(new ArrayList<>());
        }
    }

    public void addEdge(int v, int w) {
        lists.get(v).add(w);
        E++;
    }

    public int V() { return lists.size(); }
    public int E() { return E; }
    public Iterable<Integer> adj(int v) { return lists.get(v); }

    public boolean hasEdge(int v, int w) {
        for (int x : lists.get(v)) {
            if (x == w) {
                return true;
            }
        }
        return false;
    }
}
