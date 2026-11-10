class Solution {
    static int celebrity(Graph g) {
        int V = g.V();
        int candidate = 0;
        for (int i = 1; i < V; i++) {
            if (g.hasEdge(candidate, i)) {
                candidate = i;
            }
        }
        for (int i = 0; i < V; i++) {
            if (i == candidate) {
                continue;
            }
            if (g.hasEdge(candidate, i)) {
                return -1;
            }
            if (!g.hasEdge(i, candidate)) {
                return -1;
            }
        }
        return candidate;
    }
}
