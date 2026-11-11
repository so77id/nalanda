import java.util.ArrayList;
import java.util.List;

public class AdjMatrixDigraph implements Graph {
    private final boolean[][] matrix;
    private int E;

    public AdjMatrixDigraph(int V) {
        matrix = new boolean[V][V];
    }

    public int V() { return matrix.length; }
    public int E() { return E; }

    public void addEdge(int v, int w) {
        if (matrix[v][w]) return;
        matrix[v][w] = true;
        E++;
    }

    public boolean hasEdge(int v, int w) {
        return matrix[v][w];
    }

    public Iterable<Integer> adj(int v) {
        List<Integer> neighbors = new ArrayList<>();
        for (int w = 0; w < matrix.length; w++) {
            if (matrix[v][w]) {
                neighbors.add(w);
            }
        }
        return neighbors;
    }
}
