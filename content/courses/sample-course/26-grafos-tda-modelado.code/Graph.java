public interface Graph {
    int V();
    int E();
    Iterable<Integer> adj(int v);
    boolean hasEdge(int v, int w);
    void addEdge(int v, int w);
}
