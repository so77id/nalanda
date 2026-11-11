public interface WeightedGraph {
    int V();
    int E();
    Iterable<Edge> adj(int v);
    boolean hasEdge(int v, int w);
    void addEdge(int v, int w, int weight);
}
