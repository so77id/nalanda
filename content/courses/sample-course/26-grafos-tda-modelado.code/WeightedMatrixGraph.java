import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class WeightedMatrixGraph implements WeightedGraph {
    private final int[][] weights;
    private int E;

    public WeightedMatrixGraph(int V) {
        weights = new int[V][V];
        for (int[] row : weights) {
            Arrays.fill(row, Integer.MAX_VALUE);
        }
    }

    public void addEdge(int v, int w, int weight) {
        if (weights[v][w] != Integer.MAX_VALUE) return;
        weights[v][w] = weight;
        weights[w][v] = weight;
        E++;
    }

    public int V() { return weights.length; }
    public int E() { return E; }

    public boolean hasEdge(int v, int w) {
        return weights[v][w] != Integer.MAX_VALUE;
    }

    public Iterable<Edge> adj(int v) {
        List<Edge> edges = new ArrayList<>();
        for (int w = 0; w < weights.length; w++) {
            if (weights[v][w] != Integer.MAX_VALUE) {
                edges.add(new Edge(v, w, weights[v][w]));
            }
        }
        return edges;
    }
}
